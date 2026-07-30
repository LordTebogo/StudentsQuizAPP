# NucleoCampus Android screen sharing

This native Android shell loads the existing NucleoCampus site and implements whole-device screen sharing with Android MediaProjection and LiveKit. Browser and PWA screen sharing remains unchanged.

## Configure and build

1. Open `android-screen-share` in Android Studio.
2. Add the deployed HTTPS site URL to the project `gradle.properties`:

   `NUCLEOCAMPUS_URL=https://your-real-domain.example`

3. Sync Gradle and build/install the `app` module.
4. Sign in inside the app, join a live classroom, and tap **Share screen**.
5. Accept Android's system capture prompt. The foreground notification remains visible while sharing.

The Android screen publisher requests a short-lived, publish-only LiveKit token from the existing `/live/token` endpoint. Account tokens are retained in WebView session storage and are not written to Android storage by this integration.
