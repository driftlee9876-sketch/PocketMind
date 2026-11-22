package com.pocketmind

import android.content.Context
import android.content.Intent
import android.app.ActivityManager
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

class PocketMindWorkerModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val keyAlias = "PocketMindWorkerAesKey"

  override fun getName(): String = "PocketMindWorker"

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
