package net.stho.tracks.offline

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.head
import io.ktor.client.statement.readRawBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okio.FileSystem
import okio.Path

/** Where brouter.de publishes the profiles it routes with: the files its own web client reads. */
const val BROUTER_PROFILES = "https://brouter.de/brouter/profiles2"

/** The engine's vocabulary and the app's five profiles, as the engine reads them from one directory. */
val PROFILE_FILES = listOf("lookups.dat", "fastbike.brf", "trekking.brf", "gravel.brf", "mtb.brf", "hiking-mountain.brf")

/** A week, as for segment tiles: brouter.de can change a profile without a release, and the phone follows it. */
const val PROFILE_REFRESH_MS = SEGMENT_REFRESH_MS

private const val LOOKUP_VERSION_TAG = "---lookupversion:"

data class ProfileSyncResult(
    /** Files that changed on brouter.de and are now the phone's. */
    val updated: List<String>,
    /** Why a check or an update did not happen; the files the phone has stay as they are. */
    val problem: String?,
)

/**
 * The profiles the engine routes with, kept as brouter.de has them.
 *
 * The app ships with them, so a phone that never had a network routes from its first launch: [seed] copies the bundled
 * files into [directory] where none is. After that, on an unmetered network and at most once a [PROFILE_REFRESH_MS] per
 * file, a HEAD asks whether brouter.de's file changed, and a changed one is downloaded whole — they are tens of kilobytes —
 * and replaces the old one only once it reads as what it is: a profile with its global context, or a `lookups.dat` of the
 * lookup version the engine was built for. A lookups file of another version is left on the server: the engine and the
 * tiles it reads would no longer agree, and routing with the old file is better than routing with none.
 *
 * Each file's record is beside it, `trekking.brf.json`: its ETag and Last-Modified, and when it was last checked.
 */
class ProfileSync(
    val directory: Path,
    private val client: HttpClient,
    private val clock: () -> Long,
    private val fileSystem: FileSystem = FileSystem.SYSTEM,
    base: String = BROUTER_PROFILES,
) {
    private val base = base.trimEnd('/')

    /** Copies each of [bundled]'s profile files into [directory] where there is none yet. */
    fun seed(bundled: Path, bundledFileSystem: FileSystem = fileSystem) {
        fileSystem.createDirectories(directory)
        for (name in PROFILE_FILES) {
            val target = directory / name
            if (fileSystem.exists(target)) continue
            val bytes = bundledFileSystem.read(bundled / name) { readByteArray() }
            install(name, bytes)
        }
    }

    suspend fun sync(network: Network?): ProfileSyncResult {
        if (network != Network.Unmetered) return ProfileSyncResult(emptyList(), null)
        val updated = mutableListOf<String>()
        for (name in PROFILE_FILES) {
            val record = record(name)
            if (record != null && clock() - record.checkedAtMillis < PROFILE_REFRESH_MS) continue
            try {
                if (refresh(name, record)) updated += name
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return ProfileSyncResult(updated, e.message ?: e.toString())
            }
        }
        return ProfileSyncResult(updated, null)
    }

    private suspend fun refresh(name: String, record: SegmentRecord?): Boolean {
        val url = "$base/$name"
        val head = client.head(url)
        if (!head.status.isSuccess()) error("brouter.de answered ${head.status} for $name")
        val etag = head.headers[HttpHeaders.ETag]
        if (record != null && etag != null && etag == record.etag) {
            writeRecord(name, record.copy(checkedAtMillis = clock()))
            return false
        }

        val response = client.get(url)
        if (!response.status.isSuccess()) error("brouter.de answered ${response.status} for $name")
        val bytes = response.readRawBytes()
        check(readsAs(name, bytes)) { "brouter.de's $name is not one the engine can route with; the phone keeps its own" }

        val fresh = SegmentRecord(response.headers[HttpHeaders.ETag], response.headers[HttpHeaders.LastModified], bytes.size.toLong(), clock())
        val current = directory / name
        val changed = !fileSystem.exists(current) || !fileSystem.read(current) { readByteArray() }.contentEquals(bytes)
        if (changed) install(name, bytes)
        writeRecord(name, fresh)
        return changed
    }

    private fun readsAs(name: String, bytes: ByteArray): Boolean {
        val text = bytes.decodeToString()
        if (name != "lookups.dat") return "---context:global" in text
        val version = lookupVersion(text) ?: return false
        val current = (directory / name).takeIf { fileSystem.exists(it) }?.let { path -> lookupVersion(fileSystem.read(path) { readUtf8() }) }
        return current == null || current == version
    }

    private fun lookupVersion(text: String): String? =
        text.lineSequence().firstOrNull { it.startsWith(LOOKUP_VERSION_TAG) }?.removePrefix(LOOKUP_VERSION_TAG)?.trim()

    /** Written beside, then moved over: the engine never reads half a profile. */
    private fun install(name: String, bytes: ByteArray) {
        fileSystem.createDirectories(directory)
        val temporary = directory / "$name.tmp"
        fileSystem.write(temporary) { write(bytes) }
        fileSystem.atomicMove(temporary, directory / name)
    }

    fun record(name: String): SegmentRecord? {
        val path = directory / "$name.json"
        if (!fileSystem.exists(path)) return null
        return runCatching {
            val fields = Json.parseToJsonElement(fileSystem.read(path) { readUtf8() }).jsonObject
            SegmentRecord(
                etag = fields["etag"]?.jsonPrimitive?.takeUnless { it is JsonNull }?.content,
                lastModified = fields["lastModified"]?.jsonPrimitive?.takeUnless { it is JsonNull }?.content,
                bytes = fields.getValue("bytes").jsonPrimitive.long,
                checkedAtMillis = fields.getValue("checkedAtMillis").jsonPrimitive.long,
            )
        }.getOrNull()
    }

    private fun writeRecord(name: String, record: SegmentRecord) {
        val json = buildJsonObject {
            put("etag", record.etag)
            put("lastModified", record.lastModified)
            put("bytes", record.bytes)
            put("checkedAtMillis", record.checkedAtMillis)
        }
        val temporary = directory / "$name.json.tmp"
        fileSystem.write(temporary) { writeUtf8(json.toString()) }
        fileSystem.atomicMove(temporary, directory / "$name.json")
    }
}
