export const meta = {
  id: 'haijiao',
  name: '海角',
  version: '1.0.0',
  protocol: 1,
  description: '海角社区：热门帖、视频帖、最新、视频中心（分类与封面）。列表/详情/封面匿名可用；播放需要登录令牌，在插件设置里填写。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['hj2606029d3.top'],
  defaultHeaders: {
    Referer: 'https://hj2606029d3.top/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 25, playback: 40 },
  settings: [
    { key: 'token', type: 'password', label: '登录令牌（X-User-Token）', description: '在海角网页登录后，从浏览器开发者工具复制 X-User-Token。列表/封面不填也能看，播放必须填。' },
    { key: 'uid', type: 'text', label: '用户 ID（X-User-Id）', description: '与令牌配对，登录态的 User Id。' },
  ],
};

// 封面/图片是 <hash>.txt：正文是「自定义字母表的 base64」，解出来是 "data:image/jpeg;base64,…"，再解一次才是图片
const ALPHABET = 'ABCD*EFGHIJKLMNOPQRSTUVWX#YZabcdefghijklmnopqrstuvwxyz1234567890';

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return 'https://hj2606029d3.top';
  }
  function ua() {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
  }
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function token() {
    const t = hg.settings.get('token');
    return typeof t === 'string' ? t.trim() : '';
  }
  function uid() {
    const t = hg.settings.get('uid');
    return typeof t === 'string' ? t.trim() : '';
  }
  function headers(extra) {
    const h = { 'User-Agent': ua(), Referer: origin() + '/', Accept: 'application/json,text/plain,*/*' };
    const t = token();
    if (t) { h['X-User-Token'] = t; if (uid()) h['X-User-Id'] = uid(); }
    return Object.assign(h, extra || {});
  }

  // 信封 data：1–3 层 Base64 → JSON
  function unwrap(body) {
    let env;
    try { env = JSON.parse(body); } catch (_) { fail('UPSTREAM_CHANGED', '接口返回的不是 JSON（线路可能已变化）'); }
    if (env.errorCode === 1) fail('AUTH_REQUIRED', '需要登录海角才能使用（在插件设置里填写登录令牌）');
    if (env.errorCode) fail('UPSTREAM_ERROR', '接口错误 ' + env.errorCode + ' ' + (env.message || ''));
    if (env.success === false) fail('UPSTREAM_ERROR', env.message || '接口失败');
    let d = env.data;
    if (env.isEncrypted !== true) return d;
    for (let i = 0; i < 5; i++) {
      const t = String(d).trim();
      if (t.charAt(0) === '{' || t.charAt(0) === '[') { try { return JSON.parse(t); } catch (_) {} }
      const pad = '='.repeat((4 - (t.length % 4)) % 4);
      let buf; try { buf = hg.codec.base64Decode(t + pad); } catch (_) { break; }
      d = hg.codec.utf8Decode(buf);
    }
    fail('UPSTREAM_CHANGED', '接口数据解码失败');
  }

  async function api(path, ctx, opt) {
    const o = opt || {};
    const req = { url: origin() + path, headers: headers(o.headers), responseType: 'text', timeoutMs: 20000, retry: 1, signal: ctx && ctx.signal };
    if (o.post) {
      req.method = 'POST';
      req.body = { json: o.post };
      req.headers['Content-Type'] = 'application/json';
      req.headers.Origin = origin();
    }
    const res = await hg.http.fetch(req);
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return unwrap(res.data);
  }

  function absUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return origin() + (u.charAt(0) === '/' ? u : '/' + u);
  }
  // 加密图片：<hash>.txt / .hj → 交给 transformResource 解码
  function imgRef(u) {
    const url = absUrl(u);
    if (!url) return undefined;
    if (/\.(txt|hj)(\?|$)/i.test(url)) return { url, transform: { type: 'plugin', name: 'hjimg' } };
    return url;
  }
  function txt(s) {
    return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
  }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }

  // ---- 列表 ----
  function topicCard(it) {
    const atts = Array.isArray(it.attachments) ? it.attachments : [];
    const video = atts.find(function (a) { return a && a.category === 'video'; });
    const hasVideo = it.hasVideo === true || !!video;
    if (!hasVideo) return null;                 // 纯图文帖无法播放，跳过
    const title = txt(it.title);
    if (!title) return null;
    const id = String(it.topicId);
    const item = { id: 'T' + id, title, type: 'short' };
    const cov = (video && video.coverUrl) || (atts.find(function (a) { return a.category === 'images'; }) || {}).remoteUrl || (it.node && it.node.icon);
    const cover = imgRef(cov);
    if (cover) { item.cover = cover; item.backdrop = cover; }
    const secs = video && num(video.video_time_length);
    if (secs) item.durationSec = secs;
    if (it.user && it.user.nickname) item.author = { id: String(it.user.id || it.user.nickname), name: it.user.nickname };
    if (it.node && it.node.name) item.badge = String(it.node.name).slice(0, 8);
    const v = num(it.viewCount);
    if (v) item.stats = { plays: v };
    return item;
  }

  function vcCard(it) {
    const title = txt(it.title);
    if (!title) return null;
    const item = { id: 'V' + String(it.id), title, type: 'short' };
    const cover = imgRef(it.cover_url);
    if (cover) { item.cover = cover; item.backdrop = cover; }
    const secs = num(it.duration_seconds);
    if (secs) item.durationSec = secs;
    if (it.author && it.author.nickname) item.author = { id: String(it.author.id || ''), name: it.author.nickname };
    if (it.category && it.category.name) item.badge = String(it.category.name).slice(0, 8);
    const v = num(it.view_count);
    if (v) item.stats = { plays: v };
    return item;
  }

  async function listFeed(kind, categoryId, cursor, ctx) {
    const page = pageOf(cursor);
    const limit = 20;
    let data;
    if (kind === 'vc') {
      const q = '/api/video-center/video/list?page=' + page + '&limit=' + limit + (categoryId ? '&top_category_id=' + encodeURIComponent(categoryId) : '');
      data = await api(q, ctx);
    } else {
      const map = {
        hot: '/api/topic/hot/topics?page=' + page + '&limit=' + limit,
        videos: '/api/topic/node/topics?type=1&nodeId=0&page=' + page,
        news: '/api/topic/node/news?page=' + page,
      };
      data = await api(map[kind] || map.hot, ctx);
    }
    const rows = (data && data.results) || [];
    const items = [];
    const seen = {};
    for (let i = 0; i < rows.length; i++) {
      const it = kind === 'vc' ? vcCard(rows[i]) : topicCard(rows[i]);
      if (!it || seen[it.id]) continue;
      seen[it.id] = 1;
      items.push(it);
    }
    const pg = (data && data.page) || {};
    const total = num(pg.total);
    const more = items.length > 0 && (total != null ? page * (num(pg.limit) || limit) < total : rows.length >= limit);
    return { items, next: more ? String(page + 1) : null };
  }

  let catCache = null;
  async function topCategories(ctx) {
    if (catCache) return catCache;
    try {
      const tree = await api('/api/video-center/category/list', ctx);
      catCache = (Array.isArray(tree) ? tree : []).filter(function (c) { return c && num(c.parent_id) === 0 && c.name; })
        .map(function (c) { return { id: 'vc:' + String(c.id), label: txt(c.name) }; });
    } catch (e) {
      if (e && e.code === 'AUTH_REQUIRED') throw e;
      catCache = [];
    }
    return catCache;
  }

  return {
    endpoints: {
      list() { return [{ id: 'main', label: '主站', url: 'https://hj2606029d3.top' }]; }
    },

    home: {
      async getSections(params, ctx) {
        const sections = [];
        const hot = await listFeed('hot', '', '1', ctx);
        if (hot.items.length) sections.push({ id: 'hot', title: '热门', layout: 'grid', imageAspect: 'portrait', items: hot.items, more: !!hot.next });
        const vc = await listFeed('vc', '', '1', ctx);
        if (vc.items.length) sections.push({ id: 'vc', title: '视频中心', layout: 'grid', imageAspect: 'landscape', items: vc.items, more: !!vc.next });
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const id = String(params.sectionId || 'hot');
        if (id === 'vc') return listFeed('vc', '', params.cursor, ctx);
        return listFeed(id === 'news' ? 'news' : 'hot', '', params.cursor, ctx);
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const base = [
          { id: 'hot', label: '热门' },
          { id: 'videos', label: '视频帖' },
          { id: 'news', label: '最新' },
          { id: 'vc', label: '视频中心' },
        ];
        let tops = [];
        try { tops = await topCategories(ctx); } catch (_) {}
        return base.concat(tops);
      },
      async list(params, ctx) {
        const cid = String(params.categoryId || 'hot');
        if (cid.indexOf('vc:') === 0) return listFeed('vc', cid.slice(3), params.cursor, ctx);
        if (cid === 'vc' || cid === 'videos' || cid === 'news') return listFeed(cid, '', params.cursor, ctx);
        return listFeed('hot', '', params.cursor, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '');
        if (id.charAt(0) === 'V') {
          const vid = id.slice(1);
          const d = await api('/api/video-center/video/detail?id=' + encodeURIComponent(vid), ctx);
          if (!d) fail('NOT_FOUND', '作品不存在');
          const detail = { id, title: txt(d.title) || ('视频中心 ' + vid), type: 'short' };
          const cover = imgRef(d.cover_url);
          if (cover) { detail.cover = cover; detail.backdrop = cover; }
          const desc = txt(d.description);
          if (desc) detail.description = desc;
          const secs = num(d.duration_seconds);
          if (secs) detail.durationSec = secs;
          if (d.author && d.author.nickname) detail.author = { id: String(d.author.id || ''), name: d.author.nickname };
          if (d.category && d.category.name) detail.tags = [txt(d.category.name)];
          const attId = num(d.attachment_id);
          const eps = attId ? [{ id: 'E:' + vid + ':' + attId + ':video_center', index: 1, episodeNumber: 1, label: '播放' }] : [];
          detail.playlists = [{ id: 'main', label: '默认', episodes: eps }];
          if (d.can_play === false) detail.notice = '站点标记该视频不可直接播放';
          return detail;
        }
        const tid = id.slice(1);
        const d = await api('/api/topic/' + encodeURIComponent(tid), ctx);
        if (!d) fail('NOT_FOUND', '帖子不存在');
        const atts = Array.isArray(d.attachments) ? d.attachments : [];
        const videos = atts.filter(function (a) { return a && a.category === 'video' && num(a.id); });
        if (!videos.length) fail('NOT_FOUND', '该帖子没有视频（纯图文）');
        const detail = { id, title: txt(d.title) || ('帖子 ' + tid), type: 'short' };
        const cover = imgRef((videos[0] && videos[0].coverUrl) || (atts.find(function (a) { return a.category === 'images'; }) || {}).remoteUrl);
        if (cover) { detail.cover = cover; detail.backdrop = cover; }
        const c = txt(d.content);
        if (c) detail.description = c.slice(0, 300);
        if (d.node && d.node.name) detail.tags = [txt(d.node.name)];
        if (d.sale && num(d.sale.amount) > 0) {
          detail.notice = '付费帖：售价 ' + d.sale.amount + '，已购 ' + (num(d.sale.buyCount) || 0) + ' 人（未购买只能试看）';
        }
        detail.playlists = [{
          id: 'main',
          label: '默认',
          episodes: videos.map(function (a, i) {
            const e = { id: 'E:' + tid + ':' + a.id + ':topic', index: i + 1, episodeNumber: i + 1, label: String(i + 1) };
            const secs = num(a.video_time_length);
            if (secs) e.durationSec = secs;
            const th = imgRef(a.coverUrl);
            if (th) e.thumbnail = th;
            return e;
          }),
        }];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        if (!token()) {
          fail('AUTH_REQUIRED', '海角播放需要登录：到插件设置里填写登录令牌（X-User-Token，可选用户 ID）');
        }
        const ep = String((params && params.episodeId) || '');
        const parts = ep.split(':');            // E:<resourceId>:<attachmentId>:<type>
        if (parts.length < 4 || parts[0] !== 'E') fail('INVALID_ARGUMENT', '分集无效');
        const resourceId = num(parts[1]), attachmentId = num(parts[2]), type = parts[3];
        if (!attachmentId || !resourceId) fail('INVALID_ARGUMENT', '分集参数无效');
        const d = await api('/api/attachment', ctx, { post: { id: attachmentId, resource_id: resourceId, resource_type: type, line: '', is_ios: 1 } });
        const remote = (d && (d.remoteUrl || d.url)) || '';
        if (!remote) fail('UNAVAILABLE', '站点没有下发播放地址（可能需要购买或登录态已失效）');

        // 主清单下钻一层到媒体清单，key 材料在该清单同目录的 .jpg 里
        let plUrl = absUrl(remote);
        let text = await fetchText(plUrl, ctx);
        const variant = firstVariant(text, plUrl);
        if (variant) { plUrl = variant; text = await fetchText(plUrl, ctx); }
        if (text.indexOf('#EXTM3U') < 0) fail('UPSTREAM_CHANGED', '播放清单无效');

        // 密钥材料：把清单扩展名换成 jpg，正文是 base64；key 的 16 字节与材料逐字节 XOR
        let state;
        const km = text.match(/#EXT-X-KEY:[^\n]*URI="([^"]+)"/);
        if (km) {
          try {
            const matUrl = plUrl.replace(/\.m3u8(\?.*)?$/i, '.jpg');
            const matBody = (await fetchText(matUrl, ctx)).trim();
            const pad = '='.repeat((4 - (matBody.length % 4)) % 4);
            const bytes = hg.codec.base64Decode(matBody + pad);
            if (bytes && bytes.length) state = { m: hg.codec.base64Encode(bytes) };
          } catch (_) {}
        }
        const st = {
          url: plUrl,
          kind: 'media',
          format: 'hls',
          headers: { 'User-Agent': ua(), Referer: origin() + '/' },
        };
        if (state) st.transforms = { key: { type: 'plugin', name: 'hjkey', state } };
        return { streams: [st] };
      },
    },

    transformResource(params) {
      const d = params.data;
      if (params.name === 'hjimg') {
        const img = decodeHjImage(d);
        if (img && img.length) return { data: img, contentType: sniff(img) };
        return { data: d };
      }
      if (params.name === 'hjkey') {
        const m = (params.state && params.state.m) ? hg.codec.base64Decode(params.state.m) : null;
        if (!m || !m.length || !d || d.length !== 16) return { data: d };
        const out = new Uint8Array(16);
        for (let i = 0; i < 16; i++) out[i] = d[i] ^ m[i % m.length];
        return { data: out };
      }
      return { data: d };
    },
  };

  async function fetchText(url, ctx) {
    const res = await hg.http.fetch({ url, headers: { 'User-Agent': ua(), Referer: origin() + '/' }, responseType: 'text', timeoutMs: 20000, retry: 1, signal: ctx && ctx.signal });
    if (!res.ok) fail('UPSTREAM_ERROR', '资源暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }
  function firstVariant(text, base) {
    if (text.indexOf('#EXT-X-STREAM-INF') < 0) return '';
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.charAt(0) === '#') continue;
      if (/^https?:/i.test(l)) return l;
      try { return new URL(l, base).href; } catch (_) { return ''; }
    }
    return '';
  }
  function sniff(b) {
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
    return 'image/jpeg';
  }
  // 自定义字母表 base64 → "data:image/…;base64,…" → 图片字节
  function decodeHjImage(data) {
    const map = {};
    for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
    const v = [];
    for (let i = 0; i < data.length; i++) {
      const ch = String.fromCharCode(data[i]);
      if (map[ch] != null) v.push(map[ch]);
    }
    if (v.length < 4) return null;
    const out = [];
    for (let i = 0; i + 1 < v.length; i += 4) {
      const a = v[i], b = v[i + 1], c = i + 2 < v.length ? v[i + 2] : -1, d2 = i + 3 < v.length ? v[i + 3] : -1;
      out.push((a << 2 | b >> 4) & 255);
      if (c >= 0) out.push(((b & 15) << 4 | c >> 2) & 255); else break;
      if (d2 >= 0) out.push(((c & 3) << 6 | d2) & 255); else break;
    }
    let text = '';
    for (let i = 0; i < out.length; i++) text += String.fromCharCode(out[i]);
    const comma = text.indexOf(',');
    if (text.indexOf('base64') < 0 || comma < 0) return null;
    return hg.codec.base64Decode(text.slice(comma + 1).replace(/\s+/g, ''));
  }
}
