"""Run a PC GGUF with paired PocketMind GPU donors over the private network."""
import ipaddress
import json
from pathlib import Path
import queue
import re
import socket
import threading
from desktop_chat import DesktopChat

from wifi_offer import Transport, interfaces

SERVICE = "_pmgpu._tcp.local."


def mesh_peer(invite, local):
    parts = invite.strip().split("|")
    if len(parts) != 3 or parts[0] != "pmgpu1" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", parts[2]):
        raise ValueError("원격 GPU 초대를 확인하세요.")
    if not local.get("Mesh") or ipaddress.ip_address(parts[1]) not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError("두 기기에서 같은 Tailscale 네트워크를 선택하세요.")
    return dict(local, IP=parts[1], ID=parts[2], Port=47832)


def open_host(root, bundle, executable, model, loaded_model):
    import tkinter as tk
    from tkinter import filedialog, ttk
    from zeroconf import IPVersion, ServiceBrowser, ServiceListener, Zeroconf

    window = tk.Toplevel(root)
    window.title("PocketMind · Wi-Fi GPU로 대화")
    frame = ttk.Frame(window, padding=12)
    frame.pack(fill="both", expand=True)
    routes = interfaces()
    choice = tk.StringVar(value=next(iter(routes), ""))
    selector = ttk.Combobox(frame,textvariable=choice,values=list(routes),state="readonly")
    selector.pack(fill="x")
    status = tk.StringVar(value="연결할 네트워크를 선택하고 기기를 찾으세요.")
    notices = queue.Queue()
    peers = {}
    peer_keys = []
    session = None
    active = False
    closed = False
    generation = 0
    zc = browser = pending = None
    stopped = threading.Event()
    try:
        transport = Transport(bundle)
    except Exception as exc:
        status.set(str(exc))
        return window
    listing = tk.Listbox(frame, selectmode="extended", exportselection=False, height=4)
    listing.pack(fill="x")
    invite = tk.StringVar()
    ttk.Entry(frame,textvariable=invite).pack(fill="x")

    def redraw():
        chosen = {peer_keys[i] for i in listing.curselection()}
        by_id = {}
        for key, (_, endpoint) in peers.items():
            if endpoint["ID"] not in by_id or endpoint.get("near"):
                by_id[endpoint["ID"]] = key
        peer_keys[:] = list(by_id.values())
        listing.delete(0,"end")
        state = transport.call("status")
        trusted = state["trusted"]
        for i, key in enumerate(peer_keys):
            name, endpoint = peers[key]
            group = endpoint.get("Group","")
            if group:
                name = ("내 그룹" if group==state["group"] else "주변 그룹")+" "+group[:6]+" · "+name
            listing.insert("end",f"{name} · {endpoint.get('IP','인터넷')} · " + ("승인됨" if endpoint["ID"] in trusted or (state["group"] and state["group"]==endpoint.get("Group")) else "처음 연결"))
            if key in chosen:
                listing.selection_set(i)

    def stop_browse():
        nonlocal browser,zc,generation
        generation += 1
        if browser:
            browser.cancel()
        if zc:
            zc.close()
        browser = zc = None

    def browse():
        if active:
            raise ValueError("기기를 바꾸려면 실행 중인 모델을 먼저 중지하세요.")
        stop_browse()
        peers.clear()
        for endpoint in transport.call("status")["internetPeers"]:
            peers[endpoint["ID"]] = (endpoint["name"],endpoint)
        redraw()
        local = routes[choice.get()]
        if local.get("Mesh") or local.get("Internet"):
            status.set("갤탭의 원격 GPU 초대를 붙여넣고 추가하세요.")
            return
        own=transport.call("status")["id"]
        epoch = generation
        class Listener(ServiceListener):
            def remove_service(self, client, kind, name):
                notices.put(("lost",(epoch,name)))
            def add_service(self, client, kind, name):
                info = client.get_service_info(kind,name,timeout=2500)
                if not info:
                    return
                pin = info.properties.get(b"id",b"").decode("ascii",errors="ignore")
                if pin==own or not re.fullmatch(r"[A-Za-z0-9_-]{43}",pin):
                    return
                network = ipaddress.ip_network(f"{local['Local']}/{local['Prefix']}",strict=False)
                for addr in info.parsed_addresses(IPVersion.V4Only):
                    if ipaddress.ip_address(addr) in network:
                        endpoint = dict(local,IP=addr,ID=pin,Port=info.port,Group=info.properties.get(b"group",b"").decode("ascii",errors="ignore"),near=b"near" in info.properties)
                        notices.put(("found",(epoch,name,endpoint)))
                        return
            update_service = add_service
        zc = Zeroconf(interfaces=[local["Local"]],ip_version=IPVersion.V4Only)
        browser = ServiceBrowser(zc,SERVICE,Listener())
        status.set("같은 Wi-Fi에서 PocketMind가 열린 기기와 그룹을 찾고 있어요.")

    def add_remote():
        if active:
            raise ValueError("모델 실행을 먼저 중지하세요.")
        value = invite.get().strip()
        endpoint = transport.call("importInternet",Value=value) if value.startswith("pmgpu2|") else mesh_peer(value,routes[choice.get()])
        peers[endpoint["ID"]] = ("원격 GPU",endpoint)
        redraw()

    def selected(optional=False):
        result = [peers[peer_keys[i]][1] for i in listing.curselection()]
        if not result and not optional:
            raise ValueError("목록에서 갤탭을 선택하세요.")
        return result

    def pair():
        donors = selected()
        if active or len(donors)!=1:
            raise ValueError("처음 연결할 기기 한 대를 선택하세요.")
        transport.call("pair",Endpoint=donors[0])

    otp=tk.StringVar()
    ttk.Entry(frame,textvariable=otp).pack(fill="x")

    def vote(accept):
        if pending:
            if accept:
                transport.call("enter",Challenge=pending["id"],Value=otp.get())
            else:
                transport.call("vote",Challenge=pending["id"],Accept=False)
            otp.set("")

    def start():
        nonlocal active,model
        if active:
            stopped.set()
            return
        donors = selected(optional=True)
        if not Path(model).is_file():
            model = filedialog.askopenfilename(parent=window,filetypes=[("GGUF","*.gguf")])
        if not model:
            return
        if not Path(executable).is_file():
            raise ValueError("기본 창에서 llama-server.exe를 선택하고 다시 여세요.")
        # The bundled Windows runtime has 16 backend slots, including local GPU and CPU.
        if len(donors)>14:
            raise ValueError("이 Windows 실행기는 보조 GPU를 최대 14대까지 지원해요.")
        bridges = transport.call("bridges",Endpoints=donors)["bridges"] if donors else []
        stopped.clear()
        active = True
        status.set("보조 GPU에 모델 레이어를 올리고 있어요…")
        def run():
            try:
                progress = (lambda: transport.call("status")["relayBytes"]) if any(p.get("Relay") for p in donors) else None
                with loaded_model(executable,model,bridges,stopped,allow_remote_only=True,relay_progress=progress) as (port,token,devices,process):
                    notices.put(("ready",(port,token,devices)))
                    while not stopped.wait(.5):
                        if process.poll() is not None:
                            raise RuntimeError("모델 또는 GPU 연결이 종료됐어요.")
            except Exception as exc:
                notices.put(("error",str(exc)))
            finally:
                transport.call("stop")
                notices.put(("ended",None))
        threading.Thread(target=run).start()

    def guard(fn):
        def clicked():
            try:
                fn()
            except Exception as exc:
                status.set(str(exc))
        return clicked
    for title, fn in [("주변 GPU 찾기",browse),("원격 초대 추가",add_remote),("선택한 기기와 페어링",pair),
                      ("상대 코드 입력 · 연결",lambda:vote(True)),("거절",lambda:vote(False)),("모델 시작 / 중지",start)]:
        ttk.Button(frame,text=title,command=guard(fn)).pack(fill="x")
    def toggle_setup():
        if frame.winfo_manager():
            frame.pack_forget()
        else:
            frame.pack(before=desktop.frame,fill="x")
    toolbar=ttk.Frame(window)
    toolbar.pack(before=frame,fill="x")
    ttk.Button(toolbar,text="GPU 연결 설정",command=toggle_setup).pack(side="left")
    ttk.Label(toolbar,textvariable=status,wraplength=450).pack(side="left")
    window.geometry("760x760")
    desktop=DesktopChat(window,lambda:session,status,bundle)
    selector.bind("<<ComboboxSelected>>",lambda _:guard(browse)())
    last_trust = set()
    def poll():
        nonlocal pending,active,session,last_trust
        if closed:
            return
        while not notices.empty():
            kind,data = notices.get()
            if kind in ("found","lost"):
                if data[0]!=generation:
                    continue
                if kind=="found":
                    peers[data[1]]=(data[1].removesuffix("."+SERVICE),data[2])
                else:
                    peers.pop(data[1],None)
                redraw()
            elif kind=="ready":
                session=data
                frame.pack_forget()
                status.set("모델 실행 중 · "+", ".join(data[2]))
            elif kind=="error":
                status.set(data)
            elif kind=="ended":
                session=None
                active=False
                if desktop.task: desktop.task.stop()
                if stopped.is_set():
                    status.set("모델 실행을 중지했어요.")
        state=transport.call("status")
        pending=state.get("pending")
        if pending:
            status.set("내 코드 · "+pending["code"])
        elif state.get("issue"):
            status.set(state["issue"])
        if last_trust!=set(state["trusted"]):
            last_trust=set(state["trusted"])
            redraw()
            if not active:
                status.set("기기 승인이 저장됐어요. 목록에서 선택하고 모델을 시작하세요.")
        window.after(450,poll)
    def cleanup(event):
        nonlocal closed
        if event.widget==window and not closed:
            closed=True
            stopped.set()
            stop_browse()
            transport.call("stop")
    def close():
        if active:
            stopped.set()
            status.set("모델과 연결을 정리하는 중…")
            window.after(150,close)
        else:
            desktop.close()
            window.destroy()
    window.protocol("WM_DELETE_WINDOW",close)
    window.bind("<Destroy>",cleanup)
    guard(browse)()
    poll()
    return window
