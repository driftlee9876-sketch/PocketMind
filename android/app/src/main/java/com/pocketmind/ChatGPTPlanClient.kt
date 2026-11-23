package com.pocketmind

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.math.BigInteger
import java.util.UUID

/** Device-local ChatGPT plan client. Never sends tokens through the React Native bridge. */
internal class ChatGPTPlanClient(
  private val context: Context,
  private val encrypt: (String) -> String,
  private val decrypt: (String) -> String,
) {
  private val preferences = context.getSharedPreferences("pocketmind_chatgpt_plan", Context.MODE_PRIVATE)
  private val lock = Any()
  private var listener: ServerSocket? = null
  @Volatile private var loginError: String? = null
  @Volatile private var loginPending = false
  @Volatile private var activeRequest: HttpURLConnection? = null
  private val resource = "https://api.openai.com/v1"

  private fun random(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }
    .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
  private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
  private fun decode(value: String) = URLDecoder.decode(value, "UTF-8")

  private fun saved(): JSONObject? {
    val encrypted = preferences.getString("session", null) ?: return null
    return JSONObject(decrypt(encrypted))
  }
  private fun save(session: JSONObject) {
    if (!preferences.edit().putString("session", encrypt(session.toString())).commit()) {
      throw IllegalStateException("ChatGPT 로그인 정보를 저장하지 못했습니다.")
    }
  }

  fun status(): JSONObject = synchronized(lock) {
    val session = saved()
    JSONObject().put("connected", session?.optString("refresh_token")?.isNotBlank() == true)
      .put("pending", loginPending)
      .put("email", session?.optString("email", "") ?: "")
      .put("error", loginError ?: "")
  }

  fun signOut() = synchronized(lock) {
    listener?.close()
    listener = null
    loginPending = false
    preferences.edit().remove("session").commit()
  }

  fun cancel() { activeRequest?.disconnect() }

  fun startLogin(): String = synchronized(lock) {
    listener?.close()
    loginError = null
    val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    server.soTimeout = 180_000
    listener = server
    loginPending = true
    val verifier = random() + random()
    val challenge = Base64.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()),
      Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
    val state = random()
    val nonce = random()
    val hostId = preferences.getString("host_id", null) ?: ("urn:uuid:" + UUID.randomUUID()).also {
      preferences.edit().putString("host_id", it).commit()
    }
    val prior = saved()
    val clientId = prior?.optString("client_id")?.takeIf { it.isNotBlank() } ?: "dynamic_agent_client"
    val redirect = "http://127.0.0.1:${server.localPort}/auth/callback"
    val params = linkedMapOf(
      "client_id" to clientId, "ext_agent_host_id" to hostId,
      "response_type" to "code", "redirect_uri" to redirect,
      "scope" to "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      "resource" to resource, "state" to state, "nonce" to nonce,
      "code_challenge_method" to "S256", "code_challenge" to challenge,
    )
    if (prior == null) params["agent_name_hint"] = "PocketMind"
    Thread {
      try {
        server.use { socket ->
          val connection = socket.accept()
          connection.use { peer ->
            peer.soTimeout = 10_000
            val reader = peer.getInputStream().bufferedReader()
            val requestLine = reader.readLine() ?: throw IllegalStateException("로그인 응답이 없습니다.")
            val target = requestLine.split(' ').getOrNull(1) ?: throw IllegalStateException("잘못된 로그인 응답입니다.")
            if (!requestLine.startsWith("GET /auth/callback?")) throw IllegalStateException("잘못된 로그인 경로입니다.")
            val query = target.substringAfter('?', "").split('&').mapNotNull {
              val pieces = it.split('=', limit = 2)
              if (pieces.size == 2) decode(pieces[0]) to decode(pieces[1]) else null
            }.toMap()
            if (query["state"] != state) throw IllegalStateException("로그인 상태 검증 실패")
            if (query.containsKey("error")) throw IllegalStateException("ChatGPT 로그인이 취소되었습니다.")
            val code = query["code"] ?: throw IllegalStateException("로그인 코드가 없습니다.")
            val issued = query["client_id"] ?: if (prior != null) clientId else throw IllegalStateException("클라이언트 등록이 완료되지 않았습니다.")
            if (prior != null && issued != clientId) throw IllegalStateException("로그인 계정이 변경되었습니다.")
            val html = "<html><meta charset='utf-8'><body>ChatGPT 로그인이 완료되었습니다. PocketMind로 돌아가세요.</body></html>"
            peer.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${html.toByteArray().size}\r\nConnection: close\r\n\r\n" + html).toByteArray())
            val token = requestJson(
              "https://auth.openai.com/api/accounts/oauth/token", "POST",
              null, "grant_type=authorization_code&client_id=${encode(issued)}&code=${encode(code)}&code_verifier=${encode(verifier)}&redirect_uri=${encode(redirect)}&resource=${encode(resource)}",
              "application/x-www-form-urlencoded",
            )
            val scopes = token.optString("scope").split(' ')
            if (!scopes.contains("chatgpt.tokens.use.direct") || !scopes.contains("resource.invoke")) {
              throw IllegalStateException("ChatGPT 플랜 사용 권한이 승인되지 않았습니다.")
            }
            val claims = verifyIdToken(token.getString("id_token"), issued, nonce)
            if (prior != null && claims.getString("sub") != prior.getString("subject")) {
              throw IllegalStateException("이전과 다른 ChatGPT 계정입니다. 연결을 해제한 뒤 다시 시도하세요.")
            }
            val session = JSONObject()
              .put("client_id", issued).put("subject", claims.getString("sub"))
              .put("email", claims.optString("email"))
              .put("access_token", token.getString("access_token"))
              .put("refresh_token", token.getString("refresh_token"))
              .put("expires_at", System.currentTimeMillis() + token.optLong("expires_in", 3600) * 1000)
            synchronized(lock) { save(session) }
          }
        }
      } catch (error: Exception) {
        loginError = error.message ?: "ChatGPT 로그인에 실패했습니다."
      } finally {
        loginPending = false
        synchronized(lock) { if (listener === server) listener = null }
      }
    }.start()
    "https://auth.openai.com/api/accounts/authorize?" + params.entries.joinToString("&") { encode(it.key) + "=" + encode(it.value) }
  }

  private fun verifyIdToken(jwt: String, audience: String, nonce: String): JSONObject {
    val parts = jwt.split('.')
    if (parts.size != 3) throw IllegalStateException("잘못된 ID 토큰입니다.")
    fun b64(value: String) = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP)
    val header = JSONObject(String(b64(parts[0])))
    if (header.optString("alg") != "RS256") throw IllegalStateException("지원하지 않는 ID 토큰 서명입니다.")
    val keys = requestJson("https://auth.openai.com/.well-known/jwks.json", "GET", null)
    val list = keys.getJSONArray("keys")
    val key = (0 until list.length()).map { list.getJSONObject(it) }.firstOrNull {
      it.optString("kid") == header.optString("kid") && it.optString("kty") == "RSA"
    } ?: throw IllegalStateException("ID 토큰 검증 키가 없습니다.")
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(
      RSAPublicKeySpec(BigInteger(1, b64(key.getString("n"))), BigInteger(1, b64(key.getString("e")))),
    )
    val verifier = Signature.getInstance("SHA256withRSA")
    verifier.initVerify(publicKey)
    verifier.update((parts[0] + "." + parts[1]).toByteArray())
    if (!verifier.verify(b64(parts[2]))) throw IllegalStateException("ID 토큰 서명 검증 실패")
    val claims = JSONObject(String(b64(parts[1])))
    val aud = claims.opt("aud")
    val correctAudience = aud == audience || (aud is JSONArray && (0 until aud.length()).any { aud.optString(it) == audience })
    val now = System.currentTimeMillis() / 1000
    if (claims.optString("iss") != "https://auth.openai.com" || !correctAudience ||
      claims.optString("nonce") != nonce || claims.optString("sub").isBlank() ||
      claims.optLong("exp") < now - 5 || claims.optLong("iat") > now + 5) {
      throw IllegalStateException("ID 토큰 계정 검증 실패")
    }
    return claims
  }

  private fun accessToken(): String = synchronized(lock) {
    val session = saved() ?: throw IllegalStateException("ChatGPT 계정으로 로그인해 주세요.")
    if (session.optLong("expires_at") > System.currentTimeMillis() + 90_000) return@synchronized session.getString("access_token")
    val token = requestJson(
      "https://auth.openai.com/api/accounts/oauth/token", "POST", null,
      "grant_type=refresh_token&client_id=${encode(session.getString("client_id"))}&refresh_token=${encode(session.getString("refresh_token"))}&resource=${encode(resource)}",
      "application/x-www-form-urlencoded",
    )
    if (!token.optString("scope").split(' ').contains("chatgpt.tokens.use.direct")) throw IllegalStateException("ChatGPT 플랜 사용 권한이 없습니다.")
    session.put("access_token", token.getString("access_token"))
      .put("refresh_token", token.getString("refresh_token"))
      .put("expires_at", System.currentTimeMillis() + token.optLong("expires_in", 3600) * 1000)
    save(session)
    session.getString("access_token")
  }

  fun models(): JSONArray {
    val result = requestJson("https://api.openai.com/v1/models", "GET", accessToken())
    val models = result.optJSONArray("models") ?: JSONArray()
    val visible = JSONArray()
    for (i in 0 until models.length()) {
      val model = models.optJSONObject(i) ?: continue
      if (model.optString("visibility") == "list" && model.optString("slug").isNotBlank()) {
        visible.put(JSONObject().put("id", model.getString("slug")).put("name", model.optString("display_name", model.getString("slug"))))
      }
    }
    return visible
  }

  fun chat(model: String, messages: JSONArray): String {
    if (model.isBlank()) throw IllegalArgumentException("모델을 선택해 주세요.")
    val body = JSONObject().put("model", model).put("input", messages).put("store", false).put("stream", true)
    val connection = URL("https://api.openai.com/v1/responses").openConnection() as HttpURLConnection
    activeRequest = connection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 15_000
      connection.readTimeout = 180_000
      connection.setRequestProperty("Authorization", "Bearer ${accessToken()}")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.doOutput = true
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      if (connection.responseCode !in 200..299) throw IllegalStateException("ChatGPT 요청 오류 (HTTP ${connection.responseCode})")
      val text = StringBuilder()
      var completed = false
      connection.inputStream.bufferedReader().useLines { lines ->
        lines.forEach { line ->
          if (!line.startsWith("data: ") || line == "data: [DONE]") return@forEach
          val event = try { JSONObject(line.removePrefix("data: ")) } catch (_: Exception) { return@forEach }
          when (event.optString("type")) {
            "response.output_text.delta" -> text.append(event.optString("delta"))
            "response.completed" -> completed = true
            "response.failed", "response.incomplete" -> throw IllegalStateException("ChatGPT 응답이 완료되지 않았습니다. 사용 한도와 로그인 상태를 확인하세요.")
          }
        }
      }
      if (!completed) throw IllegalStateException("ChatGPT 응답이 끝까지 완료되지 않았습니다.")
      return text.toString().trim().ifBlank { throw IllegalStateException("빈 응답을 받았습니다.") }
    } finally {
      activeRequest = null
      connection.disconnect()
    }
  }

  private fun requestJson(url: String, method: String, token: String?, body: String? = null, contentType: String = "application/json"): JSONObject {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = 15_000
      connection.readTimeout = 20_000
      if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        connection.setRequestProperty("Content-Type", contentType)
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray()) }
      }
      val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
      val raw = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
      if (connection.responseCode !in 200..299) throw IllegalStateException("ChatGPT 연결 오류 (HTTP ${connection.responseCode})")
      return JSONObject(raw)
    } finally { connection.disconnect() }
  }
}
