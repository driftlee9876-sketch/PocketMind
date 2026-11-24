package com.pocketmind

import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import android.content.Intent
import com.facebook.react.bridge.Arguments

class PocketMindWorkerHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    return HeadlessJsTaskConfig(
      "PocketMindWorker",
      Arguments.createMap(),
      300_000,
      true
    )
  }
}
