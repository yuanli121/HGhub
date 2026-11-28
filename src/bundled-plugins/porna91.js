export const meta = {
  id: 'porna91',
  name: '91Porna',
  version: '1.0.2',
  protocol: 1,
  description: '91Porna（91porna.com）：12 个榜单分类、搜索、详情与 HLS 播放（播放接口 + CDN 鉴权头）。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['91porna.com', 'qnlycc.cn', 'tjyyjk.cn'],
  defaultHeaders: {
    Referer: 'https://91porna.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://91porna.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 12 个分类 2026-11 实测均可用；month_hot 实际是「上月最热」，Swift 里写的「每月最热」报错是因为旧解析器不认新版卡片，已按新结构修好
const CATEGORIES = [
  ['play', '正在播放'], ['now_hot', '当前最热'], ['new_update', '最近更新'], ['original', '原创'],
  ['now_month_hot', '本月最热'], ['ten_minutes', '10分钟以上'], ['twenty_minutes', '20分钟以上'],
  ['now_month_collect', '本月收藏'], ['hd', '高清'], ['month_hot', '上月最热'],
  ['now_month_comment', '本月讨论'], ['max_collect', '收藏最多'],
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
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers() { return { 'User-Agent': UA, Referer: SITE + '/' }; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function abs(u) {
    if (!u) return '';
    u = String(u).trim().replace(/&amp;/g, '&');
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = SITE + u;
    try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); }
  }
  function keyOf(s) {
    const m = String(s || '').match(/video_key=(\d+)/);
    if (m) return m[1];
    return /^\d+$/.test(String(s || '')) ? String(s) : '';
  }

  async function fetchHtml(url, ctx) {
    const res = await hg.http.fetch({ url, headers: headers(), responseType: 'text', timeoutMs: 15000, retry: 1, credentials: 'omit', maxBytes: 6 * 1024 * 1024, signal: ctx && ctx.signal });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  // 下一页：分页条存在 rel="next" 链接；当前页取 aria-current
  function hasNext(html) { const i = html.indexOf('class="go-list-pager"'); return i >= 0 && /rel="next"/.test(html.slice(i, i + 6000)); }
  function pageMismatch(html, page) {
    const m = html.match(/class="go-list-pager"[^>]*data-page="(\d+)"/);
    return m ? parseInt(m[1], 10) !== page : false;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [], seen = {};
    const cards = doc.select('div.video-item');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const a = c.first('a[href*="video_key="]');
      const id = keyOf(a && a.attr('href'));
      if (!id || seen[id]) continue;
      const img = c.first('img');
      let title = clean(img ? img.attr('alt') : '');
      if (!title) { const ts = c.select('a[href*="video_key="]'); for (let j = 0; j < ts.length && !title; j++) title = clean(ts[j].text()); }
      if (!title) continue;
      seen[id] = 1;
      const it = { id, title, type: 'movie' };
      const cover = img && (img.attr('data-src') || img.attr('src'));
      if (cover && !/poster_loading/.test(cover)) it.cover = imgRef(abs(cover));
      const m = clean(c.text()).match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      if (m) it.badge = m[1];
      items.push(it);
    }
    return items;
  }

  async function listUrl(url, page, ctx) {
    const html = await fetchHtml(url, ctx);
    let items = pageMismatch(html, page) ? [] : parseCards(html);
    // 站点怪癖：第 2 页与第 1 页有大段重叠（如 20分钟以上 重叠 12 条）→ 第 2 页去掉第 1 页已出现的条目
    if (page === 2 && items.length && url.indexOf('&page=2') > 0) {
      try {
        const first = parseCards(await fetchHtml(url.replace(/&page=2\b/, ''), ctx));
        const have = {}; first.forEach(function (x) { have[x.id] = 1; });
        items = items.filter(function (x) { return !have[x.id]; });
      } catch (e) { /* 取不到第 1 页就不去重 */ }
    }
    return { items, next: items.length && hasNext(html) ? String(page + 1) : null };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(SITE + '/', ctx);
        const items = parseCards(html);
        const sections = [];
        if (items.length) sections.push({ id: 'index', title: '首页推荐', layout: 'grid', items });
        try {
          const hot = await listUrl(SITE + '/comic/index/video?category=now_hot', 1, ctx);
          const have = {}; items.forEach(function (x) { have[x.id] = 1; });
          const rest = hot.items.filter(function (x) { return !have[x.id]; });
          if (rest.length) sections.push({ id: 'hot', title: '当前最热', layout: 'grid', items: rest });
        } catch (e) { /* 次要分区失败不影响首页 */ }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页没有返回可识别的视频列表');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() { return CATEGORIES.map(function (c) { return { id: c[0], label: c[1] }; }); },
      async list(params, ctx) {
        const id = (params && params.categoryId) || 'now_hot';
        if (!CATEGORIES.some(function (c) { return c[0] === id; })) fail('INVALID_ARGUMENT', '未知分类：' + id);
        const page = pageOf(params && params.cursor);
        return listUrl(SITE + '/comic/index/video?category=' + id + (page > 1 ? '&page=' + page : ''), page, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        return listUrl(SITE + '/comic/index/search?keyword=' + encodeURIComponent(q) + (page > 1 ? '&page=' + page : ''), page, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = keyOf(params && params.id);
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(SITE + '/comic/index/detail?video_key=' + id, ctx);
        const doc = hg.html.parse(html);
        const mse = doc.first('#mse');
        const og = doc.first('meta[property="og:title"]');
        let title = clean((mse && mse.attr('data-video_title')) || (og && og.attr('content') || '').replace(/\s*A片\s*$/, '') || id);
        const detail = {
          id, title, type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id, index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        const oi = doc.first('meta[property="og:image"]');
        if (oi && oi.attr('content')) detail.cover = imgRef(abs(oi.attr('content')));
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = keyOf(params && (params.episodeId || params.mediaId));
        if (!id) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = SITE + '/comic/index/detail?video_key=' + id;
        const html = await fetchHtml(pageUrl, ctx);
        const mse = hg.html.parse(html).first('#mse');
        const vid = clean(mse && mse.attr('data-video')) || id;
        if (!/^\d+$/.test(vid)) fail('UPSTREAM_CHANGED', '详情页缺少视频编号');
        // 2026-11 改版：播放地址由 POST /api/videos/{id}/playback 返回，CDN 要求 cdn.authKey: authValue 请求头
        const h = headers();
        h.Referer = pageUrl; h.Origin = SITE; h['Content-Type'] = 'application/json'; h.Accept = 'application/json';
        const res = await hg.http.fetch({ url: SITE + '/api/videos/' + vid + '/playback', method: 'POST', headers: h, body: '{}', responseType: 'json', timeoutMs: 15000, credentials: 'omit', signal: ctx && ctx.signal });
        const j = res.data;
        if (!res.ok || !j || j.status !== 1 || !j.data || !j.data.streams) fail('CONTENT_LOCKED', '播放接口未返回可用地址（可能需要登录或会员）');
        const st = j.data.streams;
        const urls = [];
        [st.main, st.hevc, st.preview].forEach(function (u) { if (u && /^https:\/\//.test(u) && urls.indexOf(u) < 0) urls.push(u); });
        if (!urls.length) fail('CONTENT_LOCKED', '播放接口未返回可用地址（可能需要登录或会员）');
        const sh = { 'User-Agent': UA, Referer: SITE + '/' };
        const cdn = j.data.cdn;
        if (cdn && cdn.authKey && cdn.authValue) sh[cdn.authKey] = cdn.authValue;
        return { streams: [{ url: urls[0], kind: 'media', format: 'hls', headers: sh, label: '默认' }] };
      },
    },
  };
}
