package com.arounus.student

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class StudentMessagingService : FirebaseMessagingService() {
    override fun onNewToken(value: String) {
        register(value)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: "Arounus"
        val body = message.notification?.body ?: message.data["body"] ?: "You have a new update."
        val manager = getSystemService(NotificationManager::class.java)
        val channel = "student_updates"
        manager.createNotificationChannel(NotificationChannel(channel, "Student updates", NotificationManager.IMPORTANCE_DEFAULT))
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("notification_url", message.data["url"] ?: "")
            putExtra("notification_tag", message.data["tag"] ?: "")
        }
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = android.app.Notification.Builder(this, channel)
            .setSmallIcon(R.drawable.app_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        manager.notify((message.data["tag"] ?: title).hashCode(), notification)
    }

    private fun register(value: String) {
        val session = getSharedPreferences("student", MODE_PRIVATE).getString("token", "") ?: ""
        if (session.isBlank()) return
        thread {
            runCatching {
                val connection = (URL("https://arounus.com/student/notifications/android").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10000
                    readTimeout = 10000
                    setRequestProperty("X-Student-Token", session)
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                }
                connection.outputStream.use { it.write(JSONObject().put("token", value).toString().toByteArray()) }
                connection.inputStream.close()
                connection.disconnect()
            }
        }
    }
}
