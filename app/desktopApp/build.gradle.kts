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
