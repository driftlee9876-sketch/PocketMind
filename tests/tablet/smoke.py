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
    with (out/(name+'.png')).open('wb') as screen:
        subprocess.run(['adb','exec-out','screencap','-p'],stdout=screen,check=True)
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
    adb('shell','settings','put','secure','immersive_mode_confirmations','confirmed')
    adb('shell','wm','size','2560x1600')
    adb('shell','wm','density','240')
    adb('shell','settings','put','system','accelerometer_rotation','0')
    adb('shell','wm','user-rotation','lock','0')
    adb('shell','settings','put','secure','show_ime_with_hard_keyboard','1')
    launch()
    if d(textMatches='(?i)got it').exists(timeout=2):
        d(textMatches='(?i)got it').click()
    if d.window_size()[0] < d.window_size()[1]:
        adb('shell','wm','user-rotation','lock','1')
    wait(lambda: d.window_size()[0] > d.window_size()[1])
    # Establish a real stored conversation using the previous release, then
    # install the new APK over it, without clearing app storage.
    send('최근 메일 보여줘')
    setup_message = '연결 앱에서 Coordinator 주소와 API 토큰을 설정해 주세요.'
    wait(lambda: label(setup_message))
    d.app_stop(pkg)
    assert 'Success' in adb('install','-r','release/app-release.apk')
    launch()
    wait(lambda: label(setup_message))
    print('Signed in-place APK update preserved existing chat',flush=True)
    tap('✎')
    wait(lambda: label('무엇을 도와드릴까요?'))
    snap('01-home')
    field().click()
    wait(lambda: ime() or bool(re.search(r'type=ime .*?visible=true',adb('shell','dumpsys','window','displays'),re.I)))
    time.sleep(1)
    wait(lambda: not label('CPU 온도') and not label('Gmail에서 받은 메일 확인'))
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
    button=wait(lambda: label('메시지 보내기')).info['bounds']
    assert button['bottom'] <= min(frames) + 2
    time.sleep(1)
    snap('02-keyboard')
    assert ime() and not label('CPU 온도')
    print('Keyboard stable, send button bounds:',button,flush=True)
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
    tap('이 기기의 GPU 제공하기')
    message = 'USB 테더링 또는 유선 이더넷을 연결한 뒤 다시 눌러 주세요.'
    wait(lambda: d(text=message).exists, 55)
    assert not d(text='데이터 케이블을 연결하고 USB 디버깅을 켜 주세요.').exists
    assert not label('GPU 제공 중지')
    snap('06-gpu-diagnostic')
    print('Tablet-specific cable diagnostic passed',flush=True)
    assert d.app_current()['package']==pkg
    print('GPU panel and missing-model guards passed',flush=True)
    tap('닫기')
    tap('모델 선택, 현재')
    tap('Wi-Fi GPU 연결')
    wait(lambda: label('주변 GPU'))
    # This text only appears after the Kotlin discovery listener and native Go
    # identity engine both return a status. No external peer is required.
    wait(lambda: label('기기를 찾는 중'),35)
    assert label('이 기기의 Wi-Fi GPU 제공')
    assert label('함께 실행할 GGUF')
    snap('07-wifi-discovery')
    tap('닫기')
    wait(lambda: label('메시지 보내기'))
    print('APK native Wi-Fi discovery and opt-in controls passed',flush=True)
    donor_log=Path(os.environ['RUNNER_TEMP'], 'pm-donor.log')
    pin=re.search(r'^ID ([A-Za-z0-9_-]{43})$',donor_log.read_text(),re.M)[1]
    adb('shell','am','start','-n','org.pocketmind.testadvert/.Advert','--es','pin',pin)
    wait(lambda:'registered PocketMind QA' in adb('logcat','-d','-s','PM-TestAdvert:I'),20)
    adb('shell','am','start','--activity-reorder-to-front','-n',pkg+'/.MainActivity')
    wait(lambda:field().exists)
    tap('모델 선택, 현재')
    tap('Wi-Fi GPU 연결')
    wait(lambda:label('PocketMind QA desktop'),35)
    tap('이 기기와 연결')
    code=wait(lambda:re.search(r'^CODE (\d{8})$',donor_log.read_text(),re.M),20)[1]
    wait(lambda:label(code[:4]+' '+code[4:]))
    tap('코드 일치 · 승인')
    wait(lambda:label('승인한 기기'))
    snap('08-wifi-approved')
    tap('닫기')
    launch()
    tap('모델 선택, 현재')
    tap('Wi-Fi GPU 연결')
    wait(lambda:label('승인한 기기'),35)
    assert label('이 GPU로 대화 · 자동 재연결') and not label('코드 일치 · 승인')
    tap('저장한 Wi-Fi 기기 모두 잊기')
    wait(lambda:label('처음 연결'),30)
    print('Release APK discovered a Bonjour donor, matched the two TLS codes, restored trust and forgot the peer',flush=True)
except Exception:
    snap('failure')
    for name, args in [('ime',['input_method']),('displays',['window','displays'])]:
        (out/('failed-'+name+'.txt')).write_text(adb('shell','dumpsys',*args))
    (out/'logcat.txt').write_text(adb('logcat','-d','-t','1200'))
    traceback.print_exc()
    raise
