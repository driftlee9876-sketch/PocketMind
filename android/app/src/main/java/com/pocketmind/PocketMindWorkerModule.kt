package com.pocketmind

import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.content.Context.CONNECTIVITY_SERVICE
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class PocketMindWorkerModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "PocketMindWorker"

  @ReactMethod
  fun startWorker(config: ReadableMap, promise: Promise) {
    try {
      val json = JSONObject(config.toHashMap() as Map<*, *>)
      json.put("enabled", true)
      context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
        .edit().putString("config", json.toString()).apply()
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
        .edit().putString("config", JSONObject().put("enabled", false).toString()).apply()
      context.stopService(Intent(context, PocketMindWorkerService::class.java))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WORKER_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun getConfig(promise: Promise) {
    try {
      val raw = context.getSharedPreferences("pocketmind_worker", Context.MODE_PRIVATE)
        .getString("config", "{}") ?: "{}"
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
