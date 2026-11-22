plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
if (file("google-services.json").isFile) apply(plugin = "com.google.gms.google-services")
android {
    namespace = "com.arounus.student"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.arounus.student"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.2"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:35.2.0"))
    implementation("com.google.firebase:firebase-messaging")
}
