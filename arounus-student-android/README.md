# Arounus Student for Android

Separate native Android project for the student learning area. It uses the existing HTTPS student API, which connects to the same production database. No database credentials are placed in the app. Market opens https://arounus.com in the device browser.

Open this folder in Android Studio, sync Gradle, and run the `app` configuration. For Play release, configure a signing key and build a signed Android App Bundle. Review the Play Console listing, data safety declaration, privacy policy, and account deletion requirements before submission.

The native implementation includes student sign in, registration, password reset, account profile editing, module enrollment, quiz lists and answer submission, lesson lists and video playback, results, messaging, and basic community posts. The debug APK has compiled successfully and installed and launched in BlueStacks 5. The Market button opened arounus.com in BlueStacks' browser. Live sign-in and the signed-in screens are not yet verified in BlueStacks because its browser and app connections to arounus.com stalled during testing, while the account and API worked from Windows. Features from the full student website such as live classrooms, media tools, premium video, and richer quiz content are still outstanding. A signed release bundle, Play listing, and policy disclosures also remain before Play submission.
