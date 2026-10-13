plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.example.flappydot"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.flappydot"
        minSdk = 28 // Android 9 起，覆盖用户要求的 9–17
        targetSdk = 36
        versionCode = 11
        versionName = "5.2.3"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
