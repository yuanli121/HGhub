package com.hghub.integrated

import android.app.Activity
import android.graphics.Bitmap
import android.net.Uri
import android.os.*
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.annotation.RequiresApi
import androidx.webkit.CookieManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

@RequiresApi(28)
class LoginWebViewActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var address: TextView
    private lateinit var start: Uri
    private var prefix: Uri? = null
    private lateinit var required: List<String>
    private lateinit var session: String
    private lateinit var owner: IBinder
    private val ownerLost = IBinder.DeathRecipient { runOnUiThread { finish() } }
    private val handler = Handler(Looper.getMainLooper())
    private var navigations = 0
    private var closing = false

    @Suppress("DEPRECATION")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        session = UUID.fromString(intent.getStringExtra("session")).toString()
        owner = intent.extras!!.getBinder("owner")!!
        try { owner.linkToDeath(ownerLost, 0) } catch (_: RemoteException) { finish(); return }
        val control = Messenger(Handler(mainLooper) { end(RESULT_CANCELED); true })
        intent.getParcelableExtra<ResultReceiver>("ready")!!.send(0, Bundle().apply { putBinder("control", control.binder) })
        // The previous session has already received finish() but Android may not have retired
        // its process yet. Never reuse an initialized WebView data directory.
        if (processSession != null) { finish(); return }
        processSession = session
        // After an abrupt app exit these private directories may outlive their owner.
        // This named process is cold, so no earlier login profile is still in use.
        dataDir.listFiles { file -> profileName.matches(file.name) }?.forEach { it.deleteRecursively() }
        cacheDir.listFiles { file -> snapshotName.matches(file.name) }?.forEach { it.delete() }
        WebView.setDataDirectorySuffix("hpp-login-$session")
        val request = JSONObject(intent.getStringExtra("request")!!)
        start = Uri.parse(request.getString("url"))
        val conditions = request.getJSONObject("doneWhen")
        prefix = if (conditions.isNull("urlPrefix")) null else Uri.parse(conditions.getString("urlPrefix"))
        val names = conditions.getJSONArray("cookieNames")
        required = List(names.length()) { names.getString(it) }
        title = if (request.isNull("title")) "网页登录" else request.getString("title")
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; fitsSystemWindows = true }
        val bar = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        address = TextView(this).apply { setPadding(20, 8, 8, 8); text = origin(start); maxLines = 2 }
        bar.addView(address, LinearLayout.LayoutParams(0, -2, 1f))
        bar.addView(Button(this).apply { text = "关闭"; setOnClickListener { finish() } })
        root.addView(bar)
        web = WebView(this)
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false
            allowContentAccess = false; mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true) }
        web.importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !allowed(request.url)
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                val page = Uri.parse(url)
                if (!allowed(page)) { end(RESULT_FIRST_USER); return }
                navigations++
                address.text = origin(page)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) end(RESULT_FIRST_USER)
            }
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        web.loadUrl(start.toString())
        handler.postDelayed(poll, 350)
    }

    private fun allowed(uri: Uri) = uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null
    private fun origin(uri: Uri): String = "https://${uri.host?.lowercase(Locale.ROOT)}" + if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"

    private val poll = object : Runnable {
        override fun run() {
            if (closing || isFinishing) return
            try {
                val raw = web.url
                if (raw != null && inspect(Uri.parse(raw))) return
            } catch (error: Exception) {
                end(RESULT_FIRST_USER); return
            }
            handler.postDelayed(this, 350)
        }
    }
    private fun inspect(page: Uri): Boolean {
        if (!allowed(page) || origin(page) != origin(start)) return false
        val path = page.encodedPath.orEmpty().ifEmpty { "/" }
        val match = prefix?.encodedPath.orEmpty().ifEmpty { "/" }
        if (path != match && !path.startsWith(match.trimEnd('/') + "/")) return false
        val lines = CookieManagerCompat.getCookieInfo(CookieManager.getInstance(), page.toString())
            .filterNot { line -> line.split(';').drop(1).any { it.trim().equals("partitioned", ignoreCase = true) } }
        if (lines.isEmpty() && navigations < 2 && page == start) return false
        if (!required.all { name -> lines.any { it.substringBefore('=') == name } }) return false
        val cookies = JSONArray()
        for (line in lines) cookies.put(cookieSnapshot(line, page.host!!))
        // Large cookie jars exceed the Activity result Binder limit. Pass only the result code
        // through Android, with the payload in an app-private, per-session file.
        File(cacheDir, "hpp-login-$session.json").writeText(JSONObject().put("finalUrl", page.toString()).put("cookies", cookies).toString())
        end(RESULT_OK)
        return true
    }
    private fun end(code: Int) {
        if (closing) return
        closing = true
        setResult(code)
        finish()
    }
    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) end(RESULT_CANCELED)
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        if (::owner.isInitialized && owner.isBinderAlive) owner.unlinkToDeath(ownerLost, 0)
        super.onDestroy()
        Process.killProcess(Process.myPid())
    }
    companion object {
        private var processSession: String? = null
        private val profileName = Regex("app_webview_hpp-login-[0-9a-f-]{36}")
        private val snapshotName = Regex("hpp-login-[0-9a-f-]{36}\\.json")
        internal fun cookieSnapshot(line: String, host: String): JSONObject {
            val parts = line.split(';')
            val fields = parts.drop(1).associate {
                it.substringBefore('=').trim().lowercase(Locale.ROOT) to it.substringAfter('=', "").trim()
            }
            val domain = fields["domain"] ?: host
            val cookie = JSONObject().put("name", parts.first().substringBefore('='))
                .put("value", parts.first().substringAfter('='))
                .put("domain", domain.removePrefix(".")).put("hostOnly", !domain.startsWith('.'))
                .put("path", fields.getValue("path")).put("secure", fields.containsKey("secure"))
                .put("httpOnly", fields.containsKey("httponly"))
            fields["expires"]?.let { expires ->
                val date = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", Locale.US).parse(expires)
                cookie.put("expiresAt", requireNotNull(date).time)
            }
            return cookie
        }
    }
}
