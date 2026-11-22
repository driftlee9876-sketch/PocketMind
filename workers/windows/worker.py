#!/usr/bin/env python3
"""PocketMind Windows GPU worker for an OpenAI-compatible local inference server.

Requires Python 3.10+. Tested by design against llama.cpp server / Ollama
OpenAI-compatible endpoints. No third-party Python packages are required.
"""

from __future__ import annotations

import json
import os
import ctypes
import subprocess
import platform
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

COORDINATOR_URL = os.environ.get("POCKETMIND_COORDINATOR_URL", "").rstrip("/")
ENROLLMENT_TOKEN = os.environ.get("POCKETMIND_ENROLLMENT_TOKEN", "")
LOCAL_LLM_URL = os.environ.get("POCKETMIND_LOCAL_LLM_URL", "http://127.0.0.1:8080").rstrip("/")
LOCAL_LLM_MODEL = os.environ.get("POCKETMIND_LOCAL_LLM_MODEL", "local-model")
MODEL_IDS = [v.strip() for v in os.environ.get("POCKETMIND_MODEL_IDS", "").split(",") if v.strip()]
BACKEND = os.environ.get("POCKETMIND_BACKEND", "cuda")
GPU_SETTING = os.environ.get("POCKETMIND_GPU_AVAILABLE", "auto").lower()
GPU_MEMORY_OVERRIDE_MB = int(os.environ.get("POCKETMIND_GPU_MEMORY_MB", "0") or 0)
RAM_MB = int(os.environ.get("POCKETMIND_RAM_MB", "0") or 0)
MIN_BATTERY = int(os.environ.get("POCKETMIND_MIN_BATTERY", "50"))
POLL_SECONDS = max(2, int(os.environ.get("POCKETMIND_POLL_SECONDS", "5")))
MAX_TOKENS = min(8192, max(64, int(os.environ.get("POCKETMIND_MAX_TOKENS", "2048"))))
CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "PocketMind"
CONFIG_FILE = CONFIG_DIR / "worker.json"


def request_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None,
                 headers: dict[str, str] | None = None, timeout: int = 30) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request_headers = {"Accept": "application/json"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(2_000_000)
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read(2000).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def machine_id() -> str:
    seed = f"{platform.node()}:{uuid.getnode()}"
    import hashlib
    return "win-" + hashlib.sha256(seed.encode()).hexdigest()[:24]


def load_token() -> str:
    try:
        data = json.loads(CONFIG_FILE.read_text("utf-8"))
        token = data.get("workerToken", "")
        if isinstance(token, str) and len(token) >= 32:
            return token
    except (OSError, ValueError, TypeError):
        pass
    return ""


def save_token(token: str) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    temp = CONFIG_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps({"workerToken": token}, indent=2), encoding="utf-8")
    try:
        os.chmod(temp, 0o600)
    except OSError:
        pass
    temp.replace(CONFIG_FILE)


class SYSTEM_POWER_STATUS(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", ctypes.c_ulong),
        ("BatteryFullLifeTime", ctypes.c_ulong),
    ]


def device_power_status() -> tuple[bool, int]:
    """Read Windows AC/battery status. Unknown/no battery is treated conservatively."""
    try:
        status = SYSTEM_POWER_STATUS()
        ok = ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status))
        if not ok:
            return False, 0
        no_battery = bool(status.BatteryFlag & 128)
        battery = int(status.BatteryLifePercent) if status.BatteryLifePercent <= 100 else 100
        charging = status.ACLineStatus == 1 or no_battery
        return charging, battery
    except Exception:
        return False, 0


def gpu_capabilities() -> tuple[bool, int, str]:
    """Detect NVIDIA GPUs via nvidia-smi; otherwise require explicit opt-in."""
    try:
        if GPU_SETTING in {"0", "false", "no"}:
            return False, 0, "llama.cpp"
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=True,
        )
        values = [int(line.strip()) for line in result.stdout.splitlines() if line.strip().isdigit()]
        if values:
            return True, GPU_MEMORY_OVERRIDE_MB or sum(values), os.environ.get("POCKETMIND_BACKEND", "cuda")
    except Exception:
        pass
    explicitly_enabled = GPU_SETTING in {"1", "true", "yes"}
    backend = os.environ.get("POCKETMIND_BACKEND", "unknown" if not explicitly_enabled else "llama.cpp")
    return explicitly_enabled, GPU_MEMORY_OVERRIDE_MB, backend


def system_ram_mb() -> int:
    if RAM_MB > 0:
        return RAM_MB
    try:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullTotalPhys // (1024 * 1024))
    except Exception:
        pass
    return 0


def conditions() -> dict[str, Any]:
    charging, battery = device_power_status()
    thermal = os.environ.get("POCKETMIND_THERMAL_STATE", "unknown").lower()
    if thermal not in {"nominal", "fair", "serious", "critical", "unknown"}:
        thermal = "unknown"
    return {
        "charging": charging,
        "batteryPercent": battery,
        "thermalState": thermal,
        # Windows does not expose a reliable, portable metered-network signal
        # in the standard library; require explicit operator configuration.
        "unmeteredNetwork": os.environ.get("POCKETMIND_UNMETERED", "false").lower() in {"1", "true", "yes"},
        "userOptedIn": True,
    }


def enroll() -> str:
    if not COORDINATOR_URL or not ENROLLMENT_TOKEN:
        raise RuntimeError("Set POCKETMIND_COORDINATOR_URL and POCKETMIND_ENROLLMENT_TOKEN.")
    if not MODEL_IDS:
        raise RuntimeError("Set POCKETMIND_MODEL_IDS to the model IDs loaded by your local inference server.")
    gpu_available, gpu_memory_mb, backend = gpu_capabilities()
    ad = {
        "workerId": machine_id(),
        "displayName": os.environ.get("POCKETMIND_WORKER_NAME", socket.gethostname()),
        "capabilities": {
            "platform": "windows",
            "backend": backend,
            "modelIds": MODEL_IDS,
            "gpu": gpu_available,
            "gpuMemoryMb": gpu_memory_mb,
            "ramMb": system_ram_mb(),
            "maxConcurrentTasks": 1,
        },
        "conditions": conditions(),
    }
    data = request_json(
        COORDINATOR_URL + "/v1/workers/enroll",
        "POST",
        ad,
        {"X-Enrollment-Token": ENROLLMENT_TOKEN},
    )
    token = data.get("workerToken")
    if not isinstance(token, str) or len(token) < 32:
        raise RuntimeError("Coordinator did not issue a worker token.")
    save_token(token)
    print(f"Enrolled as {ad['workerId']} ({ad['displayName']}).")
    return token


def call_local_model(payload: dict[str, Any], model_id: str) -> str:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("Task has no chat messages.")
    request_body = {
        "model": LOCAL_LLM_MODEL or model_id,
        "messages": messages,
        "temperature": float(payload.get("temperature", 0.6)),
        "max_tokens": min(MAX_TOKENS, int(payload.get("max_tokens", MAX_TOKENS))),
        "stream": False,
    }
    result = request_json(
        LOCAL_LLM_URL + "/v1/chat/completions",
        "POST",
        request_body,
        timeout=600,
    )
    output = result.get("choices", [{}])[0].get("message", {}).get("content")
    if not isinstance(output, str) or not output.strip():
        raise RuntimeError("Local model returned an empty response.")
    return output.strip()


def keep_lease_alive(stop_event: Event, base_url: str, token: str) -> None:
    headers = {"Authorization": "Bearer " + token}
    while not stop_event.wait(20):
        try:
            request_json(
                base_url + "/v1/workers/heartbeat",
                "POST",
                {"state": "busy", "conditions": conditions()},
                headers,
                timeout=15,
            )
        except Exception as error:
            print(f"Heartbeat warning: {error}", file=sys.stderr)


def main() -> int:
    if not COORDINATOR_URL:
        print("Missing POCKETMIND_COORDINATOR_URL.", file=sys.stderr)
        return 2
    token = load_token()
    if not token:
        token = enroll()
    headers = {"Authorization": "Bearer " + token}
    print("PocketMind Windows worker started. Ctrl+C to stop.")
    while True:
        try:
            request_json(
                COORDINATOR_URL + "/v1/workers/heartbeat",
                "POST",
                {"state": "idle", "conditions": conditions()},
                headers,
                timeout=15,
            )
            claimed = request_json(
                COORDINATOR_URL + "/v1/tasks/claim",
                "POST",
                {"modelIds": MODEL_IDS},
                headers,
                timeout=20,
            ).get("task")
            if not claimed:
                time.sleep(POLL_SECONDS)
                continue

            task_id = claimed["taskId"]
            lease_id = claimed["leaseId"]
            model_id = claimed["modelId"]
            print(f"Task {task_id}: {model_id}")
            heartbeat_stop = Event()
            heartbeat_thread = Thread(
                target=keep_lease_alive,
                args=(heartbeat_stop, COORDINATOR_URL, token),
                daemon=True,
            )
            heartbeat_thread.start()
            try:
                output = call_local_model(claimed.get("payload", {}), model_id)
                request_json(
                    f"{COORDINATOR_URL}/v1/tasks/{task_id}/result",
                    "POST",
                    {"leaseId": lease_id, "modelId": model_id, "output": output},
                    headers,
                    timeout=30,
                )
                print(f"Task {task_id} completed.")
            except Exception as error:
                print(f"Task {task_id} failed: {error}", file=sys.stderr)
                try:
                    request_json(
                        f"{COORDINATOR_URL}/v1/tasks/{task_id}/fail",
                        "POST",
                        {"leaseId": lease_id, "error": str(error)[:1000]},
                        headers,
                        timeout=20,
                    )
                except Exception as report_error:
                    print(f"Could not report failure: {report_error}", file=sys.stderr)
            finally:
                heartbeat_stop.set()
                heartbeat_thread.join(timeout=3)
        except KeyboardInterrupt:
            print("Stopping worker.")
            return 0
        except Exception as error:
            print(f"Coordinator error: {error}", file=sys.stderr)
            time.sleep(max(POLL_SECONDS, 10))


if __name__ == "__main__":
    raise SystemExit(main())
