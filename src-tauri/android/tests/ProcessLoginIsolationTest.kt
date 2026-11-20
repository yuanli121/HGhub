package com.hghub.integrated

import android.content.*
import android.os.*
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit.SECONDS

@SdkSuppress(minSdkVersion = 28)
class ProcessLoginIsolationTest {
    private val runner = InstrumentationRegistry.getInstrumentation()
    private val context = runner.targetContext

    private fun login(site: UUID): Bundle {
        val response = CompletableFuture<Bundle>()
        val exited = CompletableFuture<Unit>()
        val inbox = Messenger(Handler(Looper.getMainLooper()) { response.complete(it.data); true })
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                binder.linkToDeath({ exited.complete(Unit) }, 0)
                Messenger(binder).send(Message.obtain().apply {
                    replyTo = inbox
                    data = Bundle().apply { putString("site", site.toString()) }
                })
            }
            override fun onServiceDisconnected(name: ComponentName) {}
        }
        val intent = Intent().setClassName(context, "com.hghub.integrated.ProcessIsolationFixture")
        val start = SystemClock.elapsedRealtime()
        assertTrue(context.bindService(intent, connection, Context.BIND_AUTO_CREATE))
        val result = try {
            response.get(20, SECONDS).also {
                val elapsed = SystemClock.elapsedRealtime() - start
                android.util.Log.i("HppProfileTest", "Cold process to offline marker round trip: $elapsed ms")
            }
        } finally { context.unbindService(connection) }
        exited.get(10, SECONDS)
        return result
    }

    @Test fun sameSiteSurvivesTwoFreshLoginProcesses() {
        val site = UUID.randomUUID()
        val ready = CompletableFuture<Unit>()
        lateinit var main: WebView
        fun eval(js: String): String {
            val done = CompletableFuture<String>()
            runner.runOnMainSync { main.evaluateJavascript(js) { done.complete(it) } }
            return done.get(10, SECONDS)
        }
        runner.runOnMainSync {
            main = WebView(context)
            main.settings.blockNetworkLoads = true
            main.settings.javaScriptEnabled = true
            main.settings.domStorageEnabled = true
            main.webViewClient = object : WebViewClient() {
                override fun onPageFinished(web: WebView, url: String) { ready.complete(Unit) }
            }
            main.loadDataWithBaseURL("https://$site.example.invalid/", "<title>fixture</title>", "text/html", "utf-8", null)
        }
        try {
            ready.get(15, SECONDS)
            val read = "document.cookie === 'marker=host' && localStorage.getItem('marker') === 'host'"
            assertEquals("true", eval("document.cookie='marker=host; Secure'; localStorage.setItem('marker','host'); $read"))
            val sessions = mutableSetOf<String>()
            repeat(2) {
                val result = login(site)
                val suffix = requireNotNull(result.getString("suffix"))
                assertTrue(suffix.matches(Regex("hpp-fixture-[0-9a-f-]{36}")))
                val directory = File(context.dataDir, "app_webview_$suffix")
                try {
                    assertTrue(directory.isDirectory)
                    assertTrue(sessions.add(suffix))
                    assertNotEquals(Process.myPid(), result.getInt("pid"))
                    assertTrue("Login could see earlier data or could not write", result.getBoolean("isolated"))
                    assertEquals("true", eval(read))
                } finally { assertTrue("Remove closed fixture profile", directory.deleteRecursively()) }
            }
        } finally {
            try { eval("localStorage.removeItem('marker'); document.cookie='marker=; Max-Age=0; Secure'") }
            finally { runner.runOnMainSync { main.destroy() } }
        }
    }
}
