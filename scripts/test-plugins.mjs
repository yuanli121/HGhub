import { openRecommendations, installedTab, importTab, playerPanel, chooseEpisode } from "./frontend-navigation.mjs";
// Windows integration: real Rust/QuickJS + real React + Edge media decoding.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { chromium } from "playwright-core";
import { createServer as createViteServer } from "vite";
import { testPluginSocial } from "./test-plugin-social.mjs";
import { testPluginExtraContent } from "./test-plugin-extra-content.mjs";
import { testPluginFeed } from "./test-plugin-feed.mjs";
import { testPluginSourceSwitch } from "./test-plugin-source-switch.mjs";
import { testPluginBrowsing } from "./test-plugin-browsing.mjs";
import { testResolverPreferences } from "./test-plugin-resolver-preferences.mjs";
import { testWatchExperience } from "./test-watch-experience.mjs";
import { testFrontend } from "./test-frontend.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "plugins", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const data = await mkdtemp(join(tmpdir(), "hghub-hpp-"));
const report = { platform: process.platform, transport: "Windows Rust QuickJS host; Edge browser; stdio replaces Tauri IPC only", passed: [], external: [] };
let host, browser, page, vite, server;
try {
  const pending = new Map(); let serial = 0;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  host = spawn(join(root, "src-tauri/crates/hpp/target/debug/examples", process.platform === "win32" ? "dev_host.exe" : "dev_host"), [data, "--relaxed"], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  host.on("error", readyReject); host.stderr.on("data", chunk => process.stderr.write(chunk));
  createInterface({ input: host.stdout }).on("line", line => {
    const message = JSON.parse(line);
    if (message.ready) readyResolve(); else { const entry = pending.get(message.id); if (entry) { pending.delete(message.id); entry.resolve(message); } }
  });
  host.on("exit", code => { for (const p of pending.values()) p.reject(new Error(`Host exited: ${code}`)); pending.clear(); });
  await ready;
  const dispatch = args => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); host.stdin.write(JSON.stringify({ id, ...args }) + "\n"); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined), args: ["--autoplay-policy=no-user-gesture-required"] });
  page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  // Generate original H.264 media locally; no downloaded content or FFmpeg needed.
  await page.goto("about:blank");
  const recording = await page.evaluate(async () => {
    const mime = ["video/mp4;codecs=avc1.42001E", "video/mp4;codecs=avc1.42E01E", "video/mp4"].find(x => MediaRecorder.isTypeSupported(x));
    if (!mime) throw new Error("Browser cannot record an H.264 MP4 fixture");
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d"), stream = canvas.captureStream(20), recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 200000 });
    const chunks = [], finished = new Promise(resolve => { recorder.onstop = resolve; }); recorder.ondataavailable = event => chunks.push(event.data);
    recorder.start(); const started = performance.now();
    await new Promise(resolve => { const draw = () => { const elapsed = performance.now() - started; context.fillStyle = "#19334a"; context.fillRect(0, 0, 320, 180); context.fillStyle = "#60cdff"; context.fillRect((elapsed / 15) % 280, 120, 40, 20); context.font = "24px sans-serif"; context.fillText("HGhub / local fixture", 24, 75); if (elapsed < 6000) requestAnimationFrame(draw); else resolve(); }; draw(); });
    recorder.stop(); await finished; stream.getTracks().forEach(t => t.stop());
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
  });
  const clip = Buffer.from(recording, "base64"); await writeFile(join(output, "clip.mp4"), clip);
  const boxes = []; for (let offset = 0; offset + 8 <= clip.length;) { const size = clip.readUInt32BE(offset); assert(size >= 8 && offset + size <= clip.length, "Expected bounded MP4 boxes"); boxes.push({ offset, size, type: clip.toString("ascii", offset + 4, offset + 8) }); offset += size; }
  const firstFragment = boxes.find(b => b.type === "moof"); assert(firstFragment, "Expected fragmented MP4");
  const initialization = clip.subarray(0, firstFragment.offset), fragment = clip.subarray(firstFragment.offset);
  const upstream = [], distributionRequests = [];
  const distributionFiles = new Map();
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/distribution/")) {
      distributionRequests.push({ path: url.pathname, headers: req.headers });
      if (url.pathname === "/distribution/start") { res.writeHead(302, { Location: "/distribution/set/list" }); return res.end(); }
      const content = distributionFiles.get(url.pathname);
      res.writeHead(content === undefined ? 404 : 200, { "Content-Type": "application/octet-stream" }); return res.end(content);
    }
    upstream.push({ url: url.pathname + url.search, range: req.headers.range, token: req.headers["x-fixture-token"] });
    if (url.pathname === "/") { res.writeHead(200); return res.end("fixture root"); }
    if (req.headers["x-fixture-token"] !== "local-fixture") { res.writeHead(403); return res.end("missing provider header"); }
    let body, type;
    if (url.pathname === "/search") { type = "application/json"; body = Buffer.from(JSON.stringify({ items: [{ id: "one", title: "合成影像 · HGhub", type: "short", cover: `${base}/cover.svg`, episodeCount: 3 }], next: null })); }
    else if (url.pathname === "/cover.svg") { type = "image/svg+xml"; body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#173b50"/><circle cx="220" cy="160" r="120" fill="#245e78"/><text x="35" y="340" fill="#b9e8ff" font-size="42">HGhub</text><text x="35" y="380" fill="#7babbf" font-size="17">LOCAL FIXTURE</text></svg>'); }
    else if (url.pathname === "/clip.mp4") { body = clip; type = "video/mp4"; }
    else if (url.pathname === "/hls/init.mp4") { body = initialization; type = "video/mp4"; }
    else if (url.pathname === "/hls/segment.m4s") { body = fragment; type = "video/mp4"; }
    else if (url.pathname === "/hls/list.m3u8") { type = "application/vnd.apple.mpegurl"; body = Buffer.from('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:7\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.1,\nsegment.m4s\n#EXT-X-ENDLIST\n'); }
    else { res.writeHead(404); return res.end(); }
    let status = 200, headers = { "Content-Type": type, "Accept-Ranges": "bytes" };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) { const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1; if (start >= body.length || end < start) { res.writeHead(416, { "Content-Range": `bytes */${body.length}` }); return res.end(); } status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${body.length}`; body = body.subarray(start, end + 1); }
    headers["Content-Length"] = body.length; res.writeHead(status, headers); res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  vite = await createViteServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } }); await vite.listen(); const ui = vite.resolvedUrls.local[0];
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/__hpp_test_ipc", async route => { const response = await dispatch(JSON.parse(route.request().postData())); await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.route("**/*", route => { const url = route.request().url(); if (url.includes("/__hpp_test_ipc") || new URL(url).hostname === "127.0.0.1") return route.fallback(); report.external.push(url); return route.abort(); });
  if (!process.argv.includes("--frontend") && !process.argv.includes("--experience")) await page.addInitScript(() => { if (!localStorage.getItem("hpp.preferences")) localStorage.setItem("hpp.preferences", JSON.stringify({ homeMode: "multiple", homeIds: [], autoNext: false })); });
  await page.goto(`${ui}tests/plugins.html`);
  if (process.argv.includes("--experience")) {
    await testWatchExperience({ page, browser, dispatch, base, ui, root, output, report });
  } else if (process.argv.includes("--frontend")) {
    await testFrontend({ page, browser, dispatch, base, ui, root, output, report });
  } else if (process.argv.includes("--browsing")) {
    await testPluginBrowsing({ page, dispatch, root, output, report, rail: page.getByRole("navigation", {name:"主导航"}) });
  } else if (process.argv.some(arg => ['--social','--extra','--feed','--switch','--resolvers'].includes(arg))) {
    const suites = {'--social':testPluginSocial,'--extra':testPluginExtraContent,'--feed':testPluginFeed,'--switch':testPluginSourceSwitch,'--resolvers':testResolverPreferences};
    for (const [flag, suite] of Object.entries(suites)) if (process.argv.includes(flag)) await suite({page,dispatch,root,base,output,report,rail:page.getByRole('navigation',{name:'主导航'})});
  } else {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "插件中心", exact: true }).click();
  await importTab(page);
  await page.locator("summary").filter({ hasText: "粘贴代码导入" }).click();
  const code = (await readFile(join(root, "tests/fixtures/plugin-local.js"), "utf8")).replaceAll("__FIXTURE_BASE__", base);
  await page.getByRole("textbox", { name: "插件代码" }).fill(code); await page.getByRole("button", { name: "导入代码", exact: true }).click();
  await installedTab(page);
  // 预置源（bundled-plugins）也在同一 UI 中运行，页面上会有多个「已就绪」，用 first() 等任意一个出现
  await page.getByText("已就绪", { exact: true }).first().waitFor({ state: "attached" }); report.passed.push("Import evaluates the module, discovers capabilities, initializes endpoint and persists installation");
  await page.screenshot({ path: join(output, "management-dark.png") });
  await page.getByRole("button", { name: "查看 本地虚构影院 的设置与日志" }).click();
  await page.getByRole("button", { name: "探测站点线路", exact: true }).click();
  await page.getByText(/本机测试线路 · 可达/).waitFor();
  await page.getByRole("button", { name: "刷新站点线路", exact: true }).click();
  await page.getByLabel("展示名称", { exact: true }).fill("重命名虚构影院"); await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByLabel("展示名称", { exact: true }).waitFor();
  await page.getByRole("button", { name: "搜索", exact: true }).first().click();
  await page.getByRole("textbox", { name: "搜索所有插件" }).fill("虚构"); await page.locator(".hpp-search").getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("合成影像 · HGhub", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".legacy-search-poster img")?.naturalWidth > 0);
  await page.screenshot({ path: join(output, "library-dark.png") });
  await page.evaluate(() => document.documentElement.classList.add("theme-light")); await page.screenshot({ path: join(output, "library-light.png") }); await page.evaluate(() => document.documentElement.classList.remove("theme-light"));
  await page.getByRole("button", { name: /合成影像/ }).click(); await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.2);
  await chooseEpisode(page, '普通视频'); await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  await page.evaluate(() => { document.querySelector("video").currentTime = 3; }); await page.waitForFunction(() => document.querySelector("video")?.currentTime > 3.2);
  await page.getByLabel("源播放流", { exact: true }).selectOption("1");
  await page.waitForFunction(() => document.querySelector('[aria-label="源播放流"]')?.value === "1" && !document.querySelector('[aria-label="源播放流"]').disabled);
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 3);
  await page.getByLabel("源播放线路", { exact: true }).selectOption("source-backup");
  await page.waitForFunction(() => document.querySelector('[aria-label="源播放线路"]')?.value === "source-backup" && !document.querySelector('[aria-label="源播放线路"]').disabled);
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 3);
  assert.equal(await page.getByLabel("源播放线路", { exact: true }).inputValue(), "source-backup");
  await page.screenshot({ path: join(output, "playback-options.png") });
  // Simulate fatal decoder errors while keeping all media synthetic and deterministic.
  await page.evaluate(() => document.querySelector("video").dispatchEvent(new Event("error")));
  await page.waitForFunction(() => document.querySelector('[aria-label="源播放流"]')?.value === "0" && !document.querySelector('[aria-label="源播放流"]').disabled && document.querySelector("video")?.currentTime > 3);
  await page.evaluate(() => document.querySelector("video").dispatchEvent(new Event("error")));
  await page.waitForFunction(() => document.querySelector('[aria-label="源播放流"]')?.value === "1" && !document.querySelector('[aria-label="源播放流"]').disabled && document.querySelector("video")?.currentTime > 3);
  await page.evaluate(() => document.querySelector("video").dispatchEvent(new Event("error")));
  await page.getByRole("alert").filter({hasText:"已尝试可用播放流"}).waitFor();
  report.passed.push("A fatal playback failure refreshes once, tries each remaining candidate once, then stops without a retry loop");
  report.passed.push("Search through native HTTP, provider-protected cover, settings reinitialization, detail, progressive decode and seek");
  await chooseEpisode(page, 'HLS 清单'); await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  assert.equal(await page.getByLabel("源播放线路", { exact: true }).inputValue(), "source-backup");
  await page.screenshot({ path: join(output, "hls-playing.png") }); report.passed.push("Actual HLS playback through rewritten init segment and media fragment");
  await page.getByRole("button", { name: "刷新播放", exact: true }).click(); await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  const choiceResolver = `export const meta={id:"fixture.selection-resolver",name:"选择测试解析器",kind:"resolver",matches:["127.0.0.1"],version:"1.0.0",protocol:1,allowInsecureHttp:true,defaultHeaders:{"X-Fixture-Token":"local-fixture"}};
    export default hg=>({resolver:{async resolve(p){
      if(p.serverId&&!["resolver-main","resolver-backup"].includes(p.serverId))throw new Error("源线路误传给解析器");
      await hg.storage.set("lastPlayback",p);
      return {servers:[{id:"resolver-main",label:"解析主线"},{id:"resolver-backup",label:"解析备用"}],streams:[
        {url:"${base}/clip.mp4",format:"progressive",label:"解析 720p",serverId:p.serverId||"resolver-main"},
        {url:"${base}/clip.mp4",format:"progressive",label:"解析 1080p",serverId:p.serverId||"resolver-main"}
      ]};
    }}});`;
  assert((await dispatch({ action:"import", params:{ code:choiceResolver } })).ok);
  await page.evaluate(() => window.dispatchEvent(new Event("hpp.changed")));
  await chooseEpisode(page, '解析器播放');
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  await page.getByLabel("解析器播放流", { exact:true }).selectOption("1");
  await page.waitForFunction(() => document.querySelector('[aria-label="解析器播放流"]')?.value === "1" && !document.querySelector('[aria-label="解析器播放流"]').disabled);
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  await page.getByLabel("解析器播放线路", { exact:true }).selectOption("resolver-backup");
  await page.waitForFunction(() => document.querySelector('[aria-label="解析器播放线路"]')?.value === "resolver-backup" && !document.querySelector('[aria-label="解析器播放线路"]').disabled);
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  assert.equal(await page.getByLabel("源播放线路", { exact:true }).inputValue(), "source-backup");
  await page.getByRole("button", { name:"刷新播放", exact:true }).click();
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  assert.equal(await page.getByLabel("解析器播放线路", { exact:true }).inputValue(), "resolver-backup");
  const selectedServers = await page.evaluate(() => JSON.parse(localStorage.getItem("hpp.playback.servers")));
  assert.equal(selectedServers[JSON.stringify(["source","fixture.local"])], "source-backup");
  assert.equal(selectedServers[JSON.stringify(["resolver","fixture.selection-resolver"])], "resolver-backup");
  await page.screenshot({path:join(output,"resolver-playback-options.png")});
  await chooseEpisode(page, '备用流测试');
  await page.getByRole("alert").filter({hasText:"当前播放器尚不支持该媒体格式"}).waitFor();
  await page.getByLabel("源播放流",{exact:true}).selectOption("1");
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  report.passed.push("An unsupported first candidate keeps the host-owned stream selector available so another candidate can be played");
  report.passed.push("Source and resolver server controls use separate IDs, resolver candidate streams play, and refresh retains both stages' selections");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  assert((await dispatch({ action:"remove", params:{id:"fixture.selection-resolver"} })).ok);
  await page.evaluate(() => window.dispatchEvent(new Event("hpp.changed")));
  await page.getByRole("textbox", { name: "搜索所有插件" }).fill("fail"); await page.locator(".hpp-search").getByRole("button", { name: "搜索", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "虚构源暂时不可用" }).waitFor();
  await page.getByRole("button", { name: "插件中心", exact: true }).click(); await page.getByRole("switch", { name: /^启用 / }).click(); await page.getByText("已停用", { exact: true }).waitFor({ state: "attached" }); await page.getByRole("switch", { name: /^启用 / }).click(); await page.getByText("已就绪", { exact: true }).waitFor({ state: "attached" });
  await page.reload(); await page.getByRole("button", { name: "插件中心", exact: true }).click(); await page.getByText("已就绪", { exact: true }).first().waitFor({ state: "attached" });
  const preference = await page.evaluate(() => JSON.parse(localStorage.getItem("hpp.playback.servers"))[JSON.stringify(["source", "fixture.local"])]);
  assert.equal(preference, "source-backup");
  report.passed.push("Source streams and playback servers can be selected while preserving the current position, and stage-scoped server choices persist across episodes and reload");
  const mock = await page.evaluate(async () => {
    const { createMockHost } = await import("/src/plugins/mockHost.ts");
    let clock = 1000; const first = createMockHost({ now: () => clock }), second = createMockHost();
    const original = new Uint8Array([0, 255]); await first.hg.storage.set("bytes", original); original[0] = 99;
    await first.hg.storage.set("ttl", true, { ttlSec: 1 }); clock += 1001;
    return { bytes: Array.from(await first.hg.storage.get("bytes")), expired: await first.hg.storage.get("ttl") === undefined, isolated: await second.hg.storage.get("bytes") === undefined };
  });
  assert.deepEqual(mock, { bytes: [0, 255], expired: true, isolated: true });
  report.passed.push("Authoring mock preserves binary value semantics, TTL and host-instance isolation");
  report.passed.push("Playback refresh, readable plugin errors, disable/re-enable and reload persistence");
  // Exercise the production navigation and the new host-owned library.
  const rail = page.getByRole("navigation", { name: "主导航" });
  assert.equal(await rail.getByRole("button", { name: "排行榜", exact: true }).count(), 0);
  assert.equal(await rail.getByRole("button", { name: "登录 HGhub", exact: true }).count(), 0);
  await openRecommendations(page,"本地虚构影院");
  await page.getByRole("heading", { name: "虚构推荐本地虚构影院" }).waitFor();
  await page.getByRole("button", { name: "查看更多", exact: true }).click();
  await page.getByRole("heading", { name: "虚构推荐", exact: true }).waitFor();
  await page.getByRole("button", { name: "没有更多内容", exact: true }).waitFor();
  await page.screenshot({path:join(output,"plugin-section.png")});
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("heading", { name: "虚构推荐本地虚构影院" }).waitFor();
  report.passed.push("Home more opens a separate section list, returns to home, and endpoint probe/refresh are user-triggered");
  await page.getByRole("button", { name: /合成影像/ }).click();
  await chooseEpisode(page, '普通视频');
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.5);
  await page.getByRole("button", { name: "本地收藏", exact: true }).click();
  await page.getByRole("button", { name: "取消本地收藏", exact: true }).waitFor();
  await playerPanel(page, "详情"); await page.getByRole("button", { name: "追更", exact: true }).click();
  await chooseEpisode(page, '普通视频');
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.5);
  await page.evaluate(() => { const video = document.querySelector("video"); video.currentTime = 2; video.pause(); });
  await page.waitForFunction(() => document.querySelector("video")?.paused);
  await rail.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("heading", { name: "重命名虚构影院", exact: true }).waitFor();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("button", { name: "继续观看", exact: true }).click();
  await chooseEpisode(page, '普通视频');
  await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 2);
  const libraryData = JSON.parse(await readFile(join(data, "library.json"), "utf8"));
  assert(Object.values(libraryData.progress).some(p => p.pluginId === "fixture.local" && p.playlistId === "main" && p.episodeId === "progressive" && p.positionSec >= 2));
  assert(Object.values(libraryData.entries).some(e => e.favorite && e.tracking));
  await rail.getByRole("button", { name: "分类", exact: true }).click();
  await page.getByRole("button", { name: /分类中的虚构短剧/ }).waitFor();
  await page.locator('.legacy-category-heading').first().click();
  await page.getByLabel("2026", { exact: true }).check();
  await page.getByRole("button", { name: /筛选后的虚构短剧/ }).waitFor();
  await page.getByLabel("分类排序", { exact: true }).selectOption("latest");
  await page.getByText("最新", { exact: true }).last().waitFor();
  await page.screenshot({ path: join(output, "plugin-category.png") });
  const searchRules = await page.evaluate(async () => {
    const { mergeSearch } = await import("/src/plugins/searchModel.ts");
    const { alignedEpisode } = await import("/src/plugins/PluginMediaDetail.tsx");
    const hit = (pluginId, title, year, type) => ({ pluginId, item: { id: "one", title, year, type } });
    return {
      compatible: mergeSearch([hit("a", "Ａ，B", 2026, "movie"), hit("b", "a b", 2026, "movie")]).length,
      conflict: mergeSearch([hit("a", "AB", 2026, "movie"), hit("b", "AB", 2025, "movie")]).length,
      typeConflict: mergeSearch([hit("a", "AB", 2026, "other"), hit("b", "AB", 2026, "movie")]).length,
      symbolConflict: mergeSearch([hit("a", "A+B"), hit("b", "AB")]).length,
      identity: alignedEpisode({ id: "old", index: 1, season: 2, episodeNumber: 1 }, [{ id: "wrong", index: 1, season: 1, episodeNumber: 1 }, { id: "right", index: 9, season: 2, episodeNumber: 1 }])?.id,
      ambiguous: alignedEpisode({ id: "old", index: 1, episodeNumber: 1 }, [{ id: "a", index: 1, episodeNumber: 1 }, { id: "b", index: 2, episodeNumber: 1 }]) === undefined,
      indexOnly: alignedEpisode({ id: "old", index: 1 }, [{ id: "new", index: 1 }]) === undefined,
    };
  });
  assert.deepEqual(searchRules, { compatible: 1, conflict: 2, typeConflict: 2, symbolConflict: 2, identity: "right", ambiguous: true, indexOnly: true });
  report.passed.push("Plugin home and category navigation, filters/sort, local favorites and tracking, actual episode-ID resume, title/year/type merging, unambiguous season/episode alignment and removal of legacy account/rank entries");
  const echo = `export const meta={id:"fixture.echo",name:"另一个虚构来源",version:"1.0.0",protocol:1};export default ()=>({media:{getDetail(){return {id:"echo",title:"合成影像 · HGhub",playlists:[{id:"p",episodes:[]}]};},resolvePlayback(){}},search:{search({query}){return {items:[{id:"echo",title:"合成影像 · HGhub",type:"short"}],next:null};}}});`;
  assert((await dispatch({action:"import",params:{code:echo}})).ok);
  await page.reload();
  await rail.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索所有插件" }).fill("多来源");
  await page.locator(".hpp-search").getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: /合成影像.*2 个来源/ }).waitFor();
  await page.getByRole("button", { name: /合成影像.*2 个来源/ }).click();
  await page.getByRole("heading", { name: "选择内容来源", exact: true }).waitFor();
  assert.equal(await page.locator(".hpp-source-choice").getByRole("button").count(),3);
  await page.getByRole("button", { name: "返回搜索", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索所有插件" }).fill("fail");
  await page.locator(".hpp-search").getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("alert").filter({hasText:"虚构源暂时不可用"}).waitFor();
  await page.locator(".legacy-search-poster").filter({hasText:"合成影像"}).waitFor();
  await dispatch({action:"remove",params:{id:"fixture.echo"}});
  report.passed.push("Two-source aggregate search merges matching titles, requires explicit provider choice and keeps successful results when another provider fails");
  await rail.getByRole("button", { name: "插件中心", exact: true }).click();
  // Exercise production host-rendered forms, including every protocol field type.
  const formCode = (await readFile(join(root, "src-tauri/crates/hpp/tests/fixtures/forms.js"), "utf8")).replaceAll("__FIXTURE_BASE__", base);
  await importTab(page);
  await page.locator("summary").filter({ hasText: "粘贴代码导入" }).click();
  await page.getByRole("textbox", { name: "插件代码" }).fill(formCode);
  await page.getByRole("button", { name: "导入代码", exact: true }).click();
  await installedTab(page);
  const formCard = page.locator("article.hpp-plugin").filter({ has: page.getByRole("heading", { name: "虚构账号与表单" }) });
  const formPlugin = page.locator(".refined-plugin-detail");
  await formCard.waitFor();
  await formCard.getByRole("button", { name: /设置与日志/ }).click();
  await formPlugin.getByRole("button", { name: "设置虚构别名", exact: true }).click();
  await formPlugin.getByLabel("别名", { exact: true }).fill("未登录时输入");
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("alert").filter({ hasText: "请先登录虚构账号" }).waitFor();
  assert.equal(await formPlugin.getByLabel("别名", { exact: true }).inputValue(), "未登录时输入");
  await formPlugin.getByRole("button", { name: "取消", exact: true }).click();
  await formPlugin.getByRole("button", { name: "虚构账号登录", exact: true }).click();
  assert(await formPlugin.getByRole("button", { name: "提交", exact: true }).isDisabled());
  await formPlugin.getByLabel("账号", { exact: true }).fill("viewer");
  await formPlugin.getByLabel("密码", { exact: true }).fill("wrong");
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("alert").filter({ hasText: "虚构凭据不正确" }).waitFor();
  assert.equal(await formPlugin.getByLabel("账号", { exact: true }).inputValue(), "viewer");
  await formPlugin.getByLabel("密码", { exact: true }).fill("synthetic-password");
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("heading", { name: "完成虚构验证" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".hpp-captcha")?.naturalWidth > 0);
  assert(await formPlugin.getByRole("button", { name: "完成登录", exact: true }).isDisabled());
  await formPlugin.getByLabel("邮箱", { exact: true }).fill("viewer@example.com");
  await formPlugin.getByLabel("验证数字", { exact: true }).fill("12.5");
  await formPlugin.getByLabel("区域", { exact: true }).selectOption("local");
  await formPlugin.getByLabel("短信码", { exact: true }).fill("123456");
  await formPlugin.getByLabel("图形验证码", { exact: true }).fill("HGhub");
  await page.screenshot({ path: join(output, "forms-multistep.png") });
  await formPlugin.getByRole("button", { name: "完成登录", exact: true }).click();
  await formPlugin.getByText("虚构观众", { exact: true }).waitFor();
  assert.equal(await formPlugin.locator("input[type=password]").count(), 0);
  await page.waitForFunction(() => document.querySelector(".hpp-profile img")?.naturalWidth > 0);
  await formPlugin.getByRole("button", { name: "注册账号", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__HPP_TEST_OPENED_URLS__), ["https://accounts.example/register"]);
  await formPlugin.getByRole("button", { name: "设置虚构别名", exact: true }).click();
  await formPlugin.getByLabel("别名", { exact: true }).fill("新观众");
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("heading", { name: "确认虚构别名", exact: true }).waitFor();
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("status").filter({ hasText: "虚构别名已保存：新观众" }).waitFor();
  await page.screenshot({ path: join(output, "forms-account.png") });
  report.passed.push("Auth/UI discovery, AUTH_REQUIRED, AUTH_INVALID with preserved inputs, eight field types, merged multi-step values, hidden challenge rotation, proxied captcha/avatar and external registration command");
  // Both account session and actions survive a page reload; raw credentials do not.
  await page.reload();
  await page.getByRole("button", { name: "插件中心", exact: true }).click();
  await formCard.getByRole("button", { name: /设置与日志/ }).click();
  await formPlugin.getByText("虚构观众", { exact: true }).waitFor();
  const formStorage = await readFile(join(data, "fixture.forms", "storage.json"), "utf8");
  assert(!formStorage.includes("synthetic-password"));
  assert(!await page.evaluate(() => Object.values(localStorage).some(value => value.includes("synthetic-password"))));
  await formPlugin.getByRole("button", { name: "模拟登录失效", exact: true }).click();
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("alert").filter({ hasText: "登录已失效，请重新登录" }).waitFor();
  assert.equal(await formPlugin.getByText("虚构观众", { exact: true }).count(), 0);
  await formPlugin.getByRole("button", { name: "取消", exact: true }).click();
  await formPlugin.getByRole("button", { name: "直接登录虚构账号", exact: true }).click();
  await formPlugin.getByText("虚构观众", { exact: true }).waitFor();
  await formPlugin.getByRole("button", { name: "模拟退出接口失败", exact: true }).click();
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("status").filter({ hasText: "已启用虚构退出失败" }).waitFor();
  await formPlugin.getByRole("button", { name: "退出登录", exact: true }).click();
  await formPlugin.getByRole("alert").filter({ hasText: "虚构退出接口暂不可用" }).waitFor();
  await formPlugin.getByRole("button", { name: "虚构账号登录", exact: true }).waitFor();
  assert.equal(await formPlugin.getByText("虚构观众", { exact: true }).count(), 0);
  // Closing the plugin panel cancels even a submit that omitted ctx.signal.
  await formPlugin.getByRole("button", { name: "等待中的操作", exact: true }).click();
  await formPlugin.getByRole("button", { name: "提交", exact: true }).click();
  await formPlugin.getByRole("button", { name: "正在提交…", exact: true }).waitFor();
  await page.getByRole("button", { name: "搜索", exact: true }).first().click();
  await new Promise(resolve => setTimeout(resolve, 5200));
  assert(!(await readFile(join(data, "fixture.forms", "storage.json"), "utf8")).includes("cancelled-operation"));
  report.passed.push("Persisted plugin-owned login, credentials absent from host storage, AUTH_EXPIRED clears account UI, form-less auth, upstream logout failure still clears local session, and leaving the panel cancels submit");
  const resolverCode = `
    export const meta = {id:"fixture.account-resolver",name:"虚构账号解析器",kind:"resolver",matches:["*"],version:"1.0.0",protocol:1};
    export default hg => ({
      resolver:{resolve(){throw new hg.PluginError("AUTH_EXPIRED","解析器账号已失效",{details:{pluginId:"fixture.forms"}});}},
      auth:{getMethods(){return {methods:[{id:"direct",label:"解析器虚构登录"}]};},submit(){return {status:"ok",user:{id:"resolver-user",name:"虚构解析器用户"}};},getProfile(){return null;},logout(){}}
    });`;
  await page.getByRole("button", { name: "插件中心", exact: true }).click();
  await importTab(page);
  await page.locator("summary").filter({ hasText: "粘贴代码导入" }).click();
  await page.getByRole("textbox", { name: "插件代码" }).fill(resolverCode);
  await page.getByRole("button", { name: "导入代码", exact: true }).click();
  await installedTab(page);
  const resolverPlugin = page.locator("article.hpp-plugin").filter({ has: page.getByRole("heading", { name: "虚构账号解析器" }) });
  await resolverPlugin.getByText("已就绪", { exact: true }).waitFor({ state: "attached" });
  const updatedSource = await dispatch({ action: "import", params: { code: formCode.replace('format: "progressive"', 'kind: "page"') } });
  assert(updatedSource.ok);
  await page.getByRole("button", { name: "搜索", exact: true }).first().click();
  const resolverFailure = await page.evaluate(async () => {
    const { pluginCommand } = await import("/src/plugins/client.ts");
    try { await pluginCommand("media.prepare", { id: "fixture.forms", resolverId: "fixture.account-resolver", requestId: "browser-resolver-auth", args: { mediaId: "one", episodeId: "one", reason: "play", codecs: ["h264"] } }); }
    catch (e) { return { code: e.code, pluginId: e.pluginId }; }
  });
  assert.deepEqual(resolverFailure, { code: "AUTH_EXPIRED", pluginId: "fixture.account-resolver" });
  await page.getByRole("button", { name: "前往插件登录", exact: true }).click();
  await page.locator(".refined-plugin-detail").getByRole("button", { name: "解析器虚构登录", exact: true }).click();
  await page.locator(".refined-plugin-detail").getByText("虚构解析器用户", { exact: true }).waitFor();
  await page.getByRole("button", { name: "搜索", exact: true }).first().click();
  assert.equal(await page.getByRole("button", { name: "前往插件登录", exact: true }).count(), 0);
  report.passed.push("Chained resolver auth failure uses host-owned provider identity, ignores spoofed details, opens the resolver login panel and clears the login prompt after success");
  assert((await dispatch({action:"import",params:{code:formCode}})).ok);
  assert((await dispatch({action:"call",params:{id:"fixture.forms",method:"auth.submit",args:{methodId:"direct",values:{}},requestId:"cloud-login"}})).ok);
  await page.reload();
  await rail.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "来自片源", exact: true }).click();
  const account=page.locator("section.hpp-account").filter({has:page.getByRole("heading",{name:"虚构账号与表单",exact:true})});
  await account.getByText("虚构观众",{exact:true}).waitFor();
  await account.getByRole("button",{name:"云端收藏",exact:true}).click();
  await account.getByRole("button",{name:/云端虚构收藏/}).waitFor();
  await account.getByRole("button",{name:"本页导入到本地片库",exact:true}).click();
  await account.getByRole("status").filter({hasText:"本页条目已导入本地收藏"}).waitFor();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await page.locator(".hpp-local-library").getByRole("heading",{name:"云端虚构收藏",exact:true}).waitFor();
  assert((await dispatch({action:"library.put",params:{pluginId:"fixture.forms",item:{id:"cloud-one",title:"云端虚构收藏"},tracking:true}})).ok);
  await page.reload();
  await rail.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button",{name:"只看追更",exact:true}).click();
  await page.getByRole("button",{name:"检查追更",exact:true}).click();
  await page.getByText(/更新至第七集/).waitFor();
  const afterUpdates=await dispatch({action:"library.list",params:{}});
  assert(afterUpdates.ok);assert(!afterUpdates.value.some(e=>e.mediaId==="not-requested"));
  const imported=afterUpdates.value.find(e=>e.pluginId==="fixture.forms"&&e.mediaId==="cloud-one");
  assert(imported.favorite&&imported.tracking&&imported.item.episodeCount===7);
  await page.screenshot({path:join(output,"plugin-library.png")});
  await dispatch({action:"remove",params:{id:"fixture.forms"}});
  await page.reload();
  await rail.getByRole("button",{name:"我的",exact:true}).click();
  const unavailable=page.locator(".hpp-local-entry").filter({has:page.getByRole("heading",{name:"云端虚构收藏",exact:true})});
  await unavailable.getByText(/来源不可用/).waitFor();assert(await unavailable.getByRole("button",{name:"查看作品",exact:true}).isDisabled());
  report.passed.push("My page provider account, cloud-list import into local favorites, batched tracking updates, unsolicited update IDs ignored and removed-provider favorites retained as unavailable");
  await testPluginSocial({ page, dispatch, root, base, output, report, rail });
  await testPluginExtraContent({ page, dispatch, root, base, output, report, rail });
  await testPluginFeed({ page, dispatch, root, base, output, report, rail });
  await testPluginSourceSwitch({ page, dispatch, root, base, output, report, rail });
  await testPluginBrowsing({ page, dispatch, root, base, output, report, rail });
  await testResolverPreferences({ page, dispatch, root, base, output, report, rail });
  // Distribution UI uses real host downloads, including extensionless redirected lists.
  const distributionCode = (version, broken = false) => `export const meta={id:"fixture.distributed",name:"分发虚构影院",version:"${version}",protocol:1};export default () => ${broken ? '{throw new Error("测试初始化失败")}' : '({media:{getDetail(){return {id:"one",title:"分发测试",playlists:[{id:"main",episodes:[]}]};},resolvePlayback(){return {streams:[{url:"https://media.example/fixture.mp4",format:"progressive"}]};}}})'};`;
  const importDir = join(data, ".imports"); await mkdir(importDir);
  await writeFile(join(importDir, "source.js"), distributionCode("1.0.0"));
  await writeFile(join(importDir, "manifest.json"), JSON.stringify({ name: "本地插件集", plugins: [{ id:"fixture.distributed", name:"分发虚构影院", description:"虚构源列表简介", version:"1.0.0", url:"source.js" }] }));
  await rail.getByRole("button", { name: "插件中心", exact: true }).click();
  await page.evaluate(paths => { window.__HPP_TEST_FILE_PATHS__ = paths; }, [join(importDir, "manifest.json")]);
  await importTab(page);
  await page.getByRole("button", { name: "选择插件文件", exact: true }).click();
  await page.getByRole("heading", { name: "本地插件集", exact: true }).waitFor();
  await page.getByLabel("插件导入预览").getByText("虚构源列表简介", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: "仅安装，暂不启用", exact: true }).check();
  await page.getByRole("button", { name: "导入所选插件（1）", exact: true }).click();
  const distributed = page.locator("article.hpp-plugin").filter({ has: page.getByRole("heading", { name: /^分发虚构影院/ }) });
  await installedTab(page);
  await distributed.getByText("已停用", { exact: true }).waitFor({ state: "attached" });
  await distributed.getByRole("button", { name: /设置与日志/ }).click();
  await page.locator(".plugin-overview").getByText("本地插件集", { exact: true }).waitFor();
  await importTab(page);
  await page.getByRole("checkbox", { name: "仅安装，暂不启用", exact: true }).uncheck();
  const remoteList = version => JSON.stringify({ name:"远程插件集", plugins:[
    {id:"fixture.distributed",name:"分发虚构影院",version,url:"source"},
    {id:"fixture.wrong",name:"身份不一致",version,url:"source"},
    {id:"fixture.unselected",name:"不下载条目",version,url:"missing"}
  ] });
  distributionFiles.set("/distribution/set/list", remoteList("1.0.0")); distributionFiles.set("/distribution/set/source", distributionCode("1.0.0"));
  await page.getByRole("textbox", { name: "插件或列表地址", exact: true }).fill(`${base}/distribution/start`);
  await page.getByRole("button", { name: "读取列表或插件", exact: true }).click();
  await page.getByRole("heading", { name: "远程插件集", exact: true }).waitFor();
  await page.getByRole("button", { name: "保存订阅 · 远程插件集", exact: true }).click();
  await page.getByRole("button", { name: "刷新订阅 · 远程插件集", exact: true }).waitFor();
  await page.getByRole("button", { name: "导入所选插件（3）", exact: true }).waitFor();
  assert.equal(distributionRequests.some(r => r.path.endsWith("/source")), false);
  await page.getByRole("checkbox", { name: "选择 不下载条目", exact: true }).uncheck();
  await page.getByRole("button", { name: "导入所选插件（2）", exact: true }).click();
  await page.getByLabel("插件导入结果").getByText(/文件的 id 或 version 与列表不一致/).waitFor();
  await installedTab(page);
  await distributed.getByText("已就绪", { exact: true }).waitFor({ state: "attached" });
  assert.equal(distributionRequests.some(r => r.path.endsWith("/missing")), false);
  distributionFiles.set("/distribution/set/list", remoteList("1.1.0")); distributionFiles.set("/distribution/set/source", distributionCode("1.1.0", true));
  await importTab(page);
  await page.getByRole("button", { name: "检查插件更新", exact: true }).click();
  await page.getByRole("button", { name: "安装所选更新（1）", exact: true }).waitFor();
  await installedTab(page);
  await distributed.getByText("v1.0.0 · 内容源", { exact: true }).waitFor();
  await importTab(page);
  await page.getByRole("button", { name: "安装所选更新（1）", exact: true }).click();
  await installedTab(page);
  await distributed.getByText("运行失败", { exact: true }).waitFor({ state: "attached" });
  await distributed.getByRole("button", { name: /设置与日志/ }).click();
  await page.locator(".refined-plugin-detail").getByRole("button", { name: "恢复上一可用版本", exact: true }).click();
  await installedTab(page);
  await distributed.getByText("已就绪", { exact: true }).waitFor({ state: "attached" });
  await distributed.getByText("v1.0.0 · 内容源", { exact: true }).waitFor();
  distributionFiles.set("/distribution/set/list", remoteList("1.2.0")); distributionFiles.set("/distribution/set/source", distributionCode("1.2.0"));
  await importTab(page);
  await page.getByRole("button", { name: "检查插件更新", exact: true }).click();
  await page.getByRole("button", { name: "安装所选更新（1）", exact: true }).click();
  await installedTab(page);
  await distributed.getByText("v1.2.0 · 内容源", { exact: true }).waitFor();
  await installedTab(page);
  await distributed.getByText("已就绪", { exact: true }).waitFor({ state: "attached" });
  await rail.getByRole("button", { name: "设置", exact: true }).click();
  for (const name of ["启动时自动检查插件更新", "自动安装插件更新"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-pressed]')].some(e => e.getAttribute('aria-label') === label && e.getAttribute('aria-pressed') === 'true' && !e.disabled), name);
  }
  await rail.getByRole("button", { name: "插件中心", exact: true }).click();
  await importTab(page);
  await page.getByRole("button", { name: "取消订阅 · 远程插件集", exact: true }).click();
  await page.getByRole("button", { name: "保存订阅 · 远程插件集", exact: true }).waitFor({ state: "detached" });
  await page.screenshot({ path: join(output, "plugin-distribution.png") });
  assert(distributionRequests.every(r => !r.headers.cookie && !r.headers.authorization && !r.headers["x-fixture-token"]));
  report.passed.push("Native-file selection transport, local relative manifest, install-only, redirected extensionless remote manifest, selected-only downloads, identity mismatch isolation, update preview without replacement, failed-update restoration and selected higher-version installation");
  }
  assert.deepEqual(errors, []); assert.deepEqual(report.external, []); assert(upstream.every(r => r.url === "/" || r.token === "local-fixture"));
  await writeFile(join(output, "upstream.json"), JSON.stringify(upstream, null, 2));
} catch (e) {
  report.error = String(e.stack || e); process.exitCode = 1; console.error(report.error); await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); await browser?.close(); await vite?.close(); server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); host?.kill();
  assert(resolve(data).startsWith(resolve(tmpdir()) + sep) && basename(data).startsWith("hghub-hpp-"), "Refuse cleanup outside the generated fixture directory");
  await rm(data, { recursive: true, force: true }); console.log(JSON.stringify(report, null, 2)); console.log(`Artifacts: ${output}`);
}
