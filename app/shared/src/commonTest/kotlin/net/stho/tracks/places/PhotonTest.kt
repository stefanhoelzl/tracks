package net.stho.tracks.places

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.stho.tracks.Fixtures
import net.stho.tracks.cases
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.plan.latLon
import net.stho.tracks.plan.stringOrNull
import net.stho.tracks.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Photon's request and answer, pinned to `packages/routing/src/photon/index.ts` by `photon.json`. */
class PhotonTest {
    private val fixture = Fixtures.read("photon.json")

    private fun JsonElement.places(): List<Place> = jsonArray.map { element ->
        element.jsonObject.let {
            Place(it.string("name"), it.string("context"), it.getValue("lat").jsonPrimitive.double, it.getValue("lon").jsonPrimitive.double)
        }
    }

    @Test
    fun asksAsTheWebAsks() {
        for (case in fixture.cases("searches")) {
            val query = case.string("query")
            val near = case.getValue("near").let { if (it is JsonNull) null else it.latLon() }
            assertEquals(case.getValue("params").stringOrNull(), Photon.searchParams(query, near), "\"$query\" near $near")
        }
        for (case in fixture.cases("reverses")) {
            val at = case.getValue("at").latLon()
            assertEquals(case.string("params"), Photon.reverseParams(at), "$at")
        }
    }

    @Test
    fun readsRecordedAnswersAsTheWebDoes() {
        for (case in fixture.cases("files")) {
            val file = case.string("file")
            assertEquals(case.getValue("places").places(), Photon.places(Fixtures.repoText(file)), file)
        }
    }

    @Test
    fun readsOrIgnoresAnswersAsTheWebDoes() {
        for (case in fixture.cases("bodies")) {
            val body = case.getValue("body")
            assertEquals(case.getValue("places").places(), Photon.places(body), "$body")
        }
    }

    @Test
    fun aGeocoderThatIsDownAnswersNothing() = runTest {
        val asked = mutableListOf<String>()
        val down = PhotonGeocoder({ url -> asked.add(url); HttpResponse(503, "") })

        assertEquals(emptyList(), down.search("Vent", null))
        assertNull(down.reverse(Coordinate(47.26, 11.39)))
        assertEquals(emptyList(), down.search("   ", null))
        assertEquals(
            listOf("https://photon.komoot.io/api/?q=Vent&limit=5&lang=en", "https://photon.komoot.io/reverse?lat=47.26&lon=11.39&lang=en&limit=1"),
            asked,
        )
    }

    @Test
    fun namesAPlaceFromTheFirstAnswer() = runTest {
        val body = Fixtures.repoText("fixtures/photon/reverse-innsbruck.json")
        val geocoder = PhotonGeocoder({ HttpResponse(200, body) })
        assertEquals(Photon.places(body).first().name, geocoder.reverse(Coordinate(47.26, 11.39)))
    }
}
