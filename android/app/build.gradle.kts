plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ksFile = System.getenv("UZ_KEYSTORE_FILE")
val ksPass = System.getenv("UZ_KEYSTORE_PASSWORD")
val appVersion = (System.getenv("UZ_VERSION") ?: "1.0.0").removePrefix("v")
val appCode = (System.getenv("UZ_VERSION_CODE") ?: "1").toInt()

android {
    namespace = "uz.uzdesk.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "uz.uzdesk.app"
        minSdk = 26
        targetSdk = 34
        versionCode = appCode
        versionName = appVersion
    }

    signingConfigs {
        create("release") {
            if (ksFile != null && file(ksFile).exists()) {
                storeFile = file(ksFile)
                storePassword = ksPass
                keyAlias = "uzdesk"
                keyPassword = ksPass
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ksFile != null && file(ksFile).exists())
                signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    sourceSets {
        getByName("main") {
            // the web client is shared with the Windows app
            assets.srcDirs("../../client")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
