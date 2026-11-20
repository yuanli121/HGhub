import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Persist the release fix outside gen/: safe to rerun after every android init.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const main = join(root, "src-tauri/gen/android/app/src/main");
const manifest = join(main, "AndroidManifest.xml");
if (existsSync(manifest)) {
  const java = join(main, "java/com/hghub/integrated");
  mkdirSync(java, { recursive: true });
  copyFileSync(join(root, "src-tauri/android/OrientationPlugin.kt"), join(java, "OrientationPlugin.kt"));
  copyFileSync(join(root, "src-tauri/android/LoginWebViewProfile.kt"), join(java, "LoginWebViewProfile.kt"));
  for (const name of ["LoginWebViewPlugin.kt", "LoginWebViewActivity.kt", "PluginDocumentsPlugin.kt", "PluginDocumentPaths.kt"]) {
    copyFileSync(join(root, "src-tauri/android", name), join(java, name));
  }
  const test = join(main, "../androidTest");
  const testJava = join(test, "java/com/hghub/integrated");
  mkdirSync(testJava, { recursive: true });
  copyFileSync(join(root, "src-tauri/android/tests/LoginProfileIsolationTest.kt"), join(testJava, "LoginProfileIsolationTest.kt"));
  copyFileSync(join(root, "src-tauri/android/tests/AndroidManifest.xml"), join(test, "AndroidManifest.xml"));
  copyFileSync(join(root, "src-tauri/android/tests/ProcessLoginIsolationTest.kt"), join(testJava, "ProcessLoginIsolationTest.kt"));
  const unit = join(main, "../test/java/com/hghub/integrated");
  mkdirSync(unit, { recursive: true });
  copyFileSync(join(root, "src-tauri/android/tests/PluginDocumentPathsTest.kt"), join(unit, "PluginDocumentPathsTest.kt"));
  const debug = join(main, "../debug");
  const debugJava = join(debug, "java/com/hghub/integrated");
  mkdirSync(debugJava, { recursive: true });
  copyFileSync(join(root, "src-tauri/android/tests/process/ProcessIsolationFixture.kt"), join(debugJava, "ProcessIsolationFixture.kt"));
  copyFileSync(join(root, "src-tauri/android/tests/process/AndroidManifest.xml"), join(debug, "AndroidManifest.xml"));
  mkdirSync(join(main, "res/xml"), { recursive: true });
  copyFileSync(join(root, "src-tauri/android/network_security_config.xml"), join(main, "res/xml/network_security_config.xml"));
  let xml = readFileSync(manifest, "utf8");
  if (/android:networkSecurityConfig=/.test(xml)) xml = xml.replace(/android:networkSecurityConfig="[^"]*"/, 'android:networkSecurityConfig="@xml/network_security_config"');
  else xml = xml.replace(/<application\b/, '<application android:networkSecurityConfig="@xml/network_security_config"');
  if (!xml.includes('android:name=".LoginWebViewActivity"')) {
    xml = xml.replace("</application>", '    <activity android:name=".LoginWebViewActivity" android:exported="false" android:process=":hpp_login" android:configChanges="orientation|keyboardHidden|keyboard|screenSize|screenLayout|smallestScreenSize|uiMode" android:theme="@android:style/Theme.Material.Light.NoActionBar" />\n    </application>');
  }
  writeFileSync(manifest, xml);
  console.log("[android] 已同步应用内媒体回环网络配置");
}
