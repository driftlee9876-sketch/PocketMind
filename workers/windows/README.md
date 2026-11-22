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

Set `POCKETMIND_MODEL_IDS` only to model IDs that are genuinely loaded/available on the local endpoint. For CPU inference set `POCKETMIND_GPU_AVAILABLE=false` and `POCKETMIND_BACKEND=llama.cpp`. The worker tries `nvidia-smi` to detect NVIDIA CUDA GPU memory automatically. For other GPU backends, explicitly set `POCKETMIND_GPU_AVAILABLE=true` and `POCKETMIND_BACKEND` only after verifying the local server actually uses that GPU. GPU detection defaults to `auto` and fails closed (CPU is advertised otherwise). GPU memory/RAM can be supplied using `POCKETMIND_GPU_MEMORY_MB` and `POCKETMIND_RAM_MB`. The optional `POCKETMIND_LOCAL_MODEL_MAP_JSON` maps each PocketMind model ID to the actual local server model name; use it when the server hosts more than one model.

The worker enrolls once, saves a per-worker token under `%APPDATA%\PocketMind\worker.json`, sends heartbeats, claims compatible jobs, invokes the local `/v1/chat/completions` endpoint, validates non-empty output, and reports success/failure. Delete that file and re-enroll if you need to rotate its token.

Keep the model server bound to localhost. Do not expose the local inference server to the network. Put the coordinator behind HTTPS and keep enrollment/API tokens secret.
