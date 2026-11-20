package com.hghub.integrated

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import androidx.annotation.Keep
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

@Keep
@InvokeArg
class ResolveDocumentArgs {
    lateinit var base: String
    lateinit var reference: String
}

internal class GrantedPluginDocuments(private val resolver: ContentResolver) {
    private data class Location(val tree: Uri, val path: List<String>)
    private data class Child(val id: String, val name: String, val directory: Boolean)
    private val locations = ConcurrentHashMap<String, Location>()

    private fun children(tree: Uri, parent: String): List<Child> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        val result = mutableListOf<Child>()
        val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
        val cursor = resolver.query(uri, projection, null, null, null) ?: error("文件提供者未返回目录")
        cursor.use {
            while (it.moveToNext()) {
                require(result.size < 5000) { "目录条目过多，请选择更小的插件目录" }
                result.add(Child(it.getString(0), it.getString(1), it.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR))
            }
        }
        return result
    }

    fun select(tree: Uri): JSObject {
        val files = children(tree, DocumentsContract.getTreeDocumentId(tree))
            .filter { !it.directory && it.name.endsWith(".json", ignoreCase = true) }.sortedBy { it.name }
        require(files.isNotEmpty()) { "该目录没有 JSON 插件列表，请选择列表所在目录" }
        require(files.size <= 500) { "目录中的列表超过 500 个" }
        val result = JSArray()
        locations.clear()
        for (file in files) {
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, file.id).toString()
            locations[uri] = Location(tree, listOf(file.name))
            result.put(JSObject().put("name", file.name).put("location", uri))
        }
        return JSObject().put("files", result)
    }

    fun resolve(base: String, reference: String): String {
        val location = locations[base] ?: throw SecurityException("请先选择列表所在目录并授权")
        val path = PluginDocumentPaths.resolve(location.path, reference)
        var parent = DocumentsContract.getTreeDocumentId(location.tree)
        for ((index, name) in path.withIndex()) {
            val matches = children(location.tree, parent).filter { it.name == name }
            require(matches.size == 1) { "目录中找不到唯一的文件：$name" }
            val child = matches.single()
            require(child.directory == (index < path.lastIndex)) { "列表条目的文件类型不匹配：$name" }
            parent = child.id
        }
        val uri = DocumentsContract.buildDocumentUriUsingTree(location.tree, parent).toString()
        return uri
    }
}

@Keep
@TauriPlugin
class PluginDocumentsPlugin(private val activity: Activity) : Plugin(activity) {
    private val documents = GrantedPluginDocuments(activity.contentResolver)
    private val reads = Executors.newSingleThreadExecutor()

    override fun onDestroy(activity: AppCompatActivity) {
        reads.shutdown()
    }

    @Command
    fun pickDirectory(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        startActivityForResult(invoke, intent, "directorySelected")
    }

    @ActivityCallback
    fun directorySelected(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(JSObject().put("files", JSArray()))
            return
        }
        val tree = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || tree == null) {
            invoke.reject("未取得目录授权", "UNSUPPORTED")
            return
        }
        reads.execute {
            try { invoke.resolve(documents.select(tree)) }
            catch (error: Exception) { invoke.reject(error.message ?: "无法读取所选目录", "INVALID_ARGUMENT") }
        }
    }

    @Command
    fun resolveEntry(invoke: Invoke) {
        val args = invoke.parseArgs(ResolveDocumentArgs::class.java)
        reads.execute {
            try { invoke.resolve(JSObject().put("location", documents.resolve(args.base, args.reference))) }
            catch (error: SecurityException) { invoke.reject(error.message, "UNSUPPORTED") }
            catch (error: Exception) { invoke.reject(error.message ?: "无法读取目录条目", "INVALID_ARGUMENT") }
        }
    }
}
