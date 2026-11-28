export const meta = {
  id: '91porn',
  name: '91porn',
  version: '1.0.3',
  protocol: 1,
  description: '91porn（含镜像 sp2026.com，可在线路中切换）：分类、搜索、详情与 MP4 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['91porn.com', 'sp2026.com'],
  defaultHeaders: {
    Referer: 'https://91porn.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://91porn.com';
const MIRROR = 'https://sp2026.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 站点真实栏目（v.php 顶部导航，2026-11 实测）；「最近更新」= v.php 默认列表
const CATEGORIES = [
  { id: 'latest', label: '最近更新', q: '' },
  { id: 'ori', label: '91原创', q: 'category=ori&viewtype=basic' },
  { id: 'hot', label: '当前最热', q: 'category=hot&viewtype=basic' },
  { id: 'top', label: '本月最热', q: 'category=top&viewtype=basic' },
  { id: 'long', label: '10分钟以上', q: 'category=long&viewtype=basic' },
  { id: 'longer', label: '20分钟以上', q: 'category=longer&viewtype=basic' },
  { id: 'tf', label: '本月收藏', q: 'category=tf&viewtype=basic' },
  { id: 'rf', label: '最近加精', q: 'category=rf&viewtype=basic' },
  { id: 'hd', label: '高清', q: 'category=hd&viewtype=basic' },
  { id: 'topm', label: '每月最热', q: 'category=top&m=-1&viewtype=basic' },
  { id: 'md', label: '本月讨论', q: 'category=md&viewtype=basic' },
  { id: 'mf', label: '收藏最多', q: 'category=mf&viewtype=basic' },
];

export default function (hg) {
  // 主站若返回 403，自动切到已配置的 sp2026 镜像；报告 2026-11-27 实测主站 403、镜像 200。
  // endpoint.current 仍保留用户所选线路，自动切换只在本次插件实例内生效。
  let autoOrigin = '';
  function origin() {
    if (autoOrigin) return autoOrigin;
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  // 免责声明页只是一个链接，index.php / v.php 可直接访问；语言靠 Cookie language=cn_CN 切到简体中文标题。
  // 不用 Cookie 罐（credentials: omit），保证显式 Cookie 不被罐内会话 Cookie 覆盖，且各线路行为一致。
  function headers() {
    return { 'User-Agent': UA, Referer: origin() + '/' };
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function sleep(ms) {
    return new Promise(function (r) { if (typeof setTimeout === 'function') setTimeout(r, ms); else r(); });
  }

  async function request(url, ctx, extra) {
    const h = headers();
    h.Cookie = 'language=cn_CN';
    if (extra && extra.referer) h.Referer = extra.referer;
    if (extra && extra.contentType) h['Content-Type'] = extra.contentType;
    const req = {
      url,
      headers: h,
      responseType: 'text',
      timeoutMs: extra && extra.timeoutMs ? extra.timeoutMs : 15000,
      retry: extra && extra.retry !== undefined ? extra.retry : 1,
      credentials: 'omit',
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    };
    if (extra && extra.body !== undefined) { req.method = 'POST'; req.body = extra.body; req.retry = 0; }
    return hg.http.fetch(req);
  }

  async function fetchHtml(url, ctx) {
    // 只对明确的站点故障换站；取消、认证、内容不存在不能借换线绕过去。
    let parsed;
    try { parsed = new URL(url); } catch (_) { return (await request(url, ctx)).data; }
    const known = [SITE, MIRROR];
    const source = parsed.origin;
    if (known.indexOf(source) < 0) {
      const res = await request(url, ctx);
      if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
      return res.data;
    }
    const candidates = [source].concat(known.filter(function (o) { return o !== source; }));
    let lastError;
    for (let i = 0; i < candidates.length; i++) {
      if (ctx && ctx.signal && ctx.signal.aborted) fail('CANCELLED', '调用已取消');
      const base = candidates[i];
      try {
        // 每站最多 6 秒、不在坏站原地重试，给镜像及后续解析留出调用预算。
        const res = await request(base + parsed.pathname + parsed.search, ctx, { referer: base + '/', timeoutMs: 6000, retry: 0 });
        if (res.ok) {
          // 不把「200 的人机验证/空页」记成健康线路。
          const body = String(res.data || '');
          if (!body.trim() || /<title>\s*(?:Just a moment|Access denied)|cf-chl-|id=["']challenge-form/i.test(body)) {
            fail('UPSTREAM_ERROR', '站点返回了验证页或空页面');
          }
          autoOrigin = base;
          if (i && hg.log && hg.log.info) hg.log.info('主线路不可用，已自动切换到 ' + base);
          return res.data;
        }
        const retryable = [403, 408, 429].indexOf(res.status) >= 0 || res.status >= 500;
        if (!retryable) fail(res.status === 404 ? 'NOT_FOUND' : res.status === 401 ? 'AUTH_REQUIRED' : 'UPSTREAM_CHANGED', '页面请求失败（HTTP ' + res.status + '），不自动换站');
        fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
      } catch (e) {
        if (ctx && ctx.signal && ctx.signal.aborted) fail('CANCELLED', '调用已取消');
        if (!e || ['NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR'].indexOf(e.code) < 0) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(href) {
    if (!href) return '';
    href = String(href).replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(href)) return encodeUrl(href);
    if (href.startsWith('//')) return encodeUrl('https:' + href);
    const o = origin();
    return encodeUrl(href.startsWith('/') ? o + href : o + '/' + href);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function viewkeyOf(s) {
    const m = String(s || '').match(/viewkey=([0-9a-zA-Z]+)/);
    if (m) return m[1];
    return /^[0-9a-zA-Z]+$/.test(String(s || '')) ? String(s) : '';
  }

  function videoUrl(vk) { return origin() + '/view_video.php?viewkey=' + vk; }

  // 去掉站点插入的零宽/变体选择符混淆字符
  function clean(t) { return String(t || '').replace(/[\uFE00-\uFE0F\u200B-\u200F\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }

  // 是否有下一页：只看分页条 .pagingnav 中是否存在 page=N+1 的链接（越界页站点会回落，不可按条目数判断）
  function hasNext(html, page) {
    const i = html.indexOf('class="pagingnav"');
    if (i < 0) return false;
    const block = html.slice(i, i + 4000);
    const re = /[?&;]page=(\d+)/g;
    let m;
    while ((m = re.exec(block))) if (parseInt(m[1], 10) === page + 1) return true;
    return false;
  }

  // 页面 <style> 里 display:none 的类（站点用它隐藏诱饵卡，类名会变，如 .col-lg-8 / .vh）
  function hiddenClasses(html) {
    const set = { 'col-lg-8': 1, vh: 1 };
    const re = /\.([A-Za-z][\w-]*)\s*\{\s*display\s*:\s*none/g;
    let m;
    while ((m = re.exec(html))) set[m[1]] = 1;
    return set;
  }

  // 越界页站点会回落到最后一页/第 1 页：分页条当前页（<span class="pagingnav">N</span>）与请求页不一致时视为无数据
  function pageMismatch(html, page) {
    if (page <= 1) return false;
    const m = html.match(/<span class="pagingnav">(\d+)<\/span>/);
    return !m || parseInt(m[1], 10) !== page;
  }

  function parseCards(html) {
    const hide = hiddenClasses(html);
    const doc = hg.html.parse(html);
    const items = [];
    const seen = {};
    const links = doc.select('a[href*="viewkey="]');   // 含 view_video_hd.php（高清栏目），统一用 viewkey 取 view_video.php
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      // 站点在列表里插入 .col-lg-8 / .vh 的隐藏诱饵卡（CSS display:none），跳过
      let hidden = false;
      for (let p = a.parent(), d = 0; p && d < 6; p = p.parent(), d++) {
        const cls = String(p.attr('class') || '').split(/\s+/);
        if (cls.some(function (c) { return hide[c]; })) { hidden = true; break; }
      }
      if (hidden) continue;
      const vk = viewkeyOf(a.attr('href'));
      if (!vk || seen[vk]) continue;
      const img = a.first('img');
      if (!img) continue;   // 只取带缩略图的卡片链接
      const tEl = a.first('bdi') || a.first('.video-title') || a.first('span.title');
      let title = clean(tEl ? tEl.text() : (a.attr('title') || ''));
      if (!title) continue;
      seen[vk] = 1;
      const item = { id: vk, title, type: 'movie' };
      const cover = img.attr('data-src') || img.attr('src');
      if (cover) item.cover = absUrl(cover);
      const dur = a.first('.duration');
      if (dur) { const note = dur.text().trim(); if (note) item.badge = note.slice(0, 8); }
      items.push(item);
    }
    return items;
  }

  function catQuery(id) {
    for (let i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].q;
    return null;
  }

  async function listCategory(id, page, ctx) {
    const q = catQuery(id);
    if (q === null) fail('INVALID_ARGUMENT', '未知分类：' + id);
    let url = origin() + '/v.php';
    const qs = [];
    if (q) qs.push(q);
    if (page > 1) qs.push('page=' + page);
    if (qs.length) url += '?' + qs.join('&');
    const html = await fetchHtml(url, ctx);
    const items = pageMismatch(html, page) ? [] : parseCards(html);
    return { items, next: items.length && hasNext(html, page) ? String(page + 1) : null };
  }

  function decodeTitleBlock(html) {
    // 2026-11 起站点可能把标题用 hex/base64 + XOR 编码并在页面停留后才写回（m=0 时为明文）
    const m = html.match(/var m=(\d+),id="([^"]*)",at="([^"]*)",k="([^"]*)"/);
    if (!m || m[1] === '0' || !m[2]) return '';
    const mode = parseInt(m[1], 10), id = m[2], at = m[3], k = m[4];
    try {
      const doc = hg.html.parse(html);
      const el = doc.first('#' + id);
      const enc = el && el.attr(at);
      if (!enc || !k) return '';
      let bin = '';
      if (mode === 1) { for (let i = 0; i < enc.length; i += 2) bin += String.fromCharCode(parseInt(enc.substr(i, 2), 16)); }
      else {
        const src = mode === 2 ? enc.split('').reverse().join('') : enc;
        const bytes = hg.codec.base64Decode(src);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        if (mode === 4) bin = bin.split('').reverse().join('');
      }
      const out = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j) ^ k.charCodeAt(j % k.length);
      return clean(hg.codec.utf8Decode(out));
    } catch (e) { return ''; }
  }

  function parseTitle(html) {
    const dec = decodeTitleBlock(html);
    if (dec) return dec;
    const h = html.match(/<h4 class="login_register_header"[^>]*>([\s\S]*?)<\/h4>/);
    if (h) { const t = clean(h[1].replace(/<[^>]*>/g, '')); if (t) return t; }
    const t = html.match(/<title>([\s\S]*?)<\/title>/);
    return t ? clean(t[1]).replace(/\s*-\s*91porn\s*$/i, '') : '';
  }

  // 页面里的 vbF0=strencode2("%3c%73…") 实为 escape 编码的 <source src='…'>（strencode2 = unescape）
  function decodeStrencode(html) {
    const out = [];
    const re = /strencode2?\("([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      let s = '';
      try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1].replace(/%([0-9a-fA-F]{2})/g, function (_, x) { return String.fromCharCode(parseInt(x, 16)); }); }
      const src = s.match(/src='([^']+)'/) || s.match(/src="([^"]+)"/);
      if (src && /\.(mp4|m3u8)/i.test(src[1])) out.push(src[1]);
    }
    return out;
  }

  async function vlkUrl(html, pageUrl, ctx) {
    const g = (html.match(/var vbG="([^"]+)"/) || [])[1];
    const t = (html.match(/vbGT="([^"]+)"/) || [])[1];
    if (!g || !t) return '';
    const body = JSON.stringify({
      g, t, ev: 'pointerdown', op: 2600 + Math.floor(Math.random() * 2000), mc: 8, tc: 0, sc: 1, kc: 0, wd: 0,
      gl: 'Apple GPU', sg: 0, nc: 0, pl: 5, lg: 2, ow: 1440, oh: 900, sw: 1440, sh: 900, tz: -480,
    });
    try {
      const res = await request(origin() + '/vlk.php', ctx, { body, referer: pageUrl, contentType: 'text/plain' });
      if (!res.ok) return '';
      const j = JSON.parse(String(res.data || '').trim());
      return j && typeof j.u === 'string' ? j.u : '';
    } catch (e) { return ''; }
  }

  function guessFormat(url) { return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive'; }

  // iOS/Safari 的硬件解码只支持 8 位 H.264；站内约 5% 的视频是 High 10（10 位），WebKit 直接报
  // MEDIA_ERR_SRC_NOT_SUPPORTED。读文件头前 4KB 里的 avcC（实测 60 部都在第 546~558 字节），profile_idc=110 即 10 位。
  // 探测失败（超时/网络）一律放行，宁可让播放器去试，也不误杀能播的视频。
  async function avcProfile(url, ctx) {
    try {
      const res = await hg.http.fetch({ url, headers: Object.assign({ Range: 'bytes=0-4095' }, streamHeaders()), responseType: 'bytes', timeoutMs: 6000, maxBytes: 64 * 1024, signal: ctx && ctx.signal });
      if (!res.ok && res.status !== 206) return 0;
      const b = res.data;
      for (let i = 0; i + 8 < b.length; i++) {
        if (b[i] === 0x61 && b[i + 1] === 0x76 && b[i + 2] === 0x63 && b[i + 3] === 0x43) return b[i + 5];   // 'avcC' 后：version, profile_idc
      }
    } catch (_) {}
    return 0;
  }

  function streamHeaders() {
    const h = headers();
    // 视频 CDN（nginx）对不带 Connection 头的 curl 类客户端会在 TLS 层断开；浏览器/AVPlayer 均带此头
    h.Connection = 'keep-alive';
    return h;
  }

  return {
    endpoints: {
      list() {
        return [
          { id: 'main', label: '主站 91porn.com', url: SITE },
          { id: 'sp2026', label: '镜像 sp2026.com', url: MIRROR },
        ];
      },
    },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/index.php', ctx);
        const sections = [{ id: 'featured', title: '精选推荐', layout: 'grid', items: parseCards(html) }];
        try {
          const hot = await listCategory('hot', 1, ctx);
          if (hot.items.length) sections.push({ id: 'hot', title: '当前最热', layout: 'grid', items: hot.items });
        } catch (e) { /* 次要分区失败不影响首页 */ }
        return { items: sections.filter(function (s) { return s.items.length; }), next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATEGORIES.map(function (c) { return { id: c.id, label: c.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || 'latest';
        return listCategory(id, pageOf(params && params.cursor), ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim().slice(0, 22) : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        let url = origin() + '/search_result.php?search_id=' + encodeURIComponent(q) + '&search_type=search_videos';
        if (page > 1) url += '&page=' + page;
        let html = '';
        // 非 VIP 搜索有频率限制（「搜索太频繁，请 1 秒后再试」），等待后重试
        for (let i = 0; i < 4; i++) {
          html = await fetchHtml(url, ctx);
          if (!/搜索太频繁|too\s+frequent/i.test(html)) break;
          if (i === 3) fail('RATE_LIMITED', '搜索过于频繁，请稍后再试', { retryable: true, retryAfterSec: 2 });
          await sleep(1500);
        }
        const items = pageMismatch(html, page) ? [] : parseCards(html);
        return { items, next: items.length && hasNext(html, page) ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const vk = viewkeyOf(params && params.id);
        if (!vk) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(videoUrl(vk), ctx);
        const title = parseTitle(html) || vk;
        const detail = {
          id: vk,
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: vk, index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
        const poster = html.match(/poster="([^"]+)"/);
        if (poster) detail.cover = absUrl(poster[1]);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const vk = viewkeyOf((params && (params.episodeId || params.mediaId)) || '');
        if (!vk) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = videoUrl(vk);
        const html = await fetchHtml(pageUrl, ctx);
        if (/class="video-container"/.test(html) === false && /player_one/.test(html) === false) {
          fail('NOT_FOUND', '视频不存在或已被删除');
        }
        const urls = [];
        // 1) 真实地址：页面脚本在用户交互后 POST /vlk.php 取得（strencode 里的是带旧签名的兜底地址）
        const real = await vlkUrl(html, pageUrl, ctx);
        if (real) urls.push(real);
        // 2) 兜底：strencode2(escape) 解码 + 注释里的 <source>
        const fb = decodeStrencode(html);
        for (let i = 0; i < fb.length; i++) if (urls.indexOf(fb[i]) < 0) urls.push(fb[i]);
        // 3) 最后兜底：<source>（多在 HTML 注释里，常为旧节点）
        const srcRe = /<source src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/g;
        let m;
        if (!urls.length) while ((m = srcRe.exec(html))) if (urls.indexOf(m[1]) < 0) urls.push(m[1]);
        if (!urls.length) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        const mp4 = absUrl(urls[0]);
        if (guessFormat(mp4) === 'progressive') {
          const profile = await avcProfile(mp4, ctx);
          if (profile === 110 || profile === 122 || profile === 244) {
            const e = new hg.PluginError('UNSUPPORTED', '这部视频是 10 位色深（H.264 ' + (profile === 110 ? 'High 10' : 'profile ' + profile) + '），iPhone 的播放器无法解码，站点也没有提供其它清晰度');
            throw e;
          }
        }
        return {
          streams: urls.map(function (u, i) {
            return { url: absUrl(u), kind: 'media', format: guessFormat(u), headers: streamHeaders(), label: '线路 ' + (i + 1) };
          }),
        };
      },
    },
  };
}
