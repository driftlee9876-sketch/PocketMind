"""Foreground Wi-Fi Vulkan donor for the Android PocketMind model host."""
import ctypes
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import time


class Transport:
    def __init__(self, bundle):
        self.lib = ctypes.CDLL(str(bundle / "runtime" / "pmwifi.dll"))
        self.lib.PMWifi.argtypes = [ctypes.c_char_p]
        self.lib.PMWifi.restype = ctypes.c_void_p
        self.lib.PMWifiFree.argtypes = [ctypes.c_void_p]
        self.lib.PMWifiFree.restype = None
        self.call("init", Dir=str(Path(os.environ["LOCALAPPDATA"]) / "PocketMind" / "wifi-gpu"))

    def call(self, op, **args):
        raw = self.lib.PMWifi(json.dumps({"Op": op, **args}).encode())
        try:
            state = json.loads(ctypes.string_at(raw))
        finally:
            self.lib.PMWifiFree(raw)
        if "error" in state:
            raise ValueError(state["error"])
        return state


def interfaces():
    import psutil
    rows = {}
    for name, addresses in psutil.net_if_addrs().items():
        state = psutil.net_if_stats().get(name)
        if not state or not state.isup:
            continue
        for addr in addresses:
            if addr.family != socket.AF_INET or not addr.netmask:
                continue
            link = ipaddress.IPv4Interface(f"{addr.address}/{addr.netmask}")
            if link.ip in ipaddress.ip_network("100.64.0.0/10") and "tailscale" in name.lower():
                rows[f"Tailscale · {link.ip}"] = {"Local": str(link.ip), "Prefix": 10, "Mesh": True}
                continue
            if link.ip.is_loopback or not link.ip.is_private or not 1 <= link.network.prefixlen <= 30:
                continue
            rows[f"{name} · {link.ip}"] = {"Local": str(link.ip), "Prefix": link.network.prefixlen}
    rows["다른 Wi-Fi · PocketMind 인터넷 연결"] = {"Internet": True}
    return rows


def open_wifi(root, bundle):
    import tkinter as tk
    from tkinter import ttk
    from zeroconf import ServiceInfo, Zeroconf, IPVersion
    window = tk.Toplevel(root)
    window.title("PocketMind · Wi-Fi GPU 제공")
    frame = ttk.Frame(window, padding=18)
    frame.pack()
    status = tk.StringVar(value="태블릿과 같은 네트워크를 선택하세요.")
    invite = tk.StringVar()
    rows = interfaces()
    choice = tk.StringVar(value=next(iter(rows), ""))
    ttk.Combobox(frame, textvariable=choice, values=list(rows), state="readonly", width=42).pack(fill="x")
    ttk.Label(frame, textvariable=status, wraplength=400).pack(pady=10)
    try:
        transport = Transport(bundle)
    except Exception as exc:
        status.set(str(exc))
        return
    process = zc = advert = endpoint = challenge = None
    deadline = 0
    advertised = False

    def stop():
        nonlocal process, zc, advert, endpoint, challenge, advertised
        advertised = False
        invite.set("")
        transport.call("stop")
        if zc:
            try:
                if advert:
                    zc.unregister_service(advert)
            finally:
                zc.close()
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(3)
            except subprocess.TimeoutExpired:
                process.kill()
        process = zc = advert = endpoint = challenge = None
        status.set("GPU 제공이 중지됐어요.")

    def announce():
        nonlocal zc, advert, advertised
        if endpoint.get("Internet"):
            transport.call("offerInternet",Backend="windows",Value=str(port[0]))
            advertised = True
            return
        state = transport.call("offer", Endpoint=endpoint, Backend="windows", Value=str(port[0]))
        if endpoint.get("Mesh"):
            invite.set(f"pmgpu1|{endpoint['Local']}|{state['id']}")
            advertised = True
            return
        service = "_pmgpu._tcp.local."
        safe_name = socket.gethostname().split(".")[0][:26]
        advert = ServiceInfo(service, f"PocketMind {safe_name}.{service}", port=state["port"],
                             addresses=[socket.inet_aton(endpoint["Local"])],
                             properties={"id":state["id"],"platform":"Windows"},
                             server=f"pm-{state['id'][:10].lower().replace('_','x')}.local.")
        zc = Zeroconf(interfaces=[endpoint["Local"]], ip_version=IPVersion.V4Only)
        zc.register_service(advert, allow_name_change=True)
        advertised = True

    port = [0]
    def start():
        nonlocal process, endpoint, deadline
        if process:
            stop()
            return
        try:
            endpoint = rows[choice.get()]
            binary = bundle / "runtime" / "ggml-rpc-server.exe"
            with socket.socket() as reserved:
                reserved.bind(("127.0.0.1", 0))
                port[0] = reserved.getsockname()[1]
            process = subprocess.Popen([str(binary),"--host","127.0.0.1","--port",str(port[0]),"--device","Vulkan0"],
                                       cwd=binary.parent, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            deadline = time.monotonic()+35
            status.set("Vulkan GPU를 확인하고 있어요…")
        except Exception as exc:
            stop()
            status.set(str(exc))

    def vote(accept):
        if challenge:
            try:
                transport.call("vote",Challenge=challenge["id"],Accept=accept)
            except ValueError as exc:
                status.set(str(exc))
    def forget():
        stop()
        transport.call("forget")
        status.set("저장한 기기 승인을 지웠어요.")
    def poll():
        nonlocal challenge
        try:
            if process:
                if process.poll() is not None or endpoint not in interfaces().values():
                    raise RuntimeError("GPU 또는 네트워크 연결이 종료됐어요.")
                if not advertised:
                    try:
                        with socket.create_connection(("127.0.0.1",port[0]),timeout=.15):
                            pass
                    except OSError:
                        if time.monotonic()>deadline:
                            raise RuntimeError("Vulkan GPU가 준비되지 않았어요.")
                    else:
                        announce()
                if advertised:
                    state=transport.call("status")
                    challenge=state.get("pending")
                    if endpoint.get("Internet"):
                        invite.set(state["relayInvitation"])
                    status.set(("태블릿과 같은 코드인지 확인하세요 · "+challenge["code"]) if challenge else
                               state.get("issue") or ("원격 초대를 복사해 모델이 있는 기기에 붙여넣으세요." if invite.get() else "중계 서버에 연결하는 중…" if endpoint.get("Internet") else "Wi-Fi GPU 제공 중 · 태블릿에서 이 PC를 선택하세요."))
            approve.configure(state="normal" if challenge else "disabled")
            reject.configure(state="normal" if challenge else "disabled")
        except Exception as exc:
            stop()
            status.set(str(exc))
        if window.winfo_exists():
            window.after(700,poll)
    ttk.Button(frame,text="GPU 제공 시작 / 중지",command=start).pack(fill="x")
    def copy_invite():
        if invite.get():
            root.clipboard_clear()
            root.clipboard_append(invite.get())
    ttk.Entry(frame,textvariable=invite,state="readonly").pack(fill="x")
    ttk.Button(frame,text="원격 초대 복사",command=copy_invite).pack(fill="x")
    approve=ttk.Button(frame,text="코드 일치 · 승인",command=lambda:vote(True));approve.pack(fill="x")
    reject=ttk.Button(frame,text="거절",command=lambda:vote(False));reject.pack(fill="x")
    ttk.Button(frame,text="연결 기기 잊기",command=forget).pack(fill="x")
    window.protocol("WM_DELETE_WINDOW",lambda:(stop(),window.destroy()))
    window.bind("<Destroy>",lambda e: stop() if e.widget == window and process else None)
    poll()
