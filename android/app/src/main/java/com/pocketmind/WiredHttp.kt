package com.pocketmind

import com.facebook.react.bridge.Promise
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/** Nothing on the USB transport may redirect a prompt or pairing code off loopback. */
internal class WiredHttp {
  private val calls = ConcurrentHashMap<String, HttpURLConnection>()
  fun cancel(id: String) { calls.remove(id)?.disconnect() }
  fun close() { calls.keys.toList().forEach(::cancel) }
  fun request(id: String, action: String, token: String, data: String, promise: Promise) {
    val path = when (action) {
      "pair" -> "18788/pair"
      "models" -> "18789/v1/models"
      "chat" -> "18789/v1/chat/completions"
      else -> { promise.reject("WIRED", "지원되지 않는 유선 요청입니다."); return }
    }
    val connection = URL("http://127.0.0.1:$path").openConnection(Proxy.NO_PROXY) as HttpURLConnection
    calls[id] = connection
    Thread {
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6000
        connection.readTimeout = if (action == "chat") 180_000 else 10_000
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
        promise.reject("WIRED", "USB 케이블 또는 PC 실행기와의 연결이 끊겼어요.")
      } finally {
        calls.remove(id, connection)
        connection.disconnect()
      }
    }.start()
  }
}
