package com.hghub.integrated

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class LoginProfileIsolationTest {
    private val runner = InstrumentationRegistry.getInstrumentation()
    private fun <T> ui(action: () -> T): T {
        val value = java.util.concurrent.FutureTask(action)
        runner.runOnMainSync(value)
        return value.get()
    }

    @Test fun reportsFeaturesAndDoesNotOpenASharedViewWithoutProfiles() {
        val multiProfile = ui { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }
        val cookieInfo = ui { WebViewFeature.isFeatureSupported(WebViewFeature.GET_COOKIE_INFO) }
        android.util.Log.i("HppProfileTest", "WebView MULTI_PROFILE=$multiProfile GET_COOKIE_INFO=$cookieInfo")
        if (!multiProfile) assertNull(ui { LoginWebViewProfile.open(runner.targetContext) })
    }

    @Test fun sameSiteIsIsolatedFromTwoSessionsAndTheDefaultProfile() {
        assumeTrue(ui { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) })
        val context = runner.targetContext
        val origin = "https://${UUID.randomUUID()}.example.invalid/"
        val main = ui { WebView(context) }
        val start = android.os.SystemClock.elapsedRealtime()
        val a = ui { LoginWebViewProfile.open(context)!! }
        val first = android.os.SystemClock.elapsedRealtime()
        val b = ui { LoginWebViewProfile.open(context)!! }
        android.util.Log.i("HppProfileTest", "profile creation after default WebView: ${first-start} ms, ${android.os.SystemClock.elapsedRealtime()-first} ms")
        fun load(view: WebView) {
            val ready = CompletableFuture<Unit>()
            ui {
                view.settings.javaScriptEnabled = true
                view.settings.domStorageEnabled = true
                view.settings.blockNetworkLoads = true
                view.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) { ready.complete(Unit) }
                }
                view.loadDataWithBaseURL(origin, "<title>fixture</title>", "text/html", "utf-8", null)
            }
            ready.get(15, TimeUnit.SECONDS)
        }
        fun eval(view: WebView, js: String): String {
            val result = CompletableFuture<String>()
            ui { view.evaluateJavascript(js) { result.complete(it) } }
            return result.get(10, TimeUnit.SECONDS)
        }
        try {
            val views = listOf(main, a.view, b.view)
            val read = "[document.cookie,localStorage.getItem('marker')]"
            for ((i, view) in views.withIndex()) {
                load(view)
                assertEquals("[\"\",null]", eval(view, read))
                eval(view, "document.cookie='marker=$i; Secure; SameSite=Strict'; localStorage.setItem('marker','$i')")
            }
            for ((i, view) in views.withIndex()) {
                assertEquals("[\"marker=$i\",\"$i\"]", eval(view, read))
                assertEquals("marker=$i", ui { WebViewCompat.getProfile(view).cookieManager.getCookie(origin) })
            }
        } finally {
            ui { a.close(); b.close(); main.destroy() }
        }
    }
}
