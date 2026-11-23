package com.arounus.student

import android.app.Activity
import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max

class MediaToolActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var imageSize: Spinner
    private lateinit var videoSize: Spinner
    private var transformer: Transformer? = null
    private var output: File? = null
    private var busy = false
    private val dark = Color.rgb(8, 14, 31)
    private val ink = Color.rgb(237, 244, 255)
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 16f) = TextView(this).apply { text = value; textSize = size; setTextColor(ink); setPadding(0, dp(8), 0, dp(8)) }
    private fun button(value: String, action: () -> Unit) = Button(this).apply { text = value; setOnClickListener { action() } }
    private fun selector(options: List<String>) = Spinner(this).apply {
        adapter = ArrayAdapter(this@MediaToolActivity, android.R.layout.simple_spinner_dropdown_item, options)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18)); setBackgroundColor(dark); gravity = Gravity.TOP }
        setContentView(root)
        root.addView(button("← Back") { finish() })
        root.addView(text("Compress media", 28f))
        root.addView(text("Files stay on this device. Choose a photo or video, then save the smaller copy to Downloads."))
        root.addView(text("Photo size"))
        imageSize = selector(listOf("1920 pixels", "1280 pixels", "960 pixels")); root.addView(imageSize)
        root.addView(button("Choose photo") { pick("image/*", 41) })
        root.addView(text("Video height"))
        videoSize = selector(listOf("720 pixels", "480 pixels")); root.addView(videoSize)
        root.addView(button("Choose video") { pick("video/*", 42) })
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = android.view.View.GONE }
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(16)))
        status = text("").apply { setTextColor(Color.rgb(93, 239, 225)) }; root.addView(status)
    }
    private fun pick(type: String, requestCode: Int) {
        if (busy) { status.text = "Wait for the current file to finish."; return }
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 44)
            status.text = "Allow file saving, then choose the file again."
            return
        }
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); this.type = type }, requestCode)
    }
    @Deprecated("Activity result API used for this small native tool")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data?.data == null) return
        if (requestCode == 41) compressImage(data.data!!) else if (requestCode == 42) compressVideo(data.data!!)
    }
    private fun compressImage(uri: Uri) {
        busy = true; status.text = "Compressing photo…"; progress.visibility = android.view.View.VISIBLE; progress.isIndeterminate = true
        val target = listOf(1920, 1280, 960)[imageSize.selectedItemPosition]
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("Could not read this photo.")
                    val sample = max(1, max(bounds.outWidth, bounds.outHeight) / (target * 2))
                    val options = BitmapFactory.Options().apply { inSampleSize = sample }
                    val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: error("Could not decode this photo.")
                    val scale = minOf(1f, target.toFloat() / max(bitmap.width, bitmap.height))
                    val resized = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).toInt()), max(1, (bitmap.height * scale).toInt()), true) else bitmap
                    val buffer = java.io.ByteArrayOutputStream()
                    resized.compress(Bitmap.CompressFormat.JPEG, 78, buffer)
                    if (resized !== bitmap) resized.recycle()
                    bitmap.recycle()
                    buffer.toByteArray()
                }
                save("Arounus-photo-${System.currentTimeMillis()}.jpg", "image/jpeg") { it.write(bytes) }
                status.text = "Photo saved to Downloads (${bytes.size / 1024} KB)."
            } catch (e: Exception) { status.text = e.message ?: "Photo compression failed." }
            finally { progress.visibility = android.view.View.GONE; busy = false }
        }
    }
    private fun compressVideo(uri: Uri) {
        busy = true; status.text = "Compressing video on this device…"; progress.visibility = android.view.View.VISIBLE; progress.isIndeterminate = false; progress.progress = 0
        val height = listOf(720, 480)[videoSize.selectedItemPosition]
        val destination = File(cacheDir, "arounus-video-${System.currentTimeMillis()}.mp4")
        output = destination
        val edited = EditedMediaItem.Builder(MediaItem.fromUri(uri))
            .setEffects(Effects(emptyList(), listOf(Presentation.createForHeight(height))))
            .build()
        transformer = Transformer.Builder(this).setVideoMimeType(MimeTypes.VIDEO_H264)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, result: ExportResult) {
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { save("Arounus-video-${System.currentTimeMillis()}.mp4", "video/mp4") { destination.inputStream().use { source -> source.copyTo(it) } } }
                            status.text = "Video saved to Downloads (${destination.length() / 1024 / 1024} MB)."
                        } catch (e: Exception) { status.text = e.message ?: "Could not save video." }
                        finally { destination.delete(); output = null; transformer = null; busy = false; progress.visibility = android.view.View.GONE }
                    }
                }
                override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
                    status.text = exception.message ?: "Video compression failed."
                    destination.delete(); output = null; transformer = null; busy = false; progress.visibility = android.view.View.GONE
                }
            }).build()
        try { transformer?.start(edited, destination.absolutePath); pollProgress() }
        catch (e: Exception) { status.text = e.message ?: "Video compression could not start."; destination.delete(); output = null; transformer = null; busy = false; progress.visibility = android.view.View.GONE }
    }
    private fun pollProgress() {
        val active = transformer ?: return
        val holder = ProgressHolder()
        if (active.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) progress.progress = holder.progress
        if (busy) progress.postDelayed({ pollProgress() }, 500)
    }
    private fun save(name: String, mime: String, write: (java.io.OutputStream) -> Unit) {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= 29) put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        if (Build.VERSION.SDK_INT < 29) {
            val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            directory.mkdirs(); File(directory, name).outputStream().use(write); return
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Could not save to Downloads.")
        try { contentResolver.openOutputStream(uri)?.use(write) ?: error("Could not open the saved file.") }
        catch (e: Exception) { contentResolver.delete(uri, null, null); throw e }
    }
    override fun onDestroy() { transformer?.cancel(); output?.delete(); scope.cancel(); super.onDestroy() }
}
