"""Advertise the open PocketMind window and start Vulkan only for authorized peers."""
import socket
import subprocess
import threading
import time

from wifi_offer import Transport, interfaces


def presence(bundle, message, stopped):
    from zeroconf import IPVersion, ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf
    service = "_pmgpu._tcp.local."
    transport = Transport(bundle)
    zc = advert = stamp = process = browser = None
    visible={}
    lock=threading.Lock()
    own=transport.call("status")["id"]
    class Listener(ServiceListener):
        def add_service(self,client,kind,name):
            info=client.get_service_info(kind,name,timeout=2000)
            if info and b"id" in info.properties and info.properties[b"id"]!=own.encode():
                with lock: visible[name]=info.properties[b"id"]
        update_service=add_service
        def remove_service(self,client,kind,name):
            with lock: visible.pop(name,None)
    port = deadline = 0

    def withdraw():
        nonlocal zc, advert, stamp, browser
        if browser:
            browser.cancel()
            browser=None
        with lock: visible.clear()
        if zc:
            try:
                if advert:
                    zc.unregister_service(advert)
            finally:
                zc.close()
        zc = advert = stamp = None

    try:
        while not stopped.is_set():
            try:
                local = next((v for v in interfaces().values() if not v.get("Internet") and not v.get("Mesh")), None)
                if not local:
                    withdraw()
                    transport.call("unpresence")
                else:
                    info = transport.call("presence", Endpoint=local)
                    tag=(local["Local"],info["port"],info["group"])
                    if stamp != tag:
                        withdraw()
                        name="PocketMind "+socket.gethostname().split(".")[0][:20]+" "+info["id"][:5]+(" "+info["group"][:6] if info["group"] else "")
                        advert=ServiceInfo(service, name+"."+service, addresses=[socket.inet_aton(local["Local"])],
                            port=info["port"], properties={"id":info["id"],"platform":"Windows","near":"1","group":info["group"]},
                            server="pm-"+info["id"][:10].lower().replace("_","x")+".local.")
                        zc=Zeroconf(interfaces=[local["Local"]],ip_version=IPVersion.V4Only)
                        zc.register_service(advert,allow_name_change=True)
                        browser=ServiceBrowser(zc,service,Listener())
                        stamp=tag
                state=transport.call("status")
                if process and (process.poll() is not None or (not state["attached"] and not state["wantGPU"])):
                    if process.poll() is None:
                        process.terminate()
                    process=None
                    transport.call("detach")
                if state["wantGPU"]:
                    if not process:
                        with socket.socket() as reserved:
                            reserved.bind(("127.0.0.1",0))
                            port=reserved.getsockname()[1]
                        binary=bundle/"runtime"/"ggml-rpc-server.exe"
                        process=subprocess.Popen([str(binary),"--host","127.0.0.1","--port",str(port),"--device","Vulkan0"],
                            cwd=binary.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
                        deadline=time.monotonic()+35
                    try:
                        with socket.create_connection(("127.0.0.1",port),timeout=.2):
                            transport.call("attach",Backend="windows",Value=str(port))
                    except OSError:
                        if time.monotonic()>deadline:
                            process.terminate()
                pending=state.get("pending")
                with lock: count=len(set(visible.values()))
                message.put(("nearby",(pending,count)))
            except Exception as error:
                message.put(("nearby_error",str(error)))
            stopped.wait(.85)
    finally:
        withdraw()
        transport.call("unpresence")
        if process and process.poll() is None:
            process.terminate()
