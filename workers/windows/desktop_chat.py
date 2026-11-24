"""Local conversation view for the Windows GPU host."""
import http.client
import json
import os
from pathlib import Path
import queue
import socket
import threading


class Completion:
    def __init__(self, port):
        self.http = http.client.HTTPConnection("127.0.0.1", port, timeout=300)
        self.cancelled = threading.Event()

    def stop(self):
        self.cancelled.set()
        sock = self.http.sock
        if sock:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def run(self, token, messages, events):
        try:
            if self.cancelled.is_set():
                return
            body = json.dumps({"model":"pocketmind-wired","messages":messages,"stream":True})
            self.http.request("POST","/v1/chat/completions",body,
                              {"Content-Type":"application/json","Authorization":"Bearer "+token})
            response = self.http.getresponse()
            if response.status != 200:
                raise ValueError(f"모델 응답 오류 (HTTP {response.status})")
            for raw in response:
                if self.cancelled.is_set():
                    return
                if not raw.startswith(b"data:"):
                    continue
                payload = raw[5:].strip()
                if payload == b"[DONE]":
                    return
                event = json.loads(payload)
                if event.get("error"):
                    raise ValueError(str(event["error"]))
                for choice in event.get("choices", []):
                    part = choice.get("delta",{}).get("content")
                    if part:
                        events.put((self,"text",part))
                    if choice.get("finish_reason"):
                        return
            raise ValueError("답변을 받는 중 연결이 종료됐어요.")
        except Exception as error:
            if not self.cancelled.is_set():
                events.put((self,"error",str(error)))
        finally:
            self.http.close()
            events.put((self,"end",""))


class DesktopChat:
    def __init__(self, parent, session, status):
        import tkinter as tk
        from tkinter import ttk
        self.session = session
        self.status = status
        self.events = queue.Queue()
        self.task = None
        self.reply = None
        self.owner = None
        self.closed = False
        self.path = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "PocketMind" / "desktop-chat.json"
        try:
            items = json.loads(self.path.read_text(encoding="utf-8"))
            self.rooms = [r for r in items if isinstance(r,dict) and isinstance(r.get("messages"),list)]
        except (OSError, ValueError, TypeError):
            self.rooms = []
        self.current = self.rooms[0] if self.rooms else self.new_room()
        self.frame = tk.Frame(parent, bg="#101010")
        self.frame.pack(fill="both",expand=True)
        bar = tk.Frame(self.frame,bg="#101010")
        bar.pack(fill="x",padx=14,pady=8)
        tk.Label(bar,text="PocketMind",bg="#101010",fg="#f5f5f5",font=("Segoe UI",14,"bold")).pack(side="left")
        self.history = ttk.Combobox(bar, state="readonly",width=20)
        self.history.pack(side="right")
        self.history.bind("<<ComboboxSelected>>",lambda _: self.switch(self.rooms[self.history.current()]))
        ttk.Button(bar,text="새 채팅",command=lambda:self.switch(self.new_room())).pack(side="right",padx=6)
        self.text = tk.Text(self.frame,bg="#101010",fg="#eeeeee",selectbackground="#515151",padx=20,pady=14,
                            relief="flat",wrap="word",state="disabled",font=("Segoe UI",11),height=10)
        self.text.pack(fill="both",expand=True)
        self.text.tag_configure("user",justify="right",foreground="#ffffff",rmargin=8,lmargin1=40,lmargin2=40)
        self.text.tag_configure("assistant",spacing3=8)
        actions=tk.Frame(self.frame,bg="#101010")
        actions.pack(fill="x",padx=12)
        for label,fn in [("파일 첨부",self.attach),("답변 복사",self.copy),("질문 수정",lambda:self.fork(False)),("다시 생성",lambda:self.fork(True))]:
            ttk.Button(actions,text=label,command=fn).pack(side="left",padx=2)
        compose=tk.Frame(self.frame,bg="#2b2b2b",padx=8,pady=6)
        compose.pack(fill="x",padx=14,pady=12)
        self.prompt=tk.Text(compose,height=2,bg="#2b2b2b",fg="white",insertbackground="white",wrap="word",relief="flat",font=("Segoe UI",11))
        self.prompt.pack(side="left",fill="x",expand=True)
        self.prompt.bind("<Return>",self.enter)
        self.send_button=ttk.Button(compose,text="보내기",command=self.submit)
        self.send_button.pack(side="right")
        self.prompt.insert("1.0",self.current.get("draft",""))
        self.render()
        self.frame.after(50,self.poll)

    def new_room(self, messages=None):
        room={"messages":list(messages or []),"draft":""}
        self.rooms.insert(0,room)
        return room

    def save(self):
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            tmp=self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.rooms,ensure_ascii=False),encoding="utf-8")
            tmp.replace(self.path)
        except OSError as error:
            self.status.set(str(error))

    def switch(self, room):
        self.current["draft"]=self.prompt.get("1.0","end-1c")
        self.current=room
        self.prompt.delete("1.0","end")
        self.prompt.insert("1.0",room.get("draft",""))
        self.render()
        self.save()

    def render(self):
        names=[next((m["content"].splitlines()[0][:30] for m in r["messages"] if m.get("content")), "새 채팅") for r in self.rooms]
        self.history.configure(values=names)
        self.history.current(next(i for i,r in enumerate(self.rooms) if r is self.current))
        self.text.configure(state="normal")
        self.text.delete("1.0","end")
        if not self.current["messages"]:
            self.text.insert("end","무엇을 도와드릴까요?")
        for m in self.current["messages"]:
            self.text.insert("end",m["content"]+"\n\n",m["role"])
        self.text.configure(state="disabled")
        self.text.see("end")
        self.send_button.configure(text="중지" if self.task and self.owner is self.current else "보내기")

    def enter(self,event):
        if event.state & 1:  # Shift+Enter
            return None
        self.submit()
        return "break"

    def attach(self):
        from tkinter import filedialog
        file=filedialog.askopenfilename(parent=self.frame,filetypes=[("텍스트 문서","*.txt *.md *.csv *.json *.py *.xml")])
        if file:
            try:
                with open(file,encoding="utf-8-sig") as stream:
                    text=stream.read(32001)
                self.prompt.insert("end","\n["+Path(file).name+"]\n"+text[:32000]+("\n(본문 발췌)" if len(text)>32000 else ""))
            except (OSError,UnicodeError) as error:
                self.status.set(str(error))

    def copy(self):
        reply=next((m["content"] for m in reversed(self.current["messages"]) if m["role"]=="assistant" and m["content"]),None)
        if reply:
            self.frame.clipboard_clear()
            self.frame.clipboard_append(reply)

    def fork(self, run):
        if self.task:
            return
        msgs=self.current["messages"]
        index=next((i for i in reversed(range(len(msgs))) if msgs[i]["role"]=="user"),None)
        if index is None:
            return
        room=self.new_room(msgs[:index])
        room["draft"]=msgs[index]["content"]
        self.switch(room)
        if run:
            self.submit()

    def submit(self):
        if self.task:
            if self.owner is self.current:
                self.task.stop()
            return
        session=self.session()
        if not session:
            self.status.set("GPU 연결에서 모델을 시작한 뒤 보내 주세요.")
            return
        value=self.prompt.get("1.0","end-1c").strip()
        if not value:
            return
        messages=self.current["messages"]
        messages.append({"role":"user","content":value})
        context=[m.copy() for m in messages[-20:] if m["content"]]
        self.prompt.delete("1.0","end")
        self.current["draft"]=""
        self.reply={"role":"assistant","content":""}
        messages.append(self.reply)
        self.owner=self.current
        self.task=Completion(session[0])
        self.save()
        self.render()
        threading.Thread(target=self.task.run,args=(session[1],context,self.events),daemon=True).start()

    def poll(self):
        if self.closed:
            return
        changed=False
        while not self.events.empty():
            task,kind,value=self.events.get_nowait()
            if task is not self.task:
                continue
            if kind=="text" and not task.cancelled.is_set():
                self.reply["content"]+=value
            elif kind=="error":
                self.status.set(value)
            elif kind=="end":
                if not self.reply["content"]:
                    self.owner["messages"].pop()
                self.task=self.owner=self.reply=None
                self.save()
            changed=True
        if changed:
            self.render()
        self.frame.after(50,self.poll)

    def close(self):
        self.closed=True
        if self.task:
            self.task.stop()
        self.current["draft"]=self.prompt.get("1.0","end-1c")
        self.save()
