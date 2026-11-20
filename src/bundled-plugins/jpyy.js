export const meta = {
  id: 'jpyy',
  name: '金牌影视',
  version: '1.0.1',
  protocol: 1,
  description: '金牌影视匿名接口：分类、搜索、详情与播放。签名用 MD5+SHA1。',
  author: 'community',
  kind: 'source',
  linkDomains: ['jiabaide.cn', 'www.jiabaide.cn', 'm.jiabaide.cn'],
  defaultHeaders: {
    Referer: 'https://www.jiabaide.cn/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.jiabaide.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SIGN_KEY = 'cb808529bae6b6be45ecfab29a4889bc';
const TABS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视剧', type: 'series' },
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

  function signedHeaders(urlOrQuery) {
    const dataStr = String(urlOrQuery).includes('?') ? String(urlOrQuery).split('?')[1] : String(urlOrQuery);
    const t = Date.now();
    const signStr = dataStr + '&key=' + SIGN_KEY + '&t=' + t;
    const md5hex = hg.codec.hexEncode(hg.crypto.digest('md5', signStr));
    const sign = hg.codec.hexEncode(hg.crypto.digest('sha1', md5hex));
    return {
      'User-Agent': UA,
      deviceId: hg.crypto.randomUUID(),
      t: String(t),
      sign,
    };
  }

  async function getJson(url, ctx, label, signSource) {
    const res = await hg.http.fetch({
      url,
      headers: signedHeaders(signSource || url),
      responseType: 'json',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
    if (!res.data || typeof res.data !== 'object') fail('UPSTREAM_CHANGED', (label || '接口') + '返回结构已变化');
    return res.data;
  }

  async function getText(url, ctx, label) {
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA },
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '页面') + '暂时不可用（HTTP ' + res.status + '）');
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
      if (!e || e.vodId == null) continue;
      const name = String(e.vodName || '');
      if (!name || name.includes('预告')) continue;
      const item = { id: String(e.vodId), title: name, type: typeHint || 'other' };
      if (e.vodPic) item.cover = e.vodPic;
      const score = Number(e.vodDoubanScore);
      if (Number.isFinite(score) && score > 0) item.score = score > 10 ? score / 10 : score;
      if (e.vodRemarks) item.badge = String(e.vodRemarks).replace(/\|.*/, '').slice(0, 8);
      const year = parseInt(String(e.vodPubdate || ''), 10);
      if (Number.isFinite(year) && year > 1900) item.year = year;
      out.push(item);
    }
    return out;
  }

  function guessFormat(url) {
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    if (/\.mp4(\?|$)/i.test(url)) return 'progressive';
    return 'hls';
  }

  return {
    endpoints: {
      list() {
        return [{ id: 'main', label: '主站', url: SITE }];
      },
    },

    home: {
      async getSections(params, ctx) {
        const qs = 'area=&filterStatus=1&lang=&pageNum=1&pageSize=30&sort=1&sortBy=1&type=&type1=1&v_class=&year=';
        const body = await getJson(origin() + '/api/mw-movie/anonymous/video/list?' + qs, ctx, '首页');
        const list = body.data && body.data.list;
        return { items: [{ id: 'movie', title: '电影', layout: 'grid', items: mapCards(list, 'movie') }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '1';
        const page = pageOf(params && params.cursor);
        const qs = 'area=&filterStatus=1&lang=&pageNum=' + page + '&pageSize=30&sort=1&sortBy=1&type=&type1=' + encodeURIComponent(id) + '&v_class=&year=';
        const body = await getJson(origin() + '/api/mw-movie/anonymous/video/list?' + qs, ctx, '分类');
        const items = mapCards(body.data && body.data.list, typeOf(id));
        return { items, next: items.length >= 30 ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const path = origin() + '/api/mw-movie/anonymous/video/searchByWordPageable?keyword=' + encodeURIComponent(q) + '&pageNum=' + page + '&pageSize=12&type=false';
        const key = 'searchByWordPageable?keyword=' + q + '&pageNum=' + page + '&pageSize=12&type=false';
        const body = await getJson(path, ctx, '搜索', key);
        const items = mapCards(body.data && body.data.list);
        return { items, next: items.length >= 12 ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const mobile = origin().replace('www.', 'm.');
        const html = await getText(mobile + '/detail/' + encodeURIComponent(id), ctx, '详情');
        const m = html.match(/episodeList.*?\[.*?\}\]\}/);
        if (!m) fail('UPSTREAM_CHANGED', '未解析到分集');
        let parsed;
        try {
          parsed = JSON.parse('{"' + m[0].replace(/\\"/g, '"'));
        } catch (_) {
          fail('UPSTREAM_CHANGED', '分集结构已变化');
        }
        const list = parsed && parsed.episodeList;
        if (!Array.isArray(list) || !list.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const episodes = [];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const nid = e.nid != null ? String(e.nid) : String(i + 1);
          episodes.push({
            id: nid,
            index: i + 1,
            episodeNumber: i + 1,
            label: String(e.name || i + 1),
          });
        }
        const titleM = html.match(/<title>([^<]+)<\/title>/);
        const title = titleM ? titleM[1].replace(/[-_|].*$/, '').trim() : String(id);
        return {
          id: String(id),
          title,
          type: episodes.length > 1 ? 'series' : 'movie',
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
      },

      async resolvePlayback(params, ctx) {
        const mediaId = params && params.mediaId;
        const episodeId = params && params.episodeId;
        if (!mediaId || !episodeId) fail('INVALID_ARGUMENT', '缺少播放参数');
        const url = origin() + '/api/mw-movie/anonymous/v2/video/episode/url?id=' + encodeURIComponent(mediaId) + '&nid=' + encodeURIComponent(episodeId);
        const body = await getJson(url, ctx, '播放');
        const list = body.data && body.data.list;
        const playUrl = list && list[0] && list[0].url;
        if (!playUrl) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: playUrl,
            kind: 'media',
            format: guessFormat(playUrl),
            headers: { 'User-Agent': UA, Referer: origin() + '/' },
          }],
        };
      },
    },
  };
}
