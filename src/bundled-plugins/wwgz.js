export const meta = {
  id: 'wwgz',
  name: '农民影视',
  version: '1.0.3',
  protocol: 1,
  description: '农民影视：分类、搜索、多线路详情与 nmvod 播放解析。',
  author: 'community',
  kind: 'source',
  linkDomains: ['vip.wwgz.cn', 'api.nmvod.me'],
  defaultHeaders: {
    Referer: 'https://vip.wwgz.cn:5200/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://vip.wwgz.cn:5200';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '连续剧', type: 'series' },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动漫', type: 'anime' },
  { id: '26', label: '短剧', type: 'short' },
];

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

  async function fetchHtml(url, ctx, extra) {
    const res = await hg.http.fetch({
      url,
      headers: Object.assign(headers(), extra || {}),
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
    try { return new URL(absUrl(href)).pathname + (new URL(absUrl(href)).search || ''); } catch (_) { return String(href || ''); }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function typeOf(id) {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i].type;
    return 'other';
  }

  function parseCards(html, typeHint) {
    const doc = hg.html.parse(html);
    const items = [];
    const nodes = doc.select('.globalPicList > ul li, .globalPicList li, #search_main ul li');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('a');
      if (!a) continue;
      const href = a.attr('href');
      const title = a.attr('title') || a.text();
      if (!href || !title) continue;
      const img = nodes[i].first('img');
      const cover = img && img.attr('src');
      const noteEl = nodes[i].first('.sDes');
      const item = { id: pathId(href), title: title.trim(), type: typeHint || 'other' };
      if (cover) item.cover = absUrl(cover);
      if (noteEl) {
        const note = noteEl.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    if (/\.mp4(\?|$)/i.test(url)) return 'progressive';
    return 'hls';
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/vod-list-id-1-pg-1-order--by-time-class-0-year-0-letter--area--lang-.html', ctx);
        return { items: [{ id: 'movie', title: '电影', layout: 'grid', items: parseCards(html, 'movie') }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
        const page = pageOf(params && params.cursor);
        const url = origin() + '/vod-list-id-' + id + '-pg-' + page + '-order--by-time-class-0-year-0-letter--area--lang-.html';
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html, typeOf(id));
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const res = await hg.http.fetch({
          url: origin() + '/index.php?m=vod-search',
          method: 'POST',
          headers: headers(),
          body: { form: { wd: q } },
          responseType: 'text',
          timeoutMs: 15000,
          maxBytes: 8 * 1024 * 1024,
          signal: ctx && ctx.signal,
        });
        if (!res.ok) fail('UPSTREAM_ERROR', '搜索暂时不可用（HTTP ' + res.status + '）');
        // 站点搜索模板缺失时返回「缺少文件：…vod_search.html」（2026-11 起，PC/WAP 均如此）
        if (/缺少文件|vod_search\.html/.test(res.data || '')) fail('UPSTREAM_ERROR', '站点搜索功能已损坏（服务端缺少模板），请从分类浏览');
        return { items: parseCards(res.data), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        const firstA = doc.first('.numList li a');
        if (!firstA || !firstA.attr('href')) fail('UPSTREAM_CHANGED', '未找到分集入口');
        const epHtml = await fetchHtml(absUrl(firstA.attr('href')), ctx);
        const fromM = epHtml.match(/mac_from\s*=\s*'([^']*)'/);
        const urlM = epHtml.match(/mac_url\s*=\s*'([^']+)'/);
        if (!fromM || !urlM) fail('UPSTREAM_CHANGED', '未解析到播放列表');
        const from = fromM[1].split('$$$');
        const urls = urlM[1].split('$$$');
        const playlists = [];
        for (let i = 0; i < from.length; i++) {
          const eps = (urls[i] || '').split('#');
          const episodes = [];
          for (let j = 0; j < eps.length; j++) {
            const parts = eps[j].split('$');
            if (parts.length < 2) continue;
            episodes.push({
              id: encodeURIComponent(parts[1]),
              index: j + 1,
              episodeNumber: j + 1,
              label: from.length === 1 ? from[i] + '-' + parts[0] : parts[0],
            });
          }
          if (episodes.length) playlists.push({ id: String(i + 1), label: from[i], episodes });
        }
        if (!playlists.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        return {
          id: pathId(id),
          title,
          type: playlists[0].episodes.length > 1 ? 'series' : 'movie',
          playlists,
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const playParam = decodeURIComponent(episodeId);
        // 各线路（xiguam3u8 / lzm3u8 …）存的就是 m3u8 直链：直接播。nmvod 解析服务器已失效，仅对非直链兜底
        if (/^https?:\/\/[^\s]+\.(m3u8|mp4)(\?|$)/i.test(playParam)) {
          return { streams: [{ url: playParam, kind: 'media', format: guessFormat(playParam), headers: { 'User-Agent': UA } }] };
        }
        const html = await fetchHtml('https://api.nmvod.me:520/player/?url=' + encodeURIComponent(playParam), ctx, {
          Referer: origin() + '/',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'iframe',
        });
        const match = html.match(/var\s+config\s*=\s*(\{[\s\S]*?\})/);
        const playUrl = match && match[1] && (match[1].match(/url"\s*:\s*"(.+?)"/) || [])[1];
        if (!playUrl) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: { 'User-Agent': UA },
          }],
        };
      },
    },
  };
}
