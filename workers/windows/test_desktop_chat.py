import http.server
import queue
import threading
import unittest
from desktop_chat import Completion


class ChatTest(unittest.TestCase):
    def test_receives_two_streamed_chunks(self):
        class Local(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.end_headers()
                for text in ('first',' second'):
                    self.wfile.write(('data: {"choices":[{"delta":{"content":"'+text+'"}}]}\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
            def log_message(self,*args): pass
        with http.server.HTTPServer(('127.0.0.1',0),Local) as server:
            thread=threading.Thread(target=server.handle_request)
            thread.start()
            events=queue.Queue()
            request=Completion(server.server_port)
            request.run("test",[{"role":"user","content":"hello"}],events)
            thread.join()
            self.assertEqual([(op,data) for _,op,data in list(events.queue)],[("text","first"),("text"," second"),("end","")])
