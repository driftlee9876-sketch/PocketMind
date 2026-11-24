import contextlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import secrets
import tempfile
import threading
import urllib.request
import unittest
from http.server import ThreadingHTTPServer

from wired import allocated_device, rpc_options, Pairing, model_command, pairing_handler, private_peers, select_devices


class WiredTests(unittest.TestCase):
    def test_host_requires_real_local_gpu_and_every_requested_peer(self):
        peers = private_peers("127.0.0.1:50052")
        listing = "Available devices:\n  Vulkan0: Radeon (1024 MiB, 800 MiB free)\n  RPC0: 127.0.0.1:50052 (512 MiB)"
        devices = select_devices(listing, peers)
        args = model_command("llama-server", "model.gguf", 8080, "secret.file", devices, peers)
        self.assertEqual(args[args.index("--device") + 1], "Vulkan0,RPC0")
        self.assertEqual(args[args.index("--tensor-split") + 1], "1,1")
        self.assertEqual(args[args.index("--host") + 1], "127.0.0.1")
        with self.assertRaises(ValueError): select_devices(" CPU: Generic (1024 MiB)", [])
        with self.assertRaises(ValueError): select_devices(listing, ["127.0.0.1:50053"])
        for item in ["192.168.1.2:50052", "127.0.0.1:65536", "localhost.example:80"]:
            with self.assertRaises(ValueError): private_peers(item)

    def test_rpc_registration_order_and_multiple_remote_buffer_names(self):
        peers = ["127.0.0.1:4001", "127.0.0.1:4002"]
        devices = ["Vulkan0", "RPC0", "RPC1"]
        self.assertEqual(rpc_options(peers), ["--rpc", ",".join(peers)])
        args = model_command("llama-server", "test.gguf", 8080, "key.file", devices, peers)
        self.assertLess(args.index("--rpc"), args.index("--device"))
        for line, expected in [
            ("load_tensors: Vulkan0 model buffer size = 200.50 MiB", "Vulkan0"),
            ("load_tensors: RPC0[127.0.0.1:4002] model buffer size = 100.00 MiB", "RPC1"),
            ("load_tensors: RPC0[127.0.0.1:4001] model buffer size = 90.43 MiB", "RPC0"),
            ("load_tensors: RPC0[127.0.0.1:4001] model buffer size = 0.00 MiB", None),
            ("load_tensors: CPU_Mapped model buffer size = 20.00 MiB", None),
        ]:
            self.assertEqual(allocated_device(line, devices, peers), expected)

    @unittest.skipUnless(os.getenv("POCKETMIND_TEST_LLAMA_RUNTIME"), "requires packaged Windows runtime")
    def test_packaged_runtime_generates_across_two_loopback_rpc_peers(self):
        runtime = Path(os.environ["POCKETMIND_TEST_LLAMA_RUNTIME"]).resolve()
        model = Path(os.environ["POCKETMIND_TEST_GGUF"]).resolve()
        peer_exe = next(runtime.glob("*rpc-server.exe"))

        def free_port():
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                return reservation.getsockname()[1]

        def stop(process):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(4)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(4)

        with tempfile.TemporaryDirectory() as temp, contextlib.ExitStack() as cleanup:
            endpoints = []
            for _ in range(2):
                port = free_port()
                peer = subprocess.Popen([peer_exe, "--host", "127.0.0.1", "--port", str(port), "--device", "CPU"],
                                        cwd=runtime, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                cleanup.callback(stop, peer)
                for _ in range(100):
                    self.assertIsNone(peer.poll(), "Packaged rpc-server stopped")
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                            break
                    except OSError:
                        time.sleep(0.1)
                endpoints.append("127.0.0.1:" + str(port))

            executable = runtime / "llama-server.exe"
            devices = ["RPC0", "RPC1"]
            listing = subprocess.run([executable, *rpc_options(endpoints), "--list-devices"],
                                     cwd=runtime, capture_output=True, timeout=30, check=True)
            for name, endpoint in zip(devices, endpoints):
                self.assertIn((name + ": " + endpoint).encode(), listing.stdout + listing.stderr)

            key_file = Path(temp, "key.txt")
            token = secrets.token_urlsafe(32)
            key_file.write_text(token, encoding="ascii")
            logs = Path(temp, "load.log")
            log = cleanup.enter_context(logs.open("w", encoding="utf-8"))
            port = free_port()
            args = model_command(executable, model, port, key_file, devices, endpoints)
            host = subprocess.Popen(args, cwd=runtime, stdout=log, stderr=log)
            cleanup.callback(stop, host)
            base = "http://127.0.0.1:" + str(port)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(200):
                self.assertIsNone(host.poll(), "Packaged inference server stopped")
                try:
                    with opener.open(base + "/health", timeout=1) as response:
                        if json.load(response).get("status") == "ok":
                            break
                except OSError:
                    pass
                time.sleep(0.1)
            request = urllib.request.Request(base + "/v1/completions",
                data=json.dumps({"model": "pocketmind-wired", "prompt": "Once upon a time", "max_tokens": 8}).encode(),
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with opener.open(request, timeout=30) as response:
                result = json.load(response)
            self.assertGreater(result["usage"]["completion_tokens"], 0)
            self.assertTrue(result["choices"][0]["text"].strip())
            lines = logs.read_text(encoding="utf-8", errors="replace").splitlines()
            allocations = {allocated_device(line, ["host", *devices], endpoints) for line in lines}
            self.assertTrue(set(devices).issubset(allocations), "Each peer must contain a nonzero model allocation")

    def test_pairing_is_one_time_and_attempt_limited(self):
        pair = Pairing(secrets.token_urlsafe(32), "model", ["Vulkan0"])
        self.assertRegex(pair.code, re.compile(r"^\d{8}$"))
        for _ in range(5): self.assertIsNone(pair.exchange("invalid"))
        self.assertIsNone(pair.exchange(pair.code))
        fresh = pair.renew()
        self.assertEqual(pair.exchange(fresh)["service"], "pocketmind-wired")
        self.assertIsNone(pair.exchange(fresh))
        pair.renew()
        pair.expires = 0
        self.assertIsNone(pair.exchange(pair.code))

    def test_loopback_pairing_endpoint(self):
        pair = Pairing(secrets.token_urlsafe(32), "model", ["CUDA0"])
        with ThreadingHTTPServer(("127.0.0.1", 0), pairing_handler(pair)) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                for expected in [200, 403]:
                    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                    conn.request("POST", "/pair", json.dumps({"code": pair.code}), {"Content-Type": "application/json"})
                    response = conn.getresponse()
                    self.assertEqual(response.status, expected)
                    if expected == 200: self.assertEqual(json.load(response)["token"], pair.session["token"])
                    conn.close()
            finally:
                server.shutdown()
