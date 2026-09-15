import org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeTest

plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    jvmToolchain(21)

    // iOS is the product; the JVM is the desktop harness (M11) and the fast test loop;
    // linuxX64 is native code that CI can run without a Mac.
    jvm()
    linuxX64()

    // The iOS app links this module as one static framework. BRouter is a dependency, not an export, so
    // the Swift side sees `OnDeviceRouter` and the codecs rather than every converted class.
    listOf(iosSimulatorArm64(), iosArm64()).forEach {
        it.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
            implementation(project(":brouter"))
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        nativeTest.dependencies {
            implementation(libs.okio)
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
