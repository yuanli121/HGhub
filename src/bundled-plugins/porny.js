export const meta = {
  id: 'porny',
  name: '91Porny（九色）',
  version: '1.0.1',
  protocol: 1,
  description: '91Porny / 九色（91porny.com）：14 个榜单分类、搜索、详情与 HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['91porny.com', 'jiuse3.cloud', 'ucloud165.xyz'],
  defaultHeaders: {
    Referer: 'https://91porny.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://91porny.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 14 个分类均 2026-11 实测各返回 24 条
const CATEGORIES = [
  ['hot-list', '当前最热'], ['top-list', '本月最热'], ['top-last', '上月最热'], ['latest', '最新'],
  ['ori', '原创'], ['hd', '高清'], ['long-list', '10分钟以上'], ['longer-list', '20分钟以上'],
  ['recent-favorite', '最近收藏'], ['top-favorite', '收藏最多'], ['most-favorite', '本月收藏'],
  ['month-discuss', '本月讨论'], ['recent-rating', '最近好评'], ['nonpaid', '免费'],
];

export default function (hg) {
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers() { return { 'User-Agent': UA, Referer: SITE + '/' }; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function abs(u) {
    if (!u) return '';
    u = String(u).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = SITE + u;
    try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); }
  }

  async function fetchHtml(url, ctx) {
    const res = await hg.http.fetch({ url, headers: headers(), responseType: 'text', timeoutMs: 15000, retry: 1, credentials: 'omit', maxBytes: 6 * 1024 * 1024, signal: ctx && ctx.signal });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  function keyOf(href) {
    const m = String(href || '').match(/\/video\/view(?:hd)?\/([0-9A-Za-z]{8,})/);
    return m ? m[1] : '';
  }

  // 下一页：分页条里存在指向 page+1 的链接（/xxx/N+1 或 page=N+1）
  function hasNext(html, page) {
    const i = html.indexOf('class="pagination"');
    if (i < 0) return false;
    const block = html.slice(i, html.indexOf('</ul>', i) + 5);
    const re = /href="([^"]+)"/g;
    let m;
    while ((m = re.exec(block))) {
      const h = m[1].replace(/&amp;/g, '&');
      const n = h.match(/[?&]page=(\d+)/) || h.match(/\/(\d+)\/?$/);
      if (n && parseInt(n[1], 10) === page + 1) return true;
    }
    return false;
  }
  // 当前页（active）与请求页不一致 → 越界回落
  function pageMismatch(html, page) {
    const m = html.match(/page-item active[^>]*>\s*<span class="page-link">(\d+)<\/span>/);
    return m ? parseInt(m[1], 10) !== page : false;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [], seen = {};
    const cards = doc.select('div.video-elem');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const a = c.first('a.display');
      const id = keyOf(a && a.attr('href'));
      if (!id || seen[id]) continue;   // 广告卡 href 指向站外，无 /video/view
      const t = c.first('a.title');
      const title = clean(t ? t.text() : '');
      if (!title) continue;
      seen[id] = 1;
      const it = { id, title, type: 'movie' };
      const img = c.first('img');
      let cover = img && (img.attr('data-src') || img.attr('src'));
      if (cover) it.cover = abs(cover);
      const dur = c.first('small.layer');
      if (dur) { const n = clean(dur.text()); if (n) it.badge = n.slice(0, 8); }
      const au = c.first('a[href^="/author/"]');
      const txt = clean(c.text());
      const v = txt.match(/([0-9.,]+万?)\s*次播放/);
      const sub = [au ? clean(au.text()) : '', v ? v[1] + '次播放' : ''].filter(Boolean).join(' · ');
      if (sub) it.subtitle = sub;
      items.push(it);
    }
    return items;
  }

  async function listUrl(url, page, ctx) {
    const html = await fetchHtml(url, ctx);
    const items = pageMismatch(html, page) ? [] : parseCards(html);
    return { items, next: items.length && hasNext(html, page) ? String(page + 1) : null };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(SITE + '/', ctx);
        const items = parseCards(html);
        const sections = [];
        if (items.length) sections.push({ id: 'index', title: '首页推荐', layout: 'grid', items });
        try {
          const hot = await listUrl(SITE + '/video/category/hot-list', 1, ctx);
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
        const id = (params && params.categoryId) || 'hot-list';
        if (!CATEGORIES.some(function (c) { return c[0] === id; })) fail('INVALID_ARGUMENT', '未知分类：' + id);
        const page = pageOf(params && params.cursor);
        return listUrl(SITE + '/video/category/' + id + (page > 1 ? '/' + page : ''), page, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        // 站点真实搜索路径是 /search?keywords=…（/video/search 会回落到 latest 列表）
        return listUrl(SITE + '/search?keywords=' + encodeURIComponent(q) + (page > 1 ? '&page=' + page : ''), page, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = keyOf('/video/view/' + String((params && params.id) || ''));
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(SITE + '/video/view/' + id, ctx);
        const doc = hg.html.parse(html);
        const og = doc.first('meta[property="og:title"]');
        const h = doc.first('h4.container-title');
        const title = clean((og && og.attr('content')) || (h && h.text()) || id);
        const v = doc.first('video#video-play') || doc.first('video[data-src]');
        const detail = {
          id, title, type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id, index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        const poster = v && v.attr('data-poster');
        if (poster) detail.cover = abs(poster);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = keyOf('/video/view/' + String((params && (params.episodeId || params.mediaId)) || ''));
        if (!id) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(SITE + '/video/view/' + id, ctx);
        const doc = hg.html.parse(html);
        const v = doc.first('video#video-play') || doc.first('video[data-src]');
        let src = v && (v.attr('data-src') || v.attr('src'));
        if (!src) {
          const m = html.replace(/\\\//g, '/').match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/);
          src = m && m[0];
        }
        if (!src) {
          fail('CONTENT_LOCKED', '详情页没有返回可播放地址（可能需要会员）');
        }
        return { streams: [{ url: abs(src), kind: 'media', format: /\.m3u8/i.test(src) ? 'hls' : 'progressive', headers: headers(), label: '默认' }] };
      },
    },
  };
}
