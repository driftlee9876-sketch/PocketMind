import os
import re
import subprocess
import time
import traceback
from pathlib import Path
import uiautomator2 as u2

d = u2.connect()
pkg = 'com.pocketmind'
out = Path('evidence')
out.mkdir(exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', *args], text=True)
def wait(fn, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = fn()
        if result:
            return result
        time.sleep(.4)
    raise AssertionError('Timed out: ' + str(fn))
def label(text):
    for obj in [d(descriptionContains=text),d(textContains=text)]:
        if obj.exists:
            return obj
    return None
def tap(text):
    wait(lambda: label(text)).click()
def snap(name):
    d.screenshot(str(out/(name+'.png')))
    (out/(name+'.xml')).write_text(d.dump_hierarchy())
def ime():
    return bool(re.search(r'(?:mInputShown|inputShown)=true', adb('shell','dumpsys','input_method')))
def hide():
    if ime():
        d.press('back')
        wait(lambda: not ime(), 8)
def field():
    return d(className='android.widget.EditText',description='메시지 입력')
def send(cmd):
    entry=wait(lambda: field() if field().exists else None)
    entry.click()
    entry.set_text(cmd)
    tap('메시지 보내기')
def launch():
    d.app_stop(pkg)
    d.app_start(pkg)
    wait(lambda: field().exists, 45)

try:
    # Use the original release APK with a tablet-sized screen and the stock IME.
    adb('shell','wm','size','1600x2560')
    adb('shell','wm','density','240')
    adb('shell','settings','put','system','accelerometer_rotation','0')
    adb('shell','settings','put','system','user_rotation','1')
    adb('shell','settings','put','secure','show_ime_with_hard_keyboard','1')
    launch()
    snap('01-home')
    field().click()
    wait(ime)
    time.sleep(1)
    snap('02-keyboard')
    for part in ['displays','windows']:
        (out/('window-'+part+'.txt')).write_text(adb('shell','dumpsys','window',part))
    dumps=(out/'window-displays.txt').read_text()
    frames = []
    for line in dumps.splitlines():
        if re.search(r'(?:type=ime\b|mType=ime\b|ITYPE_IME)',line,re.I) and re.search(r'(?:visible|mVisible)=true',line,re.I):
            rect = re.search(r'(?:mFrame|frame)=\[\d+,(-?\d+)\]\[\d+,\d+\]',line,re.I)
            if rect and int(rect[1]) > 0: frames.append(int(rect[1]))
    viewport=field().info['bounds']
    print('IME frames',frames,'composer',viewport,flush=True)
    assert frames and viewport['bottom'] <= min(frames) + 2, 'Keyboard overlaps composer or missing visible IME frame'
    hide()
    # The chat command opens the app catalog without a configured AI model.
    send('@Google Drive')
    tap('Coordinator 설정')
    wait(lambda: d(className='android.widget.EditText').count == 2)
    d(className='android.widget.EditText',instance=0).set_text('http://127.0.0.1:18770')
    d(className='android.widget.EditText',instance=1).set_text(os.environ['POCKETMIND_API_TOKEN'])
    hide()
    tap('저장 후 닫기')
    send('최근 메일 보여줘')
    wait(lambda: label('Tablet mail subject'),25)
    assert label('Tablet preview verified') and label('Tablet test sender')
    assert not label('private-thread')
    snap('03-gmail-chat')
    send('드라이브 파일 보여줘')
    wait(lambda: label('Tablet Drive report.pdf'))
    assert not label('private-file-id')
    snap('04-drive-chat')
    launch()
    wait(lambda: label('Tablet Drive report.pdf'))
    print('Gmail and Drive cards, Korean chat routing and history restore passed',flush=True)
    tap('모델 선택, 현재')
    tap('유선 GPU 연결')
    wait(lambda: label('두 Android 기기로 실행'))
    snap('05-tablet-gpu')
    scan=wait(lambda: label('보조 기기 QR 스캔'))
    join=wait(lambda: label('두 GPU로 모델 열기'))
    assert not scan.info['enabled'] and not join.info['enabled'], 'Model-less tablet should not start inference'
    assert d.app_current()['package']==pkg
    print('GPU panel and missing-model guards passed',flush=True)
except Exception:
    snap('failure')
    (out/'logcat.txt').write_text(adb('logcat','-d','-t','1200'))
    traceback.print_exc()
    raise
