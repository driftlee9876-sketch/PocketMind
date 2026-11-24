"""Download selected model weights. Media inference uses bundled local executables."""
import time
import wave
from array import array
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


class Microphone:
    def __init__(self):
        import sounddevice
        self.pcm = bytearray()
        self.last_voice = None
        self.voiced = 0
        self.stream = sounddevice.RawInputStream(samplerate=16000, channels=1, dtype="int16",
                                                blocksize=1600, callback=self.capture)
        self.started = time.monotonic()
        try:
            self.stream.start()
        except Exception:
            self.stream.close()
            raise

    def capture(self, data, frames, when, status):
        chunk = bytes(data)
        if len(self.pcm) < 960000:
            self.pcm.extend(chunk[:960000 - len(self.pcm)])
        samples = array("h", chunk)
        if samples and sum(v*v for v in samples) / len(samples) > (32768 * 10**(-42/20))**2:
            self.last_voice = time.monotonic()
            self.voiced += 1

    def close(self, destination=None):
        try:
            self.stream.stop()
        finally:
            self.stream.close()
        if destination is not None:
            with wave.open(str(destination), "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", ""))
                output.writeframes(self.pcm)


def speak(text):
    command="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice=$s.GetInstalledVoices() | Where-Object {$_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'ko'} | Select-Object -First 1; if($voice){$s.SelectVoice($voice.VoiceInfo.Name)}; $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()"
    p=subprocess.Popen(["powershell.exe","-NoProfile","-NonInteractive","-Command",command],stdin=subprocess.PIPE,creationflags=FLAGS)
    threading.Thread(target=lambda:p.communicate(text.encode("utf-8")),daemon=True).start()
    return p


def open_media(parent,bundle,base,kind,on_image,on_voice):
    import tkinter as tk
    from tkinter import messagebox, ttk
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
    pref = base / ("preferred-" + kind + "-model.txt")
    try:
        preferred = pref.read_text(encoding="utf-8").strip()
    except OSError:
        preferred = None
    selection.current(next((i for i, m in enumerate(models) if m["id"] == preferred), 0))
    def choose(_):
        try:
            pref.parent.mkdir(parents=True, exist_ok=True)
            pref.write_text(models[selection.current()]["id"], encoding="utf-8")
            state.set("")
        except OSError as e:
            state.set(str(e))
    selection.bind("<<ComboboxSelected>>", choose)
    selection.pack(fill="x")
    prompt=tk.Text(frame,height=4,width=48)
    if kind=="image":
        ttk.Label(frame,text="이미지를 영어로 설명하세요").pack(anchor="w")
        prompt.pack(fill="x")
    state=tk.StringVar()
    ttk.Label(frame,textvariable=state,wraplength=420).pack(fill="x",pady=6)
    continuous=tk.BooleanVar(value=False)
    toggle=None
    if kind=="voice":
        toggle=ttk.Checkbutton(frame,text="연속 대화",variable=continuous)
        toggle.pack(anchor="w")
    busy=recording=closing=answering=False
    microphone=None
    stop_reply=None
    child=None
    wav=None
    alias="pm"+uuid.uuid4().hex
    events=queue.Queue()
    cancelled=threading.Event()

    readiness = {}
    def model_ready(model):
        directory = model_folder(base / "media-models", model)
        try:
            return ((directory / "ready").read_text(encoding="ascii") == model["revision"]
                    and all((directory / f["path"]).stat().st_size == f["bytes"] for f in model["files"]))
        except OSError:
            return False

    def ready(model):
        if model["id"] not in readiness:
            readiness[model["id"]] = model_ready(model)
        return readiness[model["id"]]

    def remove():
        model = models[selection.current()]
        if busy or recording or not messagebox.askyesno("모델 삭제", model["name"] + " 모델을 기기에서 삭제할까요?", parent=window):
            return
        work(lambda: shutil.rmtree(model_folder(base / "media-models", model)))

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
        nonlocal child,recording,wav,microphone
        if busy or answering:
            return
        model=models[selection.current()]
        directory=model_folder(base/"media-models",model)
        if not ready(model):
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
                microphone=Microphone()
                recording=True
                state.set("듣고 있어요. 말이 끝나면 보내요." if continuous.get() else "듣고 있어요. 다 말하면 눌러서 보내세요.")
            except Exception as e:
                state.set("마이크를 시작하지 못했어요. " + str(e))
        else:
            recording=False
            try:
                wav=Path(tempfile.gettempdir())/(alias+".wav")
                microphone.close(wav)
            except Exception as e:
                state.set(str(e));return
            finally:
                microphone=None
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

    def cleanup():
        nonlocal closing
        if closing:return
        closing=True;cancelled.set()
        if child and child.poll() is None:child.terminate()
        try:
            if microphone is not None:microphone.close()
        finally:
            if stop_reply:stop_reply()

    def close():
        try:cleanup()
        finally:window.destroy()
    window.bind("<Destroy>",lambda event: cleanup() if event.widget is window else None)

    def reply(text):
        nonlocal child,answering,stop_reply
        stop_reply=None
        if closing:return
        if not text:
            answering=False
            state.set("답변을 생성하지 못했어요.")
            return
        state.set(text)
        try:
            child=speak(text)
        except OSError as e:
            answering=False
            state.set(str(e))
            return
        def finished():
            nonlocal answering
            if closing:return
            if child.poll() is None:
                window.after(100,finished)
            else:
                answering=False
                if child.returncode:
                    state.set("기기 음성 출력을 확인해 주세요.")
                elif continuous.get():
                    run()
        window.after(100,finished)

    action=ttk.Button(frame,command=run)
    action.pack(fill="x")
    delete = ttk.Button(frame,text="모델 삭제",command=remove)
    delete.pack(fill="x")
    ttk.Button(frame,text="닫기",command=close).pack(fill="x")
    def poll():
        nonlocal busy,answering,stop_reply,recording,microphone
        if closing:return
        while not events.empty():
            op,value=events.get_nowait()
            if op=="done":
                busy=False
                readiness.clear()
            elif op=="image":on_image(*value);close();return
            elif op=="voice":
                answering=True
                state.set(value+" · 답변 생성 중…")
                stop_reply=on_voice(value,reply)
            else:state.set(value)
        if recording:
            elapsed=time.monotonic()-microphone.started
            spoken=microphone.voiced>=2
            if continuous.get() and not spoken and elapsed>=29:
                microphone.close();microphone=None;recording=False
                state.set("들린 음성이 없어 마이크를 껐어요.")
            elif elapsed>=29.5 or (continuous.get() and spoken and time.monotonic()-microphone.last_voice>=1.2):
                run()
        locked=busy or answering or recording
        if toggle:toggle.configure(state="disabled" if locked else "normal")
        selection.configure(state="disabled" if locked else "readonly")
        model=models[selection.current()]
        available = ready(model)
        delete.configure(state="normal" if available and not locked else "disabled")
        label="선택한 모델 다운로드" if not available else "이미지 생성" if kind=="image" else "녹음 종료하고 보내기" if recording else "말하기"
        action.configure(text=label,state="disabled" if busy or answering else "normal")
        window.after(120,poll)
    window.protocol("WM_DELETE_WINDOW",close)
    poll()
