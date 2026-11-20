// HGhub HPP 1.0 插件 · 俄网搜索
// 主路：Yandex 网页搜索（遇验证码用 hg.webview 让用户过一次，凭证存插件 Cookie 罐）
// 备路：Yandex 不通时回落 Bing 网页搜索；两路都空则返回可点开的诊断条目
// 附加：搜索框贴任意网页链接就地提取 m3u8/mp4；VK 视频页走 al_video 四档直链
export const meta = {
  id: 'yandex',
  name: '俄网搜索',
  version: '1.6.0',
  protocol: 1,
  description: 'Yandex 网页搜索（webview 过验证）；回落 Bing；空结果给诊断条目；支持贴链接提取视频与 VK 直链播放。',
  author: 'workspace',
  kind: 'source',
  features: ['webview'],
  linkDomains: ['yandex.ru', 'yandex.com'],
  defaultHeaders: {
    'Accept-Language': 'ru,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://yandex.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CTL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    let u = cur && typeof cur.url === 'string' ? cur.url.replace(/\/$/, '') : SITE;
    // yandex.com 已被官方临时关闭（维护页），一律回落到 yandex.ru
    if (/yandex\.com$/i.test(u) || /yandex\.com\//i.test(u)) return SITE;
    return u || SITE;
  }

  function fail(code, message) {
    throw new hg.PluginError(code, message);
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(CTL, '').trim();
  }

  function absUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return origin() + (u.charAt(0) === '/' ? u : '/' + u);
  }

  async function fetchText(url, ctx, cacheTtl) {
    const opts = {
      url,
      responseType: 'text',
      timeoutMs: 20000,
      maxBytes: 8 * 1024 * 1024,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      signal: ctx && ctx.signal,
    };
    if (cacheTtl) opts.cache = { ttlSec: cacheTtl };
    const res = await hg.http.fetch(opts);
    if (!res.ok) fail('UPSTREAM_ERROR', 'Yandex 返回 HTTP ' + res.status);
    const text = res.data || '';
    if (text.length < 60000 && (/we[’']ll be back/i.test(text) || /temporarily turned off/i.test(text))) {
      fail('UPSTREAM_ERROR', 'Yandex 站点维护中（官方停机页），换 yandex.ru 或稍后再试');
    }
    return text;
  }

  function readState(html) {
    const m = String(html).match(/<noframes[^>]*id="UniAppVideo-PreloadedState"[^>]*>([\s\S]*?)<\/noframes>/i);
    if (!m) return null;
    const raw = m[1];
    const tries = [raw, raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')];
    for (let i = 0; i < tries.length; i++) {
      try { return JSON.parse(tries[i]); } catch (e) {}
    }
    return null;
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function clipsOf(state) {
    if (!state) return null;
    if (state.clips && state.clips.items) return state.clips;
    if (state.viewer && state.viewer.clips && state.viewer.clips.items) return state.viewer.clips;
    return null;
  }

  function entryOf(clips, videoId) {
    const items = (clips && clips.items) || {};
    const dups = (clips && clips.dups) || {};
    const it = items[videoId] || {};
    const d = dups[videoId] || {};
    const poster = it.preview && it.preview.posterSrc;
    const pl = d.player || {};
    return {
      id: String(videoId),
      title: clean(d.cleanTitle || d.title || it.description || videoId),
      cover: poster ? absUrl(poster) : '',
      host: clean((d.host && d.host.title) || it.greenHost || ''),
      durationSec: (d.duration && d.duration.value) || 0,
      durationText: (d.duration && (d.duration.shortText || d.duration.text)) || '',
      views: (d.views && d.views.text) || '',
      description: clean(it.description || ''),
      playerId: pl.playerId || (d.host && d.host.playerId) || '',
      embedUrl: pl.embedUrl || '',
      pageUrl: pl.videoUrl || (d.host && d.host.href) || '',
    };
  }

  function toItem(e) {
    const item = { id: e.id, title: e.title, type: 'other' };
    if (e.cover) item.cover = e.cover;
    const badge = e.host ? e.host.slice(0, 8) : '';
    if (badge) item.badge = badge;
    const sub = [];
    if (e.durationText) sub.push(e.durationText);
    if (e.views) sub.push(e.views + ' 次观看');
    if (sub.length) item.subtitle = sub.join(' · ');
    return item;
  }

  function listFrom(state) {
    const clips = clipsOf(state);
    if (!clips) return [];
    const ids = Object.keys(clips.items || {});
    const arr = [];
    for (let i = 0; i < ids.length; i++) {
      const it = clips.items[ids[i]] || {};
      arr.push({ it: it, i: i });
    }
    arr.sort(function (a, b) {
      const pa = parseInt(a.it.position, 10);
      const pb = parseInt(b.it.position, 10);
      const va = Number.isFinite(pa) ? pa : 1000 + a.i;
      const vb = Number.isFinite(pb) ? pb : 1000 + b.i;
      return va - vb;
    });
    const out = [];
    for (let j = 0; j < arr.length; j++) {
      const item = toItem(entryOf(clips, arr[j].it.videoId));
      if (item.id && item.title) out.push(item);
    }
    return out;
  }

  async function previewEntry(videoId, ctx) {
    const url = origin() + '/video/preview/' + encodeURIComponent(videoId);
    const html = await fetchText(url, ctx);
    const state = readState(html);
    const clips = clipsOf(state);
    return { entry: clips ? entryOf(clips, videoId) : null, html: html };
  }

  // VK：al_video 接口一次返回四档清晰度的直链（okcdn.ru）
  async function vkStreams(pageUrl, ctx) {
    const m = /(?:video|clip)(-?\d+)_(\d+)/.exec(String(pageUrl || ''));
    if (!m) return [];
    let res;
    try {
      res = await hg.http.fetch({
        url: 'https://vk.com/al_video.php?act=show',
        method: 'POST',
        headers: {
          Referer: 'https://vk.com/',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'ru,en;q=0.9',
        },
        body: { form: { act: 'show', al: '1', video: m[1] + '_' + m[2] } },
        responseType: 'text',
        timeoutMs: 20000,
        maxBytes: 8 * 1024 * 1024,
        signal: ctx && ctx.signal,
      });
    } catch (e) {
      return [];
    }
    if (!res || !res.ok) return [];
    const body = String(res.data || '');
    const defs = [['720', '720P', 720], ['480', '480P', 480], ['360', '360P', 360], ['240', '240P', 240]];
    const out = [];
    for (let i = 0; i < defs.length; i++) {
      const re = new RegExp('"url' + defs[i][0] + '"\\s*:\\s*"([^"]+)"');
      const mm = re.exec(body);
      if (!mm || !mm[1]) continue;
      out.push({
        url: mm[1].replace(/\\\//g, '/'),
        kind: 'media',
        format: 'progressive',
        label: defs[i][1],
        height: defs[i][2],
        headers: { 'User-Agent': UA },
      });
    }
    return out;
  }

  // 通用：从嵌入页 HTML 里拾取 m3u8 / mp4 地址
  function pickMediaUrls(body) {
    const out = [];
    const seen = {};
    const marks = ['.m3u8', '.mp4'];
    for (let k = 0; k < marks.length; k++) {
      let idx = 0;
      while (true) {
        const at = body.indexOf(marks[k], idx);
        if (at < 0) break;
        idx = at + 1;
        const start = body.lastIndexOf('http', at);
        if (start < 0) continue;
        const head = body.slice(start, start + 5);
        if (head !== 'http:' && head !== 'https') continue;
        let end = at + marks[k].length;
        while (end < body.length && end - start < 500) {
          const ch = body.charAt(end);
          if (ch === '"' || ch === "'" || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\\' || ch === '<' || ch === '>') break;
          end++;
        }
        const u = body.slice(start, end).replace(/&amp;/g, '&');
        if (u.length > 20 && !seen[u]) {
          seen[u] = 1;
          out.push(u);
        }
        if (out.length >= 4) return out;
      }
    }
    return out;
  }

  function isUrl(s) {
    return /^https?:\/\/[^\s]+$/i.test(String(s || '').trim());
  }

  function hostOf(u) {
    const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ''));
    return m ? m[1] : '';
  }

  function pageTitle(html) {
    const m = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(String(html || ''));
    return m ? clean(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')).slice(0, 90) : '';
  }

  function findIframes(html) {
    const out = [];
    const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(String(html || ''))) !== null) {
      let u = m[1].replace(/&amp;/g, '&');
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (/^https?:\/\//i.test(u)) out.push(u);
      if (out.length >= 3) break;
    }
    return out;
  }

  // 贴入任意网页链接：抓页面 -> 找直链 -> 没找到就下一层 iframe
  async function extractFromUrl(url, ctx) {
    let html = '';
    try {
      html = await fetchText(url, ctx);
    } catch (e) {
      return { html: '', urls: [], title: '', error: '页面打不开（' + (e && e.code ? e.code : 'NETWORK') + '）' };
    }
    let urls = pickMediaUrls(html);
    if (!urls.length) {
      const frames = findIframes(html);
      for (let i = 0; i < frames.length; i++) {
        try {
          const sub = await fetchText(frames[i], ctx);
          const u2 = pickMediaUrls(sub);
          if (u2.length) { urls = u2; break; }
        } catch (e) {}
      }
    }
    return { html: html, urls: urls, title: pageTitle(html) || hostOf(url), error: null };
  }

  // ---------- Bing 网页搜索（Yandex 网页搜索有验证码，改走 Bing 拿网页结果）----------
  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }

  function stripTags(s) {
    return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  }

  function parseBing(html) {
    const items = [];
    const parts = String(html || '').split('class="b_algo"');
    for (let i = 1; i < parts.length && items.length < 20; i++) {
      const seg = parts[i].slice(0, 5000);
      const hm = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/i.exec(seg);
      if (!hm) continue;
      let url = decodeEntities(hm[1]);
      if (url.indexOf('/ck/a?') >= 0 || url.indexOf('bing.com/ck/a') >= 0) {
        const u = /[?&]u=a1([^&]+)/.exec(url);
        if (u) {
          try { url = decodeURIComponent(u[1]); } catch (e) { continue; }
        } else continue;
      }
      if (!/^https?:\/\//i.test(url)) continue;
      const title = stripTags(hm[2]);
      if (!title) continue;
      const cite = /<cite[^>]*>([\s\S]{0,160}?)<\/cite>/i.exec(seg);
      const para = /<p[^>]*>([\s\S]{0,400}?)<\/p>/i.exec(seg);
      const hostMatch = /^https?:\/\/([^\/?#]+)/i.exec(url);
      const host = hostMatch ? hostMatch[1] : '';
      const item = { id: url, title: title.slice(0, 120), type: 'other' };
      if (host) item.badge = host.replace(/^www\./, '').slice(0, 14);
      const sub = [];
      if (host) sub.push(host.replace(/^www\./, ''));
      const p = para ? stripTags(para[1]) : '';
      if (p) sub.push(p.slice(0, 70));
      if (sub.length) item.subtitle = sub.join(' · ');
      items.push(item);
    }
    return items;
  }

  function isCaptchaPage(html) {
    const s = String(html || '');
    return /showcaptcha/i.test(s)
      || /class="[^"]*CheckboxCaptcha/i.test(s)
      || /SmartCaptcha/i.test(s)
      || /Подтвердите, что запросы отправляли вы/i.test(s)
      || /Are you not a robot/i.test(s);
  }

  function hasWebview() {
    try {
      return !!(hg.webview && typeof hg.webview.open === 'function');
    } catch (e) {
      return false;
    }
  }

  // Yandex 网页搜索结果解析：按结果项切块，优先 OrganicTitle-Link，兜底扫外链
  function pickAnchor(seg) {
    let m = /<a[^>]*class="[^"]*OrganicTitle-Link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/i.exec(seg);
    if (!m) m = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*OrganicTitle-Link[^"]*"[^>]*>([\s\S]{0,300}?)<\/a>/i.exec(seg);
    if (m) return m;
    const re = /<a[^>]*href="(https?:\/\/(?!(?:[a-z0-9-]+\.)*yandex\.[a-z.]|yastatic\.net)[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/i;
    return re.exec(seg);
  }

  function parseYandexWeb(html) {
    const items = [];
    const seen = {};
    const text = String(html || '');
    const push = function (url, title, snippet) {
      if (!url || !title) return;
      if (!/^https?:\/\//i.test(url)) return;
      const hm = /^https?:\/\/([^\/?#]+)/i.exec(url);
      if (!hm) return;
      const host = hm[1];
      if (/(^|\.)yandex\.[a-z.]+$/i.test(host) || /(^|\.)yastatic\.net$/i.test(host) || /(^|\.)ya\.ru$/i.test(host)) return;
      if (seen[url]) return;
      if (title.length < 3) return;
      seen[url] = 1;
      const it = { id: url, title: title.slice(0, 130), type: 'other' };
      it.badge = host.replace(/^www\./, '').slice(0, 14);
      const sub = [];
      if (host) sub.push(host.replace(/^www\./, ''));
      if (snippet && snippet.length > 8) sub.push(snippet.slice(0, 70));
      if (sub.length) it.subtitle = sub.join(' · ');
      items.push(it);
    };

    // 按结果项切块
    let blocks = text.split(/<li[^>]+class="[^"]*serp-item/i);
    if (blocks.length < 3) blocks = text.split(/<div[^>]+class="[^"]*serp-item/i);
    if (blocks.length < 3) blocks = text.split(/class="[^"]*Organic(?=[ _"])/i);

    for (let i = 1; i < blocks.length && items.length < 20; i++) {
      const seg = blocks[i].slice(0, 6000);
      const a = pickAnchor(seg);
      if (!a) continue;
      const url = decodeEntities(a[1]);
      const title = stripTags(a[2]);
      let sn = '';
      const sm = /class="[^"]*OrganicTextContentSpan[^"]*"[^>]*>([\s\S]{0,400}?)<\/span>/i.exec(seg)
        || /class="[^"]*OrganicText[^"]*"[^>]*>([\s\S]{0,400}?)<\/div>/i.exec(seg);
      if (sm) sn = stripTags(sm[1]);
      push(url, title, sn);
    }

    // 兜底：整页扫外链
    if (!items.length) {
      const re = /<a[^>]*href="(https?:\/\/(?!(?:[a-z0-9-]+\.)*yandex\.[a-z.]|yastatic\.net)[^"]+)"[^>]*>([\s\S]{0,250}?)<\/a>/gi;
      let m;
      while ((m = re.exec(text)) !== null && items.length < 20) {
        push(decodeEntities(m[1]), stripTags(m[2]), '');
      }
    }
    return items;
  }

  async function yandexWebSearch(q, page, ctx) {
    const base = origin();
    let url = base + '/search/?text=' + encodeURIComponent(q);
    if (page > 1) url += '&p=' + (page - 1);
    let html = '';
    try {
      html = await fetchText(url, ctx);
    } catch (e) {
      return null;
    }
    if (isCaptchaPage(html)) {
      if (!hasWebview()) return null;
      try {
        await hg.webview.open({
          url: base + '/search/?text=' + encodeURIComponent(q),
          title: '过 Yandex 验证',
          doneWhen: { cookieNames: ['spravka'] },
          timeoutSec: 180,
        });
      } catch (e) {
        return null;
      }
      try {
        html = await fetchText(url, ctx);
      } catch (e) {
        return null;
      }
      if (isCaptchaPage(html)) return null;
    }
    const items = parseYandexWeb(html);
    if (!items.length) return null;
    const hasNext = items.length >= 5;
    return { items: items, next: hasNext ? String(page + 1) : null };
  }

  async function bingSearch(q, page, ctx) {
    const first = (page - 1) * 10 + 1;
    let url = 'https://cn.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=ru&count=20';
    if (first > 1) url += '&first=' + first;
    const html = await fetchText(url, ctx, 300);
    const items = parseBing(html);
    const hasNext = items.length >= 5;
    return { items: items, next: hasNext ? String(page + 1) : null };
  }

  function streamsFromUrls(urls) {
    const out = [];
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      out.push({
        url: u,
        kind: 'media',
        format: /\.m3u8/i.test(u) ? 'hls' : 'progressive',
        headers: { 'User-Agent': UA },
      });
    }
    return out;
  }

  // 通用：抓嵌入播放页，从中取直链（ntv / dzen / smotrim 等走这条路）
  async function embedStreams(embedUrl, ctx) {
    if (!embedUrl) return [];
    let res;
    try {
      res = await hg.http.fetch({
        url: embedUrl,
        responseType: 'text',
        timeoutMs: 15000,
        maxBytes: 8 * 1024 * 1024,
        headers: { Referer: origin() + '/' },
        signal: ctx && ctx.signal,
      });
    } catch (e) {
      return [];
    }
    if (!res || !res.ok) return [];
    const urls = pickMediaUrls(String(res.data || ''));
    const out = [];
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      out.push({
        url: u,
        kind: 'media',
        format: /\.m3u8/i.test(u) ? 'hls' : 'progressive',
        headers: { 'User-Agent': UA },
      });
    }
    return out;
  }

  return {
    endpoints: {
      list() {
        return [
          { id: 'ru', label: 'yandex.ru', url: SITE },
        ];
      },
    },

    home: {
      async getSections() {
        return { items: [], next: null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };

        // 搜索框里直接贴网页链接 -> 就地提取播放地址
        if (isUrl(q)) {
          const ex = await extractFromUrl(q, ctx);
          if (ex.error) return { items: [], next: null };
          if (!ex.urls.length) return { items: [], next: null };
          return {
            items: [{
              id: q,
              title: ex.title,
              type: 'movie',
              badge: '直取',
              subtitle: hostOf(q) + ' · ' + ex.urls.length + ' 个播放地址',
            }],
            next: null,
          };
        }

        const page = pageOf(params && params.cursor);
        const diag = [];

        // ① Yandex 网页搜索（遇验证码弹 webview 过一次）
        try {
          const yd = await yandexWebSearch(q, page, ctx);
          if (yd && yd.items && yd.items.length) return yd;
          diag.push(yd ? 'Yandex:解析0条' : 'Yandex:被验证码挡');
        } catch (e) {
          diag.push('Yandex:' + (e && e.code ? e.code : 'ERR'));
        }

        // ② 回退 Bing
        try {
          const b = await bingSearch(q, page, ctx);
          if (b.items && b.items.length) {
            if (diag.length) b.items[0].subtitle = (b.items[0].subtitle || '') + '（Yandex 未通，已用 Bing）';
            return b;
          }
          diag.push('Bing:解析0条');
        } catch (e) {
          diag.push('Bing:' + (e && e.code ? e.code : 'ERR'));
        }

        // ③ 两路都空 → 返回可点开的诊断条目，别让用户面对空列表
        return {
          items: [{
            id: 'diag://' + encodeURIComponent(q),
            title: '没搜到结果 · 点开看诊断',
            type: 'other',
            badge: '诊断',
            subtitle: diag.join(' / '),
          }],
          next: null,
        };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id ? String(params.id) : '';
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        if (id.indexOf('diag://') === 0) {
          let q0 = '';
          try { q0 = decodeURIComponent(id.slice(7)); } catch (e) { q0 = id.slice(7); }
          return {
            id: id,
            title: '搜索诊断：' + q0,
            type: 'other',
            playlists: [{ id: 'diag', label: '说明', episodes: [{ id: id, index: 1, episodeNumber: 1, label: '查看' }] }],
            description: '这是一条诊断占位条目：两路搜索都没有拿到结果。\n\n可能原因：\n1) Yandex 验证码未通过（弹窗被关闭或超时）\n2) 宿主网络到 cn.bing.com 不通\n3) 页面结构变化导致解析为空\n\n把这条截图发给维护者，能看到卡在哪一步。',
          };
        }
        if (isUrl(id)) {
          if (/vk\.com\/video|vk\.com\/clip|vkvideo\.ru\/video/i.test(id)) {
            const d0 = {
              id: id,
              title: 'VK 视频 · ' + hostOf(id),
              type: 'movie',
              playlists: [{ id: 'vk', label: 'VK', episodes: [{ id: id, index: 1, episodeNumber: 1, label: '播放' }] }],
              description: '来源：' + hostOf(id) + '（VK 直链，四档清晰度）',
            };
            return d0;
          }
          const ex = await extractFromUrl(id, ctx);
          if (ex.error) fail('UPSTREAM_ERROR', ex.error);
          if (!ex.urls.length) fail('UNSUPPORTED', '这个页面里没有找到 m3u8 / mp4 地址，试试用浏览器打开');
          const d = {
            id: id,
            title: ex.title,
            type: 'movie',
            playlists: [{
              id: 'direct',
              label: hostOf(id),
              episodes: [{ id: id, index: 1, episodeNumber: 1, label: ex.urls.length + ' 个地址' }],
            }],
            description: '来源：' + hostOf(id) + '\n共找到 ' + ex.urls.length + ' 个播放地址',
          };
          return d;
        }
        const got = await previewEntry(id, ctx);
        const e = got.entry;
        if (!e) fail('UPSTREAM_CHANGED', '未解析到该条目的信息');
        const detail = {
          id: e.id,
          title: e.title,
          type: 'movie',
          playlists: [{
            id: 'yandex',
            label: e.host || '播放',
            episodes: [{ id: e.id, index: 1, episodeNumber: 1, label: e.durationText || '播放' }],
          }],
        };
        if (e.cover) detail.cover = e.cover;
        const desc = [];
        if (e.host) desc.push('来源：' + e.host + (e.playerId === 'vk' ? '（可直接播放）' : ''));
        if (e.description) desc.push(e.description);
        if (desc.length) detail.description = desc.join('\n');
        if (e.durationSec) detail.durationSec = e.durationSec;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId ? String(params.episodeId) : '';
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        if (isUrl(episodeId)) {
          // VK 视频页：走专用解析，四档直链
          if (/vk\.com\/video|vk\.com\/clip|vkvideo\.ru\/video/i.test(episodeId)) {
            const vk = await vkStreams(episodeId, ctx);
            if (vk.length) return { streams: vk };
          }
          // Yandex 视频页：先看它是不是 VK 源
          const ym = /yandex\.[a-z.]+\/video\/preview\/(\d+)/i.exec(episodeId);
          if (ym) {
            try {
              const got0 = await previewEntry(ym[1], ctx);
              if (got0.entry && got0.entry.playerId === 'vk' && got0.entry.pageUrl) {
                const vk2 = await vkStreams(got0.entry.pageUrl, ctx);
                if (vk2.length) return { streams: vk2 };
              }
            } catch (e) {}
          }
          const ex = await extractFromUrl(episodeId, ctx);
          if (ex.error) fail('UPSTREAM_ERROR', ex.error);
          if (!ex.urls.length) fail('UNSUPPORTED', '这个页面里没有找到 m3u8 / mp4 地址，试试用浏览器打开');
          return { streams: streamsFromUrls(ex.urls) };
        }
        const got = await previewEntry(episodeId, ctx);
        const e = got.entry;
        if (!e) fail('UPSTREAM_CHANGED', '未解析到该条目的播放信息');

        const streams = [];

        if (e.playerId === 'vk' && e.pageUrl) {
          const vk = await vkStreams(e.pageUrl, ctx);
          for (let i = 0; i < vk.length; i++) streams.push(vk[i]);
        }

        if (!streams.length && e.embedUrl) {
          const em = await embedStreams(e.embedUrl, ctx);
          for (let i = 0; i < em.length; i++) streams.push(em[i]);
        }

        if (!streams.length) {
          const direct = String(got.html).match(/https?:\\?\/\\?\/[^"'\s\\]+?\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?/i);
          if (direct) {
            const u = direct[0].replace(/\\\//g, '/').replace(/\\u002F/g, '/');
            streams.push({
              url: u,
              kind: 'media',
              format: /\.m3u8/i.test(u) ? 'hls' : 'progressive',
              headers: { 'User-Agent': UA },
            });
          }
        }

        if (!streams.length && e.embedUrl) {
          const s = { url: e.embedUrl, kind: 'page', headers: { 'User-Agent': UA } };
          if (e.playerId) s.resolverId = e.playerId;
          streams.push(s);
        }
        if (!streams.length && e.pageUrl) {
          streams.push({ url: e.pageUrl, kind: 'external' });
        }
        if (!streams.length) {
          fail('UNSUPPORTED', '该条目没有可用播放地址（来源：' + (e.host || '未知') + '）');
        }
        return { streams: streams, durationSec: e.durationSec || undefined };
      },
    },
  };
}