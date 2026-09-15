plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

/*
 * The app's screens, in Compose Multiplatform: the map behind `TracksMap`, and what feeds it.
 *
 * iOS is the product. The JVM is the desktop harness (`:desktopApp`) and the screenshot tests. There is
 * no linuxX64 here, unlike :shared — maplibre-compose has none — so Compose never reaches the modules
 * the parity gate runs natively on.
 */
kotlin {
    jvmToolchain(25)

    jvm()

    // The iOS app links the whole Kotlin side as one static framework, named Shared as in M10. It exports :shared, so
    // Swift still sees OnDeviceRouter and NativeMemory for the measurement harness; everything else stays internal.
    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "Shared"
            isStatic = true
            export(project(":shared"))
        }
    }

    sourceSets {
        commonMain.dependencies {
            api(project(":shared"))
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
            implementation(libs.compose.resources)
            implementation(libs.kotlinx.coroutines.core)
            // Imported only under net.stho.tracks.ui.map; nothing outside it names a MapLibre type.
            implementation(libs.maplibre.compose)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

compose.resources {
    packageOfResClass = "net.stho.tracks.ui.resources"
}
