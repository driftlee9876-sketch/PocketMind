"""Download selected model weights. Media inference uses bundled local executables."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import urllib.request
import uuid

FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def model_folder(base, m):
    return base/(m["id"]+"-"+m["revision"][:8])


def download(base, model, cancelled, status):
    directory=model_folder(base,model)
    directory.mkdir(parents=True,exist_ok=True)
    total=sum(f["bytes"] for f in model["files"])
    done=0
    for f in model["files"]:
        if cancelled.is_set():
            return
        path=directory/f["path"]
        if path.is_file() and path.stat().st_size==f["bytes"]:
            with path.open("rb") as saved:
                if not f["sha256"] or hashlib.file_digest(saved,"sha256").hexdigest()==f["sha256"]:
                    done+=f["bytes"]
                    continue
        if shutil.disk_usage(directory).free<f["bytes"]+32_000_000:
            raise ValueError("저장 공간이 부족해요.")
        url=model["source"]+"/resolve/"+model["revision"]+"/"+f["remote"]
        tmp=path.with_suffix(".part")
        try:
            digest=hashlib.sha256()
            copied=0
            with urllib.request.urlopen(url,timeout=60) as response,tmp.open("wb") as out:
                while not cancelled.is_set():
                    block=response.read(1024*1024)
                    if not block:
                        break
                    out.write(block)
                    digest.update(block)
                    copied+=len(block)
                    status(f"다운로드 · {(done+copied)*100/total:.0f}%")
            if cancelled.is_set():
                return
            if copied!=f["bytes"] or (f["sha256"] and digest.hexdigest()!=f["sha256"]):
                raise ValueError("모델 파일 검증에 실패했어요.")
            tmp.replace(path)
            done+=copied
        finally:
            tmp.unlink(missing_ok=True)
    (directory/"ready").write_text(model["revision"],encoding="ascii")


def speak(text):
    command="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()"
    p=subprocess.Popen(["powershell.exe","-NoProfile","-NonInteractive","-Command",command],stdin=subprocess.PIPE,creationflags=FLAGS)
    threading.Thread(target=lambda:p.communicate(text.encode("utf-8")),daemon=True).start()
    return p


def open_media(parent,bundle,base,kind,on_image,on_voice):
    import tkinter as tk
    from tkinter import ttk
    runtime=Path(bundle)/"media"
    models=[m for m in json.loads((runtime/"catalog.json").read_text(encoding="utf-8")) if m["kind"]==kind]
    window=tk.Toplevel(parent)
    window.title("이미지 만들기" if kind=="image" else "음성 대화")
    window.transient(parent)
    window.grab_set()
    frame=ttk.Frame(window,padding=16)
    frame.pack(fill="both",expand=True)
    labels=[f"{m['name']} · {m['parameters']} · {sum(f['bytes'] for f in m['files'])/1e6:.0f} MB" for m in models]
    selection=ttk.Combobox(frame,values=labels,state="readonly",width=54)
    selection.current(0)
    selection.pack(fill="x")
    prompt=tk.Text(frame,height=4,width=48)
    if kind=="image":
        ttk.Label(frame,text="이미지를 영어로 설명하세요").pack(anchor="w")
        prompt.pack(fill="x")
    state=tk.StringVar()
    ttk.Label(frame,textvariable=state,wraplength=420).pack(fill="x",pady=6)
    busy=recording=closing=False
    child=None
    wav=None
    alias="pm"+uuid.uuid4().hex
    events=queue.Queue()
    cancelled=threading.Event()

    def mic(command):
        code=ctypes.windll.winmm.mciSendStringW(command,None,0,None)
        if code:
            raise OSError("Windows 마이크를 열 수 없어요. 입력 장치와 권한을 확인하세요.")

    def work(fn):
        nonlocal busy
        busy=True
        cancelled.clear()
        def run():
            try:
                fn()
            except Exception as error:
                events.put(("error",str(error)))
            finally:
                events.put(("done",None))
        threading.Thread(target=run,daemon=True).start()

    def run():
        nonlocal child,recording,wav
        if busy:
            return
        model=models[selection.current()]
        directory=model_folder(base/"media-models",model)
        if not (directory/"ready").is_file():
            work(lambda:download(base/"media-models",model,cancelled,lambda s:events.put(("status",s))))
            return
        if kind=="image":
            text=prompt.get("1.0","end-1c").strip()
            if not text:return
            out=base/"chat-images"/(uuid.uuid4().hex+".png")
            out.parent.mkdir(parents=True,exist_ok=True)
            def draw():
                nonlocal child
                child=subprocess.Popen([str(runtime/"node.exe"),str(runtime/"render.cjs")],cwd=runtime,
                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding="utf-8",creationflags=FLAGS)
                try:
                    if cancelled.is_set(): child.terminate();return
                    json.dump(dict(dir=str(directory),mode=model["id"],prompt=text,out=str(out)),child.stdin)
                    child.stdin.close()
                    last=""
                    for line in child.stdout:
                        last=line.strip()
                        events.put(("status",last))
                    if child.wait(): raise ValueError(last or "이미지 생성 실패")
                    if not cancelled.is_set(): events.put(("image",(text,out)))
                finally:
                    if child.poll() is None:child.terminate()
                    if cancelled.is_set():out.unlink(missing_ok=True)
            work(draw)
        elif not recording:
            try:
                mic("open new type waveaudio alias "+alias)
                mic(f"set {alias} time format milliseconds bitspersample 16 samplespersec 16000 channels 1 alignment 2 bytespersec 32000")
                mic(f"record {alias}")
                recording=True
                state.set("듣고 있어요. 다 말하면 눌러서 보내세요.")
                window.after(29500,lambda: run() if recording and not closing else None)
            except Exception as e:
                ctypes.windll.winmm.mciSendStringW("close "+alias,None,0,None)
                state.set(str(e))
        else:
            recording=False
            try:
                wav=Path(tempfile.gettempdir())/(alias+".wav")
                mic("stop "+alias)
                mic(f'save {alias} "{wav}"')
            except Exception as e:
                state.set(str(e));return
            finally:
                ctypes.windll.winmm.mciSendStringW("close "+alias,None,0,None)
            def recognize():
                nonlocal child
                try:
                    child=subprocess.Popen([str(runtime/"whisper"/"whisper-cli.exe"),"-m",str(directory/"whisper.bin"),"-f",str(wav),"-l","ko","-nt","-otxt","-of",str(wav)],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=FLAGS)
                    if cancelled.is_set():child.terminate();return
                    if child.wait():raise ValueError("음성을 인식하지 못했어요.")
                    text=Path(str(wav)+".txt").read_text(encoding="utf-8").strip()
                    if not text:raise ValueError("인식된 음성이 없어요.")
                    if not cancelled.is_set():events.put(("voice",text))
                finally:
                    wav.unlink(missing_ok=True);Path(str(wav)+".txt").unlink(missing_ok=True)
            work(recognize)

    def close():
        nonlocal closing
        closing=True;cancelled.set()
        if child and child.poll() is None:child.terminate()
        if recording:ctypes.windll.winmm.mciSendStringW("close "+alias,None,0,None)
        window.destroy()

    action=ttk.Button(frame,command=run)
    action.pack(fill="x")
    ttk.Button(frame,text="닫기",command=close).pack(fill="x")
    def poll():
        nonlocal busy
        if closing:return
        while not events.empty():
            op,value=events.get_nowait()
            if op=="done":busy=False
            elif op=="image":on_image(*value);close();return
            elif op=="voice":on_voice(value);close();return
            else:state.set(value)
        selection.configure(state="disabled" if busy or recording else "readonly")
        model=models[selection.current()]
        ready=(model_folder(base/"media-models",model)/"ready").is_file()
        label="선택한 모델 다운로드" if not ready else "이미지 생성" if kind=="image" else "녹음 종료하고 보내기" if recording else "말하기"
        action.configure(text=label,state="disabled" if busy else "normal")
        window.after(120,poll)
    window.protocol("WM_DELETE_WINDOW",close)
    poll()
