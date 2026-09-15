package btools.kmp.io

import okio.Buffer
import okio.BufferedSink
import okio.BufferedSource
import okio.FileHandle
import okio.FileMetadata
import okio.FileSystem
import okio.Path
import okio.Path.Companion.toPath
import okio.SYSTEM
import okio.buffer

/*
 * The slice of java.io that BRouter's routing core uses, in common Kotlin on top of Okio. The converted
 * sources keep their calls (`File(dir, name).exists()`, `DataInputStream(...).readInt()`, ...) and only swap
 * `import java.io.X` for `import btools.kmp.io.X`. Semantics follow the JDK where BRouter depends on them:
 * big-endian data streams, EOFException at end of input, lastModified() in epoch milliseconds (0 if absent).
 */

typealias IOException = okio.IOException
typealias EOFException = okio.EOFException
typealias FileNotFoundException = okio.FileNotFoundException
typealias UnsupportedEncodingException = okio.IOException

/** Throwable.printStackTrace(PrintWriter): the stack trace text, as common Kotlin can render it. */
fun Throwable.printStackTrace(pw: PrintWriter) {
    pw.write(stackTraceToString())
    pw.flush()
}

internal val fs: FileSystem get() = FileSystem.SYSTEM

class File private constructor(val path: Path) {
    constructor(pathname: String) : this(pathname.toPath(normalize = false))
    constructor(parent: File?, child: String) : this(if (parent == null) child.toPath() else parent.path / child)
    constructor(parent: String?, child: String) : this(if (parent == null) child.toPath() else parent.toPath() / child)

    // Converted code calls both the Java method (`f.getName()`) and the synthetic property (`f.name`); the
    // function forms get another JVM name so the two do not clash on the JVM.
    @kotlin.jvm.JvmName("nameOf") fun getName(): String = path.name
    val name: String get() = path.name
    fun getPath(): String = path.toString()
    @kotlin.jvm.JvmName("absolutePathOf") fun getAbsolutePath(): String =
        if (path.isAbsolute) path.toString() else (fs.canonicalize(".".toPath()) / path).toString()
    val absolutePath: String get() = getAbsolutePath()
    fun getParent(): String? = path.parent?.toString()
    @kotlin.jvm.JvmName("parentFileOf") fun getParentFile(): File? = path.parent?.let { File(it) }
    val parentFile: File? get() = getParentFile()

    /**
     * What java.io.File sees: the file a symbolic link points to, not the link. Okio's metadata describes
     * the link itself, so a segment directory that is a symlink would otherwise not be a directory, and a
     * dangling link would exist.
     */
    private fun metadata(): FileMetadata? {
        val metadata = fs.metadataOrNull(path) ?: return null
        if (metadata.symlinkTarget == null) return metadata
        return try {
            fs.metadataOrNull(fs.canonicalize(path))
        } catch (e: IOException) {
            null
        }
    }

    fun exists(): Boolean = metadata() != null
    @kotlin.jvm.JvmName("isDirectoryOf") fun isDirectory(): Boolean = metadata()?.isDirectory == true
    val isDirectory: Boolean get() = isDirectory()
    fun isFile(): Boolean = metadata()?.isRegularFile == true
    fun length(): Long = metadata()?.size ?: 0L
    fun lastModified(): Long = metadata()?.lastModifiedAtMillis ?: 0L
    fun canRead(): Boolean = exists()
    fun delete(): Boolean = runCatching { fs.delete(path, mustExist = true) }.isSuccess
    fun mkdirs(): Boolean = runCatching { fs.createDirectories(path) }.isSuccess
    fun renameTo(dest: File): Boolean = runCatching { fs.atomicMove(path, dest.path) }.isSuccess

    fun list(): Array<String>? = fs.listOrNull(path)?.map { it.name }?.toTypedArray()
    fun listFiles(): Array<File>? = fs.listOrNull(path)?.map { File(it) }?.toTypedArray()

    override fun equals(other: Any?): Boolean = other is File && other.path == path
    override fun hashCode(): Int = path.hashCode()
    override fun toString(): String = path.toString()

    companion object {
        /** Okio paths use '/' on every target this runs on (JVM on Linux/macOS, Linux, iOS). */
        const val separator: String = "/"
        const val separatorChar: Char = '/'
    }
}

/** Read-only random access, as BRouter opens rd5 files ("r"). */
class RandomAccessFile(file: File, mode: String) {
    private val handle: FileHandle
    private var pos = 0L

    init {
        require(mode == "r") { "only read mode is supported, got $mode" }
        if (!file.exists()) throw FileNotFoundException(file.toString())
        handle = fs.openReadOnly(file.path)
    }

    constructor(name: String, mode: String) : this(File(name), mode)

    fun seek(position: Long) { pos = position }
    fun getFilePointer(): Long = pos
    fun length(): Long = handle.size()

    fun read(b: ByteArray, off: Int, len: Int): Int {
        val n = handle.read(pos, b, off, len)
        if (n > 0) pos += n
        return n
    }

    fun readFully(b: ByteArray, off: Int, len: Int) {
        var done = 0
        while (done < len) {
            val n = handle.read(pos + done, b, off + done, len - done)
            if (n <= 0) throw EOFException()
            done += n
        }
        pos += len
    }

    fun readFully(b: ByteArray) = readFully(b, 0, b.size)
    fun close() = handle.close()
}

interface Closeable { @Throws(IOException::class) fun close() }

abstract class InputStream : Closeable {
    abstract fun read(): Int
    open fun read(b: ByteArray, off: Int, len: Int): Int {
        if (len == 0) return 0
        var i = 0
        while (i < len) {
            val c = read()
            if (c < 0) return if (i == 0) -1 else i
            b[off + i] = c.toByte()
            i++
        }
        return i
    }
    fun read(b: ByteArray): Int = read(b, 0, b.size)
    override fun close() {}
}

// @Throws(IOException) on the stream methods, as in java.io: Kotlin/Native requires an override that declares
// @Throws (BRouter's coder streams do) to match what it overrides.
abstract class OutputStream : Closeable {
    @Throws(IOException::class) abstract fun write(b: Int)
    @Throws(IOException::class) open fun write(b: ByteArray, off: Int, len: Int) { for (i in 0 until len) write(b[off + i].toInt()) }
    @Throws(IOException::class) open fun write(b: ByteArray) = write(b, 0, b.size)
    @Throws(IOException::class) open fun flush() {}
    @Throws(IOException::class) override fun close() {}
}

/** An InputStream over an Okio source; FileInputStream and BufferedInputStream are both this. */
open class SourceInputStream(internal val source: BufferedSource) : InputStream() {
    override fun read(): Int = if (source.exhausted()) -1 else source.readByte().toInt() and 0xff
    override fun read(b: ByteArray, off: Int, len: Int): Int = source.read(b, off, len)
    override fun close() = source.close()
}

class FileInputStream(file: File) : SourceInputStream(fs.source(file.path).buffer()) {
    constructor(name: String) : this(File(name))
}

class ByteArrayInputStream(bytes: ByteArray) : SourceInputStream(Buffer().write(bytes))

class BufferedInputStream(input: InputStream, @Suppress("UNUSED_PARAMETER") size: Int = 8192) :
    SourceInputStream(if (input is SourceInputStream) input.source else StreamSource(input).buffer())

private class StreamSource(private val input: InputStream) : okio.Source {
    private val tmp = ByteArray(8192)
    override fun read(sink: Buffer, byteCount: Long): Long {
        val n = input.read(tmp, 0, minOf(byteCount, tmp.size.toLong()).toInt())
        if (n <= 0) return -1
        sink.write(tmp, 0, n)
        return n.toLong()
    }
    override fun timeout() = okio.Timeout.NONE
    override fun close() = input.close()
}

open class SinkOutputStream(internal val sink: BufferedSink) : OutputStream() {
    override fun write(b: Int) { sink.writeByte(b) }
    override fun write(b: ByteArray, off: Int, len: Int) { sink.write(b, off, len) }
    override fun flush() = sink.flush()
    override fun close() = sink.close()
}

class FileOutputStream(file: File, append: Boolean = false) :
    SinkOutputStream((if (append) fs.appendingSink(file.path) else fs.sink(file.path)).buffer()) {
    constructor(name: String, append: Boolean = false) : this(File(name), append)
}

class BufferedOutputStream(out: OutputStream, @Suppress("UNUSED_PARAMETER") size: Int = 8192) :
    SinkOutputStream(if (out is SinkOutputStream) out.sink else StreamSink(out).buffer())

private class StreamSink(private val out: OutputStream) : okio.Sink {
    override fun write(source: Buffer, byteCount: Long) {
        out.write(source.readByteArray(byteCount))
    }
    override fun flush() = out.flush()
    override fun timeout() = okio.Timeout.NONE
    override fun close() = out.close()
}

interface DataInput {
    fun readFully(b: ByteArray)
    fun readFully(b: ByteArray, off: Int, len: Int)
    fun readBoolean(): Boolean
    fun readByte(): Byte
    fun readUnsignedByte(): Int
    fun readShort(): Short
    fun readChar(): Char
    fun readInt(): Int
    fun readLong(): Long
    fun readFloat(): Float
    fun readDouble(): Double
    fun readUTF(): String
}

interface DataOutput {
    @Throws(IOException::class) fun write(b: Int)
    @Throws(IOException::class) fun write(b: ByteArray)
    @Throws(IOException::class) fun write(b: ByteArray, off: Int, len: Int)
    fun writeBoolean(v: Boolean)
    fun writeByte(v: Int)
    fun writeShort(v: Int)
    fun writeChar(v: Int)
    fun writeInt(v: Int)
    fun writeLong(v: Long)
    fun writeFloat(v: Float)
    fun writeDouble(v: Double)
    fun writeBytes(s: String)
    fun writeUTF(s: String)
}

/** java.io.DataInputStream: big-endian, EOFException at end of input. */
open class DataInputStream(input: InputStream) : InputStream(), DataInput {
    private val src: BufferedSource = if (input is SourceInputStream) input.source else StreamSource(input).buffer()

    private fun need(n: Long) { if (!src.request(n)) throw EOFException() }

    override fun read(): Int = if (src.exhausted()) -1 else src.readByte().toInt() and 0xff
    override fun read(b: ByteArray, off: Int, len: Int): Int = src.read(b, off, len)
    override fun readFully(b: ByteArray) = readFully(b, 0, b.size)
    override fun readFully(b: ByteArray, off: Int, len: Int) {
        var done = 0
        while (done < len) {
            val n = src.read(b, off + done, len - done)
            if (n < 0) throw EOFException()
            done += n
        }
    }
    override fun readBoolean(): Boolean { need(1); return src.readByte().toInt() != 0 }
    override fun readByte(): Byte { need(1); return src.readByte() }
    override fun readUnsignedByte(): Int { need(1); return src.readByte().toInt() and 0xff }
    override fun readShort(): Short { need(2); return src.readShort() }
    override fun readChar(): Char { need(2); return src.readShort().toInt().toChar() }
    override fun readInt(): Int { need(4); return src.readInt() }
    override fun readLong(): Long { need(8); return src.readLong() }
    override fun readFloat(): Float = Float.fromBits(readInt())
    override fun readDouble(): Double = Double.fromBits(readLong())
    override fun readUTF(): String {
        val len = readShort().toInt() and 0xffff
        need(len.toLong())
        return src.readUtf8(len.toLong()) // BRouter never writes non-BMP / NUL characters here
    }
    override fun close() = src.close()
}

/** java.io.DataOutputStream: big-endian. */
open class DataOutputStream(out: OutputStream?) : OutputStream(), DataOutput {
    private val sink: BufferedSink = when (out) {
        null -> Buffer()
        is SinkOutputStream -> out.sink
        else -> StreamSink(out).buffer()
    }

    override fun write(b: Int) { sink.writeByte(b) }
    override fun write(b: ByteArray, off: Int, len: Int) { sink.write(b, off, len) }
    override fun write(b: ByteArray) { sink.write(b) }
    override fun writeBoolean(v: Boolean) { sink.writeByte(if (v) 1 else 0) }
    override fun writeByte(v: Int) { sink.writeByte(v) }
    override fun writeShort(v: Int) { sink.writeShort(v) }
    override fun writeChar(v: Int) { sink.writeShort(v) }
    override fun writeInt(v: Int) { sink.writeInt(v) }
    override fun writeLong(v: Long) { sink.writeLong(v) }
    override fun writeFloat(v: Float) { sink.writeInt(v.toRawBits()) }
    override fun writeDouble(v: Double) { sink.writeLong(v.toRawBits()) }
    override fun writeBytes(s: String) { for (c in s) sink.writeByte(c.code) }
    override fun writeUTF(s: String) {
        val bytes = s.encodeToByteArray()
        sink.writeShort(bytes.size)
        sink.write(bytes)
    }
    override fun flush() = sink.flush()
    override fun close() = sink.close()
}

abstract class Reader : Closeable {
    abstract fun read(cbuf: CharArray, off: Int, len: Int): Int

    /** A single character, or -1 at the end. */
    open fun read(): Int {
        val c = CharArray(1)
        return if (read(c, 0, 1) <= 0) -1 else c[0].code
    }
}

/** Text readers read the whole file as UTF-8 up front (profiles and lookups.dat are small). */
open class FileReader(file: File) : Reader() {
    internal val text: String = fs.read(file.path) { readUtf8() }
    private var pos = 0

    constructor(name: String) : this(File(name))

    override fun read(cbuf: CharArray, off: Int, len: Int): Int {
        if (pos >= text.length) return -1
        val n = minOf(len, text.length - pos)
        for (i in 0 until n) cbuf[off + i] = text[pos + i]
        pos += n
        return n
    }
    override fun close() {}
}

class InputStreamReader(input: InputStream, @Suppress("UNUSED_PARAMETER") charset: String = "UTF-8") : Reader() {
    private val src: BufferedSource = if (input is SourceInputStream) input.source else StreamSource(input).buffer()
    override fun read(cbuf: CharArray, off: Int, len: Int): Int {
        if (src.exhausted()) return -1
        var i = 0
        while (i < len && !src.exhausted()) { cbuf[off + i] = src.readUtf8CodePoint().toChar(); i++ }
        return i
    }
    internal fun readLine(): String? = src.readUtf8Line()
    override fun close() = src.close()
}

class BufferedReader(private val reader: Reader, @Suppress("UNUSED_PARAMETER") size: Int = 8192) : Reader() {
    private val lines: Iterator<String>? = (reader as? FileReader)?.text?.let { splitLines(it).iterator() }

    fun readLine(): String? = when {
        lines != null -> if (lines.hasNext()) lines.next() else null
        reader is InputStreamReader -> reader.readLine()
        else -> {
            val sb = StringBuilder()
            val c = CharArray(1)
            var any = false
            while (reader.read(c, 0, 1) > 0) {
                any = true
                if (c[0] == '\n') break
                if (c[0] != '\r') sb.append(c[0])
            }
            if (any) sb.toString() else null
        }
    }

    override fun read(cbuf: CharArray, off: Int, len: Int): Int = reader.read(cbuf, off, len)
    override fun close() = reader.close()

    private companion object {
        /** Lines as java.io.BufferedReader splits them: \n, \r or \r\n; no trailing empty line. */
        fun splitLines(text: String): List<String> {
            val out = ArrayList<String>()
            var start = 0
            var i = 0
            while (i < text.length) {
                val c = text[i]
                if (c == '\n' || c == '\r') {
                    out.add(text.substring(start, i))
                    if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++
                    start = i + 1
                }
                i++
            }
            if (start < text.length) out.add(text.substring(start))
            return out
        }
    }
}

abstract class Writer : Closeable {
    abstract fun write(s: String)
    fun write(c: Int) = write(c.toChar().toString())
    fun write(cbuf: CharArray, off: Int, len: Int) = write(cbuf.concatToString(off, off + len))
    fun append(s: CharSequence?): Writer { write(s.toString()); return this }
    fun append(c: Char): Writer { write(c.toString()); return this }
    open fun flush() {}
}

class StringWriter(@Suppress("UNUSED_PARAMETER") initialSize: Int = 16) : Writer() {
    private val sb = StringBuilder()
    override fun write(s: String) { sb.append(s) }
    fun getBuffer(): StringBuilder = sb
    override fun toString(): String = sb.toString()
    override fun close() {}
}

class FileWriter(file: File, append: Boolean = false) : Writer() {
    private val sink: BufferedSink = (if (append) fs.appendingSink(file.path) else fs.sink(file.path)).buffer()

    constructor(name: String, append: Boolean = false) : this(File(name), append)

    override fun write(s: String) { sink.writeUtf8(s) }
    override fun flush() = sink.flush()
    override fun close() = sink.close()
}

class OutputStreamWriter(out: OutputStream, @Suppress("UNUSED_PARAMETER") charset: String = "UTF-8") : Writer() {
    private val sink: BufferedSink = if (out is SinkOutputStream) out.sink else StreamSink(out).buffer()
    override fun write(s: String) { sink.writeUtf8(s) }
    override fun flush() = sink.flush()
    override fun close() = sink.close()
}

class BufferedWriter(private val out: Writer, @Suppress("UNUSED_PARAMETER") size: Int = 8192) : Writer() {
    override fun write(s: String) = out.write(s)
    fun newLine() = out.write("\n")
    override fun flush() = out.flush()
    override fun close() = out.close()
}

class PrintWriter(private val out: Writer) : Writer() {
    constructor(out: OutputStream) : this(OutputStreamWriter(out))
    override fun write(s: String) = out.write(s)
    fun print(s: Any?) = out.write(s.toString())
    fun println(s: Any?) = out.write(s.toString() + "\n")
    fun println() = out.write("\n")
    override fun flush() = out.flush()
    override fun close() = out.close()
}
