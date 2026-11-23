"""Run a local GGUF for a user-authorized USB tablet. Python 3.10+, standard library."""
from __future__ import annotations

import contextlib
import hmac
import json
from pathlib import Path
import queue
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from apple_usb import apple_endpoint

LOOPBACK = "127.0.0.1"
PAIR_PORT = 18788
MODEL_PORT = 18789


def private_peers(value):
    """Accept only explicit loops into previously paired, private GPU transports."""
    peers = [part.strip() for part in value.split(",") if part.strip()]
    for peer in peers:
        match = re.fullmatch(r"127\.0\.0\.1:([0-9]{1,5})", peer)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise ValueError("이미 연결한 전용 터널의 127.0.0.1:포트 주소만 입력하세요.")
    if len(peers) > 4 or len(set(peers)) != len(peers):
        raise ValueError("중복 없는 보조 기기를 최대 네 대까지 선택하세요.")
    return peers


def select_devices(listing, peers):
    local = []
    remote = {}
    for line in listing.splitlines():
        match = re.match(r"^\s*([A-Za-z][\w.-]*):\s+(.+?)\s*\(", line)
        if not match:
            continue
        name, description = match.groups()
        if name.startswith("RPC"):
            if description.strip() in peers:
                remote[description.strip()] = name
        elif re.match(r"^(CUDA|Vulkan|ROCm|HIP|Metal|SYCL|OpenCL|CANN|MUSA)", name, re.I):
            local.append(name)
    if not local or any(peer not in remote for peer in peers):
        raise ValueError("PC GPU 또는 지정한 보조 장치를 llama.cpp에서 찾지 못했어요.")
    return [local[0], *(remote[peer] for peer in peers)]


def model_command(executable, model, port, key_file, devices, peers):
    args = [str(executable), "-m", str(model), "--host", LOOPBACK, "--port", str(port),
            "--api-key-file", str(key_file), "--alias", "pocketmind-wired", "--ctx-size", "4096",
            "--n-gpu-layers", "99", "--device", ",".join(devices)]
    if peers:
        args.extend(["--rpc", ",".join(peers), "--split-mode", "layer",
                     "--tensor-split", ",".join(["1"] * len(devices))])
    return args


class Pairing:
    def __init__(self, token, model, devices):
        self.lock = threading.Lock()
        self.session = {"service": "pocketmind-wired", "token": token, "model": model, "device": ", ".join(devices)}
        self.renew()

    def renew(self):
        with self.lock:
            self.code = f"{secrets.randbelow(100_000_000):08}"
            self.expires = time.monotonic() + 300
            self.attempts = 0
            return self.code

    def exchange(self, candidate):
        with self.lock:
            if self.attempts >= 5 or self.expires < time.monotonic():
                return None
            self.attempts += 1
            if not isinstance(candidate, str) or not re.fullmatch(r"[0-9]{8}", candidate) or not hmac.compare_digest(self.code, candidate):
                return None
            self.expires = 0
            return dict(self.session)


def pairing_handler(pairing):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != "/pair" or self.headers.get("Origin") or self.headers.get_content_type() != "application/json":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 256:
                    raise ValueError()
                self.connection.settimeout(3)
                data = json.loads(self.rfile.read(length))
                result = pairing.exchange(data["code"])
            except (TypeError, ValueError, KeyError, OSError):
                self.send_error(400)
                return
            body = json.dumps(result or {}, ensure_ascii=False).encode()
            self.send_response(200 if result else 403)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Handler


def command(args, timeout=8):
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace",
                            timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError("장치 또는 실행 파일이 응답하지 않았어요. USB 디버깅 승인과 GPU 지원 빌드를 확인하세요.")
    return result.stdout + result.stderr


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def remove_mapping(adb, serial, remote_port, host_port):
    try:
        entries = command([adb, "-s", serial, "reverse", "--list"]).splitlines()
        if any(line.split()[-2:] == [f"tcp:{remote_port}", f"tcp:{host_port}"] for line in entries):
            command([adb, "-s", serial, "reverse", "--remove", f"tcp:{remote_port}"])
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        pass


def start_host(adb, executable, model, raw_peers, tablet_code, apple_code, iproxy, stopped, events):
    peers = private_peers(raw_peers)
    if tablet_code and not re.fullmatch(r"[0-9]{8}", tablet_code):
        raise ValueError("태블릿에 표시된 GPU 제공 코드 8자리를 입력하세요.")
    serial = command([adb, "-d", "get-serialno"]).strip()
    if not serial or serial == "unknown":
        raise ValueError("USB로 연결한 Android 기기 한 대를 확인하세요.")
    with contextlib.ExitStack() as cleanup:
        if tablet_code:
            target = "localabstract:pocketmind_gpu_" + tablet_code
            allocated_port = command([adb, "-s", serial, "forward", "tcp:0", target]).strip()
            if not allocated_port.isdecimal():
                raise RuntimeError("태블릿 GPU에 전용 USB 통로를 열 수 없어요.")
            def remove_forward():
                try:
                    entries = command([adb, "-s", serial, "forward", "--list"]).splitlines()
                    if any(line.split() == [serial, "tcp:" + allocated_port, target] for line in entries):
                        command([adb, "-s", serial, "forward", "--remove", "tcp:" + allocated_port])
                except (OSError, RuntimeError, subprocess.TimeoutExpired):
                    pass
            cleanup.callback(remove_forward)
            peers.append(f"127.0.0.1:{allocated_port}")
        if apple_code:
            if not iproxy or not Path(iproxy).is_file():
                raise ValueError("iPhone용 libusbmuxd의 iproxy.exe를 선택하세요.")
            peers.append(apple_endpoint(iproxy, apple_code, stopped, cleanup, stop_process))
        args = [executable, "--list-devices"]
        if peers:
            args.extend(["--rpc", ",".join(peers)])
        devices = select_devices(command(args, timeout=25), peers)
        folder = Path(cleanup.enter_context(tempfile.TemporaryDirectory(prefix="pocketmind-wired-")))
        key_file = folder / "session.key"
        token = secrets.token_urlsafe(32)
        key_file.write_text(token, encoding="ascii")
        with socket.socket() as reservation:
            reservation.bind((LOOPBACK, 0))
            port = reservation.getsockname()[1]
        process = subprocess.Popen(model_command(executable, model, port, key_file, devices, peers),
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding="utf-8", errors="replace",
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        cleanup.callback(stop_process, process)
        gpu_loaded = threading.Event()
        allocated = set()
        allocation_lock = threading.Lock()

        def observe_loading():
            # Drain output without storing or displaying prompts, completions or file paths.
            with process.stdout as lines:
                for line in lines:
                    if re.search(r"offloaded\s+[1-9]\d*(?:/\d+)?\s+layers?\s+to GPU", line, re.I):
                        gpu_loaded.set()
                    match = re.search(r"(\w+)\s+model buffer size\s*=\s*([\d.]+)\s+MiB", line, re.I)
                    if match and match[1] in devices and float(match[2]) > 0:
                        with allocation_lock:
                            allocated.add(match[1])
        threading.Thread(target=observe_loading, daemon=True).start()
        deadline = time.monotonic() + 240
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while not stopped.wait(0.4):
            if process.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError("모델을 로드하지 못했어요. GGUF 파일, GPU 드라이버와 여유 메모리를 확인하세요.")
            try:
                request = urllib.request.Request(f"http://{LOOPBACK}:{port}/v1/models", headers={"Authorization": f"Bearer {token}"})
                with opener.open(request, timeout=2) as response:
                    if any(item.get("id") == "pocketmind-wired" for item in json.load(response).get("data", [])):
                        break
            except (OSError, ValueError):
                continue
        if stopped.is_set():
            return
        if not gpu_loaded.wait(2):
            raise RuntimeError("실제 GPU 레이어 적재를 확인할 수 없어요.")
        with allocation_lock:
            if peers and not set(devices).issubset(allocated):
                raise RuntimeError("모든 보조 장치에서 모델 분할 적재를 확인할 수 없어요.")
        pairing = Pairing(token, Path(model).stem, devices)
        server = ThreadingHTTPServer((LOOPBACK, 0), pairing_handler(pairing))
        cleanup.callback(server.server_close)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cleanup.callback(server.shutdown)
        for mobile_port, host_port in [(MODEL_PORT, port), (PAIR_PORT, server.server_port)]:
            command([adb, "-s", serial, "reverse", "--no-rebind", f"tcp:{mobile_port}", f"tcp:{host_port}"])
            cleanup.callback(remove_mapping, adb, serial, mobile_port, host_port)
        events.put(("ready", pairing))
        while not stopped.wait(2):
            if process.poll() is not None or command([adb, "-s", serial, "get-state"]).strip() != "device":
                raise RuntimeError("USB 기기 또는 로컬 모델 연결이 종료됐어요.")


def main():
    import tkinter as tk
    from tkinter import filedialog, ttk

    root = tk.Tk()
    root.title("PocketMind Wired")
    form = ttk.Frame(root, padding=18)
    form.pack(fill="both", expand=True)
    form.columnconfigure(1, weight=1)
    events = queue.Queue()
    active = None
    pairing = None
    stopped = threading.Event()
    for_row = []
    for row, (title, default) in enumerate([
        ("Android Platform Tools · adb.exe", shutil.which("adb") or ""),
        ("GPU 지원 llama-server.exe", shutil.which("llama-server") or ""),
        ("GGUF 모델", ""),
    ]):
        field = tk.StringVar(value=default)
        for_row.append(field)
        ttk.Label(form, text=title).grid(row=row, column=0, sticky="w", padx=4)
        ttk.Entry(form, textvariable=field, width=40).grid(row=row, column=1, sticky="ew", pady=4)
        def choose(field=field, model=row == 2):
            value = filedialog.askopenfilename(filetypes=[("GGUF" if model else "실행 파일", "*.gguf" if model else "*.exe")])
            if value: field.set(value)
        ttk.Button(form, text="선택", command=choose).grid(row=row, column=2)
    tablet_code = tk.StringVar()
    ttk.Label(form, text="태블릿 GPU 제공 코드 (선택)").grid(row=3, column=0, sticky="w")
    ttk.Entry(form, textvariable=tablet_code).grid(row=3, column=1, columnspan=2, sticky="ew")
    peers = tk.StringVar()
    ttk.Label(form, text="다른 전용 GPU 터널 (선택)").grid(row=4, column=0, sticky="w")
    ttk.Entry(form, textvariable=peers).grid(row=4, column=1, columnspan=2, sticky="ew")
    apple_code = tk.StringVar()
    iproxy = tk.StringVar(value=shutil.which("iproxy") or "")
    ttk.Label(form, text="iPhone·iPad GPU 제공 코드 (선택)").grid(row=5, column=0, sticky="w")
    ttk.Entry(form, textvariable=apple_code).grid(row=5, column=1, sticky="ew")
    ttk.Label(form, text="Apple USB · iproxy.exe").grid(row=6, column=0, sticky="w")
    ttk.Entry(form, textvariable=iproxy).grid(row=6, column=1, sticky="ew")
    def select_iproxy():
        path = filedialog.askopenfilename(filetypes=[("iproxy", "iproxy.exe")])
        if path: iproxy.set(path)
    ttk.Button(form, text="선택", command=select_iproxy).grid(row=6, column=2)
    status = tk.StringVar(value="Android 기기를 데이터 케이블로 연결하고 USB 디버깅을 허용하세요.")
    ttk.Label(form, textvariable=status, wraplength=530).grid(row=7, column=0, columnspan=3, sticky="w", pady=15)

    def run():
        nonlocal active, pairing
        if active and active.is_alive():
            stopped.set()
            return
        paths = [field.get().strip() for field in for_row]
        if not all(Path(item).is_file() for item in paths):
            status.set("adb.exe, llama-server.exe와 GGUF 파일을 선택하세요.")
            return
        stopped.clear()
        pairing = None
        peer_list = peers.get()
        selected_tablet_code = tablet_code.get().strip()
        apple = apple_code.get().strip()
        proxy_path = iproxy.get().strip()
        def worker():
            try:
                start_host(*paths, peer_list, selected_tablet_code, apple, proxy_path, stopped, events)
            except Exception as error:
                events.put(("error", str(error)))
            finally:
                events.put(("closed", None))
        status.set("USB와 GPU를 확인하고 모델을 불러오는 중…")
        start.configure(text="중지")
        active = threading.Thread(target=worker)
        active.start()

    def renew():
        if pairing: status.set("PocketMind 모델 선택 → 유선 GPU 연결 → " + pairing.renew())

    def poll():
        nonlocal pairing
        while not events.empty():
            kind, value = events.get()
            if kind == "ready":
                pairing = value
                status.set("PocketMind 모델 선택 → 유선 GPU 연결 → " + pairing.code)
            elif kind == "error": status.set(value)
            elif kind == "closed":
                pairing = None
                if stopped.is_set(): status.set("연결을 종료했어요.")
                start.configure(text="USB 연결 시작")
        root.after(150, poll)

    start = ttk.Button(form, text="USB 연결 시작", command=run)
    start.grid(row=8, column=0)
    ttk.Button(form, text="새 연결 코드", command=renew).grid(row=8, column=1)
    root.protocol("WM_DELETE_WINDOW", lambda: (stopped.set(), root.destroy()))
    poll()
    root.mainloop()


if __name__ == "__main__":
    main()
