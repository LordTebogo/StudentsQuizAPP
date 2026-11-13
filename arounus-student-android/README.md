# Arounus Student for Android

Separate native Android project for the student learning area. It uses the existing HTTPS student API, which connects to the same production database. No database credentials are placed in the app. Market opens https://arounus.com in the device browser.

Open this folder in Android Studio, sync Gradle, and run the `app` configuration. For Play release, configure a signing key and build a signed Android App Bundle. Review the Play Console listing, data safety declaration, privacy policy, and account deletion requirements before submission.

The native implementation includes student sign in, registration, password reset, account profile editing, module enrollment, quiz lists and answer submission, lesson lists and video playback, results, and messaging. It has not yet been compiled or tested on an emulator. Features from the full website such as live classrooms, community posts, media tools, premium video, and richer quiz content are still outstanding, so this is not yet a full replacement for the student website.
