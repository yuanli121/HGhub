package com.hghub.integrated

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PluginDocumentPathsTest {
    @Test fun pathsStayInsideTheChosenTree() {
        assertEquals(listOf("插件 +.js"), PluginDocumentPaths.resolve(listOf("manifest.json"), "%E6%8F%92%E4%BB%B6%20+.js"))
        assertEquals(listOf("插件 +.js"), PluginDocumentPaths.resolve(listOf("manifest.json"), "插件 +.js"))
        assertEquals(listOf("sources", "one.js"), PluginDocumentPaths.resolve(listOf("manifest.json"), "./sources/one.js"))
        assertEquals(listOf("two.js"), PluginDocumentPaths.resolve(listOf("nested", "manifest.json"), "../two.js"))
        assertEquals(listOf("nested", "two.js"), PluginDocumentPaths.resolve(listOf("nested", "manifest.json"), "./other/../two.js"))
        for (reference in listOf("../outside.js", "%2e%2e/outside.js", "a/../../outside.js", "/outside.js", "//provider/file", "content://other/file", "file:///secret.js", "a%2fb.js", "%5csecret.js", "bad\\name.js", "bad%00.js", "bad%0a.js", "plugin.js?query=x", "plugin.js#fragment", "")) {
            assertThrows("reference=$reference", IllegalArgumentException::class.java) { PluginDocumentPaths.resolve(listOf("manifest.json"), reference) }
        }
    }
}
