package com.pocketmind

import com.facebook.react.bridge.Promise
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/** Nothing on the USB transport may redirect a prompt or pairing code off loopback. */
internal class WiredHttp(private val emit: (String, String) -> Unit) {
  private val calls = ConcurrentHashMap<String, HttpURLConnection>()
  fun cancel(id: String) { calls.remove(id)?.disconnect() }
  fun close() { calls.keys.toList().forEach(::cancel) }
  fun request(id: String, action: String, token: String, data: String, promise: Promise) {
    val path = when (action) {
      "pair" -> "18788/pair"
      "models" -> "18789/v1/models"
      "chat", "stream" -> "18789/v1/chat/completions"
      else -> { promise.reject("WIRED", "지원되지 않는 유선 요청입니다."); return }
    }
    val connection = URL("http://127.0.0.1:$path").openConnection(Proxy.NO_PROXY) as HttpURLConnection
    calls[id] = connection
    Thread {
      try {
        val requestStarted = android.os.SystemClock.elapsedRealtime()
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6000
        connection.readTimeout = if (action == "chat" || action == "stream") 180_000 else 10_000
        connection.requestMethod = if (action == "models") "GET" else "POST"
        if (token.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
        check(calls[id] === connection) { "요청을 취소했어요." }
        if (action != "models") {
          connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.outputStream.use { it.write(data.toByteArray(Charsets.UTF_8)) }
        }
        val status = connection.responseCode
        if (status !in 200..299) { promise.reject("WIRED_$status", "유선 연결 오류 (HTTP $status)"); return@Thread }
        if (action == "stream") {
          val started = requestStarted
          val content = StringBuilder()
          var first = 0L
          var speed = 0.0
          var tokens = 0
          var complete = false
          var lastEvent = 0L
          connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
            while (true) {
              val line = reader.readLine() ?: break
              if (!line.startsWith("data:")) continue
              val dataLine = line.removePrefix("data:").trim()
              if (dataLine == "[DONE]") { complete = true; break }
              val event = org.json.JSONObject(dataLine)
              check(!event.has("error")) { "모델 실행 오류" }
              val choice = event.optJSONArray("choices")?.optJSONObject(0)
              val delta = choice?.optJSONObject("delta")?.optString("content").orEmpty()
              val now = android.os.SystemClock.elapsedRealtime()
              if (delta.isNotEmpty()) {
                if (first == 0L) first = now
                content.append(delta)
                check(content.length <= 2000000)
                if (now - lastEvent >= 80) { emit(id,content.toString()); lastEvent = now }
              }
              if (choice != null && !choice.isNull("finish_reason")) complete = true
              event.optJSONObject("timings")?.let { speed = it.optDouble("predicted_per_second",speed); tokens = it.optInt("predicted_n",tokens) }
              event.optJSONObject("usage")?.let { tokens = it.optInt("completion_tokens",tokens) }
            }
          }
          if (content.isNotEmpty()) emit(id,content.toString())
          check(complete && first > 0L) { "응답이 중단됐어요." }
          val elapsed = android.os.SystemClock.elapsedRealtime() - first
          if (speed <= 0.0 && elapsed > 0 && tokens > 1) speed = (tokens-1)*1000.0/elapsed
          promise.resolve(org.json.JSONObject().put("text",content.toString()).put("firstMs",first-started)
            .put("rate",if(speed.isFinite()) speed else 0.0).toString())
          return@Thread
        }
        val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
          val result = StringBuilder()
          val chunk = CharArray(8192)
          while (true) {
            val count = reader.read(chunk)
            if (count < 0) break
            require(result.length + count <= 2_000_000) { "유선 응답이 너무 큽니다." }
            result.append(chunk, 0, count)
          }
          result.toString()
        }
        promise.resolve(body)
      } catch (_: Exception) {
        promise.reject("WIRED", "GPU와의 통신이 중단됐어요. 기기 연결을 확인하세요.")
      } finally {
        calls.remove(id, connection)
        connection.disconnect()
      }
    }.start()
  }
}
