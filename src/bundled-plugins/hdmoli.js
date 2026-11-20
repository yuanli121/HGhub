export const meta = {
  id: 'hdmoli',
  name: 'hdmoli',
  version: '2.0.0',
  protocol: 1,
  description: 'HDmoli：电影/剧集/动画分类与搜索。站点已改为网盘资源站，播放会跳转夸克/百度网盘。',
  author: 'community',
  kind: 'source',
  linkDomains: ['www.hdmoli.com', 'hdmoli.com', 'hdmoli.pro'],
  defaultHeaders: {
    Referer: 'https://www.hdmoli.com/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; M2007J3SC Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/77.0.3865.120 Mobile Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

// hdmoli.pro 已 302 到首页；新域名 www.hdmoli.com（2026-11）
const SITE = 'https://www.hdmoli.com';
const UA = 'Mozilla/5.0 (Linux; Android 11; M2007J3SC Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/77.0.3865.120 Mobile Safari/537.36';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '剧集', type: 'series' },
  { id: '41', label: '动画', type: 'anime' },
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

  async function fetchJson(url, ctx, label) {
    const res = await hg.http.fetch({
      url,
      headers: headers(),
      responseType: 'json',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
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
    try { return new URL(absUrl(href)).pathname; } catch (_) { return String(href || ''); }
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
    const nodes = doc.select('.myui-vodlist li, .myui-vodlist__media li');   // 搜索页用 __media 列表
    const seen = {};
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('.myui-vodlist__thumb') || nodes[i].first('a');
      if (!a) continue;
      const href = a.attr('href');
      const title = a.attr('title') || a.text();
      if (!href || !title) continue;
      const img = a.first('img');
      const cover = a.attr('data-original') || (img && (img.attr('data-original') || img.attr('src'))) || a.attr('src');
      const id = pathId(href);
      if (seen[id]) continue;   // 同一卡片在 .myui-vodlist > li 与 .myui-vodlist li 两个选择器下会重复命中
      seen[id] = 1;
      const item = { id, title: title.trim(), type: typeHint || 'other' };
      if (cover) item.cover = absUrl(cover);
      const tag = nodes[i].first('.pic-text') || nodes[i].first('.pic-tag');
      if (tag && tag.text().trim()) item.badge = tag.text().trim().slice(0, 8);
      items.push(item);
    }
    return items;
  }

  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function decryptUrl(encData) {
    const raw = hg.codec.base64Decode(encData);
    const key = 'ItLdg666';
    let mid = '';
    for (let i = 0; i < raw.length; i++) {
      mid += String.fromCharCode(raw[i] ^ key.charCodeAt(i % 8));
    }
    return latin1(hg.codec.base64Decode(mid));
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
        const html = await fetchHtml(origin() + '/mlist/index1-1.html', ctx);
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
        const html = await fetchHtml(origin() + '/mlist/index' + id + '-' + page + '.html', ctx);
        const items = parseCards(html, typeOf(id));
        const more = html.indexOf('/mlist/index' + id + '-' + (page + 1) + '.html') >= 0;
        return { items, next: items.length && more ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        // 新站表单字段 searchkey（旧 searchword 会提示「关键字不能为空」）；page 从 0 开始
        const html = await fetchHtml(origin() + '/search.php?page=' + (page - 1) + '&searchkey=' + encodeURIComponent(q) + '&searchtype=', ctx);
        const items = parseCards(html);
        const more = html.indexOf('page=' + page + '&searchkey=') >= 0;   // 下一页链接（page 参数从 0 起）
        return { items, next: items.length && more ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const html = await fetchHtml(absUrl(id), ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.myui-content__detail h1');
        const title = titleEl ? titleEl.text().trim() : String(id);
        // 新站无在线播放：详情页 .resource-option[data-url] 给出夸克/百度网盘地址，每个网盘作为一「集」
        const opts = doc.select('.resource-option[data-url]');
        const episodes = [];
        const seenUrl = {};
        for (let i = 0; i < opts.length; i++) {
          const url = opts[i].attr('data-url');
          if (!url || seenUrl[url]) continue;
          seenUrl[url] = 1;
          const name = (opts[i].attr('data-name') || '网盘').trim();
          episodes.push({ id: 'pan:' + url, index: episodes.length + 1, label: name, title: name + '（外部打开）' });
        }
        if (!episodes.length) fail('NOT_FOUND', '该作品暂无可用网盘资源');
        const playlists = [{ id: 'pan', label: '网盘资源', kind: 'other', episodes }];
        return {
          id: pathId(id),
          title,
          type: 'movie',
          description: (function () { const d = doc.first('.myui-content__detail .data, .content .data, meta[name=description]'); return d ? (d.attr('content') || d.text()).trim().slice(0, 400) : undefined; })(),
          playlists,
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        if (episodeId.indexOf('pan:') === 0) {
          const url = episodeId.slice(4);
          const app = /quark/.test(url) ? '夸克网盘' : /baidu/.test(url) ? '百度网盘' : '网盘';
          return { streams: [{ url, kind: 'external', label: app, external: { app } }] };
        }
        const html = await fetchHtml(absUrl(episodeId), ctx);
        const m = html.match(/var now="([^"]+)"/);
        if (!m) fail('UPSTREAM_CHANGED', '未找到播放变量');
        const encUrl = m[1].split('|')[0];
        if (encUrl.endsWith('.mp4')) {
          const url = 'https://v.damoli.pro/v/' + encUrl;
          return {
            streams: [{
              url,
              kind: 'media',
              format: 'progressive',
              headers: headers(),
            }],
          };
        }
        const api = encUrl.length === 32
          ? origin() + '/api/webvideo.php?url=' + encodeURIComponent(encUrl) + '&type=json'
          : origin() + '/api/webvideo_ty.php?url=' + encodeURIComponent(encUrl) + '&type=json';
        const body = await fetchJson(api, ctx, '解析');
        if (!body || !body.url) fail('UPSTREAM_CHANGED', '解析接口无地址');
        const playUrl = decryptUrl(body.url);
        if (!playUrl) fail('UPSTREAM_CHANGED', '播放地址解密失败');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: headers(),
          }],
        };
      },
    },
  };
}
