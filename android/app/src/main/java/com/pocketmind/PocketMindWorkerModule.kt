package com.pocketmind

import android.content.Context
import android.content.Intent
import android.app.ActivityManager
import android.hardware.usb.UsbManager
import java.io.File
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.content.Context.CONNECTIVITY_SERVICE
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.util.UUID

class PocketMindWorkerModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val keyAlias = "PocketMindWorkerAesKey"
  private val chatGPTPlan by lazy { ChatGPTPlanClient(context, ::encryptSecret, ::decryptSecret) }
  private val usbGpuPeer = UsbGpuPeer(context)
  @ReactMethod fun startUsbGpuPeer(promise: Promise) = usbGpuPeer.start(promise)
  @ReactMethod fun stopUsbGpuPeer(promise: Promise) { usbGpuPeer.stop(); promise.resolve(true) }
  @ReactMethod fun usbGpuPeerStatus(promise: Promise) { promise.resolve(usbGpuPeer.status()) }
  private val wifiLan = WifiLan(context, usbGpuPeer)
  @ReactMethod fun wifiGpu(raw: String, promise: Promise) { wifiLan.call(raw, promise) }
  @ReactMethod fun prepareWifiPeer(promise: Promise) = usbGpuPeer.start(promise, wifi = true)
  @ReactMethod fun joinWifiGpu(id: String, filename: String, promise: Promise) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      try { tabletGpu.host("", filename, promise, listOf(wifiLan.selected(id))) }
      catch(e:Exception) { promise.reject("WIFI_GPU",e) }
    }
  }
  @ReactMethod fun joinWifiGroup(ids: com.facebook.react.bridge.ReadableArray, filename: String, promise: Promise) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      try {
        require(ids.size() in 1..20) { "보조 기기를 1~20대 선택하세요." }
        val peers=(0 until ids.size()).map { wifiLan.selected(requireNotNull(ids.getString(it))) }
        tabletGpu.host("", filename, promise, peers)
      } catch(e:Exception) { promise.reject("WIFI_GPU",e) }
    }
  }
  private val tabletGpu = TabletGpu(context, usbGpuPeer)
  @ReactMethod fun prepareTabletPeer(promise: Promise) = usbGpuPeer.start(promise, true)
  @ReactMethod fun offerTabletGpu(promise: Promise) { tabletGpu.provide(promise) }
  @ReactMethod fun joinTabletGpu(invitation: String, filename: String, promise: Promise) { tabletGpu.host(invitation, filename, promise) }
  @ReactMethod fun stopTabletGpu(promise: Promise) { tabletGpu.stop(); promise.resolve(true) }
  @ReactMethod fun tabletGpuStatus(promise: Promise) { promise.resolve(tabletGpu.status()) }
  private val cableQr = CableQr(context)
  @ReactMethod fun scanCableQr(promise: Promise) = cableQr.scan(promise)
  @ReactMethod fun showCableQr(value: String, promise: Promise) = cableQr.image(value, promise)
  private val wiredHttp = WiredHttp()
  @ReactMethod fun wiredRequest(id: String, action: String, token: String, body: String, promise: Promise) =
    wiredHttp.request(id, action, token, body, promise)
  @ReactMethod fun cancelWiredRequest(id: String) = wiredHttp.cancel(id)
  override fun invalidate() { wiredHttp.close(); wifiLan.release(); cableQr.release(); tabletGpu.release(); usbGpuPeer.release(); super.invalidate() }
  @Volatile private var previousCpuSample: Pair<Long, Long>? = null

  private fun readCpuUsagePercent(): Double? {
    return try {
      val line = File("/proc/stat").bufferedReader().use { it.readLine() } ?: return null
      val parts = line.trim().split(Regex("\\s+"))
      if (parts.firstOrNull() != "cpu") return null
      val values = parts.drop(1).mapNotNull { it.toLongOrNull() }
      if (values.size < 4) return null
      val idle = values[3] + (values.getOrNull(4) ?: 0L)
      val total = values.sum()
      val previous = previousCpuSample
      previousCpuSample = Pair(total, idle)
      if (previous == null) return null
      val totalDelta = total - previous.first
      val idleDelta = idle - previous.second
      if (totalDelta <= 0L) return null
      ((totalDelta - idleDelta).toDouble() * 100.0 / totalDelta).coerceIn(0.0, 100.0)
    } catch (_: Exception) {
      null
    }
  }

  private fun readThermalTemperatures(): Pair<Double?, Double?> {
    var cpuTemp: Double? = null
    var gpuTemp: Double? = null
    return try {
      val root = File("/sys/class/thermal")
      val zones = root.listFiles()?.filter { it.isDirectory && it.name.startsWith("thermal_zone") } ?: emptyList()
      for (zone in zones) {
        val label = try { File(zone, "type").readText().trim().lowercase() } catch (_: Exception) { "" }
        if (label.isBlank()) continue
        val raw = try { File(zone, "temp").readText().trim().toDoubleOrNull() } catch (_: Exception) { null }
        if (raw == null) continue
        val celsius = when {
          raw > 1000.0 -> raw / 1000.0
          raw > 200.0 -> raw / 10.0
          else -> raw
        }
        if (celsius !in 0.0..125.0) continue
        if (Regex("gpu|adreno|mali|graphics").containsMatchIn(label)) {
          gpuTemp = maxOf(gpuTemp ?: celsius, celsius)
        } else if (Regex("cpu|soc|ap|cluster|tsens").containsMatchIn(label)) {
          cpuTemp = maxOf(cpuTemp ?: celsius, celsius)
        }
      }
      Pair(cpuTemp, gpuTemp)
    } catch (_: Exception) {
      Pair(null, null)
    }
  }

  override fun getName(): String = "PocketMindWorker"

  @ReactMethod
  fun getChatGPTStatus(promise: Promise) {
    try { promise.resolve(chatGPTPlan.status().toString()) }
    catch (error: Exception) { promise.reject("CHATGPT_STATUS", error) }
  }

  @ReactMethod
  fun beginChatGPTLogin(promise: Promise) {
    try { promise.resolve(chatGPTPlan.startLogin()) }
    catch (error: Exception) { promise.reject("CHATGPT_LOGIN", error) }
  }

  @ReactMethod
  fun disconnectChatGPT(promise: Promise) {
    try { chatGPTPlan.signOut(); promise.resolve(true) }
    catch (error: Exception) { promise.reject("CHATGPT_DISCONNECT", error) }
  }

  @ReactMethod
  fun listChatGPTModels(promise: Promise) {
    Thread {
      try { promise.resolve(chatGPTPlan.models().toString()) }
      catch (error: Exception) { promise.reject("CHATGPT_MODELS", error) }
    }.start()
  }

  @ReactMethod
  fun runChatGPT(requestId: String, model: String, messagesJson: String, promise: Promise) {
    val call = chatGPTPlan.prepareCall()
    Thread {
      try {
        val reply = chatGPTPlan.chat(call, model, org.json.JSONArray(messagesJson)) { partial ->
          if (!call.cancelled && context.hasActiveReactInstance()) {
            context.emitDeviceEvent("PocketMindChatGPTText", Arguments.createMap().apply {
              putString("requestId", requestId)
              putString("text", partial)
            })
          }
        }
        promise.resolve(reply.json())
      }
      catch (error: Exception) { promise.reject("CHATGPT_RESPONSE", error) }
    }.start()
  }

  @ReactMethod
  fun stopChatGPT(promise: Promise) {
    chatGPTPlan.cancel()
    promise.resolve(true)
  }

  private fun getOrCreateKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(keyAlias, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        keyAlias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  private fun encryptSecret(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
  }

  private fun decryptSecret(value: String): String {
    val combined = Base64.decode(value, Base64.NO_WRAP)
    if (combined.size <= 12) throw IllegalArgumentException("Encrypted value is invalid")
    val iv = combined.copyOfRange(0, 12)
    val encrypted = combined.copyOfRange(12, combined.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(encrypted), Charsets.UTF_8)
  }

  @ReactMethod
  fun startWorker(config: ReadableMap, promise: Promise) {
    try {
      val json = JSONObject(config.toHashMap() as Map<*, *>)
      json.put("enabled", true)
      context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
        .edit().putString("config", encryptSecret(json.toString())).apply()
      val intent = Intent(context, PocketMindWorkerService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WORKER_START_FAILED", error)
    }
  }

  @ReactMethod
  fun stopWorker(promise: Promise) {
    try {
      context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
        .edit().putString("config", encryptSecret(JSONObject().put("enabled", false).toString())).apply()
      context.stopService(Intent(context, PocketMindWorkerService::class.java))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WORKER_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun setGpuEnabled(enabled: Boolean, promise: Promise) {
    try {
      val preferences = context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
      val encrypted = preferences.getString("config", null)
      val json = encrypted?.let { JSONObject(decryptSecret(it)) } ?: JSONObject()
      json.put("useGpu", enabled)
      preferences.edit().putString("config", encryptSecret(json.toString())).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WORKER_GPU_CONFIG_FAILED", error)
    }
  }

  @ReactMethod
  fun getConfig(promise: Promise) {
    try {
      val encrypted = context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
        .getString("config", null)
      val raw = encrypted?.let { decryptSecret(it) } ?: "{}"
      val json = JSONObject(raw)
      val map = Arguments.createMap()
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        when (val value = json.get(key)) {
          is Boolean -> map.putBoolean(key, value)
          is Int -> map.putInt(key, value)
          is Long -> map.putDouble(key, value.toDouble())
          is Double -> map.putDouble(key, value)
          is String -> map.putString(key, value)
          is org.json.JSONArray -> {
            val array = Arguments.createArray()
            for (i in 0 until value.length()) array.pushString(value.optString(i))
            map.putArray(key, array)
          }
        }
      }
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("WORKER_CONFIG_FAILED", error)
    }
  }

  @ReactMethod
  fun setSecret(name: String, value: String, promise: Promise) {
    try {
      if (name.isBlank() || name.length > 100) throw IllegalArgumentException("Invalid secret name")
      context.getSharedPreferences("pocketmind_worker_secrets", Context.MODE_PRIVATE)
        .edit().putString(name, encryptSecret(value)).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WORKER_SECRET_STORE_FAILED", error)
    }
  }

  @ReactMethod
  fun getSecret(name: String, promise: Promise) {
    try {
      val encrypted = context.getSharedPreferences("pocketmind_worker_secrets", Context.MODE_PRIVATE)
        .getString(name, null)
      promise.resolve(if (encrypted == null) null else decryptSecret(encrypted))
    } catch (error: Exception) {
      promise.reject("WORKER_SECRET_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun removeSecret(name: String, promise: Promise) {
    context.getSharedPreferences("pocketmind_worker_secrets", Context.MODE_PRIVATE)
      .edit().remove(name).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun getWorkerId(promise: Promise) {
    try {
      val preferences = context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
      var workerId = preferences.getString("worker_id", null)
      if (workerId.isNullOrBlank()) {
        workerId = "android-" + UUID.randomUUID().toString()
        preferences.edit().putString("worker_id", workerId).apply()
      }
      promise.resolve(workerId)
    } catch (error: Exception) {
      promise.reject("WORKER_ID_FAILED", error)
    }
  }

  @ReactMethod
  fun getTotalRamMb(promise: Promise) {
    try {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memoryInfo = ActivityManager.MemoryInfo()
      manager.getMemoryInfo(memoryInfo)
      promise.resolve((memoryInfo.totalMem / (1024L * 1024L)).toInt())
    } catch (error: Exception) {
      promise.reject("WORKER_RAM_FAILED", error)
    }
  }

  @ReactMethod
  fun getDeviceMetrics(promise: Promise) {
    try {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memoryInfo = ActivityManager.MemoryInfo()
      manager.getMemoryInfo(memoryInfo)
      val totalRam = memoryInfo.totalMem.coerceAtLeast(0L)
      val usedRam = (totalRam - memoryInfo.availMem).coerceIn(0L, totalRam)
      val (cpuTemperature, gpuTemperature) = readThermalTemperatures()

      val battery = context.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val plugType = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
      val usbPowerConnected = (plugType and BatteryManager.BATTERY_PLUGGED_USB) != 0
      val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
      val usbDeviceCount = try { usbManager.deviceList.size } catch (_: Exception) { 0 }

      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val thermalState = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        when (power.currentThermalStatus) {
          PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
          PowerManager.THERMAL_STATUS_MODERATE -> "fair"
          PowerManager.THERMAL_STATUS_SEVERE -> "serious"
          PowerManager.THERMAL_STATUS_CRITICAL, PowerManager.THERMAL_STATUS_EMERGENCY,
          PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
          else -> "unknown"
        }
      } else "unknown"

      val map = Arguments.createMap()
      readCpuUsagePercent()?.let { map.putDouble("cpuUsagePercent", it) } ?: map.putNull("cpuUsagePercent")
      cpuTemperature?.let { map.putDouble("cpuTemperatureC", it) } ?: map.putNull("cpuTemperatureC")
      gpuTemperature?.let { map.putDouble("gpuTemperatureC", it) } ?: map.putNull("gpuTemperatureC")
      map.putDouble("totalRamMb", totalRam.toDouble() / (1024.0 * 1024.0))
      map.putDouble("usedRamMb", usedRam.toDouble() / (1024.0 * 1024.0))
      map.putDouble("ramUsagePercent", if (totalRam > 0L) usedRam.toDouble() * 100.0 / totalRam else 0.0)
      map.putInt("usbDeviceCount", usbDeviceCount)
      map.putBoolean("usbConnected", usbDeviceCount > 0 || usbPowerConnected)
      map.putString(
        "usbStatus",
        when {
          usbDeviceCount > 0 -> "USB 장치 ${usbDeviceCount}개"
          usbPowerConnected -> "USB 전원 연결 · 데이터 미확인"
          else -> "USB 미연결"
        }
      )
      map.putString("thermalState", thermalState)
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("DEVICE_METRICS_FAILED", error)
    }
  }

  @ReactMethod
  fun getDeviceConditions(promise: Promise) {
    try {
      val battery = context.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      val percent = if (level >= 0 && scale > 0) (level * 100 / scale) else 100
      val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL

      val connectivity = context.getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
      val network = connectivity.activeNetwork
      val caps = network?.let { connectivity.getNetworkCapabilities(it) }
      val unmetered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true

      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        when (power.currentThermalStatus) {
          PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
          PowerManager.THERMAL_STATUS_MODERATE -> "fair"
          PowerManager.THERMAL_STATUS_SEVERE -> "serious"
          PowerManager.THERMAL_STATUS_CRITICAL, PowerManager.THERMAL_STATUS_EMERGENCY,
          PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
          else -> "unknown"
        }
      } else "unknown"

      val map = Arguments.createMap()
      map.putInt("batteryPercent", percent)
      map.putBoolean("charging", charging)
      map.putBoolean("unmeteredNetwork", unmetered)
      map.putString("thermalState", thermal)
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("WORKER_CONDITIONS_FAILED", error)
    }
  }

  @ReactMethod
  fun finishIteration() {
    context.sendBroadcast(Intent(PocketMindWorkerService.ACTION_ITERATION_FINISHED).setPackage(context.packageName))
  }
}
