package com.arounus.student

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

class ClassroomActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val background = Color.rgb(8, 14, 31)
    private val ink = Color.rgb(237, 244, 255)
    private val accent = Color.rgb(93, 239, 225)
    private lateinit var root: LinearLayout
    private lateinit var notice: TextView
    private lateinit var code: EditText
    private lateinit var videos: LinearLayout
    private lateinit var chat: LinearLayout
    private lateinit var chatInput: EditText
    private lateinit var micButton: Button
    private lateinit var cameraButton: Button
    private var room: Room? = null
    private var connecting = false
    private var microphoneOn = false
    private var cameraOn = false
    private var handRaised = false
    private val videoViews = mutableMapOf<VideoTrack, SurfaceViewRenderer>()

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(value: String, size: Float = 16f): TextView = TextView(this).apply {
        text = value; textSize = size; setTextColor(ink); setPadding(dp(4), dp(8), dp(4), dp(8))
    }
    private fun button(value: String, onClick: () -> Unit) = Button(this).apply {
        text = value; setOnClickListener { onClick() }
    }
    private fun row(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun field(hint: String) = EditText(this).apply {
        this.hint = hint; setSingleLine(true); setTextColor(ink); setHintTextColor(Color.LTGRAY)
    }
    private fun status(value: String) { notice.text = value }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = background; window.navigationBarColor = background
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(this@ClassroomActivity.background); setPadding(dp(16), dp(12), dp(16), dp(16)) }
        setContentView(root)
        showJoin()
    }

    private fun showJoin() {
        root.removeAllViews()
        root.addView(button("← Back") { finish() })
        root.addView(label("Live classroom", 27f))
        root.addView(label("Enter the room code your tutor shared. Classroom audio and video are live."))
        code = field("Room code").apply { inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
        root.addView(code)
        val initial = intent.getStringExtra("room_code").orEmpty()
        if (initial.isNotBlank()) code.setText(initial)
        root.addView(button("Join with camera and microphone") { join(true) })
        root.addView(button("Join without camera or microphone") { join(false) })
        notice = label("").apply { setTextColor(accent) }; root.addView(notice)
    }

    private fun join(withMedia: Boolean) {
        if (connecting || room != null) return
        val roomCode = code.text.toString().trim().uppercase(Locale.US)
        if (!roomCode.matches(Regex("[A-Z0-9_-]{4,32}"))) { status("Enter a valid room code (4 to 32 letters or numbers)."); return }
        if (withMedia) {
            val needed = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (needed.isNotEmpty()) { requestPermissions(needed.toTypedArray(), 31); status("Allow camera and microphone, then tap Join again."); return }
        }
        connecting = true; status("Connecting to classroom…")
        scope.launch {
            try {
                val access = withContext(Dispatchers.IO) { fetchAccess(roomCode) }
                val call = LiveKit.create(applicationContext)
                room = call
                launch { call.events.collect { event -> handleEvent(event) } }
                call.connect(access.getString("url"), access.getString("token"))
                showCall(roomCode)
                if (withMedia) {
                    microphoneOn = call.localParticipant.setMicrophoneEnabled(true)
                    cameraOn = call.localParticipant.setCameraEnabled(true)
                    updateControls()
                }
                refreshVideos()
            } catch (error: Exception) {
                room?.disconnect(); room = null
                if (::notice.isInitialized) status(error.message ?: "Could not join the classroom.")
            } finally { connecting = false }
        }
    }

    private fun fetchAccess(roomCode: String): JSONObject {
        val studentToken = getSharedPreferences("student", MODE_PRIVATE).getString("token", "").orEmpty()
        if (studentToken.isBlank()) throw IllegalStateException("Sign in again to join a classroom.")
        val connection = (URL("https://arounus.com/live/token").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 15000; readTimeout = 15000
            setRequestProperty("X-Student-Token", studentToken)
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        }
        try {
            connection.outputStream.use { it.write("room_code=${URLEncoder.encode(roomCode, "UTF-8")}".toByteArray()) }
            val response = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = JSONObject(response)
            if (connection.responseCode !in 200..299) throw IllegalStateException(json.optString("detail", "Could not join the classroom."))
            return json
        } finally { connection.disconnect() }
    }

    private fun showCall(roomCode: String) {
        root.removeAllViews()
        val header = row(); header.addView(label("Room $roomCode", 22f), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("Leave") { finish() }); root.addView(header)
        notice = label("Connected").apply { setTextColor(accent) }; root.addView(notice)
        val scroll = ScrollView(this)
        videos = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(videos); root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val controls = row()
        micButton = button("") { toggleMic() }; controls.addView(micButton, LinearLayout.LayoutParams(0, -2, 1f))
        cameraButton = button("") { toggleCamera() }; controls.addView(cameraButton, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(button("✋") { toggleHand() }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(controls); updateControls()
        root.addView(button("React to the lesson") { chooseReaction() })
        root.addView(label("Class chat", 19f))
        val chatScroll = ScrollView(this)
        chat = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        chatScroll.addView(chat); root.addView(chatScroll, LinearLayout.LayoutParams(-1, dp(130)))
        val composer = row(); chatInput = field("Message your class")
        composer.addView(chatInput, LinearLayout.LayoutParams(0, -2, 1f)); composer.addView(button("Send") { sendChat() })
        root.addView(composer)
    }

    private fun updateControls() {
        if (::micButton.isInitialized) micButton.text = if (microphoneOn) "Mute" else "Unmute"
        if (::cameraButton.isInitialized) cameraButton.text = if (cameraOn) "Camera off" else "Camera on"
    }
    private fun toggleMic() {
        val call = room ?: return
        if (!microphoneOn && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 32); return
        }
        scope.launch { try { val next = !microphoneOn; if (call.localParticipant.setMicrophoneEnabled(next)) microphoneOn = next; updateControls() } catch (e: Exception) { status(e.message ?: "Microphone unavailable") } }
    }
    private fun toggleCamera() {
        val call = room ?: return
        if (!cameraOn && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 33); return
        }
        scope.launch { try { val next = !cameraOn; if (call.localParticipant.setCameraEnabled(next)) cameraOn = next; updateControls(); refreshVideos() } catch (e: Exception) { status(e.message ?: "Camera unavailable") } }
    }
    private fun toggleHand() {
        handRaised = !handRaised
        val data = JSONObject().put("type", "hand-raise").put("raised", handRaised).put("id", "android-hand-${System.currentTimeMillis()}")
        scope.launch { room?.localParticipant?.publishData(data.toString().toByteArray(), topic = "classroom-event")?.onFailure { status("Could not send hand raise.") } }
        status(if (handRaised) "Your hand is raised" else "Your hand is lowered")
    }
    private fun chooseReaction() {
        val reactions = listOf("👍 Like" to "like", "❤️ Love" to "love", "😄 Happy" to "happy", "😂 Laugh" to "laugh", "😮 Wow" to "wow", "😢 Sad" to "sad")
        AlertDialog.Builder(this).setTitle("React to the lesson")
            .setItems(reactions.map { it.first }.toTypedArray()) { _, index ->
                val data = JSONObject().put("type", "reaction").put("code", reactions[index].second).put("id", "android-reaction-${System.currentTimeMillis()}")
                scope.launch {
                    val result = room?.localParticipant?.publishData(data.toString().toByteArray(), topic = "classroom-event")
                    if (result?.isSuccess == true) appendChat("You", reactions[index].first)
                    else status("Could not send reaction.")
                }
            }.show()
    }
    private fun sendChat() {
        val text = chatInput.text.toString().trim(); if (text.isEmpty()) return
        val data = JSONObject().put("type", "chat").put("text", text).put("id", "android-chat-${System.currentTimeMillis()}")
        scope.launch {
            val result = room?.localParticipant?.publishData(data.toString().toByteArray(), topic = "class-chat")
            if (result?.isSuccess == true) { appendChat("You", text); chatInput.setText("") } else status("Message could not reach the class.")
        }
    }
    private fun appendChat(sender: String, text: String) { if (::chat.isInitialized) chat.addView(label("$sender: $text", 14f)) }
    private fun handleEvent(event: RoomEvent) {
        when (event) {
            is RoomEvent.TrackSubscribed, is RoomEvent.TrackUnsubscribed, is RoomEvent.ParticipantConnected, is RoomEvent.ParticipantDisconnected -> refreshVideos()
            is RoomEvent.DataReceived -> {
                try {
                    val data = JSONObject(event.data.toString(Charsets.UTF_8))
                    when (data.optString("type")) {
                        "chat" -> appendChat(event.participant?.name ?: "Classmate", data.optString("text"))
                        "hand-raise" -> appendChat(event.participant?.name ?: "Classmate", if (data.optBoolean("raised")) "raised a hand" else "lowered a hand")
                        "reaction" -> appendChat(event.participant?.name ?: "Classmate", "reacted ${data.optString("code")}")
                        "recording-notice" -> appendChat("Classroom", data.optString("text"))
                    }
                } catch (_: Exception) { }
            }
            is RoomEvent.Disconnected -> { status("Classroom disconnected."); clearVideos() }
            else -> Unit
        }
    }
    private fun refreshVideos() {
        val call = room ?: return; if (!::videos.isInitialized) return
        val tracks = mutableListOf<Pair<String, VideoTrack>>()
        call.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track?.let { if (it is VideoTrack) tracks.add("You" to it) }
        call.remoteParticipants.values.forEach { participant ->
            listOf(Track.Source.CAMERA, Track.Source.SCREEN_SHARE).forEach { source ->
                (participant.getTrackPublication(source)?.track as? VideoTrack)?.let { tracks.add((participant.name ?: "Classmate") to it) }
            }
        }
        clearVideos()
        if (tracks.isEmpty()) videos.addView(label("Waiting for video. Audio and chat still work."))
        tracks.forEach { (name, track) ->
            videos.addView(label(name))
            val renderer = SurfaceViewRenderer(this)
            call.initVideoRenderer(renderer); track.addRenderer(renderer)
            videos.addView(renderer, LinearLayout.LayoutParams(-1, dp(190)))
            videoViews[track] = renderer
        }
    }
    private fun clearVideos() {
        videoViews.forEach { (track, renderer) -> track.removeRenderer(renderer); renderer.release() }
        videoViews.clear(); if (::videos.isInitialized) videos.removeAllViews()
    }
    override fun onDestroy() { clearVideos(); room?.disconnect(); scope.cancel(); super.onDestroy() }
}
