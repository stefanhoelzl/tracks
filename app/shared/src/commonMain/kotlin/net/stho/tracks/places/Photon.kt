package net.stho.tracks.places

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import net.stho.tracks.codec.Coordinate
import net.stho.tracks.codec.jsNumberToString
import net.stho.tracks.codec.jsToFixed
import net.stho.tracks.codec.jsTrim
import net.stho.tracks.plan.FormUrlEncoded

/** A place a search found. [name] is never empty; [context] is where it is, in one line. */
data class Place(val name: String, val context: String, val lat: Double, val lon: Double)

class HttpResponse(val status: Int, val body: String) {
    val ok: Boolean get() = status in 200..299
}

/** A GET, from whatever the platform has. Throws when there is no network; answers any status it got. */
fun interface Http {
    suspend fun get(url: String): HttpResponse
}

/**
 * Photon, at `photon.komoot.io`, from `packages/routing/src/photon/index.ts`: finding a place online, and naming one.
 * Offline there is no search; a POI is named from the map label under the tap instead.
 *
 * The caller debounces, as the web does: 250 ms, one request in flight.
 */
class PhotonGeocoder(private val http: Http, private val endpoint: String = ENDPOINT) {
    /** Places matching [query], biased towards [near]. A geocoder that is down answers nothing rather than failing. */
    suspend fun search(query: String, near: Coordinate?): List<Place> {
        val params = Photon.searchParams(query, near) ?: return emptyList()
        val response = http.get("$endpoint/api/?$params")
        if (!response.ok) return emptyList()
        return Photon.places(response.body)
    }

    /** What is here, for naming a POI. */
    suspend fun reverse(at: Coordinate): String? {
        val response = http.get("$endpoint/reverse?${Photon.reverseParams(at)}")
        if (!response.ok) return null
        return Photon.places(response.body).firstOrNull()?.name
    }

    companion object {
        const val ENDPOINT = "https://photon.komoot.io"
    }
}

/** The request and the reading of the answer, pinned by `photon.json`. */
internal object Photon {
    /** About five: enough to disambiguate a name, few enough to read without scrolling. */
    private const val LIMIT = 5

    fun searchParams(query: String, near: Coordinate?): String? {
        val trimmed = jsTrim(query)
        if (trimmed == "") return null

        val params = mutableListOf("q" to trimmed, "limit" to LIMIT.toString(), "lang" to "en")
        if (near != null) {
            params.add("lat" to jsNumberToString(near.lat))
            params.add("lon" to jsNumberToString(near.lon))
        }
        return FormUrlEncoded.serialize(params)
    }

    fun reverseParams(at: Coordinate): String = FormUrlEncoded.serialize(
        listOf("lat" to jsNumberToString(at.lat), "lon" to jsNumberToString(at.lon), "lang" to "en", "limit" to "1"),
    )

    fun places(body: String): List<Place> = places(Json.parseToJsonElement(body))

    /** Every place in an answer, or none when it is not an answer Photon gives. */
    fun places(root: JsonElement): List<Place> {
        val features = (root as? JsonObject)?.get("features") as? JsonArray ?: return emptyList()
        return features.map { readPlace(it) ?: return emptyList() }
    }

    private val PROPERTIES = listOf("name", "housenumber", "street", "city", "district", "county", "state", "country")

    private fun readPlace(element: JsonElement): Place? {
        val feature = element as? JsonObject ?: return null
        val geometry = feature["geometry"] as? JsonObject ?: return null
        if ((geometry["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content != "Point") return null
        val coordinates = geometry["coordinates"] as? JsonArray ?: return null
        if (coordinates.size != 2) return null
        val lon = coordinates[0].number() ?: return null
        val lat = coordinates[1].number() ?: return null

        val properties = feature["properties"] as? JsonObject ?: return null
        val fields = HashMap<String, String>()
        for (key in PROPERTIES) {
            val value = properties[key] ?: continue
            if (value !is JsonPrimitive || !value.isString) return null
            fields[key] = value.content
        }

        val name = nameOf(fields, lat, lon)
        return Place(name = name, context = contextOf(fields, name), lat = lat, lon = lon)
    }

    private fun JsonElement.number(): Double? {
        if (this !is JsonPrimitive || this is JsonNull || isString || booleanOrNull != null) return null
        return content.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    /** A named feature, then a street address, then the settlement, then coordinates: a name is never empty. */
    private fun nameOf(fields: Map<String, String>, lat: Double, lon: Double): String {
        fields["name"]?.takeIf { it.isNotEmpty() }?.let { return it }
        fields["street"]?.takeIf { it.isNotEmpty() }?.let { street ->
            val number = fields["housenumber"]?.takeIf { it.isNotEmpty() }
            return if (number != null) "$street $number" else street
        }
        return fields["city"] ?: fields["county"] ?: "${jsToFixed(lat, 4)}, ${jsToFixed(lon, 4)}"
    }

    /** Settlement, region, country — without repeating the name, or a word already said. */
    private fun contextOf(fields: Map<String, String>, name: String): String {
        val parts = listOf(
            fields["city"] ?: fields["district"],
            fields["state"] ?: fields["county"],
            fields["country"],
        )
        val seen = mutableSetOf(name)
        return parts.filter { !it.isNullOrEmpty() && seen.add(it) }.joinToString(" · ")
    }
}
