export const meta = {
  id: 'madou',
  name: '麻豆社',
  version: '1.0.3',
  protocol: 1,
  description: '麻豆社：分类、搜索、详情与 HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['madou.club'],
  defaultHeaders: {
    Referer: 'https://madou.club/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://madou.club';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.excerpts-wrapper article');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a');
      const h2 = nodes[i].first('h2');
      const href = a && a.attr('href');
      const title = h2 ? h2.text() : (a && a.attr('title'));
      if (!href || !title) continue;
      const img = nodes[i].first('img');
      const cover = img && (img.attr('data-src') || img.attr('src'));
      const noteEl = nodes[i].first('.post-view');
      const item = { id: absUrl(href), title: title.trim(), type: 'movie' };
      if (cover) item.cover = absUrl(cover);
      if (noteEl) {
        const note = noteEl.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  async function loadTabs(ctx) {
    const html = await fetchHtml(origin() + '/', ctx);
    const doc = hg.html.parse(html);
    const links = doc.select('.sitenav a');
    const items = [];
    const ignore = ['首页', '其他', '热门标签', '筛选'];
    for (let i = 0; i < links.length; i++) {
      const name = links[i].text().trim();
      const href = links[i].attr('href');
      if (!name || !href) continue;
      if (ignore.some(function (x) { return name.indexOf(x) >= 0; })) continue;
      if (/\/(week|month)\/?$/.test(href)) continue;   // 7天/30天热门：站点页面为空（excerpts-none，2026-11 实测）
      items.push({ id: absUrl(href), label: name });
    }
    return items.length ? items : [{ id: origin() + '/', label: '首页' }];
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/', ctx);
        return { items: [{ id: 'latest', title: '最新', layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadTabs(ctx);
      },
      async list(params, ctx) {
        const cat = (params && params.categoryId) || origin() + '/';
        const page = pageOf(params && params.cursor);
        let url = absUrl(cat);
        if (page > 1) url = url.replace(/\/?$/, '') + '/page/' + page;
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        // 只有页面里出现 /page/{N+1} 链接才有下一页（小分类不足一页，/page/2 会 404；点赞排行是单页）
        const more = html.indexOf('/page/' + (page + 1)) >= 0;
        return { items, next: items.length && more ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/page/' + page + '?s=' + encodeURIComponent(q), ctx);
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
        const titleEl = doc.first('h1') || doc.first('.article-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const img = doc.first('.article-content img') || doc.first('img');
        const cover = img && (img.attr('data-src') || img.attr('src'));
        const detail = {
          id: absUrl(id),
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: absUrl(id), index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
        if (cover) detail.cover = absUrl(cover);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const doc = hg.html.parse(html);
        const iframe = doc.first('.article-content iframe') || doc.first('iframe');
        const src = iframe && iframe.attr('src');
        if (!src) fail('UPSTREAM_CHANGED', '未找到播放框');
        const dash = (absUrl(src).match(/^(https?:\/\/[^/]+)/) || [])[1];
        const dashHtml = await fetchHtml(absUrl(src), ctx);
        const token = (dashHtml.match(/var token = "(.+)";/) || [])[1];
        const m3u8 = (dashHtml.match(/var m3u8 = '(.+)';/) || [])[1];
        if (!dash || !token || !m3u8) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        const playUrl = dash + m3u8 + '?token=' + token;
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: 'hls',
            headers: headers(),
          }],
        };
      },
    },
  };
}
