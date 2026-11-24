"""Verify the packaged release opens its composer, Drive sheet and history."""
import subprocess
import time

import uiautomator2 as ui

device = ui.connect()


def element(label, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for candidate in (device(description=label), device(text=label),
                          device(descriptionContains=label), device(textContains=label)):
            if candidate.exists:
                return candidate
        time.sleep(.3)
    raise AssertionError(f"{label} not found: {device.dump_hierarchy()}")


subprocess.run(["adb", "shell", "settings", "put", "secure",
                "immersive_mode_confirmations", "confirmed"], check=True)
device.app_start("com.pocketmind", stop=True)
compose = element("메시지 입력", timeout=90)
element("첨부 및 도구").click()
element("Drive 파일 첨부").click()
element("Drive에서 첨부")
element("닫기").click()
compose.click()
compose.set_text("PocketMind tablet")
element("메시지 보내기")
device.press("back")
element("대화 목록 열기").click()
element("새 채팅")
print("Release APK: composer, Drive attachment sheet and history passed")
