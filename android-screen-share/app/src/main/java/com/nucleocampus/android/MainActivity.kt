package com.nucleocampus.android

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var screenRoom: Room? = null
    private var pendingRequest: ShareRequest? = null
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    private val screenCaptureLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            notifyWeb("stopped", "Screen sharing was cancelled.")
            lifecycleScope.launch { disconnectScreenRoom() }
            return@registerForActivityResult
        }
        lifecycleScope.launch {
            try {
                val started = screenRoom?.localParticipant?.setScreenShareEnabled(true, ScreenCaptureParams(data)) == true
                if (!started) throw IllegalStateException("Android could not start screen capture.")
                notifyWeb("sharing", "Your Android screen is being presented.")
            } catch (error: Exception) {
                notifyWeb("stopped", error.message ?: "Android screen sharing failed.")
                disconnectScreenRoom()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        configureWebView()
        val permissions = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        permissionLauncher.launch(permissions.toTypedArray())
        openConfiguredSite()
    }

    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.origin.host == Uri.parse(currentSiteUrl()).host) request.grant(request.resources)
                    else request.deny()
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val allowedHost = Uri.parse(currentSiteUrl()).host
                return if (request.url.host == allowedHost) false else {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url)); true
                }
            }
        }
        webView.addJavascriptInterface(AndroidBridge(), "NucleoAndroid")
    }

    private fun openConfiguredSite() {
        val configured = currentSiteUrl()
        if (configured.contains("your-nucleocampus-domain.example")) {
            val input = EditText(this).apply { hint = "https://your-app.example" }
            AlertDialog.Builder(this).setTitle("NucleoCampus website address").setView(input)
                .setCancelable(false)
                .setPositiveButton("Open") { _, _ ->
                    val value = input.text.toString().trim().trimEnd('/')
                    if (value.startsWith("https://")) {
                        getSharedPreferences("app", MODE_PRIVATE).edit().putString("site_url", value).apply()
                        webView.loadUrl(value)
                    } else openConfiguredSite()
                }.show()
        } else webView.loadUrl(configured)
    }

    private fun currentSiteUrl(): String = getSharedPreferences("app", MODE_PRIVATE)
        .getString("site_url", BuildConfig.DEFAULT_SITE_URL)!!.trimEnd('/')

    inner class AndroidBridge {
        @JavascriptInterface
        fun startScreenShare(baseUrl: String, roomCode: String, role: String, authToken: String) {
            runOnUiThread {
                if (!isTrustedOrigin(baseUrl) || roomCode.isBlank() || authToken.isBlank()) {
                    notifyWeb("stopped", "The Android app could not verify this classroom.")
                    return@runOnUiThread
                }
                pendingRequest = ShareRequest(baseUrl, roomCode, role, authToken)
                lifecycleScope.launch { connectScreenPublisher(pendingRequest!!) }
            }
        }

        @JavascriptInterface
        fun stopScreenShare() {
            runOnUiThread { lifecycleScope.launch { disconnectScreenRoom(); notifyWeb("stopped", "Screen sharing stopped.") } }
        }
    }

    private fun isTrustedOrigin(origin: String): Boolean = Uri.parse(origin).host == Uri.parse(currentSiteUrl()).host

    private suspend fun connectScreenPublisher(request: ShareRequest) {
        try {
            disconnectScreenRoom()
            val access = fetchScreenToken(request)
            screenRoom = LiveKit.create(applicationContext)
            screenRoom!!.connect(access.url, access.token)
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            screenCaptureLauncher.launch(manager.createScreenCaptureIntent())
        } catch (error: Exception) {
            notifyWeb("stopped", error.message ?: "Could not connect Android screen sharing.")
            disconnectScreenRoom()
        }
    }

    private suspend fun fetchScreenToken(request: ShareRequest): Access = withContext(Dispatchers.IO) {
        val connection = URL("${request.baseUrl}/live/token").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        connection.setRequestProperty(if (request.role == "lecturer") "X-Lecturer-Token" else "X-Student-Token", request.authToken)
        val body = "room_code=${URLEncoder.encode(request.roomCode, "UTF-8")}&screen_only=true"
        connection.outputStream.use { it.write(body.toByteArray()) }
        val responseText = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
            .bufferedReader().use { it.readText() }
        if (connection.responseCode !in 200..299) throw IllegalStateException(JSONObject(responseText).optString("detail", "Could not enter the live room."))
        JSONObject(responseText).let { Access(it.getString("url"), it.getString("token")) }
    }

    private suspend fun disconnectScreenRoom() {
        try { screenRoom?.localParticipant?.setScreenShareEnabled(false) } catch (_: Exception) {}
        screenRoom?.disconnect()
        screenRoom = null
    }

    private fun notifyWeb(state: String, message: String) {
        val safeState = JSONObject.quote(state); val safeMessage = JSONObject.quote(message)
        runOnUiThread { webView.evaluateJavascript("window.onNucleoAndroidShareState?.($safeState,$safeMessage)", null) }
    }

    override fun onDestroy() {
        lifecycleScope.launch { disconnectScreenRoom() }
        webView.removeJavascriptInterface("NucleoAndroid")
        super.onDestroy()
    }

    data class ShareRequest(val baseUrl: String, val roomCode: String, val role: String, val authToken: String)
    data class Access(val url: String, val token: String)
}
