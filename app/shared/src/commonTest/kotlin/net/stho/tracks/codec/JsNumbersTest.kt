package net.stho.tracks.codec

import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.plan.stringOrNull
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals

/** JavaScript's numbers as text and text as numbers, where a request or a name has to come out the same. */
class JsNumbersTest {
    private val fixture = Fixtures.read("numbers.json")

    @Test
    fun writesNumbersAsJavaScriptDoes() {
        for (case in fixture.cases("numbers")) {
            val value = case.getValue("value").jsonPrimitive.double
            assertEquals(case.string("string"), jsNumberToString(value), "String($value)")
            case.getValue("fixed4").stringOrNull()?.let { assertEquals(it, jsToFixed(value, 4), "$value.toFixed(4)") }
            case.getValue("fixed6").stringOrNull()?.let { assertEquals(it, jsToFixed(value, 6), "$value.toFixed(6)") }
        }
    }

    @Test
    fun readsTextAsJavaScriptDoes() {
        for (case in fixture.cases("texts")) {
            val text = case.string("text")
            assertEquals(case.string("trimmed"), jsTrim(text), "\"$text\".trim()")
            assertEquals(case.string("number"), jsNumberToString(jsStringToNumber(text)), "Number(\"$text\")")
        }
    }
}
