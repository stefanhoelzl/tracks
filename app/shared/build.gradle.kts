import org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeTest

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
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
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.okio)
            implementation(project(":brouter"))
            // A ride's journal is a file (recording); `Rides` takes okio's paths, so they are API.
            api(libs.okio)
            // The upload talks to Tracks; the engine is the platform's, chosen by :ui.
            api(libs.ktor.client.core)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.okio.fakefilesystem)
        }
        nativeTest.dependencies {
            implementation(libs.okio)
        }
    }
}

// The fixtures are generated from the TypeScript (`pnpm fixtures:app`) and read from disk by
// every test target, so they are an input: regenerating them reruns the tests.
val fixtures = layout.projectDirectory.dir("src/commonTest/fixtures")

// Some of them name recorded answers elsewhere in the repository, which are inputs too.
val recorded = listOf(rootDir.resolve("../fixtures/brouter"), rootDir.resolve("../fixtures/photon"))

tasks.withType<Test>().configureEach {
    inputs.dir(fixtures)
    inputs.files(recorded)
    environment("TRACKS_APP_FIXTURES", fixtures.asFile.absolutePath)
}

tasks.withType<KotlinNativeTest>().configureEach {
    inputs.dir(fixtures)
    inputs.files(recorded)
    environment("TRACKS_APP_FIXTURES", fixtures.asFile.absolutePath)
}

// The on-device router's tests route over BRouter's parity snapshot, so the JVM tests need it in the
// cache, exactly as :brouter's do. Only the JVM: a debug native binary routes too slowly to be worth it.
evaluationDependsOn(":brouter")
val brouter = project(":brouter")

tasks.named<Test>("jvmTest") {
    dependsOn(brouter.tasks.named("paritySegments"))
    inputs.dir(brouter.layout.projectDirectory.dir("profiles"))
    environment("TRACKS_BROUTER_SEGMENTS", brouter.extra["paritySegments"].toString())
    environment("TRACKS_BROUTER_PROFILES", brouter.layout.projectDirectory.dir("profiles").asFile.absolutePath)
    environment("TRACKS_BROUTER_PARITY", brouter.layout.projectDirectory.dir("parity").asFile.absolutePath)
    maxHeapSize = "1g"
}
