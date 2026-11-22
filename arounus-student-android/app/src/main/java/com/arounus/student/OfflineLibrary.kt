package com.arounus.student

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Private, per-student offline library. Only an online sign-in can create an offline account. */
class OfflineLibrary(context: Context) : SQLiteOpenHelper(context, "student_offline.db", null, 2) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE accounts (student_number TEXT PRIMARY KEY, full_name TEXT NOT NULL, login_identifier TEXT NOT NULL, salt BLOB NOT NULL, verifier BLOB NOT NULL)")
        db.execSQL("CREATE TABLE content (student_number TEXT NOT NULL, path TEXT NOT NULL, module_code TEXT NOT NULL, body BLOB NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY(student_number, path))")
        db.execSQL("CREATE INDEX content_module ON content(student_number, module_code)")
        db.execSQL("CREATE TABLE pending (id INTEGER PRIMARY KEY AUTOINCREMENT, student_number TEXT NOT NULL, path TEXT NOT NULL, body BLOB NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("ALTER TABLE accounts ADD COLUMN login_identifier TEXT NOT NULL DEFAULT ''")
    }

    private fun verifier(password: CharArray, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(password, salt, 180_000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded } finally { spec.clearPassword() }
    }

    fun saveAccount(number: String, name: String, identifier: String, password: CharArray) {
        if (number.isBlank() || password.isEmpty()) return
        val salt = ByteArray(24).also { SecureRandom().nextBytes(it) }
        val values = ContentValues().apply {
            put("student_number", number); put("full_name", name); put("login_identifier", identifier); put("salt", salt); put("verifier", verifier(password, salt))
        }
        writableDatabase.insertWithOnConflict("accounts", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun authenticate(identifier: String, password: CharArray): Pair<String, String>? {
        readableDatabase.rawQuery("SELECT student_number,full_name,salt,verifier FROM accounts WHERE lower(student_number)=lower(?) OR lower(login_identifier)=lower(?)", arrayOf(identifier.trim(), identifier.trim())).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val expected = cursor.getBlob(3)
            val candidate = verifier(password, cursor.getBlob(2))
            if (!java.security.MessageDigest.isEqual(expected, candidate)) return null
            return cursor.getString(0) to cursor.getString(1)
        }
    }

    private fun zipped(value: String): ByteArray = ByteArrayOutputStream().also { output ->
        GZIPOutputStream(output).use { it.write(value.toByteArray(Charsets.UTF_8)) }
    }.toByteArray()

    private fun unzipped(value: ByteArray): String = GZIPInputStream(ByteArrayInputStream(value)).use {
        it.readBytes().toString(Charsets.UTF_8)
    }

    fun put(number: String, path: String, module: String, json: String) {
        if (number.isBlank() || json.length > 3_000_000) return
        val values = ContentValues().apply {
            put("student_number", number); put("path", path); put("module_code", module)
            put("body", zipped(json)); put("saved_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("content", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun get(number: String, path: String): String? {
        readableDatabase.rawQuery("SELECT body FROM content WHERE student_number=? AND path=?", arrayOf(number, path)).use { cursor ->
            return if (cursor.moveToFirst()) runCatching { unzipped(cursor.getBlob(0)) }.getOrNull() else null
        }
    }

    fun keepOnlyModule(number: String, module: String) {
        writableDatabase.delete("content", "student_number=? AND module_code<>? AND module_code<>''", arrayOf(number, module))
    }

    fun queue(number: String, path: String, json: String) {
        val values = ContentValues().apply { put("student_number", number); put("path", path); put("body", zipped(json)) }
        writableDatabase.insert("pending", null, values)
    }

    fun pending(number: String): List<Triple<Long, String, String>> {
        val rows = mutableListOf<Triple<Long, String, String>>()
        readableDatabase.rawQuery("SELECT id,path,body FROM pending WHERE student_number=? ORDER BY id", arrayOf(number)).use { cursor ->
            while (cursor.moveToNext()) rows.add(Triple(cursor.getLong(0), cursor.getString(1), unzipped(cursor.getBlob(2))))
        }
        return rows
    }

    fun removePending(id: Long) { writableDatabase.delete("pending", "id=?", arrayOf(id.toString())) }
}
