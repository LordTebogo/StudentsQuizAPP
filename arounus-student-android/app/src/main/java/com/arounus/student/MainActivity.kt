package com.arounus.student

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.widget.*
import android.text.Editable
import android.text.TextWatcher
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.ArrayDeque
import java.util.concurrent.Executors
import kotlin.concurrent.thread
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    private val base = "https://arounus.com"
    private lateinit var body: LinearLayout
    private lateinit var status: TextView
    private lateinit var topBar: LinearLayout
    private lateinit var bottomBar: LinearLayout
    private lateinit var chatComposer: LinearLayout
    private lateinit var pageTitle: TextView
    private lateinit var menuIcon: TextView
    private lateinit var searchIcon: TextView
    private lateinit var drawerLayer: FrameLayout
    private lateinit var pageScroll: ScrollView
    private data class Route(val key: String, val render: () -> Unit)
    private val routeHistory = ArrayDeque<Route>()
    private var currentRoute: Route? = null
    private var restoringRoute = false
    private var similarQuestionOpen = false
    private var backCallback: OnBackInvokedCallback? = null
    private var token: String = ""
    private var screenVersion = 0
    private var speech: TextToSpeech? = null
    private var funMuted = false
    private var funQuiz: JSONObject? = null
    private val funAnswers = mutableMapOf<Int, String>()
    private val funWrongAttempts = mutableMapOf<String, Int>()
    private var funIndex = 0
    private var funFeedback: LinearLayout? = null
    private val draftExecutor = Executors.newSingleThreadExecutor()
    private val ink = Color.rgb(237, 244, 255)
    private val muted = Color.rgb(157, 174, 199)
    private val baseBlue = Color.rgb(8, 14, 31)
    private val panel = Color.rgb(18, 28, 51)
    private val stroke = Color.rgb(42, 58, 86)
    private val cyan = Color.rgb(93, 239, 225)
    private val violet = Color.rgb(161, 135, 255)
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int = 18, outline: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); if (outline != null) setStroke(dp(1), outline)
    }
    private fun gradient(): GradientDrawable = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.rgb(37, 88, 118), Color.rgb(45, 44, 105))).apply { cornerRadius = dp(24).toFloat() }
    private fun text(value: String, size: Float, color: Int = ink, bold: Boolean = false): TextView = TextView(this).apply {
        this.text = value; textSize = size; setTextColor(color); if (bold) setTypeface(null, Typeface.BOLD)
    }
    private fun margin(top: Int = 0, bottom: Int = 0): LinearLayout.LayoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top); bottomMargin = dp(bottom) }
    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18)); background = shape(panel, 20, stroke)
        body.addView(this, margin(12, 0))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        token = getSharedPreferences("student", MODE_PRIVATE).getString("token", "") ?: ""
        speech = TextToSpeech(this) { status -> if (status == TextToSpeech.SUCCESS) speech?.language = Locale.ENGLISH }
        showShell()
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { handleBack() }
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback!!)
        }
        if (token.isEmpty()) showLogin() else showHome()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        speech?.stop(); speech?.shutdown(); draftExecutor.shutdown(); super.onDestroy()
    }

    @Deprecated("Handled for older Android versions")
    override fun onBackPressed() { handleBack() }

    private fun enterRoute(key: String, render: () -> Unit) {
        if (key == "home" || key == "login") routeHistory.clear()
        else if (!restoringRoute && currentRoute?.key != key) currentRoute?.let {
            routeHistory.addLast(it); if (routeHistory.size > 40) routeHistory.removeFirst()
        }
        currentRoute = Route(key, render)
        pageScroll.scrollTo(0, 0)
    }

    private fun handleBack() {
        if (drawerLayer.visibility == View.VISIBLE) { closeDrawer(); return }
        if (similarQuestionOpen && currentRoute?.key?.startsWith("quiz:") == true) {
            similarQuestionOpen = false; renderFunQuestion(funIndex); return
        }
        if (currentRoute?.key == "home" || currentRoute?.key == "login") {
            AlertDialog.Builder(this).setTitle("Exit Arounus Student?")
                .setMessage("Are you sure you want to leave the app?")
                .setNegativeButton("Stay", null).setPositiveButton("Exit") { _, _ -> finish() }.show()
            return
        }
        val previous = if (routeHistory.isEmpty()) null else routeHistory.removeLast()
        if (previous == null) { showHome(); return }
        restoringRoute = true
        try { currentRoute = previous; previous.render() } finally { restoringRoute = false }
    }

    private fun showShell() {
        window.statusBarColor = baseBlue; window.navigationBarColor = baseBlue
        val frame = FrameLayout(this).apply { setBackgroundColor(baseBlue) }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        topBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(14), dp(12), dp(8)) }
        menuIcon = text("☰", 26f, cyan).apply { gravity = Gravity.CENTER; contentDescription = "Open account menu"; setOnClickListener { openDrawer() } }
        topBar.addView(menuIcon, LinearLayout.LayoutParams(dp(48), dp(48)))
        pageTitle = text("", 24f, ink, true)
        topBar.addView(pageTitle, LinearLayout.LayoutParams(0, -2, 1f))
        searchIcon = text("⌕", 32f, cyan).apply { gravity = Gravity.CENTER; contentDescription = "Search modules and topics"; setOnClickListener { showSearch() } }
        topBar.addView(searchIcon, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(topBar)
        pageScroll = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(30)) }
        pageScroll.addView(body); root.addView(pageScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        status = text("", 13f, cyan).apply { setPadding(dp(22), 0, dp(22), dp(4)) }
        root.addView(status)
        bottomBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), dp(8), dp(8), dp(10)); background = shape(panel, 20, stroke) }
        chatComposer = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE; setPadding(dp(12), dp(8), dp(12), dp(10)); background = shape(panel, 18, stroke) }
        root.addView(chatComposer)
        val destinations = listOf("Home" to "⌂", "Lessons" to "▶", "Chats" to "✉", "Market" to "↗")
        destinations.forEach { (label, symbol) ->
            val tab = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(0, dp(4), 0, dp(4)) }
            tab.addView(text(symbol, 22f, cyan, true).apply { gravity = Gravity.CENTER })
            tab.addView(text(label, 10f, muted).apply { gravity = Gravity.CENTER })
            tab.setOnClickListener {
                when (label) {
                    "Home" -> showHome()
                    "Lessons" -> showLessons()
                    "Chats" -> showMessages()
                    "Market" -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base)))
                }
            }
            bottomBar.addView(tab, LinearLayout.LayoutParams(0, dp(55), 1f))
        }
        root.addView(bottomBar)
        frame.addView(root, FrameLayout.LayoutParams(-1, -1))
        drawerLayer = FrameLayout(this).apply { visibility = View.GONE }
        frame.addView(drawerLayer, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
    }

    private fun closeDrawer() { drawerLayer.visibility = View.GONE; drawerLayer.removeAllViews() }
    private fun openDrawer() {
        if (token.isEmpty()) return
        drawerLayer.removeAllViews()
        drawerLayer.addView(View(this).apply { setBackgroundColor(Color.argb(180, 1, 5, 15)); setOnClickListener { closeDrawer() } }, FrameLayout.LayoutParams(-1, -1))
        val width = minOf(dp(350), (resources.displayMetrics.widthPixels * 0.82f).toInt())
        val drawer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(34), dp(22), dp(20)); background = shape(panel, 0) }
        drawerLayer.addView(drawer, FrameLayout.LayoutParams(width, -1, Gravity.START))
        drawer.addView(text("AROUNUS", 13f, cyan, true))
        drawer.addView(text(getSharedPreferences("student", MODE_PRIVATE).getString("full_name", "Student") ?: "Student", 24f, ink, true), margin(14, 4))
        drawer.addView(text("Your account", 14f, muted), margin(0, 20))
        fun entry(symbol: String, label: String, action: () -> Unit) {
            drawer.addView(text("$symbol    $label", 17f, ink).apply { setPadding(dp(10), dp(17), dp(10), dp(17)); setOnClickListener { closeDrawer(); action() } }, margin(4, 0))
        }
        entry("◎", "My profile") { showAccount() }
        entry("▦", "Browse modules") { showQuizModules() }
        entry("▦", "Manage modules") { showModules() }
        entry("✦", "My results") { showResults(getSharedPreferences("student", MODE_PRIVATE).getString("student_number", "") ?: "") }
        entry("◉", "Community posts") { showPosts() }
        entry("✉", "Messages") { showMessages() }
        entry("◇", "Request account deletion") { showDeletionRequest() }
        entry("↪", "Sign out") { token = ""; getSharedPreferences("student", MODE_PRIVATE).edit().clear().apply(); showLogin() }
        drawerLayer.visibility = View.VISIBLE
    }

    private fun heading(value: String) {
        screenVersion++; body.removeAllViews(); message("")
        val auth = token.isEmpty()
        topBar.visibility = if (auth) View.GONE else View.VISIBLE
        bottomBar.visibility = if (auth) View.GONE else View.VISIBLE
        chatComposer.visibility = View.GONE
        chatComposer.removeAllViews()
        pageScroll.setBackgroundColor(baseBlue)
        pageTitle.text = value
        menuIcon.text = "☰"
        menuIcon.contentDescription = "Open account menu"
        menuIcon.setOnClickListener { openDrawer() }
        searchIcon.visibility = View.VISIBLE
        if (auth) {
            body.addView(text("A", 38f, baseBlue, true).apply { gravity = Gravity.CENTER; background = shape(cyan, 22); layoutParams = margin(36, 18).apply { width = dp(64); height = dp(64) } })
            body.addView(text("AROUNUS", 13f, cyan, true), margin(0, 4))
            body.addView(text(value, 32f, ink, true), margin(0, 8))
            body.addView(text("Your learning universe starts here.", 16f, muted), margin(0, 24))
        }
    }
    private fun field(hintText: String, password: Boolean = false): EditText = EditText(this).also {
        it.hint = hintText; it.setHintTextColor(muted); it.setTextColor(ink); it.textSize = 16f
        it.setSingleLine(true); it.setPadding(dp(16), dp(14), dp(16), dp(14)); it.background = shape(panel, 15, stroke)
        if (password) it.inputType = 129
        body.addView(it, margin(8, 3))
    }
    private fun message(value: String) { status.text = value }
    private fun showError(value: String) {
        message(value)
        Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    }
    private fun button(label: String, action: () -> Unit) {
        body.addView(Button(this).apply {
            text = label; textSize = 14f; isAllCaps = false; setTypeface(null, Typeface.BOLD)
            setTextColor(baseBlue); background = shape(cyan, 15); backgroundTintList = null
            elevation = dp(2).toFloat(); setOnClickListener { action() }
        }, margin(10, 2))
    }
    private fun secondaryButton(label: String, action: () -> Unit) {
        body.addView(Button(this).apply {
            text = label; textSize = 14f; isAllCaps = false; setTextColor(ink)
            background = shape(panel, 15, stroke); backgroundTintList = null; setOnClickListener { action() }
        }, margin(8, 2))
    }
    private fun line(value: String) { body.addView(text(value, 16f, muted).apply { setPadding(dp(2), dp(10), dp(2), dp(10)) }) }
    private fun emptyState(symbol: String, title: String, detail: String) {
        val view = card().apply { gravity = Gravity.CENTER; setPadding(dp(26), dp(34), dp(26), dp(34)) }
        view.addView(text(symbol, 34f, cyan, true).apply { gravity = Gravity.CENTER })
        view.addView(text(title, 20f, ink, true).apply { gravity = Gravity.CENTER }, margin(12, 4))
        view.addView(text(detail, 15f, muted).apply { gravity = Gravity.CENTER })
    }
    private fun featureCard(symbol: String, title: String, detail: String, action: () -> Unit) {
        val view = card().apply { setOnClickListener { action() }; isClickable = true }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(text(symbol, 23f, cyan, true).apply { gravity = Gravity.CENTER; background = shape(Color.rgb(27, 63, 79), 14) }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, 0, 0) }
        copy.addView(text(title, 17f, ink, true)); copy.addView(text(detail, 13f, muted), margin(3, 0))
        row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f)); row.addView(text("›", 28f, cyan))
        view.addView(row)
    }
    private fun showSearch() {
        if (token.isEmpty()) return
        enterRoute("search") { showSearch() }
        heading("Search learning")
        val input = field("Search module, topic, or title")
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(results, margin(12, 0))
        results.addView(text("Loading your learning library…", 15f, muted))
        request("/student/quiz-modules") { moduleData ->
            val modules = moduleData.optJSONArray("items") ?: JSONArray()
            val assigned = (0 until modules.length()).map { modules.optJSONObject(it)?.optString("module_code") ?: "" }.toSet()
            request("/quizzes") { quizData ->
                val quizzes = quizData.optJSONArray("items") ?: JSONArray()
                request("/student/lessons") { lessonData ->
                    val lessons = lessonData.optJSONArray("items") ?: JSONArray()
                    fun render(term: String) {
                        results.removeAllViews()
                        if (term.isBlank()) { results.addView(text("Type a module, topic, or quiz title.", 15f, muted)); return }
                        var matches = 0
                        fun hit(title: String, detail: String, action: () -> Unit) {
                            if (matches >= 30) return
                            val row = LinearLayout(this).apply {
                                orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
                                background = shape(panel, 16, stroke); setOnClickListener { action() }
                            }
                            row.addView(text(title, 16f, ink, true)); row.addView(text(detail, 13f, muted), margin(4, 0))
                            results.addView(row, margin(8, 0)); matches++
                        }
                        for (i in 0 until modules.length()) {
                            val item = modules.optJSONObject(i) ?: continue
                            val code = item.optString("module_code")
                            val name = item.optString("module_name", code)
                            if ("$code $name".contains(term, true)) hit(name, "Module · $code") { showQuizzes(code) }
                        }
                        for (i in 0 until quizzes.length()) {
                            val item = quizzes.optJSONObject(i) ?: continue
                            val code = item.optString("module_code")
                            if (code !in assigned) continue
                            val title = item.optString("title")
                            if ("$title ${item.optString("topic")} $code".contains(term, true)) hit(title, "Quiz · $code · ${item.optString("topic")}") { showQuiz(item.optInt("id")) }
                        }
                        for (i in 0 until lessons.length()) {
                            val item = lessons.optJSONObject(i) ?: continue
                            val title = item.optString("title")
                            if ("$title ${item.optString("topic")} ${item.optString("module_code")}".contains(term, true)) hit(title, "Lesson · ${item.optString("module_code")} · ${item.optString("topic")}") { showLesson(item.optInt("id")) }
                        }
                        if (matches == 0) results.addView(text("No match. Try another module, topic, or title.", 15f, muted))
                    }
                    input.addTextChangedListener(object : TextWatcher {
                        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { render(s?.toString()?.trim() ?: "") }
                        override fun afterTextChanged(s: Editable?) {}
                    })
                    render(input.text.toString().trim())
                }
            }
        }
    }
    private fun showLogin() {
        enterRoute("login") { showLogin() }
        heading("Student sign in")
        val identifier = field("Student number or email")
        val password = field("Password", true)
        button("Sign in") {
            if (identifier.text.isBlank() || password.text.isBlank()) { message("Enter your username or email and password."); return@button }
            request("/students/login", "POST", JSONObject().put("identifier", identifier.text.toString().trim()).put("password", password.text.toString())) { data ->
                token = data.getString("token")
                saveSession(data)
                showHome()
            }
        }
        secondaryButton("Create student account") { showRegister() }
        secondaryButton("Forgot password?") { showReset() }
    }

    private fun showRegister() {
        enterRoute("register") { showRegister() }
        heading("Create student account")
        val username = field("Student number or username")
        val name = field("Full name")
        val email = field("Email")
        val password = field("Password (at least 8 characters)", true)
        val confirm = field("Confirm password", true)
        button("Create account") {
            val values = listOf(username, name, email, password, confirm).map { it.text.toString().trim() }
            if (values.any { it.isEmpty() } || values[3].length < 8 || values[3] != values[4]) {
                message("Complete every field. Passwords must match and be at least 8 characters."); return@button
            }
            val form = mapOf("username" to values[0], "full_name" to values[1], "email" to values[2], "password" to values[3], "confirm_password" to values[4])
            request("/students/register", "POST", form = form) { data ->
                token = data.getString("token")
                saveSession(data)
                showHome()
            }
        }
        secondaryButton("Back to sign in") { showLogin() }
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
        enterRoute("reset") { showReset() }
        heading("Reset password")
        val email = field("Account email")
        button("Email me a code") {
            if (email.text.isBlank()) { message("Enter your account email."); return@button }
            request("/students/password-reset/request", "POST", JSONObject().put("email", email.text.toString().trim())) {
                message(it.optString("message", "Check your email for a reset code."))
            }
        }
        val code = field("Reset code")
        val password = field("New password", true)
        button("Set new password") {
            if (code.text.isBlank() || password.text.length < 8) { message("Enter your code and a password of at least 8 characters."); return@button }
            if (email.text.isBlank()) { message("Enter your account email."); return@button }
            request("/students/password-reset/confirm", "POST", JSONObject().put("email", email.text.toString().trim()).put("code", code.text.toString().trim()).put("new_password", password.text.toString())) {
                showLogin(); message("Password updated. Sign in with your new password.")
            }
        }
        secondaryButton("Back to sign in") { showLogin() }
    }

    private fun showHome() {
        if (token.isEmpty()) { showLogin(); return }
        enterRoute("home") { showHome() }
        heading("Dashboard")
        request("/student/me") { data ->
            getSharedPreferences("student", MODE_PRIVATE).edit()
                .putString("student_number", data.optString("student_number"))
                .putString("full_name", data.optString("full_name")).apply()
            body.addView(text("Choose where to continue", 16f, muted), margin(4, 16))
            featureCard("▦", "My modules", "Browse tutors, quizzes, and lessons") { showQuizModules() }
            featureCard("◇", "Quizzes", "New quizzes appear when tutors publish them") { showQuizModules() }
            featureCard("▶", "Lessons", "Videos and learning materials") { showLessons() }
            featureCard("✉", "Messages", "Connect with tutors and admin") { showMessages() }
            featureCard("◎", "My results", "Track your progress") { showResults(data.optString("student_number")) }
        }
    }

    private fun showAccount() {
        enterRoute("account") { showAccount() }
        heading("My account")
        request("/student/me") { profile ->
            val panel = card()
            panel.addView(text(profile.optString("full_name", "Student"), 23f, ink, true))
            panel.addView(text(profile.optString("student_number"), 14f, muted), margin(5, 0))
            secondaryButton("Edit profile") { showProfile(profile) }
            secondaryButton("Request account deletion") { showDeletionRequest() }
        }
    }

    private fun showProfile(profile: JSONObject) {
        enterRoute("profile") { showProfile(profile) }
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
        enterRoute("modules") { showModules() }
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
                val check = CheckBox(this).apply {
                    text = item.optString("module_name", code); isChecked = code in current
                    setTextColor(ink); textSize = 15f; buttonTintList = android.content.res.ColorStateList.valueOf(cyan)
                    setPadding(dp(6), dp(7), dp(6), dp(7))
                }
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
        enterRoute("quiz-modules") { showQuizModules() }
        heading("My modules")
        request("/student/quiz-modules") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) emptyState("◇", "No quizzes yet", "Quizzes for your modules will appear here when a tutor publishes them.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val code = item.optString("module_code")
                featureCard("◇", item.optString("module_name", code), "${item.optInt("quiz_count")} quizzes available") { showQuizzes(code) }
            }
        }
    }

    private fun showQuizzes(code: String) {
        showModuleContent(code)
    }

    private fun showModuleContent(code: String, tutorId: Int? = null, tutorName: String = "") {
        val key = if (tutorId == null) "module:$code" else "tutor:$code:$tutorId"
        enterRoute(key) { showModuleContent(code, tutorId, tutorName) }
        heading(if (tutorId == null) code else tutorName)
        if (tutorId == null) {
            request("/student/module-tutors/${Uri.encode(code)}") { data ->
                val tutors = data.optJSONArray("items") ?: JSONArray()
                if (tutors.length() == 0) { showTutorContent(code, null); return@request }
                body.addView(text("CHOOSE A TUTOR", 12f, violet, true), margin(8, 4))
                for (i in 0 until tutors.length()) {
                    val tutor = tutors.optJSONObject(i) ?: continue
                    val name = tutor.optString("full_name", "Tutor")
                    val id = tutor.optInt("id")
                    val detail = "${tutor.optInt("quiz_count")} quizzes · ${tutor.optInt("lesson_count")} lessons" +
                        tutor.optString("institution").let { if (it.isBlank()) "" else " · $it" }
                    featureCard("◉", name, detail) { showModuleContent(code, id, name) }
                }
            }
        } else showTutorContent(code, tutorId)
    }

    private fun showTutorContent(code: String, tutorId: Int?) {
        request("/student/quizzes/by-module/${Uri.encode(code)}") { quizData ->
            val quizzes = quizData.optJSONArray("items") ?: JSONArray()
            request("/student/lessons?module_code=${Uri.encode(code)}") { lessonData ->
                val lessons = lessonData.optJSONArray("items") ?: JSONArray()
                var shown = 0
                body.addView(text("QUIZZES & TESTS", 12f, violet, true), margin(8, 4))
                for (i in 0 until quizzes.length()) {
                    val item = quizzes.optJSONObject(i) ?: continue
                    if (tutorId != null && item.optInt("lecturer_id") != tutorId) continue
                    val isFun = item.optBoolean("is_fun")
                    val detail = if (isFun) "✦ Fun Quiz · ${item.optString("fun_level", "starter").replaceFirstChar { it.uppercase() }} level" else item.optString("topic", "Quiz")
                    featureCard(if (isFun) "✦" else "◇", item.optString("title", "Quiz"), detail) { showQuiz(item.optInt("id")) }
                    shown++
                }
                body.addView(text("LESSONS", 12f, violet, true), margin(22, 4))
                for (i in 0 until lessons.length()) {
                    val item = lessons.optJSONObject(i) ?: continue
                    if (tutorId != null && item.optInt("lecturer_id") != tutorId) continue
                    featureCard("▶", item.optString("title", "Lesson"), item.optString("topic", "Lesson")) { showLesson(item.optInt("id")) }
                    shown++
                }
                if (shown == 0) emptyState("◇", "Nothing published yet", "This tutor's content will appear here when it is published.")
            }
        }
    }

    private fun showQuiz(id: Int) {
        enterRoute("quiz:$id") { showQuiz(id) }
        heading("Quiz")
        request("/student/quiz/$id") { quiz ->
            if (quiz.optBoolean("is_fun")) {
                funQuiz = quiz; funAnswers.clear(); funWrongAttempts.clear()
                request("/student/quiz/$id/draft") { draft ->
                    val saved = draft.optJSONArray("answers") ?: JSONArray()
                    for (i in 0 until saved.length()) {
                        val item = saved.optJSONObject(i) ?: continue
                        funAnswers[item.optInt("question_id")] = item.optString("answer")
                    }
                    val count = quiz.optJSONArray("questions")?.length() ?: 0
                    renderFunQuestion(draft.optInt("current_question").coerceIn(0, (count - 1).coerceAtLeast(0)))
                }
                return@request
            }
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

    private fun speakFun(value: String) {
        if (funMuted) return
        speech?.apply { language = Locale.ENGLISH; speak(value, TextToSpeech.QUEUE_FLUSH, null, "fun_feedback") }
    }

    private fun funAction(container: LinearLayout, label: String, primary: Boolean = false, action: () -> Unit) {
        container.addView(Button(this).apply {
            text = label; textSize = 14f; isAllCaps = false; setTextColor(if (primary) baseBlue else ink)
            background = shape(if (primary) cyan else panel, 15, if (primary) null else stroke)
            backgroundTintList = null; setOnClickListener { action() }
        }, margin(8, 0))
    }

    private fun remoteImage(raw: String, container: LinearLayout) {
        if (raw.isBlank() || raw == "null") return
        val address = if (raw.startsWith("/")) base + raw else raw
        if (!address.startsWith("https://")) return
        val version = screenVersion
        val image = ImageView(this).apply { adjustViewBounds = true; maxHeight = dp(360); scaleType = ImageView.ScaleType.FIT_CENTER; contentDescription = "Question illustration" }
        container.addView(image, margin(14, 4))
        thread {
            runCatching {
                val connection = URL(address).openConnection().apply { connectTimeout = 12000; readTimeout = 12000 }
                connection.getInputStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull()?.let { bitmap -> runOnUiThread { if (screenVersion == version) image.setImageBitmap(bitmap) } }
        }
    }

    private fun saveFunDraft(index: Int) {
        val quiz = funQuiz ?: return
        val id = quiz.optInt("quiz_id")
        val answers = JSONArray()
        funAnswers.forEach { (qid, answer) -> answers.put(JSONObject().put("question_id", qid).put("answer", answer)) }
        val payload = JSONObject().put("answers", answers).put("current_question", index)
        val currentToken = token
        draftExecutor.execute {
            runCatching {
                val connection = (URL("$base/student/quiz/$id/draft").openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"; connectTimeout = 12000; readTimeout = 12000; doOutput = true
                    setRequestProperty("X-Student-Token", currentToken); setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                connection.inputStream.close(); connection.disconnect()
            }
        }
    }

    private fun renderFunQuestion(index: Int, similar: Boolean = false, similarData: JSONObject? = null) {
        val quiz = funQuiz ?: return
        similarQuestionOpen = similar
        val questions = quiz.optJSONArray("questions") ?: JSONArray()
        if (index >= questions.length()) { showFunFinish(); return }
        val question = questions.optJSONObject(index) ?: return
        funIndex = index
        heading(quiz.optString("title", "Fun Quiz"))
        val level = quiz.optString("fun_level", "starter").replaceFirstChar { it.uppercase() }
        val intro = card().apply { background = gradient() }
        intro.addView(text("✦  FUN QUIZ  /  $level", 12f, cyan, true))
        intro.addView(text(if (similar) "Try a similar question" else "Question ${index + 1} of ${questions.length()}", 22f, ink, true), margin(8, 4))
        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = questions.length(); this.progress = index + 1; progressTintList = android.content.res.ColorStateList.valueOf(cyan)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(stroke)
        }
        intro.addView(progress, margin(12, 0))
        val readingTitle = question.optString("reading_title")
        val readingText = question.optString("reading_text")
        if (!similar && (readingTitle.isNotBlank() || readingText.isNotBlank() || question.optString("reading_image_url").isNotBlank())) {
            val reading = card()
            reading.addView(text(readingTitle.ifBlank { "Read before you answer" }, 17f, violet, true))
            if (readingText.isNotBlank()) reading.addView(text(readingText, 15f, ink), margin(10, 0))
            remoteImage(question.optString("reading_image_url"), reading)
        }
        val stage = card()
        stage.addView(text(if (similar) similarData?.optString("similar_question") ?: "" else question.optString("question"), 21f, ink, true))
        if (!similar) remoteImage(question.optString("image_url"), stage)
        val options = if (similar) similarData?.optJSONArray("similar_options") ?: JSONArray() else question.optJSONArray("options") ?: JSONArray()
        val answer: () -> String
        if (question.optString("type") == "mcq") {
            val group = RadioGroup(this)
            for (j in 0 until options.length()) {
                val value = options.optString(j)
                group.addView(RadioButton(this).apply {
                    text = value; id = View.generateViewId(); setTextColor(ink); textSize = 16f
                    buttonTintList = android.content.res.ColorStateList.valueOf(cyan)
                    setPadding(dp(12), dp(12), dp(12), dp(12)); background = shape(panel, 12, stroke)
                    val saved = funAnswers[question.optInt("question_id")]
                    if (!similar && saved == value) isChecked = true
                }, margin(8, 0))
            }
            stage.addView(group, margin(14, 0))
            answer = { group.findViewById<RadioButton>(group.checkedRadioButtonId)?.text?.toString() ?: "" }
        } else {
            val input = EditText(this).apply {
                hint = "Type your answer"; setHintTextColor(muted); setTextColor(ink); textSize = 16f
                setSingleLine(true); setPadding(dp(16), dp(14), dp(16), dp(14)); background = shape(panel, 15, stroke)
                if (!similar) setText(funAnswers[question.optInt("question_id")] ?: "")
            }
            stage.addView(input, margin(14, 0))
            answer = { input.text.toString().trim() }
        }
        funFeedback = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        button("Check my answer") {
            val value = answer()
            if (value.isBlank()) { message("Choose or enter an answer first."); return@button }
            val qid = question.optInt("question_id")
            request("/student/fun-quiz/${quiz.optInt("quiz_id")}/question/$qid/check", "POST", JSONObject().put("answer", value).put("similar", similar)) { result ->
                if (!similar) { funAnswers[qid] = value; saveFunDraft(index) }
                val key = "$qid:$similar"
                if (result.optBoolean("correct")) {
                    funWrongAttempts.remove(key); speakFun(listOf("Good!", "Excellent!", "Brilliant!", "Well done!")[index % 4])
                    funFeedback?.removeAllViews()
                    funFeedback?.addView(text("✦  Correct!", 19f, cyan, true), margin(14, 2))
                    funFeedback?.let { funAction(it, if (index == questions.length() - 1) "Finish Fun Quiz" else "Next question", true) { renderFunQuestion(index + 1) } }
                } else {
                    val attempts = (funWrongAttempts[key] ?: 0) + 1; funWrongAttempts[key] = attempts
                    speakFun("Try again")
                    funFeedback?.removeAllViews()
                    funFeedback?.addView(text("Not quite yet. Try again or view the explanation.", 16f, Color.rgb(255, 197, 112)), margin(14, 4))
                    funFeedback?.let { area ->
                        funAction(area, "Try again") { renderFunQuestion(index, similar, similarData) }
                        funAction(area, "View correct answer") { revealFunAnswer(quiz, question, index, similar) }
                        if (attempts >= 2) funAction(area, "Continue") { renderFunQuestion(index + 1) }
                    }
                }
            }
        }
        body.addView(funFeedback)
        secondaryButton(if (funMuted) "Turn sound on" else "Turn sound off") {
            funMuted = !funMuted; renderFunQuestion(index, similar, similarData)
        }
        secondaryButton("Pause and continue later") { saveFunDraft(index); showQuizModules() }
        if (!similar) saveFunDraft(index)
    }

    private fun revealFunAnswer(quiz: JSONObject, question: JSONObject, index: Int, similar: Boolean) {
        val qid = question.optInt("question_id")
        val suffix = if (similar) "?similar=true" else ""
        request("/student/fun-quiz/${quiz.optInt("quiz_id")}/question/$qid/answer$suffix") { detail ->
            funFeedback?.removeAllViews()
            val area = funFeedback ?: return@request
            area.addView(text("Correct answer: ${detail.optString("correct_answer")}", 17f, cyan, true), margin(16, 4))
            area.addView(text(detail.optString("explanation"), 15f, ink), margin(4, 8))
            if (detail.optBoolean("has_similar")) funAction(area, "Try a similar question", true) { renderFunQuestion(index, true, detail) }
            funAction(area, "Continue") { renderFunQuestion(index + 1) }
        }
    }

    private fun showFunFinish() {
        val quiz = funQuiz ?: return
        heading("Fun Quiz complete")
        emptyState("✦", "Great work!", "You have reached the end of this level. Submit to save your result.")
        button("Submit my result") {
            AlertDialog.Builder(this).setTitle("Submit Fun Quiz?").setMessage("Your answers will be sent for marking.")
                .setNegativeButton("Keep reviewing", null).setPositiveButton("Submit") { _, _ ->
                    request("/quiz/${quiz.optInt("quiz_id")}/submit", "POST", submission((0 until (quiz.optJSONArray("questions")?.length() ?: 0)).mapNotNull { i ->
                        val qid = quiz.optJSONArray("questions")?.optJSONObject(i)?.optInt("question_id") ?: return@mapNotNull null
                        qid to { funAnswers[qid] ?: "" }
                    })) { result ->
                        heading("Result saved")
                        emptyState("✦", "${result.optString("auto_marked_score")} / ${result.optString("max_score")}", "Well done for completing this Fun Quiz level!")
                        button("Back to quizzes") { showQuizModules() }
                        val id = quiz.optInt("quiz_id")
                        draftExecutor.execute { runCatching { (URL("$base/student/quiz/$id/draft").openConnection() as HttpURLConnection).apply { requestMethod = "DELETE"; setRequestProperty("X-Student-Token", token) }.inputStream.close() } }
                    }
                }.show()
        }
        secondaryButton("Back to quizzes") { saveFunDraft(funIndex); showQuizModules() }
    }

    private fun showLessons() {
        enterRoute("lessons") { showLessons() }
        heading("Lessons")
        request("/student/lessons") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) emptyState("▶", "No lessons yet", "Lessons for your modules will appear here when they are available.")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                featureCard("▶", item.optString("title"), item.optString("module_code")) { showLesson(item.optInt("id")) }
            }
        }
    }

    private fun showLesson(id: Int) {
        enterRoute("lesson:$id") { showLesson(id) }
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
                for (j in 0 until options.length()) group.addView(RadioButton(this).apply {
                    text = options.optString(j); id = View.generateViewId(); setTextColor(ink); textSize = 15f
                    buttonTintList = android.content.res.ColorStateList.valueOf(cyan); setPadding(dp(4), dp(6), dp(4), dp(6))
                })
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
        enterRoute("messages") { showMessages() }
        heading("Chats")
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        actions.addView(text("Your conversations", 15f, muted), LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(text("✎", 26f, baseBlue, true).apply {
            gravity = Gravity.CENTER; contentDescription = "Start a new chat"; background = shape(cyan, 22)
            setOnClickListener { showContacts() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        body.addView(actions, margin(4, 14))
        val filter = field("Search chats")
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list, margin(10, 0))
        request("/student/messages?summary=true") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            fun render(query: String) {
                list.removeAllViews()
                var shown = 0
                for (i in 0 until items.length()) {
                    val item = items.optJSONObject(i) ?: continue
                    val name = item.optString("peer_name", "Conversation")
                    if (!name.contains(query, true) && !item.optString("content").contains(query, true)) continue
                    val type = item.optString("peer_type")
                    val id = item.optInt("peer_id")
                    val unread = item.optInt("unread_count")
                    val row = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                        setPadding(dp(4), dp(13), dp(4), dp(13)); setOnClickListener { showConversation(type, id, name) }
                    }
                    row.addView(chatAvatar(name), LinearLayout.LayoutParams(dp(52), dp(52)))
                    val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(13), 0, dp(8), 0) }
                    copy.addView(text(name, 17f, ink, unread > 0))
                    copy.addView(text((if (item.optBoolean("is_outgoing")) "You: " else "") + item.optString("content"), 14f, muted).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }, margin(5, 0))
                    row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
                    val meta = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
                    meta.addView(text(item.optString("created_at").take(10), 11f, if (unread > 0) cyan else muted))
                    if (unread > 0) meta.addView(text("$unread", 12f, baseBlue, true).apply { gravity = Gravity.CENTER; background = shape(cyan, 16) }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { topMargin = dp(7) })
                    row.addView(meta)
                    list.addView(row)
                    list.addView(View(this).apply { setBackgroundColor(stroke) }, LinearLayout.LayoutParams(-1, dp(1)))
                    shown++
                }
                if (shown == 0) list.addView(text(if (query.isBlank()) "No chats yet. Tap the pencil to start one." else "No chats match your search.", 15f, muted).apply { gravity = Gravity.CENTER; setPadding(dp(18), dp(60), dp(18), dp(24)) })
            }
            filter.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { render(s?.toString() ?: "") }
                override fun afterTextChanged(s: Editable?) {}
            })
            render("")
        }
    }

    private fun chatAvatar(name: String): TextView = text(name.trim().firstOrNull()?.uppercase() ?: "?", 21f, cyan, true).apply {
        gravity = Gravity.CENTER; background = shape(Color.rgb(26, 75, 83), 28)
    }

    private fun showContacts() {
        enterRoute("contacts") { showContacts() }
        heading("New chat")
        body.addView(text("SELECT A CONTACT", 12f, cyan, true), margin(8, 10))
        chatContact("Administrator", "Arounus support") { showConversation("admin", 0, "Administrator") }
        request("/student/message-lecturers") { data ->
            val tutors = data.optJSONArray("items") ?: JSONArray()
            body.addView(text("YOUR TUTORS", 12f, violet, true), margin(20, 4))
            if (tutors.length() == 0) line("No tutors are assigned to your modules yet.")
            for (i in 0 until tutors.length()) {
                val tutor = tutors.optJSONObject(i) ?: continue
                val name = tutor.optString("full_name", "Tutor")
                val modules = tutor.optJSONArray("module_codes") ?: JSONArray()
                val subjects = (0 until minOf(modules.length(), 3)).joinToString(" · ") { modules.optString(it) } +
                    if (modules.length() > 3) " · +${modules.length() - 3} more" else ""
                chatContact(name, subjects) { showConversation("lecturer", tutor.optInt("id"), name) }
            }
        }
    }

    private fun chatContact(name: String, detail: String, action: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(13), dp(4), dp(13)); setOnClickListener { action() } }
        row.addView(chatAvatar(name), LinearLayout.LayoutParams(dp(52), dp(52)))
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(13), 0, 0, 0) }
        copy.addView(text(name, 17f, ink, true))
        copy.addView(text(detail, 13f, muted).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }, margin(4, 0))
        row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
        body.addView(row)
        body.addView(View(this).apply { setBackgroundColor(stroke) }, LinearLayout.LayoutParams(-1, dp(1)))
    }

    private fun showConversation(type: String, id: Int, name: String) {
        enterRoute("conversation:$type:$id") { showConversation(type, id, name) }
        heading(name)
        menuIcon.text = "‹"
        menuIcon.contentDescription = "Back to chats"
        menuIcon.setOnClickListener { handleBack() }
        searchIcon.visibility = View.INVISIBLE
        bottomBar.visibility = View.GONE
        pageScroll.setBackgroundColor(Color.rgb(10, 25, 34))
        chatComposer.visibility = View.VISIBLE
        val content = EditText(this).apply {
            hint = "Message"; setHintTextColor(muted); setTextColor(ink); textSize = 16f
            minLines = 1; maxLines = 4; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setPadding(dp(16), dp(12), dp(16), dp(12)); background = shape(baseBlue, 24)
        }
        chatComposer.addView(content, LinearLayout.LayoutParams(0, -2, 1f))
        chatComposer.addView(text("➤", 22f, baseBlue, true).apply {
            gravity = Gravity.CENTER; contentDescription = "Send message"; background = shape(cyan, 24)
            setOnClickListener {
                val value = content.text.toString().trim()
                if (value.isEmpty()) return@setOnClickListener
                request("/student/messages", "POST", JSONObject().put("recipient_type", type).put("recipient_id", id).put("content", value)) {
                    showConversation(type, id, name)
                }
            }
        }, LinearLayout.LayoutParams(dp(48), dp(48)).apply { leftMargin = dp(8) })
        val threadView = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(threadView)
        request("/student/messages") { data ->
            val all = data.optJSONArray("items") ?: JSONArray()
            val messages = (0 until all.length()).mapNotNull { all.optJSONObject(it) }
                .filter { it.optString("peer_type") == type && it.optInt("peer_id") == id }.reversed()
            if (messages.isEmpty()) threadView.addView(text("Start your chat with $name", 14f, muted).apply {
                gravity = Gravity.CENTER; setPadding(dp(16), dp(65), dp(16), dp(16))
            })
            val readIds = JSONArray()
            var lastDay = ""
            for (item in messages) {
                val outgoing = item.optBoolean("is_outgoing")
                if (item.optBoolean("unread")) readIds.put(item.optInt("id"))
                val day = item.optString("created_at").take(10)
                if (day != lastDay) {
                    threadView.addView(text(day, 12f, muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(18), 0, dp(10)) })
                    lastDay = day
                }
                val bubble = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(10), dp(14), dp(8))
                    background = shape(if (outgoing) Color.rgb(20, 87, 79) else panel, 16)
                }
                bubble.addView(text(item.optString("content"), 16f, ink).apply {
                    maxWidth = minOf(dp(450), (resources.displayMetrics.widthPixels * 0.7f).toInt())
                })
                val time = item.optString("created_at").drop(11).take(5)
                bubble.addView(text(time + if (outgoing) (if (item.optString("read_at").isNotBlank()) "  ✓✓" else "  ✓") else "", 11f, muted).apply { gravity = Gravity.END }, margin(6, 0))
                threadView.addView(bubble, LinearLayout.LayoutParams(-2, -2).apply {
                    gravity = if (outgoing) Gravity.END else Gravity.START; topMargin = dp(7)
                })
            }
            pageScroll.post { pageScroll.fullScroll(View.FOCUS_DOWN) }
            if (readIds.length() > 0) thread { runCatching {
                (URL("$base/student/messages/read").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; doOutput = true; setRequestProperty("X-Student-Token", token); setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(JSONObject().put("message_ids", readIds).toString().toByteArray(Charsets.UTF_8)) }
                }.inputStream.close()
            } }
        }
    }

    private fun showDeletionRequest() {
        enterRoute("deletion") { showDeletionRequest() }
        heading("Request account deletion")
        line("You can ask Arounus to delete your student account and associated data. Some academic records may need to be retained for legal or operational reasons.")
        button("Write deletion request to administrator") {
            heading("Request account deletion")
            val content = field("Your request").apply { setText("Please delete my Arounus Student account and associated data. Please confirm what will be deleted and whether any records must be retained.") }
            button("Send deletion request") {
                request("/student/messages", "POST", JSONObject().put("recipient_type", "admin").put("recipient_id", 0).put("content", content.text.toString())) {
                    heading("Request sent")
                    line("Your request was sent to the Arounus administrator.")
                    button("Back to home") { showHome() }
                }
            }
            button("Cancel") { showHome() }
        }
        button("Back to home") { showHome() }
    }

    private fun showPosts() {
        enterRoute("posts") { showPosts() }
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
        enterRoute("results") { showResults(studentNumber) }
        heading("My results")
        request("/results/${Uri.encode(studentNumber)}") { data ->
            val items = data.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) emptyState("◎", "No results yet", "Your scores will appear here after you complete a quiz or lesson.")
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
