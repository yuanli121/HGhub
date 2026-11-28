export const meta = {
  id: 'xhamster',
  name: 'xHamster',
  version: '1.0.3',
  protocol: 1,
  description: 'xHamster：分类、搜索、详情与多清晰度播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['xhamster.com', 'zh.xhamster.com'],
  defaultHeaders: {
    Referer: 'https://zh.xhamster.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://zh.xhamster.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TABS = [
  { id: '/newest', label: '最新' },
  { id: '/best/weekly', label: '本周最佳' },
  { id: '/4k', label: '4K' },
];


// —— xHamster 2026-11 起把 sources.*.url 加密为十六进制：首字节=算法号(1-7)，次 4 字节=种子(LE)，余下逐字节与 PRNG 异或 ——
// 移植自其播放器 xplayer.js（函数 n / o）。不是十六进制时原样返回。
function xhPrng(algo, seed) {
  let i = seed | 0;
  const mul = Math.imul;
  switch (algo) {
    case 1: return function () { return 255 & (i = mul(i, 1664525) + 0x3c6ef35f | 0); };
    case 2: return function () { i |= 0; i ^= i << 13; i ^= i >>> 17; i ^= i << 5; return 255 & (i |= 0); };
    case 3: return function () { let e = i = i + 0x9e3779b9 | 0; e ^= e >>> 16; e = mul(e, 0x85ebca77) | 0; e ^= e >>> 13; e = mul(e, 0xc2b2ae3d) | 0; return 255 & (e ^= e >>> 16); };
    case 4: return function () { let e = (i = i + 0x6d2b79f5 | 0) << 7 | i >>> 25; e = e + 0x9e3779b9 | 0; e ^= e >>> 11; return 255 & (e = mul(e, 0x27d4eb2d) | 0); };
    case 5: return function () { i |= 0; i ^= i << 7; i ^= i >>> 9; i ^= i << 8; return 255 & (i = i + 0xa5a5a5a5 | 0); };
    case 6: return function () { return 255 & ((i = mul(i, 0x2c9277b5) + 0xac564b05 | 0) ^ i >>> 18) >>> (i >>> 27 & 31); };
    case 7: return function () { let e = (i = i + 0x9e3779b9 | 0) ^ i << 5; e = mul(e, 0x7feb352d) | 0; e ^= e >>> 15; return 255 & (e = mul(e, 0x846ca68b) | 0); };
    default: return null;
  }
}
function xhDecodeHex(e) {
  if (typeof e !== 'string' || e.length < 12 || (e.length & 1) || !/^[0-9a-fA-F]+$/.test(e)) return null;
  const b = [];
  for (let k = 0; k < e.length; k += 2) b.push(parseInt(e.substr(k, 2), 16));
  const next = xhPrng(b[0] | 0, b[1] | b[2] << 8 | b[3] << 16 | b[4] << 24);
  if (!next) return null;
  let pct = '', raw = '';
  for (let k = 5; k < b.length; k++) { const c = (b[k] ^ next()) & 255; pct += '%' + (c < 16 ? '0' : '') + c.toString(16); raw += String.fromCharCode(c); }
  let out; try { out = decodeURIComponent(pct); } catch (_) { out = raw; }
  return out && /^[\x20-\x7E]+$/.test(out) ? out : null;
}
function xhDecodeUrl(e) {
  if (typeof e !== 'string' || !e) return e;
  const whole = xhDecodeHex(e);
  if (whole !== null) return whole;
  // 也可能只加密了路径的第一段：https://host/<hex>/rest
  const p = e.indexOf('://'), slash = p >= 0 ? e.indexOf('/', p + 3) : e.indexOf('/');
  if (slash < 0) return e;
  const a = slash + 1, n1 = e.indexOf('/', a), n2 = e.indexOf(',', a);
  const b = n1 >= 0 && n2 >= 0 ? Math.min(n1, n2) : (n1 >= 0 ? n1 : n2);
  if (b <= a) return e;
  const mid = xhDecodeHex(e.substring(a, b));
  return mid !== null ? e.substring(0, a) + mid + e.substring(b) : e;
}

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function headers() {
    return { 'User-Agent': UA, Referer: origin() + '/' };
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  async function fetchHtml(url, ctx) {
    const res = await hg.http.fetch({
      url,
      headers: headers(),
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return 'https:' + href;
    const o = origin();
    return href.startsWith('/') ? o + href : o + '/' + href;
  }

  function pathId(href) {
    try {
      const u = new URL(absUrl(href));
      return u.pathname;
    } catch (_) {
      return String(href || '');
    }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.thumb-list__item');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a.video-thumb__image-container');
      const href = a && a.attr('href');
      const img = nodes[i].first('.thumb-image-container__image');
      const title = img && img.attr('alt');
      if (!href || !title) continue;
      const cover = img && img.attr('src');
      const dur = nodes[i].first('.thumb-image-container__duration');
      const item = { id: pathId(href), title: title.trim(), type: 'movie' };
      if (cover) item.cover = absUrl(cover);
      if (dur) {
        const note = dur.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  function extractJsonObject(text, startKey) {
    const idx = text.indexOf(startKey);
    if (idx < 0) return null;
    const brace = text.indexOf('{', idx);
    if (brace < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = brace; i < text.length; i++) {
      const ch = text.charAt(i);
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(brace, i + 1)); } catch (_) { return null; }
        }
      }
    }
    return null;
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    return 'progressive';
  }

  // 只预检站点已声明的 HLS 候选；清单成功不足以证明密钥/分片可达。
  // 顺序探测保留用户首选，失败才换线；不吞登录、锁定、取消或未知错误。
  async function verifiedHls(streams, ctx) {
    const deadline = Date.now() + 18000;
    function cancelled() {
      if (ctx && ctx.signal && ctx.signal.aborted) throw new hg.PluginError('CANCELLED', '调用已取消');
    }
    function retryable(e) {
      return e && ['NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR', 'UPSTREAM_CHANGED'].indexOf(e.code) >= 0;
    }
    async function request(url, st, bytes) {
      cancelled();
      if (!/^https:\/\//i.test(url)) throw new hg.PluginError('NETWORK', '播放资源不是 HTTPS');
      const left = deadline - Date.now();
      if (left <= 0) throw new hg.PluginError('TIMEOUT', '播放线路预检超时');
      const res = await hg.http.fetch({ url: url, headers: Object.assign({}, st.headers, bytes ? { Range: 'bytes=0-1023' } : {}),
        responseType: bytes ? 'bytes' : 'text', timeoutMs: Math.min(4000, left),
        maxBytes: bytes ? 2 * 1024 * 1024 : 256 * 1024, retry: 0, signal: ctx && ctx.signal });
      cancelled();
      if (res.url && !/^https:\/\//i.test(res.url)) throw new hg.PluginError('NETWORK', '播放资源重定向到非 HTTPS');
      if (res.status === 401) throw new hg.PluginError('AUTH_REQUIRED', '播放资源需要登录');
      if (res.status === 429) throw new hg.PluginError('RATE_LIMITED', '播放资源请求过于频繁');
      if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', '播放资源 HTTP ' + res.status);
      return res;
    }
    async function check(st, url, depth) {
      if (depth > 3) throw new hg.PluginError('UPSTREAM_CHANGED', '播放清单嵌套过深');
      const res = await request(url, st, false);
      const body = typeof res.data === 'string' ? res.data.trim() : '';
      if (!/^#EXTM3U(?:\s|$)/.test(body)) throw new hg.PluginError('UPSTREAM_CHANGED', '播放地址未返回 HLS 清单');
      const base = res.url || url, lines = body.split(/\r?\n/);
      let master = false, segment = '', key = '', encrypted = false;
      for (let i = 1; i < lines.length; i++) {
        if (i % 128 === 0) { await new Promise(function (r) { setTimeout(r, 0); }); cancelled(); }
        const line = lines[i].trim();
        if (/^#EXT-X-STREAM-INF:/.test(line)) master = true;
        if (/^#EXT-X-KEY:/.test(line)) {
          encrypted = !/METHOD=NONE(?:,|$)/.test(line);
          const m = line.match(/URI="([^"]+)"/);
          key = encrypted && m ? new URL(m[1], base).href : '';
          if (encrypted && (!/METHOD=AES-128(?:,|$)/.test(line) || !key)) throw new hg.PluginError('UNSUPPORTED', '不支持的 HLS 密钥格式');
        }
        if (line && line.charAt(0) !== '#') { segment = new URL(line, base).href; break; }
      }
      if (!segment) throw new hg.PluginError('UPSTREAM_CHANGED', '播放清单没有媒体资源');
      if (master) return check(st, segment, depth + 1);
      if (key) {
        const kr = await request(key, st, true);
        if (!kr.data || kr.data.length !== 16) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 密钥长度异常');
      }
      const sr = await request(segment, st, true), data = sr.data;
      if (!data || !data.length) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 分片为空');
      // 拦截常见的 200 停放/验证页；不把一次取样当作完整解码证明。
      if (!encrypted) {
        let head = '';
        for (let i = 0; i < Math.min(data.length, 96); i++) head += String.fromCharCode(data[i]);
        if (/^\s*(?:<|\{|\[)/.test(head)) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 分片返回了错误页面');
      }
    }
    let last;
    for (let i = 0; i < streams.length; i++) {
      cancelled();
      try { await check(streams[i], streams[i].url, 0); return [streams[i]].concat(streams.slice(i + 1)); }
      catch (e) { if (!retryable(e)) throw e; last = e; }
      if (Date.now() >= deadline) break;
    }
    throw last || new hg.PluginError('NETWORK', '没有通过清单/密钥/首片预检的播放线路');
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/newest', ctx);
        return { items: [{ id: 'newest', title: '最新', layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const href = (params && params.categoryId) || '/newest';
        const page = pageOf(params && params.cursor);
        let url = origin() + href;
        if (page > 1) url += '/' + page;
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/search/' + encodeURIComponent(q) + '?page=' + page, ctx);
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.with-player-container h1');
        const title = titleEl ? titleEl.text().trim() : String(id);
        return {
          id: pathId(id),
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: pathId(id), index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        const html = await fetchHtml(pageUrl, ctx);
        const settings = extractJsonObject(html, 'xplayerSettings');
        const sources = (settings && settings.sources) || {};
        const h264 = sources.standard && sources.standard.h264;
        const streams = [];
        // 首选 sources.hls.h264（自适应码率主清单，解密后可直接播）；mp4 直链会因签名校验返回 403「Wrong key」，仅作备用
        const hls = sources.hls && sources.hls.h264;
        if (hls) {
          const cands = [hls.url, hls.fallback].map(xhDecodeUrl).filter(function (u) { return /^https?:\/\//i.test(u || ''); });
          for (let i = 0; i < cands.length; i++) {
            streams.push({ url: cands[i], kind: 'media', format: 'hls', label: i === 0 ? '自动' : '自动（备用）', headers: { 'User-Agent': UA, Referer: pageUrl + '/' } });
          }
        }
        if (!streams.length && (!Array.isArray(h264) || !h264.length)) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        for (let i = 0; Array.isArray(h264) && i < h264.length && streams.length < 16; i++) {
          if (!h264[i] || !h264[i].url) continue;
          const url = xhDecodeUrl(h264[i].url);
          if (!/^https?:\/\//i.test(url)) continue;   // 解不开就跳过
          const hh = parseInt(h264[i].quality || h264[i].label, 10);
          streams.push({
            url: url,
            height: Number.isFinite(hh) ? hh : undefined,
            kind: 'media',
            format: guessFormat(url),
            label: String(h264[i].label || 'play'),
            headers: { 'User-Agent': UA, Referer: pageUrl + '/' },
          });
        }
        if (!streams.length) fail('UPSTREAM_CHANGED', '未解析到播放地址（解密失败）');
        // HLS 在前，其余 mp4 按清晰度降序
        streams.sort(function (a, b) { return (a.format === 'hls' ? 0 : 1) - (b.format === 'hls' ? 0 : 1) || (b.height || 0) - (a.height || 0); });
        const hlsStreams = streams.filter(function (st) { return st.format === 'hls'; });
        return { streams: hlsStreams.length > 1 ? (await verifiedHls(hlsStreams, ctx)).concat(streams.filter(function (st) { return st.format !== 'hls'; })) : streams };
      },
    },
  };
}
