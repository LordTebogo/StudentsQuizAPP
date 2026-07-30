plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nucleocampus.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nucleocampus.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        val siteUrl = providers.gradleProperty("NUCLEOCAMPUS_URL").orNull ?: "https://your-nucleocampus-domain.example"
        buildConfigField("String", "DEFAULT_SITE_URL", "\"$siteUrl\"")
    }

    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("io.livekit:livekit-android:2.27.0")
}
