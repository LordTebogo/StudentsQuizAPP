plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
if (file("google-services.json").isFile) apply(plugin = "com.google.gms.google-services")
android {
    namespace = "com.arounus.student"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.arounus.student"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.3"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:35.2.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("io.livekit:livekit-android:2.30.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.media3:media3-transformer:1.11.1")
    implementation("androidx.media3:media3-effect:1.11.1")
    implementation("androidx.media3:media3-common:1.11.1")
}
