import http.client
import json
import re
import secrets
import threading
import unittest
from http.server import ThreadingHTTPServer

from wired import Pairing, model_command, pairing_handler, private_peers, select_devices


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
