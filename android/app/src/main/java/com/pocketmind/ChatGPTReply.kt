package com.pocketmind

import java.io.BufferedReader
import java.io.IOException
import org.json.JSONObject

internal data class ChatGPTReply(val text: String, val issue: String? = null, val code: String? = null) {
  fun json(): String = JSONObject().put("text", text).put("issue", issue).put("code", code).toString()
}

internal object ChatGPTResponses {
  fun failure(code: String, status: Int = 0, requestId: String? = null): ChatGPTReply {
    val message = when (code) {
      "subscription_sharing_usage_limit_exceeded" -> "이 앱에서 사용할 수 있는 ChatGPT 한도에 도달했어요. 사용량을 확인하고 나중에 다시 시도하세요."
      "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable", "server_error" -> "ChatGPT가 잠시 요청을 처리할 수 없어요. 잠시 후 다시 시도하세요."
      "subscription_sharing_user_not_eligible" -> "이 계정이나 워크스페이스에서 ChatGPT 플랜을 이 앱에 사용할 수 없어요."
      "subscription_sharing_invalid_user", "invalid_grant", "invalid_refresh_token" -> "ChatGPT 계정 연결을 다시 확인해 주세요."
      "subscription_sharing_unsupported_capability", "model_not_found" -> "선택한 모델에서 이 요청을 처리할 수 없어요. 모델 목록을 새로고침하고 다른 모델을 선택해 주세요."
      "max_output_tokens" -> "답변 길이 한도에서 멈췄어요. 질문을 나누거나 이어서 요청해 주세요."
      "content_filter" -> "ChatGPT가 이 답변을 끝까지 제공할 수 없어요."
      "stream_interrupted" -> "답변을 받는 중 연결이 끊겼어요. 네트워크를 확인하고 다시 시도하세요."
      "incomplete" -> "ChatGPT가 답변 생성을 중간에 마쳤어요."
      else -> when (status) {
        401 -> "ChatGPT 계정과 승인한 권한을 확인해 주세요."
        403 -> "이 계정의 정책 또는 권한으로 요청이 제한됐어요."
        429 -> "요청이 일시적으로 제한됐어요. 잠시 후 다시 시도하세요."
        in 500..599 -> "ChatGPT 서비스에 일시적인 문제가 있어요. 잠시 후 다시 시도하세요."
        else -> "ChatGPT에서 요청을 완료하지 못했어요."
      }
    }
    val details = listOfNotNull(code.takeIf { it.matches(Regex("[a-zA-Z0-9_.-]{1,90}")) },
      status.takeIf { it >= 400 }?.let { "HTTP $it" },
      requestId?.takeIf { it.matches(Regex("[a-zA-Z0-9_-]{1,100}")) }).joinToString(" · ")
    return ChatGPTReply("", if (details.isEmpty()) message else "$message\n$details", code)
  }

  fun read(reader: BufferedReader, requestId: String?, progress: (String) -> Unit): ChatGPTReply {
    val parts = sortedMapOf<Pair<Int, Int>, StringBuilder>(compareBy({ it.first }, { it.second }))
    var lastProgressAt = 0L
    fun output(): String = parts.values.joinToString("") { it.toString() }
    fun failed(code: String) = failure(code, requestId = requestId).copy(text = output().trim())
    fun consume(data: String, eventName: String): ChatGPTReply? {
      if (data == "[DONE]") return failed("stream_interrupted")
      val event = try { JSONObject(data) } catch (_: Exception) { return failed("invalid_stream") }
      val response = event.optJSONObject("response")
      val key = event.optInt("output_index") to event.optInt("content_index")
      when (event.optString("type", eventName)) {
        "response.output_text.delta", "response.refusal.delta" -> {
          parts.getOrPut(key) { StringBuilder() }.append(event.optString("delta"))
          val now = System.nanoTime()
          if (lastProgressAt == 0L || now - lastProgressAt >= 80_000_000L) {
            lastProgressAt = now
            progress(output())
          }
        }
        "response.output_text.done", "response.refusal.done" -> {
          val full = event.optString("text").ifEmpty { event.optString("refusal") }
          if (full.isNotEmpty()) parts[key] = StringBuilder(full)
        }
        "response.completed", "response.incomplete" -> {
          val items = response?.optJSONArray("output")
          for (i in 0 until (items?.length() ?: 0)) {
            val content = items?.optJSONObject(i)?.optJSONArray("content") ?: continue
            for (j in 0 until content.length()) {
              val part = content.optJSONObject(j) ?: continue
              val value = when (part.optString("type")) {
                "output_text" -> part.optString("text")
                "refusal" -> part.optString("refusal")
                else -> ""
              }
              if (value.isNotEmpty()) parts[i to j] = StringBuilder(value)
            }
          }
          if (event.optString("type", eventName) == "response.incomplete")
            return failed(response?.optJSONObject("incomplete_details")?.optString("reason") ?: "incomplete")
          val answer = output().trim()
          return if (answer.isNotEmpty()) ChatGPTReply(answer) else failed("empty_response")
        }
        "response.failed", "error" -> {
          val error = response?.optJSONObject("error") ?: event.optJSONObject("error") ?: event
          return failed(error.optString("code", "response_failed"))
        }
      }
      return null
    }
    val data = mutableListOf<String>()
    var name = ""
    try {
      while (true) {
        val line = reader.readLine()
        if (line == null || line.isEmpty()) {
          if (data.isNotEmpty()) consume(data.joinToString("\n"), name)?.let { return it }
          data.clear()
          name = ""
          if (line == null) return failed("stream_interrupted")
        } else if (line.startsWith("data:")) data.add(line.substring(5).removePrefix(" "))
        else if (line.startsWith("event:")) name = line.substring(6).trim()
      }
    } catch (_: IOException) {
      return failed("stream_interrupted")
    }
  }
}
