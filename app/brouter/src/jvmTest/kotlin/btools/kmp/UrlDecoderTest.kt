package btools.kmp

import btools.kmp.net.URLDecoder
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals

class UrlDecoderTest {
    private fun jdk(s: String): Result<String> = runCatching { java.net.URLDecoder.decode(s, "UTF-8") }
    private fun mine(s: String): Result<String> = runCatching { URLDecoder.decode(s, "UTF-8") }

    private fun check(s: String) {
        val a = jdk(s)
        val b = mine(s)
        assertEquals(a.isSuccess, b.isSuccess, "success for '$s': jdk=$a mine=$b")
        if (a.isSuccess) assertEquals(a.getOrThrow(), b.getOrThrow(), "value for '$s'")
    }

    @Test
    fun knownInputs() {
        listOf(
            "lonlats=11.5755,48.1374|11.3406,47.9988&profile=trekking",
            "a+b%20c", "%7C", "%E2%82%AC", "%C3%A4%C3%B6", "%zz", "%4", "%", "100%25", "%ff%fe", "plain",
            "nogos=11.1,48.2,50%7C11.2,48.3,60",
        ).forEach(::check)
    }

    @Test
    fun randomInputs() {
        val alphabet = "ab+%09AFz|,.=&?"
        val rnd = Random(11)
        repeat(100_000) {
            val len = rnd.nextInt(0, 12)
            check(String(CharArray(len) { alphabet[rnd.nextInt(alphabet.length)] }))
        }
    }
}
