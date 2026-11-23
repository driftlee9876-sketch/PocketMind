import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

sys.path.insert(0, os.environ["POCKETMIND_WINDOWS_SOURCE"])
from wired import allocated_device, model_command

peers = sys.argv[1:]
devices = ["RPC0", "RPC1"]
with tempfile.TemporaryDirectory() as tmp:
    key = Path(tmp, "key")
    token = secrets.token_urlsafe(32)
    key.write_text(token)
    logfile = Path(tmp, "log")
    with logfile.open("w") as log:
        host = subprocess.Popen(model_command(Path(os.environ["POCKETMIND_HOST"]), Path(os.environ["POCKETMIND_MODEL"]), 16605, key, devices, peers), stdout=log, stderr=log)
        try:
            for attempt in range(120):
                if host.poll() is not None:
                    raise RuntimeError("model server stopped")
                try:
                    with urlopen("http://127.0.0.1:16605/health", timeout=1) as response:
                        if json.load(response)["status"] == "ok":
                            break
                except OSError:
                    time.sleep(.25)
            request = Request("http://127.0.0.1:16605/v1/completions", data=json.dumps({"model":"pocketmind-wired","prompt":"Once upon a time","max_tokens":8}).encode(), headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
            with urlopen(request, timeout=45) as response:
                result = json.load(response)
            assert result["choices"][0]["text"].strip() and result["usage"]["completion_tokens"] > 0
            allocations = {allocated_device(line, ["host",*devices], peers) for line in logfile.read_text().splitlines()}
            assert set(devices).issubset(allocations), allocations
            print("Both authenticated peers hold model weights. Generated tokens:", result["usage"]["completion_tokens"])
        except Exception:
            print(logfile.read_text()[-10000:])
            raise
        finally:
            host.kill()
            host.wait()
