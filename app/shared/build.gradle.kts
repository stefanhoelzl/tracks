import org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeTest

plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvmToolchain(25)

    // iOS is the product; the JVM is the desktop harness (M11) and the fast test loop;
    // linuxX64 is native code that CI can run without a Mac.
    jvm()
    linuxX64()

    // The iOS app's framework is built by :ui, which exports this module. BRouter is a dependency, not
    // an export, so the Swift side sees `OnDeviceRouter` and the codecs rather than every converted class.
    iosSimulatorArm64()
    iosArm64()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
            implementation(project(":brouter"))
            // A ride's journal is a file (recording); `Rides` takes okio's paths, so they are API.
            api(libs.okio)
            // The upload talks to Tracks; the engine is the platform's, chosen by :ui.
            api(libs.ktor.client.core)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
    }
}

// The fixtures are generated from the TypeScript (`pnpm fixtures:app`) and read from disk by
// every test target, so they are an input: regenerating them reruns the tests.
val fixtures = layout.projectDirectory.dir("src/commonTest/fixtures")

tasks.withType<Test>().configureEach {
    inputs.dir(fixtures)
    environment("TRACKS_APP_FIXTURES", fixtures.asFile.absolutePath)
}

tasks.withType<KotlinNativeTest>().configureEach {
    inputs.dir(fixtures)
    environment("TRACKS_APP_FIXTURES", fixtures.asFile.absolutePath)
}
