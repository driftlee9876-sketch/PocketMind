"""Connect a paired Apple USB device to llama.cpp through a private, authenticated loopback relay."""
from __future__ import annotations

import re
import select
import socket
import socketserver
import subprocess
import threading
import time


def receive_line(connection):
    result = bytearray()
    while len(result) < 80:
        value = connection.recv(1)
        if value == b"\n":
            return bytes(result)
        if not value:
            break
        result.extend(value)
    raise OSError("Invalid USB handshake")


def pair_apple(tunnel, code):
    if not re.fullmatch(r"[0-9]{8}", code):
        raise ValueError("iPhone 또는 iPad에 표시된 GPU 코드 8자리를 입력하세요.")
    with socket.create_connection(tunnel, timeout=3) as connection:
        connection.sendall(b"PAIR " + code.encode("ascii") + b"\n")
        response = receive_line(connection)
        if not re.fullmatch(rb"OK [0-9a-f]{64}", response):
            raise ValueError("Apple 기기의 GPU 코드와 컴퓨터 신뢰 설정을 확인하세요.")
        return response[3:]


class Relay(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def __init__(self, tunnel, token):
        self.tunnel, self.token = tunnel, token
        self.closing = threading.Event()
        super().__init__(("127.0.0.1", 0), RelayConnection)

    def handle_error(self, *_):
        pass  # A closed cable ends this stream. No prompts or credentials are logged.


class RelayConnection(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.create_connection(self.server.tunnel, timeout=4) as mobile:
            mobile.sendall(b"RPC " + self.server.token + b"\n")
            if receive_line(mobile) != b"OK":
                return
            mobile.settimeout(None)
            while not self.server.closing.is_set():
                readable, _, _ = select.select([self.request, mobile], [], [], 0.5)
                for source in readable:
                    chunk = source.recv(128 * 1024)
                    if not chunk:
                        return
                    (mobile if source is self.request else self.request).sendall(chunk)


def apple_endpoint(iproxy, code, stopped, cleanup, stop_process):
    # iproxy --local selects a physical USB connection and excludes wireless pairing.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        host_port = reservation.getsockname()[1]
    child = subprocess.Popen([iproxy, "--local", "--source", "127.0.0.1", f"{host_port}:18790"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    cleanup.callback(stop_process, child)
    tunnel = ("127.0.0.1", host_port)
    for _ in range(25):
        if stopped.wait(0.2) or child.poll() is not None:
            raise ValueError("Apple USB 연결을 시작하지 못했어요.")
        try:
            token = pair_apple(tunnel, code)
            break
        except ConnectionRefusedError:
            continue
        except OSError as error:
            raise ValueError("Apple 기기에 PocketMind를 열고 컴퓨터를 신뢰해 주세요.") from error
    else:
        raise ValueError("Apple USB 터널이 응답하지 않아요.")
    relay = Relay(tunnel, token)
    cleanup.callback(relay.server_close)
    threading.Thread(target=relay.serve_forever, daemon=True).start()
    cleanup.callback(relay.shutdown)
    cleanup.callback(relay.closing.set)
    return "127.0.0.1:" + str(relay.server_address[1])
