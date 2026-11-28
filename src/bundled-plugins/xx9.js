export const meta = {
  id: 'xx9',
  name: '主播视频',
  version: '1.0.4',
  protocol: 1,
  description: '主播视频（xx9.com）：点播源。分类、搜索、专题、详情与 HLS 播放。接口为 AES-ECB 加密网关（密钥按时间戳尾数轮换），自动获取 jwtToken 与游客 accessToken；封面为单字节 XOR 加密。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['xx9.com', 'www.xx9.com'],
  defaultHeaders: {
    Referer: 'https://xx9.com/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://xx9.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
// 前端 webpack 模块 4117 导出的 10 把 AES-128-ECB 密钥，按请求 time % 10 选取
const KEYS = ['6eIZ4cxM5pqzUXcF', '84UZNK33cSVylz6Y', 'jeSWRcTwHyAKwJDB', 'i1hvJx9vuRt5zEBS', '1Yy1KOa75R7cnmkg',
  '4MVTQQAJlMpUIAiL', 'T0RVp7KIPamrtQ33', '8HbPxhX6fjhhhwok', 'ugvseZc5Kkj8ecmV', 'G7i3OPcfNhBnAYpc'];
const API_HOSTS = ['https://api.gu6ji7sorn7s.xyz', 'https://api.y7hvaad8g.xyz'];
const POOL_URLS = ['https://k5p0vw2fgfvc.xyz/', 'https://k4irke3n6xcwdpc.xyz/zbtip.txt'];
const GATEWAY = '/fast-endecode/main/request';
const DEFAULT_PIC = 'https://qv1tx2.shoupingxz.com';
const DEFAULT_LINES = [
  { name: '国线1', line: 'https://rr.rxjhwl.com' },
  { name: '海线1', line: 'https://allmusiclub.almusiclub.com' },
];
const SORTS = [
  { id: '2', label: '最新' },
  { id: '3', label: '最热' },
];
const PAGE_SIZE = 20;

export default function (hg) {
  let apiBase = null;
  let jwtMem = null;
  let cfgMem = null;

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function apiHeaders(jwt, token) {
    const h = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Origin: SITE,
      Referer: SITE + '/',
    };
    if (jwt) h.jwtToken = jwt;
    if (token) h.accessToken = token;
    return h;
  }

  function aesKey(t) {
    return hg.codec.utf8Encode(KEYS[t % 10]);
  }

  function encrypt(obj, t) {
    const out = hg.crypto.aesEncrypt({ mode: 'ecb', key: aesKey(t), padding: 'pkcs7' }, hg.codec.utf8Encode(JSON.stringify(obj)));
    return hg.codec.base64Encode(out);
  }

  function decrypt(b64, t) {
    const out = hg.crypto.aesDecrypt({ mode: 'ecb', key: aesKey(t), padding: 'pkcs7' }, hg.codec.base64Decode(b64));
    return JSON.parse(hg.codec.utf8Decode(out));
  }

  async function resolveApi(ctx) {
    if (apiBase) return apiBase;
    const cached = await hg.storage.get('apiBase');
    if (cached) { apiBase = cached; return apiBase; }
    for (let i = 0; i < POOL_URLS.length; i++) {
      try {
        const res = await hg.http.fetch({ url: POOL_URLS[i], headers: { 'User-Agent': UA }, responseType: 'text', timeoutMs: 8000, signal: ctx && ctx.signal });
        if (!res.ok) continue;
        const m = String(res.data).match(/"result"\s*:\s*"(https:\/\/[^"]+?)\/?"/);
        if (m) {
          apiBase = m[1];
          await hg.storage.set('apiBase', apiBase, { ttlSec: 6 * 3600 });
          return apiBase;
        }
      } catch (_) {}
    }
    apiBase = API_HOSTS[0];
    return apiBase;
  }

  // 统一网关：{data: AES(JSON{method, params|body, uri}), time}；响应 {data: AES(JSON)}
  async function gateway(uri, method, payload, opts, ctx) {
    const base = await resolveApi(ctx);
    const t = Date.now();
    const inner = { method: method };
    inner[(opts && opts.bodyKey) ? 'body' : 'params'] = payload === undefined ? null : payload;
    inner.uri = uri;
    const res = await hg.http.fetch({
      url: base + GATEWAY,
      method: 'POST',
      headers: apiHeaders(opts && opts.jwt, opts && opts.token),
      body: { json: { data: encrypt(inner, t), time: t } },
      responseType: 'text',
      timeoutMs: 15000,
      credentials: 'omit',
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '接口暂时不可用（HTTP ' + res.status + '）');
    let wrap;
    try { wrap = JSON.parse(res.data); } catch (_) { wrap = null; }
    if (!wrap || typeof wrap.data !== 'string') fail('UPSTREAM_CHANGED', '接口返回为空或结构已变化');
    let body;
    try { body = decrypt(wrap.data, typeof wrap.time === 'number' ? wrap.time : t); } catch (_) { fail('UPSTREAM_CHANGED', '接口数据解密失败'); }
    return body;
  }

  async function getJwt(ctx, force) {
    if (!force) {
      if (jwtMem) return jwtMem;
      const c = await hg.storage.get('jwt');
      if (c) { jwtMem = c; return c; }
    }
    const body = await gateway('app/jwt-token', 1, null, null, ctx);
    if (!body || body.code !== '0000' || !body.result) fail('UPSTREAM_ERROR', '获取访问令牌失败：' + ((body && body.message) || '未知错误'));
    jwtMem = String(body.result);
    await hg.storage.set('jwt', jwtMem, { ttlSec: 20 * 3600 });
    return jwtMem;
  }

  function randomSign() {
    return hg.codec.base64Encode(hg.crypto.randomBytes(24), { urlSafe: true, pad: false }).slice(0, 32);
  }

  // 游客账号（user/register/free），详情/播放地址必须带 accessToken
  async function getToken(ctx, force) {
    if (!force) {
      const c = await hg.storage.get('accessToken');
      if (c) return c;
    }
    const jwt = await getJwt(ctx);
    let sign = await hg.storage.get('deviceSign');
    if (!sign || force) {
      sign = randomSign();
      await hg.storage.set('deviceSign', sign);
    }
    const body = await gateway('user/register/free', 2, {
      channelCode: '', key: '', osType: 'h5', sign: sign, machineCode: 'safari',
      version: 'xx9.com', domain: '', verifyCode: '', uuid: '',
    }, { jwt: jwt, bodyKey: true }, ctx);
    const tok = body && body.code === '0000' && body.result && body.result.accessToken;
    if (!tok) {
      if (body && body.code === '1062') fail('RATE_LIMITED', '游客注册次数超过站点限制，请稍后再试', { retryAfterSec: 3600 });
      fail('UPSTREAM_ERROR', '游客登录失败：' + ((body && body.message) || '未知错误'));
    }
    await hg.storage.set('accessToken', String(tok), { ttlSec: 20 * 86400 });
    return String(tok);
  }

  // 带 jwt 调用；jwt 过期（1033/1034 等）时刷新一次
  async function call(uri, method, payload, ctx, opts) {
    const o = opts || {};
    let jwt = await getJwt(ctx);
    let token = o.auth ? await getToken(ctx) : undefined;
    let body = await gateway(uri, method, payload, { jwt: jwt, token: token, bodyKey: o.bodyKey }, ctx);
    if (body && /^103[34]$/.test(String(body.code))) {
      jwt = await getJwt(ctx, true);
      body = await gateway(uri, method, payload, { jwt: jwt, token: token, bodyKey: o.bodyKey }, ctx);
    }
    if (body && o.auth && /^(1032|1035|1036|1037|1038)$/.test(String(body.code))) {
      token = await getToken(ctx, true);
      body = await gateway(uri, method, payload, { jwt: jwt, token: token, bodyKey: o.bodyKey }, ctx);
    }
    if (!body || body.code !== '0000') fail('UPSTREAM_ERROR', (o.label || uri) + '失败：' + ((body && body.message) || '未知错误'));
    return body;
  }

  async function config(ctx) {
    if (cfgMem) return cfgMem;
    const cached = await hg.storage.get('config');
    if (cached) { cfgMem = cached; return cfgMem; }
    let pic = DEFAULT_PIC, lines = DEFAULT_LINES;
    try {
      const body = await call('config/query', 1, { groupKey: 'APP', key: 'picBaseUrl,newPicBaseUrl,h5_play_line' }, ctx, { label: '配置' });
      const r = body.result || {};
      if (r.newPicBaseUrl || r.picBaseUrl) pic = String(r.newPicBaseUrl || r.picBaseUrl).replace(/\/$/, '');
      try {
        const arr = JSON.parse(r.h5_play_line || '[]');
        const seen = {};
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          const ln = arr[i] && String(arr[i].line || '').replace(/\/$/, '');
          if (!ln || seen[ln] || !/^https:\/\//.test(ln)) continue;
          seen[ln] = true;
          out.push({ name: String(arr[i].name || ('线路' + (out.length + 1))), line: ln });
        }
        if (out.length) lines = out;
      } catch (_) {}
    } catch (_) {}
    cfgMem = { pic: pic, lines: lines };
    await hg.storage.set('config', cfgMem, { ttlSec: 6 * 3600 });
    return cfgMem;
  }

  function imgRef(cfg, path) {
    if (!path) return undefined;
    const p = String(path);
    const url = /^https?:\/\//.test(p) ? p : cfg.pic + (p.charAt(0) === '/' ? '' : '/') + encodeURI(p);
    return { url: url, transform: { type: 'plugin', name: 'xor1' } };
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  function videoItem(cfg, raw) {
    if (!raw || raw.id == null || !raw.title) return null;
    const item = { id: String(raw.id), title: String(raw.title).trim(), type: 'movie' };
    const cover = imgRef(cfg, raw.vodPic);
    if (cover) { item.cover = cover; item.backdrop = cover; }
    if (Array.isArray(raw.tags) && raw.tags.length) item.tags = raw.tags.slice(0, 20).map(String);
    const dur = num(raw.vodDuration);
    if (dur) item.durationSec = dur;
    const ts = num(raw.vodTime || raw.createTime);
    if (ts) { item.publishedAt = ts; item.year = new Date(ts).getFullYear(); }
    const stats = {};
    if (num(raw.readNumber) != null) stats.plays = num(raw.readNumber);
    if (num(raw.likeNumber) != null) stats.likes = num(raw.likeNumber);
    if (num(raw.comments) != null) stats.comments = num(raw.comments);
    if (Object.keys(stats).length) item.stats = stats;
    const a = raw.authors;
    if (a && a.id != null && a.nickName) {
      item.author = { id: String(a.id), name: String(a.nickName) };
      const av = imgRef(cfg, a.avatar);
      if (av) item.author.avatar = av;
    }
    if (raw.vodVersion) item.badge = String(raw.vodVersion).slice(0, 8);
    item.entryEpisodeId = '0';
    return item;
  }

  function mapList(cfg, rows) {
    const out = [];
    const seen = {};
    const arr = Array.isArray(rows) ? rows : [];
    for (let i = 0; i < arr.length; i++) {
      const it = videoItem(cfg, arr[i]);
      if (!it || seen[it.id]) continue;
      seen[it.id] = true;
      out.push(it);
    }
    return out;
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function searchVods(params, cursor, ctx, label) {
    const cfg = await config(ctx);
    const page = pageOf(cursor);
    const q = Object.assign({ page: page, pageSize: PAGE_SIZE, sortType: 2, explore: false }, params);
    const body = await call('cms/vod/search', 2, q, ctx, { label: label || '列表' });
    const rows = Array.isArray(body.data) ? body.data : [];
    const total = num(body.total) || 0;
    const items = mapList(cfg, rows);
    const more = rows.length > 0 && page * PAGE_SIZE < total;
    return { items: items, next: more ? String(page + 1) : null, total: total || undefined };
  }

  async function loadCategories(ctx) {
    const c = await hg.storage.get('cats');
    if (c) return c;
    const body = await call('cms/group-in-packages', 1, null, ctx, { label: '分类' });
    const pkgs = Array.isArray(body.data) ? body.data : [];
    const tree = [];
    for (let i = 0; i < pkgs.length; i++) {
      const p = pkgs[i];
      const groups = Array.isArray(p && p.groups) ? p.groups : [];
      const children = [];
      for (let j = 0; j < groups.length; j++) {
        const g = groups[j];
        if (!g || g.id == null || g.status === 0) continue;
        children.push({ id: 'g:' + g.id, label: String(g.groupName || g.description || g.id), sorts: SORTS });
      }
      if (children.length) tree.push({ id: 'p:' + p.id, label: String(p.name || p.id), children: children });
    }
    if (!tree.length) fail('UPSTREAM_CHANGED', '分类为空');
    await hg.storage.set('cats', tree, { ttlSec: 12 * 3600 });
    return tree;
  }

  async function loadDetail(id, ctx) {
    const body = await call('cms/vod/detail/' + encodeURIComponent(id), 1, { needCdnAuth: true }, ctx, { auth: true, label: '详情' });
    const vod = body.result && body.result.vod;
    if (!vod) fail('NOT_FOUND', '视频不存在或已下架');
    return vod;
  }

  // 探测线路：并行请求各线路「清单 → 密钥 → 首个分片」，全部通过才算可用；取最先通过的。结果缓存 10 分钟。
  // （2026-11-19 实测：同一时刻各线路好坏不同且会变，国线1/国线4 曾出现清单可取、分片 CDN 连不上 → 黑屏）
  let lineCache = null;
  async function grab(url, type, ctx, range) {
    const h = mediaHeaders();
    if (range) h.Range = 'bytes=0-1023';
    try {
      const r = await hg.http.fetch({ url, headers: h, responseType: type, timeoutMs: 5000, signal: ctx && ctx.signal });
      return r.ok || r.status === 206 ? r.data : null;
    } catch (_) { return null; }
  }
  function resolveRef(ref, base) {
    if (/^https?:/i.test(ref)) return ref;
    try { return new URL(ref, base).href; } catch (_) { return ''; }
  }
  async function lineWorks(url, ctx) {
    const body = await grab(url, 'text', ctx);
    if (!body || body.indexOf('#EXTM3U') < 0) return false;
    const km = body.match(/#EXT-X-KEY:[^\n]*URI="([^"]+)"/);
    const seg = body.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; })[0];
    const jobs = [];
    if (km) jobs.push(grab(resolveRef(km[1], url), 'bytes', ctx).then(function (d) { return !!d && d.length === 16; }));
    if (seg) jobs.push(grab(resolveRef(seg, url), 'bytes', ctx, true).then(function (d) { return !!d && d.length > 0; }));
    const rs = await Promise.all(jobs);
    return rs.length > 0 && rs.every(Boolean);
  }
  async function pickLine(cfg, path, ctx) {
    // 线路状态会变（有些 HTTPS 节点会重定向到 HTTP，被宿主安全策略拒绝）。
    // 旧逻辑把失败的线路缓存 10 分钟，且无线路通过时仍盲目返回 0，造成播放黑屏。
    if (lineCache && lineCache.at > Date.now() - 60 * 1000 && lineCache.sid < cfg.lines.length) {
      if (await lineWorks(cfg.lines[lineCache.sid].line + path, ctx)) return lineCache.sid;
      lineCache = null;
    }
    const n = cfg.lines.length;
    const winner = await new Promise(function (resolve) {
      let left = n;
      if (!n) resolve(-1);
      cfg.lines.forEach(function (l, i) {
        lineWorks(l.line + path, ctx).then(function (ok) {
          if (ok) resolve(i);
          if (--left === 0) resolve(-1);
        }, function () { if (--left === 0) resolve(-1); });
      });
    });
    if (winner >= 0) { lineCache = { sid: winner, at: Date.now() }; return winner; }
    fail('NETWORK', '所有播放线路都未通过清单/分片预检（可能是节点故障或 HTTPS 降级被安全策略阻止），请稍后重试或换一部');
  }

  function addrList(vod) {
    const out = [];
    const full = Array.isArray(vod.vodFullPlayUrl) ? vod.vodFullPlayUrl : [];
    for (let i = 0; i < full.length; i++) {
      if (full[i] && full[i].addr) out.push({ addr: String(full[i].addr), label: String(full[i].type || ('线路' + (i + 1))), duration: num(full[i].duration) });
    }
    if (!out.length && vod.newAddr) out.push({ addr: String(vod.newAddr), label: '高清', duration: num(vod.vodDuration) });
    return out;
  }

  function mediaHeaders() {
    return { Referer: SITE + '/', 'User-Agent': UA };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const cfg = await config(ctx);
        const sections = [];
        const latest = await searchVods({}, '1', ctx, '最新');
        if (latest.items.length) {
          sections.push({ id: 'banner', title: '最新推荐', layout: 'banner', imageAspect: 'landscape', items: latest.items.slice(0, 6) });
          sections.push({ id: 'latest', title: '最新', layout: 'grid', imageAspect: 'landscape', items: latest.items, more: true });
        }
        try {
          const hot = await searchVods({ sortType: 3 }, '1', ctx, '最热');
          if (hot.items.length) sections.push({ id: 'hot', title: '最热', layout: 'row', imageAspect: 'landscape', items: hot.items, more: true });
        } catch (_) {}
        try {
          const body = await call('theme/index', 2, null, ctx, { bodyKey: true, label: '专题' });
          const themes = Array.isArray(body.data) ? body.data : [];
          for (let i = 0; i < themes.length; i++) {
            const th = themes[i];
            const items = mapList(cfg, th && th.data);
            if (items.length) sections.push({ id: 'theme-' + th.id, title: String(th.title || '专题'), layout: 'row', imageAspect: 'landscape', items: items });
          }
        } catch (_) {}
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const id = String(params.sectionId || '');
        if (id === 'latest') return searchVods({}, params.cursor, ctx, '最新');
        if (id === 'hot') return searchVods({ sortType: 3 }, params.cursor, ctx, '最热');
        return { items: [], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadCategories(ctx);
      },
      async list(params, ctx) {
        const cid = String((params && params.categoryId) || '');
        const sort = params && params.sort && /^[1-5]$/.test(params.sort) ? Number(params.sort) : 2;
        const q = { sortType: sort };
        if (cid.indexOf('g:') === 0) { q.groupIds = Number(cid.slice(2)); q.keyword = ''; q.keywordType = 1; }
        return searchVods(q, params && params.cursor, ctx, '分类');
      },
    },

    search: {
      async search(params, ctx) {
        const kw = params && params.query ? String(params.query).trim() : '';
        if (!kw) return { items: [], next: null };
        return searchVods({ keyword: kw, keywordType: 0 }, params.cursor, ctx, '搜索');
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少视频 ID');
        const cfg = await config(ctx);
        const vod = await loadDetail(String(id), ctx);
        const base = videoItem(cfg, vod) || { id: String(id), title: String(vod.title || id), type: 'movie' };
        if (Array.isArray(vod.group_names)) {
          const tags = vod.group_names.map(function (g) { return g && g.groupName; }).filter(Boolean);
          if (tags.length) base.tags = tags.concat(base.tags || []).slice(0, 20);
        }
        const list = addrList(vod);
        const eps = list.map(function (a, i) {
          const e = { id: String(i), index: i + 1, episodeNumber: i + 1, label: a.label };
          if (a.duration) e.durationSec = a.duration;
          return e;
        });
        if (!eps.length) fail('CONTENT_LOCKED', '该视频没有可播放地址');
        delete base.entryEpisodeId;
        base.playlists = [{ id: 'main', label: '默认', episodes: eps }];
        return base;
      },

      async resolvePlayback(params, ctx) {
        const id = params && params.mediaId;
        if (!id) fail('INVALID_ARGUMENT', '缺少视频 ID');
        const cfg = await config(ctx);
        const vod = await loadDetail(String(id), ctx);
        const list = addrList(vod);
        const idx = Math.max(0, Math.min(list.length - 1, parseInt(params.episodeId || '0', 10) || 0));
        const a = list[idx];
        if (!a) fail('CONTENT_LOCKED', '该视频没有可播放地址');
        const servers = cfg.lines.map(function (l, i) { return { id: String(i), label: l.name }; });
        let sid = params.serverId != null && params.serverId !== '' ? parseInt(params.serverId, 10) : -1;
        const path = a.addr.charAt(0) === '/' ? a.addr : '/' + a.addr;
        // 线路好坏会变（2026-11-19 实测：国线1 清单能取到，但密钥/分片所在的 tigerstx 子域连不上 → 黑屏）。
        // 未指定线路时，按顺序探测每条线路「清单 → 首个密钥」，第一个全通的作默认；其余线路依次作为备用流返回。
        // App 会带上它记住的 serverId（上次用过的线路），而线路好坏会变：即便指定了线路，也先验证它能播，不行就自动换到能播的。
        if (!Number.isFinite(sid) || sid < 0 || sid >= cfg.lines.length) sid = await pickLine(cfg, path, ctx);
        else if (!(await lineWorks(cfg.lines[sid].line + path, ctx))) sid = await pickLine(cfg, path, ctx);
        const order = [sid].concat(cfg.lines.map(function (_, i) { return i; }).filter(function (i) { return i !== sid; }));
        return {
          streams: order.map(function (i) {
            return {
              url: cfg.lines[i].line + path,
              kind: 'media',
              format: 'hls',
              label: a.label + ' · ' + cfg.lines[i].name,
              serverId: String(i),
              headers: mediaHeaders(),
            };
          }),
          servers: servers,
          durationSec: a.duration,
          expiresAt: Date.now() + 2 * 3600 * 1000,
        };
      },

      matchUrl(params) {
        const m = String((params && params.url) || '').match(/[?&]id=(\d+)/);
        return m ? { mediaId: m[1] } : null;
      },
    },

    // 封面图片可能较大；超过 32 KiB 就分块让出，避免 QuickJS 单段同步 XOR 撞到宿主 1 秒硬上限。
    async transformResource(params) {
      const d = params.data;
      if (params.name !== 'xor1' || !d || d.length < 2) return { data: d };
      const k = d[0];
      const out = new Uint8Array(d.length - 1);
      for (let i = 1; i < d.length; i++) {
        out[i - 1] = d[i] ^ k;
        if ((i & 0x7fff) === 0) await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
      let ct = 'image/jpeg';
      if (out[0] === 0x89 && out[1] === 0x50) ct = 'image/png';
      else if (out[0] === 0x47 && out[1] === 0x49) ct = 'image/gif';
      else if (out[0] === 0x52 && out[1] === 0x49) ct = 'image/webp';
      return { data: out, contentType: ct };
    },
  };
}
