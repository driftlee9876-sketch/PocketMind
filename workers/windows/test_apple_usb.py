import contextlib
import socket
import threading
import unittest
from socketserver import BaseRequestHandler, ThreadingTCPServer

from apple_usb import Relay, pair_apple, receive_line


class ApplePeerFixture(BaseRequestHandler):
    def handle(self):
        handshake = receive_line(self.request)
        if handshake == b"PAIR 12345678":
            self.request.sendall(b"OK " + b"a" * 64 + b"\n")
        elif handshake == b"RPC " + b"a" * 64:
            self.request.sendall(b"OK\n")
            self.request.sendall(self.request.recv(100))
        else:
            self.request.sendall(b"DENIED\n")


class AppleUsbTests(unittest.TestCase):
    def test_authenticated_relay_preserves_binary_payloads(self):
        with contextlib.ExitStack() as stack:
            peer = stack.enter_context(ThreadingTCPServer(("127.0.0.1", 0), ApplePeerFixture))
            threading.Thread(target=peer.serve_forever, daemon=True).start()
            stack.callback(peer.shutdown)
            with self.assertRaises(ValueError):
                pair_apple(peer.server_address, "00000000")
            token = pair_apple(peer.server_address, "12345678")
            relay = stack.enter_context(Relay(peer.server_address, token))
            threading.Thread(target=relay.serve_forever, daemon=True).start()
            stack.callback(relay.shutdown)
            stack.callback(relay.closing.set)
            with socket.create_connection(relay.server_address, timeout=2) as client:
                value = bytes(range(32))
                client.sendall(value)
                self.assertEqual(client.makefile("rb").read(len(value)), value)
