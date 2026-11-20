package com.hghub.integrated

import android.content.Context
import android.view.ViewGroup
import android.webkit.WebView
import androidx.annotation.UiThread
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.UUID

/** One browsing session, never the application WebView or a reusable plugin profile. */
@UiThread
internal class LoginWebViewProfile private constructor(val view: WebView) {
    fun close() {
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        // Chromium may keep the profile in use after destroy(). Never reuse its name.
    }

    companion object {
        private const val prefix = "hpp-login-"

        private var swept = false

        fun open(context: Context): LoginWebViewProfile? {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return null
            if (!swept) {
                removeAbandonedProfiles()
                swept = true
            }
            val name = prefix + UUID.randomUUID()
            val view = WebView(context)
            WebViewCompat.setProfile(view, name)
            return LoginWebViewProfile(view)
        }

        /** Call once on cold start, before any sessions exist, never during another login. */
        private fun removeAbandonedProfiles() {
            val store = ProfileStore.getInstance()
            store.allProfileNames.filter { it.startsWith(prefix) }.forEach { store.deleteProfile(it) }
        }
    }
}
