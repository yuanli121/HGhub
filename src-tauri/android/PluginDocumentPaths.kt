package com.hghub.integrated

import java.net.URI
import java.net.URISyntaxException

internal object PluginDocumentPaths {
    fun resolve(base: List<String>, reference: String): List<String> {
        require(reference.isNotEmpty() && reference.none { it < ' ' || it == '\u007f' }) { "列表条目路径无效" }
        val uri = try { URI(reference.replace(" ", "%20")) }
            catch (error: URISyntaxException) { throw IllegalArgumentException("列表条目路径无效", error) }
        require(!uri.isAbsolute && uri.rawAuthority == null && uri.rawQuery == null && uri.rawFragment == null) { "目录列表条目必须为相对文件路径" }
        require(!uri.rawPath.startsWith('/') && !Regex("(?i)%2f|%5c").containsMatchIn(uri.rawPath)) { "列表条目不能使用绝对路径或编码分隔符" }
        val path = uri.path
        require(path.none { it == '\\' || it < ' ' || it == '\u007f' }) { "列表条目路径含非法字符" }
        val result = base.dropLast(1).toMutableList()
        for (segment in path.split('/')) {
            when (segment) {
                "", "." -> Unit
                ".." -> {
                    require(result.isNotEmpty()) { "列表条目越出了获授权目录" }
                    result.removeAt(result.lastIndex)
                }
                else -> result.add(segment)
            }
        }
        require(result.isNotEmpty()) { "列表条目必须指向文件" }
        return result
    }
}
