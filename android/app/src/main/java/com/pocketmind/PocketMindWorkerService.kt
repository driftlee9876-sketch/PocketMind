package com.pocketmind

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

class PocketMindWorkerService : Service() {
  companion object {
    const val ACTION_ITERATION_FINISHED = "com.pocketmind.WORKER_ITERATION_FINISHED"
    private const val CHANNEL_ID = "pocketmind-worker"
    private const val NOTIFICATION_ID = 8801
    private const val POLL_DELAY_MS = 30_000L
    private const val TASK_WATCHDOG_MS = 315_000L
  }

  private val handler = Handler(Looper.getMainLooper())
  private var taskRunning = false

  private val finishReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      taskRunning = false
      handler.removeCallbacks(watchdog)
      handler.postDelayed(startIteration, POLL_DELAY_MS)
    }
  }

  private val startIteration = Runnable {
    if (!taskRunning) {
      taskRunning = true
      try {
        com.facebook.react.HeadlessJsTaskService.acquireWakeLockNow(this)
        startService(Intent(this, PocketMindWorkerHeadlessService::class.java))
        handler.postDelayed(watchdog, TASK_WATCHDOG_MS)
      } catch (_: Exception) {
        taskRunning = false
        handler.postDelayed(startIteration, POLL_DELAY_MS)
      }
    }
  }

  private val watchdog = Runnable {
    taskRunning = false
    handler.postDelayed(startIteration, POLL_DELAY_MS)
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    val filter = IntentFilter(ACTION_ITERATION_FINISHED)
    if (Build.VERSION.SDK_INT >= 33) {
      registerReceiver(finishReceiver, filter, RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(finishReceiver, filter)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, notification())
    handler.removeCallbacks(startIteration)
    handler.post(startIteration)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    try { unregisterReceiver(finishReceiver) } catch (_: Exception) {}
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "PocketMind Worker", NotificationManager.IMPORTANCE_LOW)
      channel.description = "사용자가 켠 PocketMind 분산 AI 작업 처리 상태"
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun notification(): Notification {
    val openApp = packageManager.getLaunchIntentForPackage(packageName)
    val pending = openApp?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder.setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("PocketMind Worker 실행 중")
      .setContentText("사용자가 허용한 조건에서 분산 AI 작업을 확인하고 있습니다.")
      .setOngoing(true)
    if (pending != null) builder.setContentIntent(pending)
    return builder.build()
  }
}
