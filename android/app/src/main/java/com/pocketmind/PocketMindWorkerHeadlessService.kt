package com.pocketmind

import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import android.content.Intent
import android.os.Bundle

class PocketMindWorkerHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
      "PocketMindWorker",
      Bundle(),
      60_000,
      true
    )
  }
}
