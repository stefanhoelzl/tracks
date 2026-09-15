/*
 * The iPhone app, as a Kotlin Multiplatform project inside the pnpm monorepo.
 *
 * Gradle owns everything under `app/`; pnpm owns everything else. They meet in one place:
 * `shared` ports the codecs the TypeScript already has, and `pnpm fixtures:app` writes the
 * fixtures that pin the port to it.
 *
 *     cd app && ./gradlew :shared:jvmTest :shared:linuxX64Test
 */
rootProject.name = "tracks-app"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// The JVM targets build with JDK 21 wherever Gradle happens to run: a machine whose default
// `java` is a runtime without a compiler, or JDK 25, gets 21 provisioned instead of a failure.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

include(":shared", ":brouter")
