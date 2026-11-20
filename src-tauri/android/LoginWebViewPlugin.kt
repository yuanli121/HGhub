package com.hghub.integrated

import android.app.Activity
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.os.ResultReceiver
import android.os.Bundle
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.annotation.Keep
import androidx.webkit.WebViewFeature
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.UUID

@Keep
@TauriPlugin
class LoginWebViewPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Session(val id: String, val invoke: Invoke, val owner: Binder = Binder(),
        var control: Messenger? = null, var cancelled: Boolean = false, var exited: Boolean = false,
        var result: ActivityResult? = null)
    private val main = Handler(activity.mainLooper)
    private var active: Session? = null

    @Command fun supported(invoke: Invoke) {
        invoke.resolveObject(Build.VERSION.SDK_INT >= 28 && WebViewFeature.isFeatureSupported(WebViewFeature.GET_COOKIE_INFO))
    }

    @Command fun openLogin(invoke: Invoke) {
        val args = invoke.getArgs()
        val id = UUID.fromString(args.getString("session")).toString()
        val request = args.getJSONObject("request").toString()
        activity.runOnUiThread {
            if (active != null) {
                invoke.reject("请先关闭当前网页登录窗口", "RATE_LIMITED"); return@runOnUiThread
            }
            // The login Activity runs under our UID in its own process. The host retains this
            // binder so the window can close if the application process dies during login.
            val session = Session(id, invoke)
            val observer = object : ResultReceiver(main) {
                override fun onReceiveResult(resultCode: Int, data: Bundle?) {
                    if (active !== session) return
                    val binder = requireNotNull(data?.getBinder("control"))
                    session.control = Messenger(binder)
                    try {
                        binder.linkToDeath({ main.post { session.exited = true; complete(session) } }, 0)
                    } catch (_: RemoteException) { session.exited = true; complete(session); return }
                    if (session.cancelled) close(session)
                }
            }
            val extras = Bundle().apply { putBinder("owner", session.owner) }
            val intent = Intent(activity, LoginWebViewActivity::class.java).putExtras(extras)
                .putExtra("session", id).putExtra("request", request).putExtra("ready", observer)
            active = session
            try { startActivityForResult(invoke, intent, "onLoginResult") }
            catch (error: RuntimeException) { active = null; invoke.reject("无法打开登录窗口", error) }
        }
    }

    @Command fun cancelLogin(invoke: Invoke) {
        val id = invoke.getArgs().getString("session")
        activity.runOnUiThread {
            active?.takeIf { it.id == id }?.let {
                it.cancelled = true
                close(it)
            }
            invoke.resolve()
        }
    }

    @Keep @ActivityCallback fun onLoginResult(invoke: Invoke, result: ActivityResult) {
        val session = active ?: return invoke.reject("登录窗口已关闭", "CANCELLED")
        session.result = result
        complete(session)
    }

    private fun close(session: Session) {
        try { session.control?.send(Message.obtain()) }
        catch (_: RemoteException) { session.exited = true; complete(session) }
    }

    private fun complete(session: Session) {
        val result = session.result ?: return
        // A second Activity must start in a cold process before setDataDirectorySuffix().
        if (active !== session || session.control != null && !session.exited) return
        active = null
        val invoke = session.invoke
        val snapshot = File(activity.cacheDir, "hpp-login-${session.id}.json")
        try {
            if (session.cancelled || result.resultCode == Activity.RESULT_CANCELED) {
                invoke.reject("已关闭登录窗口", "CANCELLED")
            } else if (result.resultCode != Activity.RESULT_OK) {
                invoke.reject("加载登录页失败", "NETWORK")
            } else {
                invoke.resolve(JSObject(snapshot.readText()))
            }
        } catch (error: Exception) {
            invoke.reject("无法读取登录结果", error)
        } finally {
            snapshot.delete()
            val profile = File(activity.dataDir, "app_webview_hpp-login-${session.id}")
            kotlin.concurrent.thread(name = "login-profile-cleanup") {
                if (!profile.deleteRecursively()) Log.w("HGhub", "网页登录目录等待下次清理")
            }
        }
    }
}
