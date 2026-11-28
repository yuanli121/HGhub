export const meta = {
  id: 'xingya',
  name: '星芽短剧',
  version: '1.0.4',
  protocol: 1,
  description: '星芽短剧 App 接口：分类、搜索、详情与直链播放。登录令牌保存在插件存储中。',
  author: 'community',
  kind: 'source',
  linkDomains: ['app.whjzjx.cn', 'whjzjx.cn', 'u.shytkjgs.com'],
  defaultHeaders: {
    'User-Agent': 'okhttp/4.10.0',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://app.whjzjx.cn';
const LOGIN = 'https://u.shytkjgs.com/user/v1/account/login';
const TABS = [
  { id: '2', label: '热播剧' },
  { id: '8', label: '会员专享' },
  { id: '7', label: '星选好剧' },
  { id: '3', label: '新剧' },
  { id: '5', label: '阳光剧场' },
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

  function deviceId() {
    let id = hg.settings.get('deviceId');
    return id || '2885ce2d34c9634b287ab022f2f3a6cfb';
  }

  function baseHeaders() {
    return {
      'User-Agent': 'okhttp/4.10.0',
      'Accept-Encoding': 'gzip',
      'x-app-id': '7',
      platform: '1',
      manufacturer: 'asus',
      version_name: '3.3.1',
      user_agent:
        'Mozilla/5.0 (Linux; Android 14; Zenfone 5Z Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36',
      app_version: '3.3.1',
      device_platform: 'android',
      personalized_recommend_status: '1',
      device_type: 'Zenfone+5Z',
      device_brand: 'asus',
      os_version: '14',
      channel: 'default',
      raw_channel: 'default',
      uuid: 'randomUUID_9e91d3ce-8658-4d6e-9d1b-6f351611163d',
      device_id: deviceId(),
      support_h265: '1',
    };
  }

  function decodeJwtExp(token) {
    try {
      const parts = String(token).split('.');
      if (parts.length < 2) return 0;
      let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) payload += '=';
      const json = JSON.parse(hg.codec.utf8Decode(hg.codec.base64Decode(payload)));
      return Number(json.exp) || 0;
    } catch (_) {
      return 0;
    }
  }

  async function getToken() {
    const cached = await hg.storage.get('xingya-token');
    if (cached && typeof cached === 'string') {
      const exp = decodeJwtExp(cached);
      if (exp && Math.floor(Date.now() / 1000) < exp - 60) return cached;
    }
    const h = baseHeaders();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await hg.http.fetch({
      url: LOGIN,
      method: 'POST',
      headers: h,
      body: { form: { device: deviceId() } },
      responseType: 'json',
      timeoutMs: 25000,
      retry: 2,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '登录暂时不可用（HTTP ' + res.status + '）');
    const token = res.data && res.data.data && res.data.data.token;
    if (!token) fail('UPSTREAM_CHANGED', '登录返回结构已变化');
    await hg.storage.set('xingya-token', token, { ttlSec: 86400 * 6 });
    return token;
  }

  async function authHeaders() {
    const h = baseHeaders();
    h.authorization = await getToken();
    return h;
  }

  async function getJson(url, ctx, label, opt) {
    const headers = await authHeaders();
    const req = {
      url,
      headers,
      responseType: 'json',
      timeoutMs: 25000,   // 接口偶发 9–12s 慢响应
      retry: 2,
      signal: ctx && ctx.signal,
    };
    if (opt && opt.method === 'POST') {
      req.method = 'POST';
      req.body = { json: opt.json || {} };
      headers['Content-Type'] = 'application/json';
    }
    const res = await hg.http.fetch(req);
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
    if (!res.data || typeof res.data !== 'object') fail('UPSTREAM_CHANGED', (label || '接口') + '返回结构已变化');
    return res.data;
  }

  function cardItem(raw) {
    if (!raw) return null;
    const id = raw.id != null ? String(raw.id) : '';
    const title = String(raw.title || '').trim();
    if (!id || !title) return null;
    const item = { id, title, type: 'short' };
    if (raw.cover_url) item.cover = raw.cover_url;
    const total = Number(raw.total);
    if (Number.isFinite(total) && total > 0) {
      item.totalEpisodes = total;
      item.episodeCount = total;
      item.badge = total + '集';
    }
    return item;
  }

  function mapList(rows) {
    const out = [];
    if (!Array.isArray(rows)) return out;
    for (let i = 0; i < rows.length; i++) {
      const theater = rows[i] && rows[i].theater ? rows[i].theater : rows[i];
      const item = cardItem(theater);
      if (item) out.push(item);
    }
    return out;
  }

  return {
    endpoints: {
      list() {
        return [{ id: 'main', label: '主站', url: SITE }];
      },
    },

    home: {
      async getSections(params, ctx) {
        const body = await getJson(
          origin() + '/cloud/v2/theater/home_page?theater_class_id=2&type=1&page_num=1&page_size=24',
          ctx,
          '首页',
        );
        const items = mapList(body.data && body.data.list);
        return { items: [{ id: 'hot', title: '热播剧', layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return TABS.map(function (t) { return { id: t.id, label: t.label }; });
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || '2';
        const page = pageOf(params && params.cursor);
        const body = await getJson(
          origin() + '/cloud/v2/theater/home_page?theater_class_id=' + encodeURIComponent(id) + '&type=1&page_num=' + page + '&page_size=24',
          ctx,
          '分类',
        );
        const all = mapList(body.data && body.data.list);
        // 部分分类（如「星选好剧」）忽略 page_num/page_size，一次返回全部且每页相同：本地按 24 条切片
        if (all.length > 24) {
          const start = (page - 1) * 24;
          const items = all.slice(start, start + 24);
          return { items, next: start + 24 < all.length ? String(page + 1) : null };
        }
        return { items: all, next: all.length >= 24 ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const body = await getJson(origin() + '/v3/search', ctx, '搜索', {
          method: 'POST',
          json: { text: encodeURIComponent(q) },
        });
        const rows = body.data && body.data.theater && body.data.theater.search_data;
        return { items: mapList(rows), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const body = await getJson(
          origin() + '/v2/theater_parent/detail?theater_parent_id=' + encodeURIComponent(id),
          ctx,
          '详情',
        );
        const data = body.data || {};
        const theaters = Array.isArray(data.theaters) ? data.theaters : [];
        const episodes = [];
        for (let i = 0; i < theaters.length; i++) {
          const ep = theaters[i];
          const num = Number(ep.num);
          const index = Number.isFinite(num) && num > 0 ? num : i + 1;
          episodes.push({
            id: String(index),
            index,
            episodeNumber: index,
            label: String(index),
          });
        }
        if (!episodes.length) fail('UPSTREAM_CHANGED', '未解析到分集');
        const title = String(data.title || (theaters[0] && theaters[0].title) || id);
        const item = {
          id: String(id),
          title,
          type: 'short',
          playlists: [{ id: 'main', label: '默认', episodes }],
        };
        const cover = data.cover_url || data.cover;
        if (cover) item.cover = cover;
        if (data.introduction || data.desc) item.description = String(data.introduction || data.desc);
        if (episodes.length) item.totalEpisodes = episodes.length;
        return item;
      },

      async resolvePlayback(params, ctx) {
        const mediaId = params && params.mediaId;
        const episodeId = params && params.episodeId;
        if (!mediaId || !episodeId) fail('INVALID_ARGUMENT', '缺少播放参数');
        const body = await getJson(
          origin() + '/v2/theater_parent/detail?theater_parent_id=' + encodeURIComponent(mediaId),
          ctx,
          '播放',
        );
        const theaters = body.data && Array.isArray(body.data.theaters) ? body.data.theaters : [];
        let url = '';
        for (let i = 0; i < theaters.length; i++) {
          if (String(theaters[i].num) === String(episodeId) || String(i + 1) === String(episodeId)) {
            url = theaters[i].son_video_url;
            break;
          }
        }
        if (!url && theaters[0]) url = theaters[0].son_video_url;
        if (!url) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        // 接口下发的是 http://qcapp.xingya.com.cn/...，宿主只接受 https（未声明 allowInsecureHttp），
        // 否则流会被全部丢弃并报「没有合法可播放流」。同域 https 实测可用（2026-11-21）。
        url = String(url).replace(/^http:\/\//i, 'https://');
        return {
          streams: [{
            url,
            kind: 'media',
            format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive',
          }],
        };
      },
    },
  };
}
