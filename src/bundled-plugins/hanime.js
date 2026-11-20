export const meta = {
  id: 'hanime',
  name: 'Hanime1',
  version: '1.0.4',
  protocol: 1,
  description: 'Hanime1：分类、搜索、详情与直链播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['hanime1.me', 'hanimeone.me'],
  defaultHeaders: {
    Referer: 'https://hanimeone.me/',
    'Accept-Language': 'zh-CN,zh-Hant;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

// hanime1.me 主域被 Cloudflare 人机挑战拦截（任何请求头都 403）；改用官方镜像 hanimeone.me
const SITE = 'https://hanimeone.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function headers() {
    return { 'User-Agent': UA, Referer: origin() + '/', 'Accept-Language': 'zh-CN,zh-Hant;q=0.9' };
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

  // 链接里的中文/空格必须编码，否则站点返回 400（如 genre=裏番）
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return encodeUrl(href);
    if (href.startsWith('//')) return 'https:' + href;
    const o = origin();
    return encodeUrl(href.startsWith('/') ? o + href : o + '/' + href);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    // 新版列表/搜索页卡片：.video-item-container（2026-11 起）
    const cards = doc.select('.video-item-container');
    const seen = {};
    for (let i = 0; i < cards.length; i++) {
      const el = cards[i];
      const a = el.first('a.video-link') || el.first('a');
      const href = a && a.attr('href');
      if (!href || href.indexOf('watch?v=') < 0 || seen[href]) continue;   // 跳过赞助商外链
      seen[href] = 1;
      const t = el.first('.title');
      const title = (el.attr('title') || (t ? t.text() : '')).trim();
      if (!title) continue;
      const img = el.first('img.main-thumb') || el.first('img');
      const item = { id: absUrl(href), title, type: 'anime' };
      const cover = img && img.attr('src');
      if (cover) item.cover = absUrl(cover);
      const dur = el.first('.duration');
      if (dur && dur.text()) item.badge = dur.text().trim().slice(0, 8);
      items.push(item);
    }
    if (items.length) return items;
    let nodes = doc.select('.home-rows-videos-wrapper > a');
    if (!nodes.length) nodes = doc.select('.content-padding-new > .row > .search-doujin-videos.col-xs-6, .col-xs-6');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const overlay = el.first('.overlay');
      const href = el.attr('href') || (overlay && overlay.attr('href'));
      const titleEl = el.first('.home-rows-videos-title') || el.first('.card-mobile-title');
      const title = titleEl ? titleEl.text().trim() : '';
      if (!href || !title) continue;
      const imgs = el.select('img');
      let cover = imgs[0] && imgs[0].attr('src');
      if (cover && cover.indexOf('background') >= 0 && imgs[1]) cover = imgs[1].attr('src');
      const item = { id: absUrl(href), title, type: 'anime' };
      if (cover) item.cover = absUrl(cover);
      items.push(item);
    }
    return items;
  }

  async function loadTabs(ctx) {
    const html = await fetchHtml(origin() + '/', ctx);
    const doc = hg.html.parse(html);
    const links = doc.select('#main-nav-home > a.nav-item');
    const items = [];
    for (let i = 0; i < links.length; i++) {
      const name = links[i].text().trim();
      const href = links[i].attr('href');
      if (!name || !href) continue;
      if (name.indexOf('新番預告') >= 0 || name.indexOf('H漫畫') >= 0) continue;
      if (!/\/search\?/.test(href) || (/^https?:/i.test(href) && href.indexOf(origin().replace(/^https?:\/\//, '')) < 0)) continue;   // 外链广告
      items.push({ id: absUrl(href), label: name });
    }
    return items.length ? items : [{ id: origin() + '/', label: '首页' }];
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    return 'progressive';
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/', ctx);
        return { items: [{ id: 'latest', title: '最新', layout: 'grid', items: parseCards(html).slice(0, 40) }], next: null };
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
        if (page > 1) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page;
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        return { items, next: items.length >= 20 ? String(page + 1) : null };   // 不足一页即最后一页
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const html = await fetchHtml(origin() + '/search?query=' + encodeURIComponent(q) + '&page=' + page, ctx);
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
        const titleEl = doc.first('h3') || doc.first('h1') || doc.first('.video-description-panel h3');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const img = doc.first('video') || doc.first('.video-player img');
        const cover = img && (img.attr('poster') || img.attr('src'));
        const detail = {
          id: absUrl(id),
          title,
          type: 'anime',
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
        // 2026-11 起播放地址在 <video><source src size="1080"> 里，多清晰度；旧版 JSON-LD contentUrl 作回退
        const doc = hg.html.parse(html);
        const streams = [];
        const seen = {};
        const nodes = doc.select('video source[src]');
        for (let i = 0; i < nodes.length; i++) {
          const url = (nodes[i].attr('src') || '').replace(/&amp;/g, '&');
          if (!url || seen[url]) continue;
          seen[url] = 1;
          const h = parseInt(nodes[i].attr('size') || '', 10);
          const st = { url, kind: 'media', format: guessFormat(url), headers: headers() };
          if (Number.isFinite(h) && h > 0) { st.height = h; st.label = h + 'P'; }
          streams.push(st);
        }
        if (!streams.length) {
          const m = html.match(/contentUrl"\s*:\s*"(.*?)"/);
          if (m) streams.push({ url: m[1].replace(/\\\//g, '/'), kind: 'media', format: guessFormat(m[1]), headers: headers() });
        }
        if (!streams.length) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        streams.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });   // 高清在前
        const max = params && params.maxHeight;
        const fit = max ? streams.filter(function (x) { return !x.height || x.height <= max; }) : streams;
        return { streams: fit.length ? fit : streams };
      },
    },
  };
}
