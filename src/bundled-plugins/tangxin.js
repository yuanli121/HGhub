export const meta = {
  id: 'tangxin',
  name: '糖心Vlog',
  version: '1.0.1',
  protocol: 1,
  description: '糖心Vlog（tangxinvlog.pro）：全部作品 / 博主 / 题材标签分类，站内搜索（基于站点 search-index.json），HLS(AES-128) 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['tangxinvlog.pro'],
  defaultHeaders: {
    Referer: 'https://tangxinvlog.pro/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://tangxinvlog.pro';
const MEDIA = 'https://t.5gcdn.xyz/videos';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default function (hg) {
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers() { return { 'User-Agent': UA, Referer: SITE + '/' }; }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(h) {
    h = String(h || '');
    if (!h) return '';
    if (/^https?:\/\//i.test(h)) return h;
    if (h.indexOf('//') === 0) return 'https:' + h;
    return SITE + (h.charAt(0) === '/' ? h : '/' + h);
  }

  async function fetchRes(url, ctx, type) {
    return hg.http.fetch({
      url: encodeUrl(url.indexOf('http') === 0 ? url : SITE + url),
      headers: headers(), responseType: type || 'text', timeoutMs: 20000, retry: 1, maxBytes: 8 * 1024 * 1024, signal: ctx && ctx.signal,
    });
  }
  async function fetchHtml(url, ctx, soft) {
    const res = await fetchRes(url, ctx);
    if (res.status === 404 && soft) return null;
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  function slugOf(h) { const m = String(h || '').match(/\/videos\/([0-9a-f]{10})\//); return m ? m[1] : ''; }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const nodes = doc.select('a.video-card');
    const items = [];
    const seen = {};
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const id = slugOf(a.attr('href'));
      if (!id || seen[id]) continue;
      const t = a.first('.title');
      const title = clean(a.attr('title') || (t ? t.text() : ''));
      if (!title) continue;
      seen[id] = 1;
      const it = { id, title, type: 'movie' };
      const img = a.first('img');
      const cover = img && (img.attr('src') || img.attr('data-src'));
      if (cover) it.cover = absUrl(cover);
      const d = a.first('.duration');
      if (d) { const x = clean(d.text()); if (x) it.badge = x.slice(0, 8); }
      const au = a.first('.meta span');
      if (au) { const n = clean(au.text()); if (n) it.author = { id: n, name: n }; }
      items.push(it);
    }
    return items;
  }

  // 下一页以分页条里 rel="next" 链接为准
  function nextCursor(html) {
    const m = html.match(/<a href="([^"]+)"[^>]*rel="next"/);
    return m && m[1].charAt(0) === '/' ? m[1] : null;
  }

  async function listPath(path, ctx) {
    const html = await fetchHtml(path, ctx, true);
    if (html === null) return { items: [], next: null };
    const items = parseCards(html);
    return { items, next: items.length ? nextCursor(html) : null };
  }

  let catCache = null;
  async function loadCategories(ctx) {
    if (catCache) return catCache;
    const tree = [{ id: 'all', label: '全部作品' }];
    try {
      const html = await fetchHtml('/artists/', ctx);
      const doc = hg.html.parse(html);
      const kids = [];
      doc.select('a.artist-card').forEach(function (a) {
        const m = String(a.attr('href') || '').match(/^\/artists\/([^/]+)\/$/);
        const n = a.first('.name');
        if (m && n) kids.push({ id: 'a:' + decodeURIComponent(m[1]), label: clean(n.text()) });
      });
      if (kids.length) tree.push({ id: 'artists', label: '博主', children: kids.slice(0, 100) });
    } catch (e) { /* 忽略 */ }
    try {
      const html = await fetchHtml('/tags/', ctx);
      const doc = hg.html.parse(html);
      const kids = [];
      const seen = {};
      doc.select('a.tag-link').forEach(function (a) {
        const m = String(a.attr('href') || '').match(/^\/tags\/([^/]+)\/$/);
        if (!m) return;
        let name = decodeURIComponent(m[1]);
        if (seen[name]) return;
        seen[name] = 1;
        const label = clean(a.text()).replace(/\s*\d+$/, '') || name;
        kids.push({ id: 't:' + name, label });
      });
      // 站点有 184 个标签、91 个博主，宿主 children 上限 100：超出会被丢弃并报 warn。
      // 标签页本身按条目数降序（丝袜 382 → 长尾个位数），取前 100 即保留热门，丢的都是冷标签。
      if (kids.length) tree.push({ id: 'tags', label: '题材标签', children: kids.slice(0, 100) });
    } catch (e) { /* 忽略 */ }
    catCache = tree;
    return tree;
  }

  function pathOfCategory(id) {
    if (id === 'all') return '/videos/';
    if (id.indexOf('a:') === 0) return '/artists/' + encodeURIComponent(id.slice(2)) + '/';
    if (id.indexOf('t:') === 0) return '/tags/' + encodeURIComponent(id.slice(2)) + '/';
    return '';
  }

  // 搜索索引：[slug, 标题, 博主, [标签], 时长, mediaId, 备用标题]
  async function searchIndex(ctx) {
    const page = await fetchHtml('/search/', ctx);
    const m = page.match(/data-index="([^"]+)"/);
    const res = await fetchRes(m ? m[1].replace(/&amp;/g, '&') : '/search-index.json', ctx, 'json');
    if (!res.ok || !Array.isArray(res.data)) fail('UPSTREAM_ERROR', '搜索索引暂时不可用');
    return res.data;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const out = [];
        const r = await listPath('/videos/', ctx);
        if (r.items.length) out.push({ id: 'latest', title: '最新作品', layout: 'grid', imageAspect: 'landscape', items: r.items });
        return { items: out, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) { return loadCategories(ctx); },
      async list(params, ctx) {
        const cur = params && params.cursor;
        if (cur) {
          if (cur.charAt(0) !== '/') fail('INVALID_ARGUMENT', '游标无效');
          return listPath(cur, ctx);
        }
        const path = pathOfCategory((params && params.categoryId) || 'all');
        if (!path) fail('INVALID_ARGUMENT', '未知分类');
        const r = await listPath(path, ctx);
        if (!r.items.length && !r.next) {
          // 首页就没有内容：分类不存在或已清空
          const html = await fetchHtml(path, ctx, true);
          if (html === null) fail('NOT_FOUND', '分类不存在');
        }
        return r;
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim().toLowerCase() : '';
        if (!q) return { items: [], next: null };
        const offset = Math.max(0, parseInt((params && params.cursor) || '0', 10) || 0);
        const PAGE = 24;
        const idx = await searchIndex(ctx);
        const terms = q.split(/\s+/).filter(Boolean);
        const hits = idx.filter(function (r) {
          const hay = (String(r[1] || '') + ' ' + String(r[2] || '') + ' ' + (r[3] || []).join(' ') + ' ' + String(r[6] || '')).toLowerCase();
          return terms.every(function (t) { return hay.indexOf(t) >= 0; });
        });
        const slice = hits.slice(offset, offset + PAGE);
        const items = slice.map(function (r) {
          const it = { id: r[0], title: clean(r[1]), type: 'movie' };
          if (r[5]) it.cover = MEDIA + '/' + r[5] + '/cover.jpg';
          if (r[4]) it.badge = String(r[4]).slice(0, 8);
          if (r[2]) it.author = { id: r[2], name: r[2] };
          if (r[3] && r[3].length) it.tags = r[3];
          return it;
        });
        return { items, next: offset + PAGE < hits.length ? String(offset + PAGE) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '');
        if (!/^[0-9a-f]{10}$/.test(id)) fail('INVALID_ARGUMENT', '作品 ID 无效');
        const html = await fetchHtml('/videos/' + id + '/', ctx, true);
        if (html === null) fail('NOT_FOUND', '视频不存在或已删除');
        const doc = hg.html.parse(html);
        const og = function (p) { const e = doc.first('meta[property="' + p + '"]'); return e ? e.attr('content') : ''; };
        const h1 = doc.first('h1');
        const title = clean(h1 ? h1.text() : og('og:title').replace(/\s*\|\s*糖心Vlog\s*$/, ''));
        const detail = {
          id, title: title || id, type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id, index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        const cover = og('og:image'); if (cover) detail.cover = absUrl(cover);
        const desc = clean(og('og:description')); if (desc) detail.description = desc;
        const tags = doc.select('a.tag-link').map(function (a) { return clean(a.text()); }).filter(Boolean);
        if (tags.length) detail.tags = tags.slice(0, 12);
        const ld = html.match(/"duration":"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
        if (ld) detail.durationSec = (+ld[1] || 0) * 3600 + (+ld[2] || 0) * 60 + (+ld[3] || 0);
        const ar = html.match(/"position":3,"name":"([^"]+)","item":"[^"]*\/artists\//);
        if (ar) detail.author = { id: ar[1], name: ar[1] };
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && (params.episodeId || params.mediaId)) || '');
        if (!/^[0-9a-f]{10}$/.test(id)) fail('INVALID_ARGUMENT', '分集 ID 无效');
        const html = await fetchHtml('/videos/' + id + '/', ctx, true);
        if (html === null) fail('NOT_FOUND', '视频不存在或已删除');
        const m = html.match(/https:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/);
        if (!m) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        // 该 CDN 无 Referer 时 403（m3u8 / enc.key / 分片都要）
        return { streams: [{ url: m[0].replace(/&amp;/g, '&'), kind: 'media', format: 'hls', headers: headers(), label: '默认' }] };
      },
    },
  };
}
