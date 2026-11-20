package com.hghub.integrated

import android.app.Application
import android.app.Service
import android.content.Intent
import android.os.*
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi
import java.util.UUID

/** Debug-only, offline peer for ProcessLoginIsolationTest. Each binding runs in a fresh process. */
@RequiresApi(28)
class ProcessIsolationFixture : Service() {
    private lateinit var view: WebView
    private val suffix = "hpp-fixture-" + UUID.randomUUID()

    override fun onCreate() {
        super.onCreate()
        check(Application.getProcessName() == "$packageName:hpp_isolation_test")
        WebView.setDataDirectorySuffix(suffix)
        view = WebView(this)
        view.settings.blockNetworkLoads = true
        view.settings.domStorageEnabled = true
        view.settings.javaScriptEnabled = true
    }

    override fun onBind(intent: Intent): IBinder = Messenger(Handler(mainLooper) { request ->
        val reply = request.replyTo
        val origin = "https://${UUID.fromString(request.data.getString("site"))}.example.invalid/"
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(web: WebView, url: String) {
                web.evaluateJavascript("""(() => {
                    const clean = document.cookie === '' && localStorage.getItem('marker') === null;
                    document.cookie = 'marker=login; Secure'; localStorage.setItem('marker','login');
                    return clean && document.cookie === 'marker=login' && localStorage.getItem('marker') === 'login';
                })()""") { result ->
                    // Commit the cookie to disk so the second run also exercises persisted state.
                    android.webkit.CookieManager.getInstance().flush()
                    reply.send(Message.obtain().apply { data = Bundle().apply {
                        putBoolean("isolated", result == "true")
                        putString("suffix", suffix)
                        putInt("pid", Process.myPid())
                    } })
                }
            }
        }
        view.loadDataWithBaseURL(origin, "<title>fixture</title>", "text/html", "utf-8", null)
        true
    }).binder

    override fun onDestroy() {
        view.destroy()
        super.onDestroy()
        Process.killProcess(Process.myPid())
    }
}
