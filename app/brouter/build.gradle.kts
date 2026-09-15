import org.jetbrains.kotlin.gradle.plugin.mpp.NativeBuildType
import org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeTest
import java.net.URI
import java.security.MessageDigest

plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

/*
 * BRouter's routing core, converted from Java by IntelliJ's J2K and the fix passes in
 * `conversion/`. `src/commonMain/kotlin/btools/{codec,expressions,mapaccess,router,util}` is
 * generated — change it by changing a pass, never by hand. `btools/kmp` is the hand-written
 * stand-in for the Java APIs the core uses; `net/stho/tracks/brouter` is the app's way in.
 */
kotlin {
    jvmToolchain(25)

    jvm()
    linuxX64 {
        // Parity routes 300 km: an unoptimised binary spends minutes on what a release one does in
        // seconds, so the native parity run is the release test binary.
        binaries.test(listOf(NativeBuildType.RELEASE))
        testRuns.create("release") {
            setExecutionSourceFrom(binaries.getTest(NativeBuildType.RELEASE))
        }
    }
    iosSimulatorArm64()
    iosArm64()

    compilerOptions {
        // The generated sources use expect/actual classes for the Java shims, and carry thousands
        // of warnings (redundant `!!`, unused variables) that are J2K's style, not something to fix.
        freeCompilerArgs.addAll("-Xexpect-actual-classes", "-nowarn")
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.okio)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

/*
 * The parity fixtures were fetched from brouter.de against its rd5 tiles of one day, and are only
 * meaningful against those tiles. `parity/segments.txt` names that snapshot; it is a release of this
 * repository, never git, and is fetched into the cache once and checked by sha256 on every run.
 */
val parity = layout.projectDirectory.dir("parity")
val profiles = layout.projectDirectory.dir("profiles")
val manifest = parity.file("segments.txt").asFile.readLines().filter { it.isNotBlank() && !it.startsWith("#") }
val snapshot = manifest.first { it.startsWith("release ") }.removePrefix("release ").trim()
val tiles = manifest.filterNot { it.startsWith("release ") }.map { line ->
    line.trim().split(Regex("\\s+")).let { (sha256, name) -> name to sha256 }
}
val segments = file("${System.getenv("TRACKS_CACHE") ?: "${System.getProperty("user.home")}/.cache/tracks"}/segments/$snapshot")

fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(1 shl 16)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

val paritySegments = tasks.register("paritySegments") {
    description = "Puts the rd5 snapshot the parity fixtures belong to into the cache, checked."
    outputs.upToDateWhen { false }
    doLast {
        segments.mkdirs()
        for ((name, want) in tiles) {
            val target = segments.resolve(name)
            if (target.isFile && sha256(target) == want) continue
            val url = "https://github.com/stefanhoelzl/tracks/releases/download/$snapshot/$name"
            logger.lifecycle("downloading $url")
            val part = segments.resolve("$name.part")
            URI(url).toURL().openStream().use { input -> part.outputStream().use { input.copyTo(it) } }
            val got = sha256(part)
            check(got == want) { "$name from $url has sha256 $got, expected $want" }
            check(part.renameTo(target)) { "could not move $part into place" }
        }
    }
}

fun parityEnvironment(set: (String, String) -> Unit) {
    set("TRACKS_BROUTER_SEGMENTS", segments.absolutePath)
    set("TRACKS_BROUTER_PROFILES", profiles.asFile.absolutePath)
    set("TRACKS_BROUTER_PARITY", parity.asFile.absolutePath)
    System.getenv("TRACKS_BROUTER_ROUTES")?.let { set("TRACKS_BROUTER_ROUTES", it) }
}

tasks.withType<Test>().configureEach {
    dependsOn(paritySegments)
    inputs.dir(parity)
    inputs.dir(profiles)
    parityEnvironment(::environment)
    maxHeapSize = "1g"
    testLogging { showStandardStreams = true }
}

tasks.withType<KotlinNativeTest>().configureEach {
    dependsOn(paritySegments)
    inputs.dir(parity)
    inputs.dir(profiles)
    parityEnvironment(::environment)
    testLogging { showStandardStreams = true }
}
