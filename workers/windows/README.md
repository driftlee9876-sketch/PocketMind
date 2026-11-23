# PocketMind Windows GPU Worker

## Prerequisites

- Windows 10/11
- Python 3.10+
- A local OpenAI-compatible inference server with a model already loaded (for example llama.cpp server or an Ollama OpenAI-compatible endpoint)
- Network access to your PocketMind coordinator

This worker does not install CUDA drivers or download models. Configure and verify your local GPU inference server first.

## Configure PowerShell

```powershell
$env:POCKETMIND_COORDINATOR_URL = "https://your-coordinator.example"
$env:POCKETMIND_ENROLLMENT_TOKEN = "the-enrollment-token-from-your-server"
$env:POCKETMIND_LOCAL_LLM_URL = "http://127.0.0.1:8080"
$env:POCKETMIND_LOCAL_LLM_MODEL = "your-loaded-model-alias"
$env:POCKETMIND_MODEL_IDS = "qwen3-4b,qwen2.5-coder-7b"
$env:POCKETMIND_LOCAL_MODEL_MAP_JSON = '{"qwen3-4b":"qwen3:4b","qwen2.5-coder-7b":"qwen2.5-coder:7b"}'
$env:POCKETMIND_BACKEND = "cuda"
$env:POCKETMIND_GPU_AVAILABLE = "true"
python .\worker.py
```

Set `POCKETMIND_MODEL_IDS` only to model IDs that are genuinely loaded/available on the local endpoint. For CPU inference set `POCKETMIND_GPU_AVAILABLE=false` and `POCKETMIND_BACKEND=llama.cpp`. The worker tries `nvidia-smi` to detect NVIDIA CUDA GPU memory automatically and advertises the largest individual NVIDIA GPU memory value (rather than summing multiple cards). For other GPU backends, explicitly set `POCKETMIND_GPU_AVAILABLE=true` and `POCKETMIND_BACKEND` only after verifying the local server actually uses that GPU. GPU detection defaults to `auto` and fails closed (CPU is advertised otherwise). GPU memory/RAM can be supplied using `POCKETMIND_GPU_MEMORY_MB` and `POCKETMIND_RAM_MB`. The optional `POCKETMIND_LOCAL_MODEL_MAP_JSON` maps each PocketMind model ID to the actual local server model name; use it when the server hosts more than one model. The Worker pauses when battery is below `POCKETMIND_MIN_BATTERY` (default 50%) and AC power is not connected. Metered-network detection defaults to false and can be explicitly configured with `POCKETMIND_UNMETERED`; thermal state can be supplied with `POCKETMIND_THERMAL_STATE` when reliable telemetry is available.

The worker enrolls once, saves a per-worker token under `%APPDATA%\PocketMind\worker.json`, sends heartbeats, claims compatible jobs, invokes the local `/v1/chat/completions` endpoint, validates non-empty output, and reports success/failure. Delete that file and re-enroll if you need to rotate its token.

Keep the model server bound to localhost. Do not expose the local inference server to the network. Put the coordinator behind HTTPS and keep enrollment/API tokens secret.

## PocketMind Wired

The Windows Actions artifact contains `PocketMind-Wired.exe`. On a Windows host select Android Platform Tools' `adb.exe`, a GPU-enabled `llama-server.exe`, and a local GGUF. Connect one Android device with a data cable and authorize USB debugging. The host only uses the chosen USB device and loopback services.

For PC-only inference, click **USB 연결 시작**. On Android choose **모델 선택 → 유선 GPU 연결**, then enter the eight-digit code displayed on Windows. It expires in five minutes and is single-use. **새 연결 코드** issues another code for the same running model. Close the host to release the model, credentials, and USB forwards.

For experimental layer splitting, first press **태블릿 GPU 제공 시작** on the Android device. Enter its separate eight-digit GPU code in **태블릿 GPU 제공 코드** on Windows. Use a Windows llama.cpp build with GPU and RPC enabled, compatible with revision `a8f8294c45076538f4509754e4c79fc51a1a486b`. The bundled arm64 peer requires Vulkan, Android 9 or later, a visible app, USB debugging, and at least 20% battery. The app stops the peer on leaving the foreground, USB removal, or severe thermal status. No model download is required on the tablet. The launcher checks real layer offload and nonzero model buffers on each selected device before enabling chat. Performance depends on model size, drivers and cable speed.

The optional tunnel field accepts previously established private loopback RPC forwards. Each endpoint must belong to a trusted GPU peer. A passive cable cannot provide a network transport. The Android peer uses an abstract Unix socket restricted to the Android shell UID and does not listen on IP.
