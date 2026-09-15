package btools.kmp

import btools.kmp.util.PriorityQueue
import btools.kmp.util.StringTokenizer
import btools.kmp.util.TreeMap
import java.util.Locale
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals

/** Checks the java.util / java.util.Formatter replacements against the JDK. */
class JavaUtilTest {
    @Test
    fun fixed1Width3MatchesStringFormat() {
        val rnd = Random(3)
        val samples = listOf(0f, -0f, 0.05f, 0.15f, 0.25f, 0.35f, 1.25f, 2.45f, 9.95f, 99.95f, 123.456f, -0.04f, -1.25f, 0.3048f * 7, 1.609344f * 30) +
            List(1_000_000) { rnd.nextFloat() * 400f } +
            List(200_000) { rnd.nextInt(0, 40_000) / 100f } +
            List(200_000) { rnd.nextInt(0, 4000) * 0.3048f }
        for (f in samples) assertEquals(String.format(Locale.US, "%3.1f", f), TextFormat.fixed1Width3(f), "value $f")
    }

    @Test
    fun stringTokenizer() {
        for (s in listOf("a b  c", "  lead", "trail  ", "", "k=v&x=y", "?&a=1&&b=2?", "one")) {
            for (d in listOf(" ", "?&", "=", "|")) {
                val jdk = java.util.StringTokenizer(s, d)
                val mine = StringTokenizer(s, d)
                assertEquals(jdk.countTokens(), mine.countTokens(), "count '$s' '$d'")
                while (jdk.hasMoreTokens()) assertEquals(jdk.nextToken(), mine.nextToken())
                assertEquals(false, mine.hasMoreTokens())
            }
        }
    }

    @Test
    fun treeMapOrder() {
        val rnd = Random(5)
        val jdk = java.util.TreeMap<Long, String>()
        val mine = TreeMap<Long, String>()
        repeat(5000) {
            val k = rnd.nextLong(-1000, 1000)
            val v = "v$it"
            assertEquals(jdk.put(k, v), mine.put(k, v))
            if (it % 7 == 0) assertEquals(jdk.remove(k + 1), mine.remove(k + 1))
        }
        assertEquals(jdk.entries.map { it.key to it.value }, mine.entries.map { it.key to it.value })
        assertEquals(jdk.firstKey(), mine.firstKey())
        assertEquals(jdk.lastKey(), mine.lastKey())
    }

    @Test
    fun priorityQueuePollOrder() {
        val rnd = Random(9)
        val cmp = Comparator<Int> { a, b -> (a % 97).compareTo(b % 97) }
        val jdk = java.util.PriorityQueue(11, cmp)
        val mine = PriorityQueue(11, cmp)
        repeat(3000) { val x = rnd.nextInt(0, 100000); jdk.add(x); mine.add(x) }
        // only the key order is defined; compare keys
        while (jdk.isNotEmpty()) assertEquals(jdk.poll() % 97, mine.poll()!! % 97)
    }
}
