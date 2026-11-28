export const meta = {
  id: 'mrds',
  name: '每日大赛',
  version: '1.0.3',
  protocol: 1,
  description: '每日大赛（mrds.com，吃瓜站，含多条镜像线路可切换）：15 个栏目、搜索、详情与 HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['mrds.com', 'mrds66.com', 'opukapynj.cc', 'mmgbaa.cn', 'gyezbp.cn', 'ohjzmm.cn'],
  defaultHeaders: {
    Referer: 'https://mrds.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://mrds.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 前 12 个来自 Swift 项目，全部实测可用；czds/omjp/tgds 是站点「热门大赛」导航里的真实栏目（实测各 ~28 条），为新增
const CATEGORIES = [
  ['mrds', '每日大赛'], ['ztds', '主题大赛'], ['rstt', '热搜吃瓜'], ['xazd', '校园学生'],
  ['blyp', '必撸大赛'], ['fctg', '反差泄密'], ['mhds', '网红黑料'], ['lqdp', '猎奇重口'],
  ['jdsj', 'AV看片'], ['mxwh', '明星大赛'], ['smdh', '动漫之家'], ['dypd', '影视国漫'],
  ['czds', '寸止挑战'], ['omjp', '欧美精品'], ['tgds', '投稿原创'],
];


// 站点图片是加密的：路径含 /upload_01/ 等目录的，内容是 AES-128-CBC（与 911爆料网、黄果短剧同一套密钥，实测解出 JPEG）
const IMG_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const IMG_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';
function imgRef(url) {
  if (!url) return undefined;
  let path = '';
  try { path = new URL(url).pathname; } catch (_) { return url; }
  if (!/\/(upload_01|upload|uploads|xiao|hc237|upload-images)\//.test(path)) return url;
  return { url: url, transform: { type: 'aes-cbc', key: IMG_KEY_B64, iv: IMG_IV_B64, padding: 'pkcs7' } };
}

export default function (hg) {
  const ENDPOINT_URLS = [SITE, 'https://www.mrds66.com', 'https://capital.opukapynj.cc'];
  let activeOrigin = '';
  function origin() {
    if (activeOrigin) return activeOrigin;
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers() { return { 'User-Agent': UA, Referer: origin() + '/' }; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function clean(t) { return String(t || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
  function abs(u) {
    if (!u) return '';
    u = String(u).trim().replace(/&amp;/g, '&');
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = origin() + u;
    try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); }
  }

  // 同一路径请求已声明的镜像，不拿首页 200 当作目标页面/视频可用。
  // 仅在本实例记住成功镜像，不修改宿主当前线路或持久设置。
  async function fetchHtml(url, ctx, allow404) {
    const deadline = Date.now() + 15000;
    const known = ENDPOINT_URLS.slice();
    const parsed = new URL(url);
    const candidates = [parsed.origin];
    if (known.indexOf(parsed.origin) >= 0) known.forEach(function (u) { if (candidates.indexOf(u) < 0) candidates.push(u); });
    let last;
    for (let i = 0; i < candidates.length; i++) {
      if (ctx && ctx.signal && ctx.signal.aborted) fail('CANCELLED', '调用已取消');
      const left = deadline - Date.now();
      if (left <= 0) { last = new hg.PluginError('TIMEOUT', '镜像切换预算已用尽'); break; }
      const base = candidates[i];
      let res;
      try {
        res = await hg.http.fetch({ url: base + url.slice(parsed.origin.length),
          headers: Object.assign({}, headers(), { Referer: base + '/' }), responseType: 'text',
          timeoutMs: Math.min(6000, left), retry: 0, credentials: 'omit', maxBytes: 6 * 1024 * 1024, signal: ctx && ctx.signal });
      } catch (e) {
        if (!e || ['NETWORK', 'TIMEOUT'].indexOf(e.code) < 0) throw e;
        last = e; continue;
      }
      if (ctx && ctx.signal && ctx.signal.aborted) fail('CANCELLED', '调用已取消');
      if (res.status === 404) { if (allow404) return ''; fail('NOT_FOUND', '页面不存在'); }
      if (res.status === 401) fail('AUTH_REQUIRED', '页面需要登录');
      if (res.status === 429) fail('RATE_LIMITED', '站点请求过于频繁，请稍后重试');
      if (res.status === 403 || res.status === 408 || res.status >= 500) {
        last = new hg.PluginError('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）'); continue;
      }
      if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
      const body = typeof res.data === 'string' ? res.data : '';
      const sample = body.slice(0, 65536);
      // 目标页面必须有本站内容标记；空页、停放页、200 验证页不晋升为当前镜像。
      const challenge = /cf-chl-|challenge-platform|<title>\s*(?:Just a moment|Attention Required)|Checking your browser|verify you are human/i.test(sample);
      const content = /class=["'][^"']*(?:dplayer|post-title|post-content|post-card|post-list|page-navigator)|<article\b/i.test(body);
      if (!body.trim() || challenge || !content) {
        last = new hg.PluginError('UPSTREAM_CHANGED', '镜像未返回可识别的目标内容页'); continue;
      }
      activeOrigin = base;
      return body;
    }
    throw last || new hg.PluginError('NETWORK', '所有已声明镜像均不可达');
  }

  // 下一页：分页条里存在 <li class="next">（越界页会 404，不能按条目数判断）
  function hasNext(html) {
    const i = html.indexOf('class="page-navigator"');
    if (i < 0) return false;
    return /<li class="next">/.test(html.slice(i, html.indexOf('</ul>', i)));
  }

  // 列表卡片：<article>…<a href="/archives/ID/">…loadBannerDirect('封面')…<h2 class="post-card-title">标题</h2>…
  // 广告卡是 <article class="ad-item">（外链），跳过
  function parseCards(html) {
    const parts = html.split('<article');
    const items = [], seen = {};
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i].split('</article>')[0];
      if (/^\s*class="ad-item"/.test(p)) continue;
      const a = p.match(/<a href="(?:https?:\/\/[^\/"]+)?\/archives\/(\d+)\/?"/);
      const t = p.match(/<h2 class="post-card-title"[^>]*>([\s\S]*?)<\/h2>/);
      if (!a || !t || seen[a[1]]) continue;
      const title = clean(t[1].replace(/<[^>]*>/g, ''));
      if (!title) continue;
      seen[a[1]] = 1;
      const it = { id: a[1], title, type: 'movie' };
      const c = p.match(/loadBannerDirect\(\s*['"]([^'"]+)['"]/);
      if (c) it.cover = imgRef(abs(c[1]));
      const sub = p.match(/<span>([^<]*)<\/span>\s*<\/div>/);
      if (sub && clean(sub[1])) it.subtitle = clean(sub[1]);
      items.push(it);
    }
    return items;
  }

  async function listUrl(url, page, ctx) {
    const html = await fetchHtml(url, ctx, page > 1);
    const items = html ? parseCards(html) : [];
    return { items, next: items.length && hasNext(html) ? String(page + 1) : null };
  }

  function dplayers(html) {
    const out = [];
    const re = /<div class="dplayer"[^>]*?data-config='([^']*)'/g;
    let m;
    while ((m = re.exec(html))) {
      try {
        const cfg = JSON.parse(m[1].replace(/&#039;/g, "'").replace(/&quot;/g, '"'));
        const u = cfg && cfg.video && cfg.video.url;
        if (u && /^https?:\/\//.test(u)) out.push({ url: u, type: cfg.video.type || '' });
      } catch (e) { /* 忽略损坏的配置 */ }
    }
    return out;
  }

  return {
    endpoints: {
      list() {
        return [
          { id: 'main', label: '主站 mrds.com', url: SITE },
          { id: 'mrds66', label: '线路 www.mrds66.com', url: 'https://www.mrds66.com' },
          { id: 'capital', label: '线路 capital.opukapynj.cc', url: 'https://capital.opukapynj.cc' },
        ];
      },
    },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/', ctx);
        const items = parseCards(html);
        if (!items.length) fail('UPSTREAM_CHANGED', '首页没有返回可识别的视频列表，可尝试切换线路');
        return { items: [{ id: 'latest', title: '最新大赛', layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories() { return CATEGORIES.map(function (c) { return { id: c[0], label: c[1] }; }); },
      async list(params, ctx) {
        const id = (params && params.categoryId) || 'mrds';
        if (!CATEGORIES.some(function (c) { return c[0] === id; })) fail('INVALID_ARGUMENT', '未知分类：' + id);
        const page = pageOf(params && params.cursor);
        return listUrl(origin() + '/category/' + id + '/' + (page > 1 ? page + '/' : ''), page, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        return listUrl(origin() + '/search/' + encodeURIComponent(q) + '/' + (page > 1 ? page + '/' : ''), page, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '').replace(/\D/g, '');
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(origin() + '/archives/' + id + '/', ctx);
        const doc = hg.html.parse(html);
        const h1 = doc.first('h1.post-title');
        const og = doc.first('meta[property="og:title"]');
        const title = clean((h1 && h1.text()) || (og && og.attr('content')) || id);
        const n = Math.max(1, dplayers(html).length);
        const eps = [];
        for (let i = 0; i < n; i++) eps.push({ id: id + ':' + i, index: i + 1, episodeNumber: i + 1, label: n > 1 ? '视频 ' + (i + 1) : '播放' });
        const detail = { id, title, type: 'movie', playlists: [{ id: 'main', label: '默认', episodes: eps }] };
        const imgs = html.match(/data-xkrkllgl="([^"]+)"/);
        if (imgs) detail.cover = imgRef(abs(imgs[1]));
        const c = html.match(/loadBannerDirect\(\s*['"]([^'"]+)['"]/);
        if (!detail.cover && c) detail.cover = imgRef(abs(c[1]));
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const eid = String((params && (params.episodeId || params.mediaId)) || '');
        const mm = eid.match(/^(\d+)(?::(\d+))?$/);
        if (!mm) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const idx = mm[2] ? parseInt(mm[2], 10) : 0;
        const html = await fetchHtml(origin() + '/archives/' + mm[1] + '/', ctx);
        const list = dplayers(html);
        if (!list.length) fail('UNSUPPORTED', '该文章没有视频（可能是纯图文帖）');
        const v = list[idx] || list[0];
        // 签名 URL（auth_key）有时效，每次现取；CDN 校验 Referer
        return { streams: [{ url: abs(v.url), kind: 'media', format: /m3u8/i.test(v.url + v.type) ? 'hls' : 'progressive', headers: headers(), label: '默认' }] };
      },
    },
  };
}
