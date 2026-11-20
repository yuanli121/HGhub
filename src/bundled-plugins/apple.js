export const meta = {
  id: 'apple',
  name: '小苹果',
  version: '1.0.1',
  protocol: 1,
  description: '小苹果影视 App 接口：分类、搜索、详情与 HLS 播放。上游为 HTTP。',
  author: 'community',
  kind: 'source',
  allowInsecureHttp: true,
  linkDomains: ['c.xpgtv.net', 'item.xpgcom.com'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'http://c.xpgtv.net';
const UA = 'okhttp/3.12.11';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视', type: 'series' },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动漫', type: 'anime' },
];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function getJson(path, ctx, label) {
    const res = await hg.http.fetch({
      url: origin() + path,
      headers: { 'User-Agent': UA },
      responseType: 'json',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
    if (!res.data || typeof res.data !== 'object') fail('UPSTREAM_CHANGED', (label || '接口') + '返回结构已变化');
    return res.data;
  }

  function typeOf(categoryId) {
    for (let i = 0; i < TABS.length; i++) {
      if (TABS[i].id === categoryId) return TABS[i].type;
    }
    return 'other';
  }

  function mapCards(rows, typeHint) {
    const out = [];
    if (!Array.isArray(rows)) return out;
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (!e || e.id == null || !e.name) continue;
      const item = {
        id: String(e.id),
        title: String(e.name),
        type: typeHint || 'other',
      };
      if (e.pic) item.cover = e.pic;
      if (e.state) item.badge = String(e.state).slice(0, 8);
      out.push(item);
    }
    return out;
  }

  function playHeaders() {
    return {
      token2: 'SnAXiSW8vScXE0Z9aDOnK5xffbO75w1+uPom3WjnYfVEA1oWtUdi2Ihy1N8=',
      token: 'ElEDlwCVgXcFHFhddiq2JKteHofExRBUrfNlmHrWetU3VVkxnzJAodl52N9EUFS+Dig2A/fBa/V9RuoOZRBjYvI+GW8kx3+xMlRecaZuECdb/3AdGkYpkjW3wCnpMQxf8vVeCz5zQLDr8l8bUChJiLLJLGsI+yiNskiJTZz9HiGBZhZuWh1mV1QgYah5CLTbSz8=',
      version: 'XPGBOX com.phoenix.tv1.5.7',
      user_id: 'XPGBOX',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
      screenx: '1280',
      screeny: '720',
      hash: 'd78a',
      timestamp: '1743060300',
    };
  }

  return {
    endpoints: {
      list() {
        return [{ id: 'main', label: '主站', url: SITE }];
      },
    },

    home: {
      async getSections(params, ctx) {
        const body = await getJson('/api.php/v2.vod/androidfilter10086?page=1&type=1', ctx, '首页');
        return { items: [{ id: 'movie', title: '电影', layout: 'grid', items: mapCards(body.data, 'movie') }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
        const page = pageOf(params && params.cursor);
        const body = await getJson('/api.php/v2.vod/androidfilter10086?page=' + page + '&type=' + encodeURIComponent(id), ctx, '分类');
        const items = mapCards(body.data, typeOf(id));
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const body = await getJson(
          '/api.php/v2.vod/androidsearch10086?page=' + page + '&wd=' + encodeURIComponent(q),
          ctx,
          '搜索',
        );
        const items = mapCards(body.data);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const body = await getJson('/api.php/v3.vod/androiddetail2?vod_id=' + encodeURIComponent(id), ctx, '详情');
        const data = body.data || {};
        const urls = Array.isArray(data.urls) ? data.urls : [];
        const episodes = [];
        let index = 0;
        for (let i = 0; i < urls.length; i++) {
          const e = urls[i];
          if (!e || !e.key) continue;
          if (String(e.key).includes('及时雨')) continue;
          index += 1;
          episodes.push({
            id: String(e.url || e.key),
            index,
            episodeNumber: index,
            label: String(e.key),
            title: String(e.key),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const item = {
          id: String(id),
          title: String(data.name || data.vod_name || id),
          type: episodes.length > 1 ? 'series' : 'movie',
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
        if (data.pic || data.vod_pic) item.cover = data.pic || data.vod_pic;
        if (data.content || data.vod_content) item.description = String(data.content || data.vod_content);
        return item;
      },

      async resolvePlayback(params) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const url = origin() + '/m3u8/' + episodeId + '.m3u8';
        return {
          streams: [{
            url,
            kind: 'media',
            format: 'hls',
            headers: playHeaders(),
          }],
        };
      },
    },
  };
}
