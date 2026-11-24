"""Verify the packaged release opens its composer, Drive sheet and history."""
import time
import uiautomator2 as ui

device = ui.connect()
device.app_start("com.pocketmind", stop=True)
compose = device(description="메시지 입력")
assert compose.wait(timeout=90), device.dump_hierarchy()
device(description="첨부 및 도구").click()
device(text="Drive 파일 첨부").click()
assert device(text="Drive에서 첨부").wait(timeout=10)
device(text="닫기").click()
compose.click()
compose.set_text("PocketMind tablet")
assert device(description="메시지 보내기").exists
device.press("back")
device(description="대화 목록 열기").click()
assert device(textContains="새 채팅").wait(timeout=10)
print("Release APK: composer, Drive attachment sheet and history passed")
