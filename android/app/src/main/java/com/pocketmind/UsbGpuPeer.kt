package com.pocketmind

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.security.SecureRandom
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicit foreground-only sharing. The child exposes a shell-UID-restricted abstract socket. */
internal class UsbGpuPeer(private val context: ReactApplicationContext) : LifecycleEventListener {
  private var child: Process? = null
  private var code = ""
  private var monitoring = false
  private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
  private val usbAction = "android.hardware.usb.action.USB_STATE"
  private val watcher = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) {
      if (intent?.action == usbAction && !intent.getBooleanExtra("connected", false)) stop()
    }
  }
  init { context.addLifecycleEventListener(this) }

  private fun conditionsAllow(): Boolean {
    val hot = Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 0) ?: 0
    return !hot && level >= 0 && scale > 0 && level * 100 / scale >= 20
  }

  @Synchronized fun status() = code

  fun start(promise: Promise, tablet: Boolean = false, wifi: Boolean = false) {
    Thread {
      var started: Process? = null
      try {
        val ready = CountDownLatch(1)
        val ownCode = String.format(Locale.ROOT, "%08d", SecureRandom().nextInt(100_000_000))
        val proc = synchronized(this) {
          if (code.isNotEmpty()) { promise.resolve(code); return@Thread }
          check(child == null) { "GPU 준비 중이에요." }
          check(context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED) { "앱을 화면에 열어 주세요." }
          check(Build.VERSION.SDK_INT >= 28 && conditionsAllow()) { "Android 9 이상, 배터리 20% 이상, 안전한 온도에서 사용할 수 있어요." }
          if (wifi) {
            check(wifiAddress(context) != null || gpuNetwork(context,true) != null) { "Wi-Fi에 연결해 주세요." }
          } else if (tablet) {
            check(cableAddresses(context).isNotEmpty()) {
              "USB 테더링 또는 유선 이더넷을 연결한 뒤 다시 눌러 주세요."
            }
          } else {
            val usb = context.registerReceiver(null, IntentFilter(usbAction))
            check(usb?.getBooleanExtra("connected", false) == true && usb.getBooleanExtra("adb", false)) {
              "데이터 케이블을 연결하고 USB 디버깅을 켜 주세요."
            }
          }
          val binary = File(context.applicationInfo.nativeLibraryDir, "libpocketmind_usb_gpu.so")
          check(binary.canExecute()) { "유선 GPU가 포함된 arm64 APK가 필요해요." }
          val builder = ProcessBuilder(binary.absolutePath, "--device", "Vulkan0").redirectErrorStream(true)
          builder.environment()["POCKETMIND_USB_SOCKET"] = "pocketmind_gpu_$ownCode"
          val launched = builder.start()
          started = launched
          child = launched
          if (!tablet && !wifi) {
          if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(watcher, IntentFilter(usbAction), Context.RECEIVER_NOT_EXPORTED)
          else @Suppress("DEPRECATION") context.registerReceiver(watcher, IntentFilter(usbAction))
          monitoring = true
          }
          launched
        }
        Thread {
          try {
            proc.inputStream.bufferedReader().useLines { lines ->
              lines.forEach { line -> if (line == "POCKETMIND_USB_READY") {
                synchronized(this) { if (child === proc) code = ownCode }
                ready.countDown()
              } }
            }
          } finally {
            synchronized(this) { if (child === proc) stop() }
            ready.countDown()
          }
        }.start()
        check(ready.await(35, TimeUnit.SECONDS) && status() == ownCode) { "Vulkan GPU를 시작하지 못했어요. 기기 드라이버와 USB 상태를 확인하세요." }
        promise.resolve(ownCode)
        while (synchronized(this) { child === proc }) {
          Thread.sleep(2000)
          if (!conditionsAllow()) synchronized(this) { if (child === proc) stop() }
        }
      } catch (error: Exception) {
        synchronized(this) { if (started != null && child === started) stop() }
        promise.reject("USB_GPU", error)
      }
    }.start()
  }

  @Synchronized fun stop() {
    code = ""
    child?.destroy()
    child = null
    if (monitoring) {
      context.unregisterReceiver(watcher)
      monitoring = false
    }
  }
  override fun onHostResume() {}
  override fun onHostPause() = stop()
  override fun onHostDestroy() = stop()
  fun release() { stop(); context.removeLifecycleEventListener(this) }
}
