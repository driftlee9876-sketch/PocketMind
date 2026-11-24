package com.pocketmind

import java.io.StringReader
import org.junit.Assert.*
import org.junit.Test

class ChatGPTReplyTest {
  private fun read(vararg events: String): ChatGPTReply {
    val input = events.joinToString("\n\n") { "data:$it" } + "\n\n"
    return ChatGPTResponses.read(StringReader(input).buffered(), "req-test") {}
  }
  private val partial = """{"type":"response.output_text.delta","delta":"안녕"}"""

  @Test fun terminalUsageFailureKeepsPartialTextAndExactCode() {
    val result = read(partial, """{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}""")
    assertEquals("안녕", result.text)
    assertEquals("subscription_sharing_usage_limit_exceeded", result.code)
    assertTrue(result.issue!!.contains("req-test"))
  }

  @Test fun finalSnapshotIsAuthoritativeAndNeverDuplicatesDeltas() {
    val result = read(partial, """{"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"안녕하세요"}]}]}}""", "[DONE]")
    assertNull(result.issue)
    assertEquals("안녕하세요", result.text)
  }

  @Test fun incompleteRefusalAndEofAreDistinct() {
    val incomplete = read("""{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"},"output":[{"content":[{"type":"output_text","text":"앞부분"}]}]}}""")
    assertEquals("max_output_tokens", incomplete.code)
    assertEquals("앞부분", incomplete.text)
    assertEquals("stream_interrupted", read(partial).code)
    assertEquals("stream_interrupted", read(partial, "[DONE]").code)
    val refusal = read("""{"type":"response.refusal.delta","delta":"답변할 수 없어요."}""", """{"type":"response.completed"}""")
    assertNull(refusal.issue)
    assertEquals("답변할 수 없어요.", refusal.text)
  }
}
