package com.arounus.student

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    private val base = "https://arounus.com"
    private lateinit var body: LinearLayout
    private lateinit var status: TextView
    private var token: String = ""
    private var screenVersion = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        token = getSharedPreferences("student", MODE_PRIVATE).getString("token", "") ?: ""
        showShell()
        if (token.isEmpty()) showLogin() else showHome()
    }

    private fun showShell() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(247, 249, 247)) }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(12, 12, 12, 12) }
        listOf("Home", "Modules", "Lessons", "Messages", "Market").forEach { label ->
            val button = Button(this).apply { text = label; textSize = 11f; setOnClickListener {
                when (label) {
                    "Home" -> showHome()
                    "Modules" -> showModules()
                    "Lessons" -> showLessons()
                    "Messages" -> showMessages()
                    "Market" -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base)))
                }
            } }
            bar.addView(button, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(bar)
        val scroll = ScrollView(this)
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 16, 24, 24) }
        scroll.addView(body); root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        status = TextView(this).apply { setPadding(24, 8, 24, 16) }
        root.addView(status); setContentView(root)
    }

    private fun heading(value: String) { screenVersion++; body.removeAllViews(); body.addView(TextView(this).apply { text = value; textSize = 28f; setTextColor(Color.rgb(25, 70, 51)) }) }
    private fun field(hintText: String, password: Boolean = false): EditText = EditText(this).also {
        it.hint = hintText
        if (password) it.inputType = 129
        body.addView(it)
    }
    private fun message(value: String) { status.text = value }
    private fun showError(value: String) {
        message(value)
        Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    }
    private fun button(label: String, action: () -> Unit) {
        body.addView(Button(this).apply { text = label; setOnClickListener { action() } })
    }
    private fun line(value: String) { body.addView(TextView(this).apply { text = value; textSize = 17f; setPadding(0, 10, 0, 10) }) }
    private fun showLogin() {
        heading("Student sign in")
        val identifier = field("Student number or email")
        val password = field("Password", true)
        body.addView(Button(this).apply { text = "Sign in"; setOnClickListener {
            if (identifier.text.isBlank() || password.text.isBlank()) { message("Enter your username or email and password."); return@setOnClickListener }
            request("/students/login", "POST", JSONObject().put("identifier", identifier.text.toString().trim()).put("password", password.text.toString())) { data ->
                token = data.getString("token")
                saveSession(data)
                showHome()
            }
        } })
        body.addView(Button(this).apply { text = "Create student account"; setOnClickListener { showRegister() } })
        body.addView(Button(this).apply { text = "Forgot password?"; setOnClickListener { showReset() } })
    }

    private fun showRegister() {
        heading("Create student account")
        val username = field("Student number or username")
        val name = field("Full name")
        val email = field("Email")
        val password = field("Password (at least 8 characters)", true)
        val confirm = field("Confirm password", true)
        body.addView(Button(this).apply { text = "Create account"; setOnClickListener {
            val values = listOf(username, name, email, password, confirm).map { it.text.toString().trim() }
            if (values.any { it.isEmpty() } || values[3].length < 8 || values[3] != values[4]) {
                message("Complete every field. Passwords must match and be at least 8 characters."); return@setOnClickListener
            }
            val form = mapOf("username" to values[0], "full_name" to values[1], "email" to values[2], "password" to values[3], "confirm_password" to values[4])
            request("/students/register", "POST", form = form) { data ->
                token = data.getString("token")
                saveSession(data)
                showHome()
            }
        } })
        body.addView(Button(this).apply { text = "Back to sign in"; setOnClickListener { showLogin() } })
    }

    private fun saveSession(data: JSONObject) {
        val student = data.optJSONObject("student") ?: JSONObject()
        getSharedPreferences("student", MODE_PRIVATE).edit()
            .putString("token", token)
            .putString("student_number", student.optString("student_number"))
            .putString("full_name", student.optString("full_name"))
            .apply()
    }

    private fun showReset() {
        heading("Reset password")
        val email = field("Account email")
        body.addView(Button(this).apply { text = "Email me a code"; setOnClickListener {
            if (email.text.isBlank()) { message("Enter your account email."); return@setOnClickListener }
            request("/students/password-reset/request", "POST", JSONObject().put("email", email.text.toString().trim())) {
                message(it.optString("message", "Check your email for a reset code."))
            }
        } })
        val code = field("Reset code")
        val password = field("New password", true)
        body.addView(Button(this).apply { text = "Set new password"; setOnClickListener {
            if (code.text.isBlank() || password.text.length < 8) { message("Enter your code and a password of at least 8 characters."); return@setOnClickListener }
            if (email.text.isBlank()) { message("Enter your account email."); return@setOnClickListener }
            request("/students/password-reset/confirm", "POST", JSONObject().put("email", email.text.toString().trim()).put("code", code.text.toString().trim()).put("new_password", password.text.toString())) {
                showLogin(); message("Password updated. Sign in with your new password.")
            }
        } })
        body.addView(Button(this).apply { text = "Back to sign in"; setOnClickListener { showLogin() } })
    }

    private fun showHome() {
        if (token.isEmpty()) { showLogin(); return }
        heading("Your learning space")
        request("/student/me") { data ->
            getSharedPreferences("student", MODE_PRIVATE).edit()
                .putString("student_number", data.optString("student_number"))
                .putString("full_name", data.optString("full_name")).apply()
            body.addView(TextView(this).apply { text = "Welcome, ${data.optString("full_name")}"; textSize = 20f })
            body.addView(TextView(this).apply { text = data.optString("institution") })
            button("Edit profile") { showProfile(data) }
            button("My results") { showResults(data.optString("student_number")) }
            button("Choose modules") { showModules() }
            button("Take a quiz") { showQuizModules() }
            button("Community posts") { showPosts() }
            body.addView(Button(this).apply { text = "Sign out"; setOnClickListener {
                token = ""; getSharedPreferences("student", MODE_PRIVATE).edit().clear().apply(); showLogin()
            } })
        }
    }

    private fun showProfile(profile: JSONObject) {
        heading("My profile")
        val name = field("Full name").apply { setText(profile.optString("full_name")) }
        val phone = field("Phone").apply { setText(profile.optString("phone")) }
        val institution = field("Institution").apply { setText(profile.optString("institution")) }
        val bio = field("About you").apply { setText(profile.optString("bio")) }
        button("Save profile") {
            if (name.text.isBlank()) { message("Full name is required."); return@button }
            request("/student/me", "PUT", form = mapOf("full_name" to name.text.toString(), "phone" to phone.text.toString(), "institution" to institution.text.toString(), "bio" to bio.text.toString())) { showHome(); message("Profile saved.") }
        }
    }

    private fun showModules() {
        if (token.isEmpty()) { showLogin(); return }
        heading("My modules")
        request("/student/module-enrollment") { data ->
            val selected = data.optJSONArray("module_codes") ?: JSONArray()
            val available = data.optJSONArray("available_modules") ?: JSONArray()
            val current = (0 until selected.length()).map { selected.optString(it) }
            line(if (current.isEmpty()) "No modules selected yet." else "Selected: ${current.joinToString()}")
            val checks = mutableListOf<Pair<String, CheckBox>>()
            for (i in 0 until available.length()) {
                val item = available.optJSONObject(i) ?: continue
                val code = item.optString("module_code")
                val check = CheckBox(this).apply { text = item.optString("module_name", code); isChecked = code in current }
                body.addView(check); checks.add(code to check)
            }
            if (!data.optBoolean("completed")) button("Save module selection") {
                val chosen = JSONArray(); checks.filter { it.second.isChecked }.forEach { chosen.put(it.first) }
                request("/student/modules", "PUT", JSONObject().put("module_codes", chosen)) { showModules() }
            } else button("Add modules") {
                val added = JSONArray(); checks.filter { it.second.isChecked && it.first !in current }.forEach { added.put(it.first) }
                if (added.length() == 0) { message("Select a new module first."); return@button }
                request("/student/modules/add", "POST", JSONObject().put("module_codes", added)) { showModules() }
            }
            button("Browse quizzes") { showQuizModules() }
        }
    }

    private fun showQuizModules() {
        heading("Quizzes")
        request("/student/quiz-modules") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No quizzes available for your modules.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val code = item.optString("module_code")
                button("${item.optString("module_name", code)} · ${item.optInt("quiz_count")} quizzes") { showQuizzes(code) }
            }
        }
    }

    private fun showQuizzes(code: String) {
        heading("Quizzes · $code")
        request("/student/quizzes/by-module/${Uri.encode(code)}") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No quizzes here yet.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                button(item.optString("title", "Quiz")) { showQuiz(item.optInt("id")) }
            }
        }
    }

    private fun showQuiz(id: Int) {
        heading("Quiz")
        request("/student/quiz/$id") { quiz ->
            heading(quiz.optString("title", "Quiz"))
            val answers = showQuestions(quiz.optJSONArray("questions") ?: JSONArray())
            button("Submit answers") {
                request("/quiz/$id/submit", "POST", submission(answers)) { result ->
                    heading("Submitted"); line("Score: ${result.optString("auto_marked_score")} / ${result.optString("max_score")}")
                    button("Back to quizzes") { showQuizModules() }
                }
            }
        }
    }

    private fun showLessons() {
        heading("Lessons")
        request("/student/lessons") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No lessons available for your modules.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                button("${item.optString("title")} · ${item.optString("module_code")}") { showLesson(item.optInt("id")) }
            }
        }
    }

    private fun showLesson(id: Int) {
        heading("Lesson")
        request("/student/lesson/$id") { lesson ->
            heading(lesson.optString("title", "Lesson"))
            line(lesson.optString("description"))
            val url = lesson.optString("video_url")
            if (url.isNotBlank() && url != "null") {
                val video = VideoView(this).apply { layoutParams = LinearLayout.LayoutParams(-1, 600); setVideoURI(Uri.parse(if (url.startsWith("/")) base + url else url)); setMediaController(MediaController(this@MainActivity)); setOnPreparedListener { start() } }
                body.addView(video)
            } else line("No video available for this lesson.")
            val questions = lesson.optJSONArray("questions") ?: JSONArray()
            if (questions.length() > 0) {
                val answers = showQuestions(questions)
                button("Submit lesson answers") {
                    request("/lesson/$id/submit", "POST", submission(answers)) { result ->
                        heading("Lesson submitted"); line("Score: ${result.optString("auto_marked_score")} / ${result.optString("max_score")}")
                        button("Back to lessons") { showLessons() }
                    }
                }
            }
            button("Back to lessons") { showLessons() }
        }
    }

    private fun showQuestions(questions: JSONArray): List<Pair<Int, () -> String>> {
        val answers = mutableListOf<Pair<Int, () -> String>>()
        for (i in 0 until questions.length()) {
            val question = questions.optJSONObject(i) ?: continue
            line("${i + 1}. ${question.optString("question")}")
            val qid = question.optInt("question_id")
            if (question.optString("type") == "mcq") {
                val group = RadioGroup(this)
                val options = question.optJSONArray("options") ?: JSONArray()
                for (j in 0 until options.length()) group.addView(RadioButton(this).apply { text = options.optString(j); id = View.generateViewId() })
                body.addView(group)
                answers.add(qid to { group.findViewById<RadioButton>(group.checkedRadioButtonId)?.text?.toString() ?: "" })
            } else {
                val input = field("Your answer")
                answers.add(qid to { input.text.toString() })
            }
        }
        return answers
    }

    private fun submission(answers: List<Pair<Int, () -> String>>): JSONObject {
        val profile = getSharedPreferences("student", MODE_PRIVATE)
        val answerArray = JSONArray()
        answers.forEach { (qid, value) -> answerArray.put(JSONObject().put("question_id", qid).put("answer", value())) }
        return JSONObject().put("student_id", profile.getString("student_number", ""))
            .put("student_name", profile.getString("full_name", "")).put("answers", answerArray)
    }

    private fun showMessages() {
        heading("Messages")
        request("/student/messages") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No messages yet.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                line("${item.optString("peer_name", "Conversation")}: ${item.optString("content")}\n${item.optString("created_at")}")
            }
            button("Message administrator") { composeMessage("admin", 0, "Administrator") }
            request("/student/message-lecturers") { tutors ->
                val list = tutors.optJSONArray("items") ?: JSONArray()
                for (i in 0 until list.length()) {
                    val tutor = list.optJSONObject(i) ?: continue
                    button("Message ${tutor.optString("full_name")}") { composeMessage("lecturer", tutor.optInt("id"), tutor.optString("full_name")) }
                }
            }
        }
    }

    private fun composeMessage(type: String, id: Int, name: String) {
        heading("Message $name")
        val content = field("Write your message")
        button("Send message") {
            if (content.text.isBlank()) { message("Write a message first."); return@button }
            request("/student/messages", "POST", JSONObject().put("recipient_type", type).put("recipient_id", id).put("content", content.text.toString())) {
                showMessages(); message("Message sent.")
            }
        }
        button("Back to messages") { showMessages() }
    }

    private fun showPosts() {
        heading("Community posts")
        request("/fun/posts") { data ->
            val content = field("Share an update")
            button("Post") {
                if (content.text.isBlank()) { message("Write a post first."); return@button }
                request("/fun/posts", "POST", form = mapOf("content" to content.text.toString())) { showPosts() }
            }
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No posts yet.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                line("${item.optString("author_name")} · ${item.optString("created_at")}\n${item.optString("content")}")
                if (item.optBoolean("can_reply")) button("Reply") {
                    val reply = field("Reply to this post")
                    button("Send reply") {
                        if (reply.text.isBlank()) return@button
                        request("/fun/posts", "POST", form = mapOf("content" to reply.text.toString(), "parent_id" to item.optString("id"))) { showPosts() }
                    }
                }
            }
        }
    }

    private fun showResults(studentNumber: String) {
        heading("My results")
        request("/results/${Uri.encode(studentNumber)}") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) line("No results yet.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                line("${item.optString("quiz_title")} · ${item.optString("total_score")} / ${item.optString("max_score")}")
            }
        }
    }

    private fun request(path: String, method: String = "GET", payload: JSONObject? = null, form: Map<String, String>? = null, done: (JSONObject) -> Unit) {
        message("Loading…")
        val requestedOnScreen = screenVersion
        val finished = AtomicBoolean(false)
        Handler(Looper.getMainLooper()).postDelayed({
            if (requestedOnScreen == screenVersion && finished.compareAndSet(false, true))
                showError("Connection timed out. Check your internet connection and try again.")
        }, 30000)
        thread {
            try {
                val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = method; connectTimeout = 15000; readTimeout = 15000
                    if (token.isNotEmpty()) setRequestProperty("X-Student-Token", token)
                    if (payload != null) { doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(payload.toString().toByteArray()) } }
                    if (form != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                        val encoded = form.entries.joinToString("&") { "${URLEncoder.encode(it.key, "UTF-8") }=${URLEncoder.encode(it.value, "UTF-8")}" }
                        outputStream.use { it.write(encoded.toByteArray(Charsets.UTF_8)) }
                    }
                }
                val code = connection.responseCode
                val response = (if (code in 200..299) connection.inputStream else connection.errorStream).bufferedReader().use { it.readText() }
                connection.disconnect()
                runOnUiThread {
                    if (requestedOnScreen != screenVersion || !finished.compareAndSet(false, true)) return@runOnUiThread
                    if (code !in 200..299) {
                        val detail = runCatching { JSONObject(response).optString("detail") }.getOrDefault(response)
                        if (code == 404 && path.startsWith("/results/")) {
                            message(""); line("No results yet.")
                        } else if (code == 401 && path != "/students/login") {
                            token = ""
                            getSharedPreferences("student", MODE_PRIVATE).edit().clear().apply()
                            showLogin()
                            showError("Session expired. Sign in again.")
                        } else showError(detail.ifBlank { "Request failed ($code)." })
                    }
                    else { message(""); done(if (response.trimStart().startsWith("{")) JSONObject(response) else JSONObject().put("items", JSONArray(response))) }
                }
            } catch (e: Exception) { runOnUiThread { if (requestedOnScreen == screenVersion && finished.compareAndSet(false, true)) showError(e.message ?: "Connection failed") } }
        }
    }
}
