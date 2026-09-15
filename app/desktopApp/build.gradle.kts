plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

/*
 * The desktop harness: the app's UI on Linux, with a replayed ride for a GPS. It is how the phone is
 * tested without a phone or a Mac, and it is never shipped.
 *
 *     cd app && ./gradlew :desktopApp:run --args="--gpx path/to/ride.gpx --speed 4"
 *
 * It needs a Vulkan driver: a GPU's, or Mesa's lavapipe (see the screenshot tests).
 */
kotlin {
    jvmToolchain(25)
}

dependencies {
    implementation(project(":ui"))
    implementation(compose.desktop.currentOs)
    runtimeOnly(libs.maplibre.compose.runtime.vulkan.linux)
}

compose.desktop {
    application {
        mainClass = "net.stho.tracks.desktop.MainKt"
        // MapLibre Native is reached through Java's foreign function API.
        jvmArgs += listOf("--enable-native-access=ALL-UNNAMED", "-Xmx1g")
    }
}

/*
 * The screenshot tests run the harness inside a container rather than through Gradle (screenshots/run.sh). This writes
 * what the container needs to start it: the runtime classpath as absolute paths — the container mounts the Gradle home
 * read-only at the same path — and the JDK 25 to run it with, which it mounts the same way.
 */
val screenshotJdk = javaToolchains.launcherFor { languageVersion = JavaLanguageVersion.of(25) }

tasks.register("screenshotClasspath") {
    val jar = tasks.named<Jar>("jar")
    val runtime = configurations.named("runtimeClasspath")
    val javaHome = screenshotJdk.map { it.metadata.installationPath.asFile.absolutePath }
    val out = layout.buildDirectory.dir("screenshot-run")
    dependsOn(jar)
    inputs.files(runtime)
    outputs.dir(out)
    doLast {
        val dir = out.get().asFile.apply { mkdirs() }
        val files = listOf(jar.get().archiveFile.get().asFile) + runtime.get().files
        dir.resolve("classpath.txt").writeText(files.joinToString(":") { it.absolutePath })
        dir.resolve("java-home.txt").writeText(javaHome.get())
    }
}
