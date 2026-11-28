export const meta = {
  id: 'mwxk62',
  name: 'KKAV',
  version: '1.1.3',
  protocol: 1,
  description: 'KKAV（入口 62mwxk.com 是跳板页，真实域名会变，插件自动解析）：点播源。2026-11-23 站点已迁移到新版 H5 平台（uni-app + /api 接口，响应为 ENC3 XOR 封包），本版按新接口重写：分类 /movie/tags、列表与搜索 /movie/list、首页 /movie/home_sections、详情 /movie/{id}。封面走 cover_64_2/<路径>.txt（data URI 文本，插件解包）；注意 /config/ini 里的 tupath 是已失效的占位域名（DNS 不存在），封面基址改为探测可用者，兜底用仍在服务的旧图床。播放仍走原来的 m3u8 节点（AES-128 加密分片，由播放器按 m3u8 自行解密）。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['62mwxk.com', 'www.62mwxk.com', '57hqky.com', 'www.57hqky.com', 'kkav.com', 'www.kkav.com'],
  defaultHeaders: {
    Referer: 'https://62mwxk.com/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 20, playback: 25 },
};

const ENTRY = 'https://62mwxk.com';               // 入口（跳板页，不再是片库本身）
const FALLBACK_SITE = 'https://www.57hqky.com';   // 解析失败时的兜底（2026-11-23 实测，为入口脚本当前唯一目标）
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
// 播放节点：详情接口只给相对路径 /data/...，节点域名沿用旧站 config（2026-11-23 实测两节点都正常返回清单）
const M3U8_LINES = [
  { id: 'l2', label: '极速', origin: 'https://h3.xinghun1.com' },
  { id: 'l1', label: '普通', origin: 'https://h1.qhkjapp.com' },
];
// 新站接口 ENC3 封包的默认口令（站点前端 bundle 的默认值，运行时以此解包）
const ENC_PASS = 'Mumu2026#';
// 封面基址兜底：/config/ini 的 tupath（sq.2277ww.com）是失效占位（公共 DNS 查不到，NXDOMAIN）；
// 旧图床 ddd.aisheji8.com/data 仍在服务且存有新站全部封面（2026-11-24 实测）
const FALLBACK_TUPATH = 'https://ddd.aisheji8.com/data';
const PAGE_SIZE = 20;
// 分类兜底（与旧版一致；新接口 /movie/tags 正常时不用）
const FALLBACK_GROUPS = [
  { id: 'g1', label: '长片', children: [
    { id: '26', label: '无码素人' }, { id: '84', label: '日本无码' }, { id: '22', label: '无码破解' },
    { id: '25', label: '日韩中字' }, { id: '19', label: '欧美劲爆' }, { id: '28', label: '经典三级' }, { id: '20', label: '3D动漫' },
  ] },
  { id: 'g2', label: '视频', children: [
    { id: '1', label: '国产自拍' }, { id: '4', label: '家庭乱伦' }, { id: '3', label: '少女萝莉' }, { id: '5', label: '熟女少妇' },
    { id: '7', label: '酒店探花' }, { id: '8', label: '偷拍盗摄' }, { id: '37', label: '醉酒迷奸' }, { id: '90', label: '综合强片' },
    { id: '38', label: '吃瓜黑料' }, { id: '2', label: '直播裸聊' }, { id: '76', label: '巨乳诱惑' }, { id: '36', label: '户外野战' },
    { id: '23', label: 'AI换脸' }, { id: '73', label: '群P换妻' }, { id: '57', label: '网黄博主' }, { id: '56', label: '黑人媚黑' },
  ] },
];

export default function (hg) {
  let SITE = FALLBACK_SITE;       // 当前真实站点，由 resolveSite() 解析
  let siteAt = 0;

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function headers() {
    return { 'User-Agent': UA, Referer: SITE + '/' };
  }

  async function fetchText(url, ctx, opts) {
    const res = await hg.http.fetch({
      url: url,
      headers: (opts && opts.headers) || headers(),
      responseType: 'text',
      timeoutMs: (opts && opts.timeoutMs) || 15000,
      retry: 1,
      maxBytes: 4 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) {
      if (opts && opts.allowFail) return null;
      fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    }
    return String(res.data || '');
  }

  function safeDecode(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, '%20')); } catch (_) { return String(s); }
  }

  // ---------- 新站接口 ENC3（XOR2）封包解码 ----------
  // 与站点前端一致：FNV-1a(口令|nonce) 作种子，xorshift32 生成密钥流逐字节 XOR；载荷为 base64url。
  function fnv1a(bytes) {
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0 || 2166136261;
  }
  function xorshift(t) {
    t = (t ^ ((t << 13) >>> 0)) >>> 0;
    t = (t ^ (t >>> 17)) >>> 0;
    t = (t ^ ((t << 5) >>> 0)) >>> 0;
    return t >>> 0;
  }
  function xorDecode(bytes, nonce, pass) {
    let state = fnv1a(hg.codec.utf8Encode(String(pass) + '|' + String(nonce)));
    let r = 0;
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      if ((i & 3) === 0) { state = xorshift(state); r = state; }
      out[i] = bytes[i] ^ ((r >>> (8 * (i & 3))) & 255);
    }
    return out;
  }
  function decodeEnvelope(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.enc === 3 && typeof obj.d === 'string') {
      const plain = xorDecode(hg.codec.base64Decode(obj.d), obj.n, ENC_PASS);
      return JSON.parse(hg.codec.utf8Decode(plain));
    }
    return obj;
  }

  async function api(path, ctx, opts) {
    await resolveSite(ctx);
    let text;
    try {
      text = await fetchText(SITE + '/api' + path, ctx, opts);
    } catch (e) {
      // 网络层失败（超时/DNS）：清掉域名缓存重新解析并重试一次，扛设备网络抖动
      if (e && e.code) throw e;
      if (opts && opts._retried) throw e;
      siteAt = 0;
      try { await hg.storage.delete('site:v2'); } catch (_) {}
      await resolveSite(ctx);
      return api(path, ctx, Object.assign({}, opts || {}, { _retried: true }));
    }
    if (text == null) return null;
    let obj;
    try { obj = JSON.parse(text); } catch (_) {
      if (opts && opts.allowFail) return null;
      fail('UPSTREAM_CHANGED', '站点接口返回格式已变化');
    }
    const data = decodeEnvelope(obj);
    if (!data || data.code !== 0) {
      if (opts && opts.allowFail) return null;
      fail('UPSTREAM_ERROR', '站点接口暂时不可用（' + ((data && data.msg) || '无响应') + '）');
    }
    return data;
  }

  // 入口页的跳转脚本与旧版相同：eval(decodeURIComponent('url2.push("域名")')) 列出候选，
  // 再按「当天序号 % 数量」选一个拼 www. 跳转。变化在目标站本身：旧片库页面已下线，
  // 新站是 H5 平台，验证方式改为请求 /api/movie/tags 看是否返回 ENC3 封包。
  async function resolveSite(ctx) {
    if (siteAt && Date.now() - siteAt < 12 * 3600 * 1000) return SITE;
    const cached = await hg.storage.get('site:v2');
    if (cached && cached.url && cached.at && Date.now() - cached.at < 12 * 3600 * 1000) { SITE = cached.url; siteAt = cached.at; return SITE; }
    const cands = [];
    if (cached && cached.url) cands.push(cached.url);
    try {
      const res = await hg.http.fetch({ url: ENTRY + '/home.htm', headers: { 'User-Agent': UA }, responseType: 'text', timeoutMs: 12000, signal: ctx && ctx.signal });
      const html = typeof res.data === 'string' ? res.data : '';
      const m = html.match(/eval\(decodeURIComponent\('([^']+)'\)\)/);
      if (m) {
        const decoded = safeDecode(m[1]);
        const doms = [];
        const re = /url2\.push\("([^"]+)"\)/g;
        let x;
        while ((x = re.exec(decoded))) doms.push(x[1]);
        const useDay = parseInt((html.match(/var UseDay=(\d+)/) || [])[1] || '1', 10) || 1;
        const offset = parseInt((html.match(/var OffsetHour=(-?\d+)/) || [])[1] || '0', 10) || 0;
        if (doms.length) {
          const day = Math.floor((Math.floor(Date.now() / 1000) * 1000 + 8 * 3600000 - offset * 3600000) / 86400000 / useDay);
          const pick = doms[day % doms.length].split(',');
          pick.forEach(function (d) { cands.push('https://www.' + d.trim()); });
          doms.forEach(function (g) { g.split(',').forEach(function (d) { cands.push('https://www.' + d.trim()); }); });
        }
      }
    } catch (_) {}
    cands.push(FALLBACK_SITE);
    const tried = {};
    for (let i = 0; i < cands.length; i++) {
      const base = cands[i];
      if (tried[base]) continue;
      tried[base] = 1;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await hg.http.fetch({ url: base + '/api/movie/tags', headers: { 'User-Agent': UA, Referer: base + '/' }, responseType: 'text', timeoutMs: 10000, signal: ctx && ctx.signal });
          if (r.ok && typeof r.data === 'string' && (r.data.indexOf('"enc":3') >= 0 || r.data.indexOf('"code":0') >= 0)) {
            SITE = base; siteAt = Date.now();
            try { await hg.storage.set('site:v2', { url: base, at: siteAt }, { ttlSec: 12 * 3600 }); } catch (_) {}
            return SITE;
          }
          break;
        } catch (_) {}
      }
    }
    fail('UPSTREAM_ERROR', '无法解析 KKAV 当前可用域名（入口 ' + ENTRY + ' 的跳转目标都打不开）');
  }

  // 封面基址：/config/ini 的 tupath 可能是失效占位域名，必须先探活（任意 HTTP 响应都算活，
  // 连接/DNS 失败算死）；探不活就用兜底图床。结果缓存 6 小时。
  let cfgMem = null;
  async function configIni(ctx) {
    if (cfgMem) return cfgMem;
    const cached = await hg.storage.get('cfg:v3');
    if (cached && cached.tupath) { cfgMem = cached; return cfgMem; }
    const candidates = [];
    try {
      const res = await api('/config/ini', ctx, { allowFail: true, timeoutMs: 12000 });
      const tu = res && res.data && res.data.system && res.data.system.tupath;
      if (tu && /^https?:\/\//.test(String(tu))) candidates.push(String(tu).replace(/\/+$/, ''));
    } catch (_) {}
    if (candidates.indexOf(FALLBACK_TUPATH) < 0) candidates.push(FALLBACK_TUPATH);
    let chosen = FALLBACK_TUPATH;
    for (let i = 0; i < candidates.length; i++) {
      try {
        await hg.http.fetch({ url: candidates[i] + '/', responseType: 'text', timeoutMs: 8000, maxBytes: 1024, signal: ctx && ctx.signal });
        chosen = candidates[i];
        break;
      } catch (_) {}
    }
    const cfg = { tupath: chosen };
    cfgMem = cfg;
    try { await hg.storage.set('cfg:v3', cfg, { ttlSec: 6 * 3600 }); } catch (_) {}
    return cfg;
  }

  // 封面：与站点前端一致——smallpic 的路径 /cover/<...> 换成 cover_64_2/<...>.txt，拼在 tupath 后，
  // 内容是 data URI 文本，靠 transformResource('datauri') 解包。smallpic 直链域名不可达，不能直接当封面。
  function coverOf(m, tupath) {
    const raw = String((m && m.smallpic) || '').trim();
    if (!raw) return undefined;
    let p = raw.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].split('#')[0];
    if (!p) return undefined;
    p = p.replace(/\/cover\//i, '/cover_64_2/');
    const segs = p.split('/').filter(Boolean);
    if (segs.length && segs[0].toLowerCase() === 'cover') segs[0] = 'cover_64_2';
    if (!segs.length) return undefined;
    let path = segs.join('/');
    path = /\.[a-z0-9]+$/i.test(path) ? path.replace(/\.[a-z0-9]+$/i, '.txt') : path + '.txt';
    const base = String(tupath || FALLBACK_TUPATH).replace(/\/+$/, '');
    return { url: base + '/' + path, transform: { type: 'plugin', name: 'datauri' } };
  }

  // ---------- 数据映射 ----------
  function parseDate(s) {
    const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - 8 * 3600000;
  }
  function card(m, tupath) {
    if (!m || m.movieid == null) return null;
    const item = { id: String(m.movieid), title: String(m.Topic || '').trim(), type: 'movie' };
    if (!item.title) return null;
    const cov = coverOf(m, tupath);
    if (cov) item.cover = cov;
    const dur = parseInt(m.timesize, 10);
    if (Number.isFinite(dur) && dur > 0) item.durationSec = dur;
    const t = parseDate(m.time1 || m.UpdateTime || m.release_date);
    if (t) { item.publishedAt = t; item.year = new Date(t + 8 * 3600000).getUTCFullYear(); }
    return item;
  }
  function cards(list, tupath) {
    const out = [], seen = {};
    (list || []).forEach(function (m) {
      const it = card(m, tupath);
      if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
    });
    return out;
  }
  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function loadGroups(ctx) {
    const cached = await hg.storage.get('cats:v2');
    if (cached) return cached;
    let groups = [];
    try {
      const res = await api('/movie/tags', ctx, { allowFail: true, timeoutMs: 12000 });
      if (res && Array.isArray(res.data)) {
        res.data.forEach(function (g, gi) {
          if (!g || g.category === 'graphic') return;   // 图文/小说栏目不是视频
          const kids = [];
          (g.tags || []).forEach(function (t) {
            if (!t || t.type === 'image' || t.type === 'novel') return;
            kids.push({ id: String(t.id), label: String(t.name || '').trim() });
          });
          const label = String(g.categoryShow || g.category || '').trim();
          if (label && kids.length) groups.push({ id: 'grp:' + (gi + 1), label: label, children: kids });
        });
      }
    } catch (_) {}
    if (!groups.length) groups = FALLBACK_GROUPS;
    await hg.storage.set('cats:v2', groups, { ttlSec: 12 * 3600 });
    return groups;
  }

  async function listPage(params, ctx, extra) {
    const page = pageOf(params && params.cursor);
    let path = '/movie/list?page=' + page + '&pageSize=' + PAGE_SIZE;
    if (extra) path += extra;
    const res = await api(path, ctx, { timeoutMs: 20000 });
    const cfg = await configIni(ctx);
    const items = cards(res.data, cfg.tupath);
    const total = Number(res.total) || 0;
    return { items: items, next: total > page * PAGE_SIZE && items.length ? String(page + 1) : null };
  }

  async function detailData(id, ctx) {
    const mid = String(id || '').replace(/[^0-9]/g, '');
    if (!mid) fail('INVALID_ARGUMENT', '无效的视频 ID');
    const res = await api('/movie/' + mid, ctx, { timeoutMs: 15000 });
    if (!res.data || !res.data.h264m3u8url) fail('UPSTREAM_CHANGED', '未找到播放地址');
    return res.data;
  }

  // 只预检站点已声明的 HLS 候选；清单成功不足以证明密钥/分片可达。
  // 顺序探测保留用户首选，失败才换线；不吞登录、锁定、取消或未知错误。
  async function verifiedHls(streams, ctx) {
    const deadline = Date.now() + 18000;
    function cancelled() {
      if (ctx && ctx.signal && ctx.signal.aborted) throw new hg.PluginError('CANCELLED', '调用已取消');
    }
    function retryable(e) {
      return e && ['NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR', 'UPSTREAM_CHANGED'].indexOf(e.code) >= 0;
    }
    async function request(url, st, bytes) {
      cancelled();
      if (!/^https:\/\//i.test(url)) throw new hg.PluginError('NETWORK', '播放资源不是 HTTPS');
      const left = deadline - Date.now();
      if (left <= 0) throw new hg.PluginError('TIMEOUT', '播放线路预检超时');
      const res = await hg.http.fetch({ url: url, headers: Object.assign({}, st.headers, bytes ? { Range: 'bytes=0-1023' } : {}),
        responseType: bytes ? 'bytes' : 'text', timeoutMs: Math.min(4000, left),
        maxBytes: bytes ? 2 * 1024 * 1024 : 256 * 1024, retry: 0, signal: ctx && ctx.signal });
      cancelled();
      if (res.url && !/^https:\/\//i.test(res.url)) throw new hg.PluginError('NETWORK', '播放资源重定向到非 HTTPS');
      if (res.status === 401) throw new hg.PluginError('AUTH_REQUIRED', '播放资源需要登录');
      if (res.status === 429) throw new hg.PluginError('RATE_LIMITED', '播放资源请求过于频繁');
      if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', '播放资源 HTTP ' + res.status);
      return res;
    }
    async function check(st, url, depth) {
      if (depth > 3) throw new hg.PluginError('UPSTREAM_CHANGED', '播放清单嵌套过深');
      const res = await request(url, st, false);
      const body = typeof res.data === 'string' ? res.data.trim() : '';
      if (!/^#EXTM3U(?:\s|$)/.test(body)) throw new hg.PluginError('UPSTREAM_CHANGED', '播放地址未返回 HLS 清单');
      const base = res.url || url, lines = body.split(/\r?\n/);
      let master = false, segment = '', key = '', encrypted = false;
      for (let i = 1; i < lines.length; i++) {
        if (i % 128 === 0) { await new Promise(function (r) { setTimeout(r, 0); }); cancelled(); }
        const line = lines[i].trim();
        if (/^#EXT-X-STREAM-INF:/.test(line)) master = true;
        if (/^#EXT-X-KEY:/.test(line)) {
          encrypted = !/METHOD=NONE(?:,|$)/.test(line);
          const m = line.match(/URI="([^"]+)"/);
          key = encrypted && m ? new URL(m[1], base).href : '';
          if (encrypted && (!/METHOD=AES-128(?:,|$)/.test(line) || !key)) throw new hg.PluginError('UNSUPPORTED', '不支持的 HLS 密钥格式');
        }
        if (line && line.charAt(0) !== '#') { segment = new URL(line, base).href; break; }
      }
      if (!segment) throw new hg.PluginError('UPSTREAM_CHANGED', '播放清单没有媒体资源');
      if (master) return check(st, segment, depth + 1);
      if (key) {
        const kr = await request(key, st, true);
        if (!kr.data || kr.data.length !== 16) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 密钥长度异常');
      }
      const sr = await request(segment, st, true), data = sr.data;
      if (!data || !data.length) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 分片为空');
      // 拦截常见的 200 停放/验证页；不把一次取样当作完整解码证明。
      if (!encrypted) {
        let head = '';
        for (let i = 0; i < Math.min(data.length, 96); i++) head += String.fromCharCode(data[i]);
        if (/^\s*(?:<|\{|\[)/.test(head)) throw new hg.PluginError('UPSTREAM_CHANGED', 'HLS 分片返回了错误页面');
      }
    }
    let last;
    for (let i = 0; i < streams.length; i++) {
      cancelled();
      try { await check(streams[i], streams[i].url, 0); return [streams[i]].concat(streams.slice(i + 1)); }
      catch (e) { if (!retryable(e)) throw e; last = e; }
      if (Date.now() >= deadline) break;
    }
    throw last || new hg.PluginError('NETWORK', '没有通过清单/密钥/首片预检的播放线路');
  }

  return {
    home: {
      async getSections(params, ctx) {
        const res = await api('/movie/home_sections?pageSize=12', ctx, { timeoutMs: 20000 });
        const cfg = await configIni(ctx);
        const sections = [];
        (res.data || []).forEach(function (s, i) {
          const items = cards(s.movies, cfg.tupath);
          if (items.length) sections.push({ id: 'sec' + (s.tagid != null ? s.tagid : i), title: String(s.tagname || '最新'), layout: 'grid', imageAspect: 'landscape', items: items });
        });
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadGroups(ctx);
      },
      async list(params, ctx) {
        const cid = String((params && params.categoryId) || '').replace(/[^0-9]/g, '');
        if (!cid) fail('INVALID_ARGUMENT', '缺少分类');
        return listPage(params, ctx, '&tagid=' + cid);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        return listPage(params, ctx, '&keyword=' + encodeURIComponent(q));
      },
    },

    media: {
      async getDetail(params, ctx) {
        const d = await detailData(params && params.id, ctx);
        const cfg = await configIni(ctx);
        const item = card(d, cfg.tupath) || { id: String(d.movieid), title: String(d.movieid), type: 'movie' };
        const detail = {
          id: item.id,
          title: item.title,
          type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id: '1', index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        if (item.cover) { detail.cover = item.cover; detail.backdrop = item.cover; }
        if (item.durationSec) detail.durationSec = item.durationSec;
        if (item.year) detail.year = item.year;
        if (item.publishedAt) detail.publishedAt = item.publishedAt;
        if (d.tagname) detail.tags = [String(d.tagname)];
        try {
          if (d.tagid) {
            const rel = await api('/movie/related?tagid=' + encodeURIComponent(d.tagid) + '&movieid=' + encodeURIComponent(item.id), ctx, { allowFail: true, timeoutMs: 12000 });
            const related = cards(rel && rel.data, cfg.tupath).filter(function (x) { return x.id !== detail.id; });
            if (related.length) detail.related = related;
          }
        } catch (_) {}
        const bits = [];
        if (detail.durationSec) { const t = detail.durationSec; bits.push('时长 ' + (t >= 3600 ? Math.floor(t / 3600) + ':' : '') + String(Math.floor((t % 3600) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')); }
        if (detail.tags && detail.tags.length) bits.push('分类 ' + detail.tags[0]);
        if (detail.year) bits.push('发布于 ' + detail.year + ' 年');
        bits.push('该站点未提供视频简介');
        detail.description = bits.join(' · ');
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const d = await detailData(params && (params.mediaId || params.episodeId), ctx);
        const rels = [];
        [d.h264m3u8url, d.h264m3u8url2].forEach(function (u) {
          if (u && rels.indexOf(u) < 0) rels.push(u);
        });
        if (!rels.length) fail('UPSTREAM_CHANGED', '未找到播放地址');
        let line = M3U8_LINES[0];
        for (let i = 0; i < M3U8_LINES.length; i++) if (M3U8_LINES[i].id === params.serverId) line = M3U8_LINES[i];
        const streams = [];
        const push = function (origin, rel, label) {
          streams.push({
            url: origin + (rel.charAt(0) === '/' ? rel : '/' + rel),
            kind: 'media', format: 'hls', codec: 'h264',
            label: label, height: 720,
            serverId: M3U8_LINES.filter(function (l) { return l.origin === origin; })[0].id,
            headers: headers(),
          });
        };
        rels.forEach(function (rel, i) { push(line.origin, rel, i === 0 ? '720P' : '720P · 线路' + (i + 1)); });
        M3U8_LINES.forEach(function (l) {
          if (l.id === line.id) return;
          push(l.origin, rels[0], '720P · ' + l.label + '（备用）');
        });
        const verified = await verifiedHls(streams, ctx);
        return { streams: verified, servers: M3U8_LINES.map(function (l) { return { id: l.id, label: l.label }; }) };
      },

      matchUrl(params) {
        const u = String((params && params.url) || '');
        const m = u.match(/\/movie\/(\d+)/) || u.match(/[?&](?:movieid|id)=(\d+)/);
        return m ? { mediaId: m[1] } : null;
      },
    },

    // 封面 .txt 内容是 "data:image\jpg;base64,\9j\4AAQ…"（斜杠被写成反斜杠，含换行），与旧版相同
    transformResource(params) {
      if (params.name !== 'datauri') return { data: params.data };
      const text = hg.codec.utf8Decode(params.data).replace(/\\/g, '/').trim();
      const m = text.match(/^data:([^;,]+);base64,([\s\S]*)$/);
      if (!m) return { data: params.data };
      const b64 = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
      return { data: hg.codec.base64Decode(b64), contentType: m[1].replace('jpg', 'jpeg') };
    },
  };
}
