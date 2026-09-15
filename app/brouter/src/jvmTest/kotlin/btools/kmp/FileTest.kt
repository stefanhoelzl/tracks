package btools.kmp

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

/** Checks the File shim against java.io.File on the cases BRouter's segment lookup meets, links included. */
class FileTest {
    private val root = Files.createTempDirectory("file-test").toFile()

    init {
        val dir = java.io.File(root, "dir").apply { mkdirs() }
        java.io.File(dir, "E10_N45.rd5").writeBytes(ByteArray(1234))
        Files.createSymbolicLink(root.toPath().resolve("dir-link"), dir.toPath())
        Files.createSymbolicLink(root.toPath().resolve("file-link"), dir.toPath().resolve("E10_N45.rd5"))
        Files.createSymbolicLink(root.toPath().resolve("dangling"), root.toPath().resolve("nowhere"))
    }

    private fun check(name: String) {
        val jdk = java.io.File(root, name)
        val mine = btools.kmp.io.File(root.path, name)
        assertEquals(jdk.exists(), mine.exists(), "$name: exists")
        assertEquals(jdk.isDirectory, mine.isDirectory(), "$name: isDirectory")
        assertEquals(jdk.isFile, mine.isFile(), "$name: isFile")
        assertEquals(jdk.length(), mine.length(), "$name: length")
        assertEquals(jdk.lastModified(), mine.lastModified(), "$name: lastModified")
    }

    @Test
    fun plainEntries() {
        listOf("dir", "dir/E10_N45.rd5", "missing").forEach(::check)
    }

    @Test
    fun symbolicLinksAreFollowed() {
        listOf("dir-link", "file-link", "dir-link/E10_N45.rd5", "dangling").forEach(::check)
    }
}
