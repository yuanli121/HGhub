export const meta = {
  id: 'pornlulu',
  name: '撸撸视频 Pornlulu',
  version: '1.0.2',
  protocol: 1,
  description: 'Pornlulu（撸撸）：首页、分类、排行、搜索、详情与 HLS 播放。站点前置 CDNLah「工作量验证」（SHA-256 PoW），插件内自动求解并缓存通行 Cookie。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['pornlulu.net', 'www.pornlulu.net'],
  defaultHeaders: {
    Referer: 'https://www.pornlulu.net/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 45, playback: 45 },
};

const SITE = 'https://www.pornlulu.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const POW_KEY = 'pow:cookie';
const MAX_DIFFICULTY = 6;          // 16^6≈1677 万次哈希，QuickJS 里已不可接受，超过即报不可用
const SORTS = [
  { id: 'new', label: '最新' },
  { id: 'hits', label: '最多观看' },
  { id: 'likes', label: '最多收藏' },
  { id: 'score', label: '评分最高' },
];
const SORT_PARAM = { new: '', hits: 'hits', likes: 'likes', score: 'score' };
const FALLBACK_CATS = [
  ['13', '强奸乱伦'], ['270', '日本无码'], ['269', '日本有码'], ['48', '中文字幕'], ['254', '无码专区'],
  ['86', '动漫精品'], ['93', '巨乳美乳'], ['367', '伦理三级'], ['260', '欧美精品'], ['392', 'AV解说'],
  ['23', '人妻熟女'], ['416', '麻豆传媒'], ['357', 'AI换脸'], ['653', '韩国-主播'],
];

export default function (hg) {
  let solving = null;
  let pendingChallenge = null;   // { cfg, at }：未解完的 PoW 题目，跨调用接力
  let memCookie = null;   // { value, expiresAt }

  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    return origin() + (href.charAt(0) === '/' ? href : '/' + href);
  }

  // 游标 = "页码|上一页的条目 ID"：站点部分分类排序不稳定，相邻页会重复，用它跨页去重
  function pageOf(cursor) {
    const n = parseInt(String(cursor || '1').split('|')[0], 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function prevIdsOf(cursor) {
    const out = {};
    const part = String(cursor || '').split('|')[1];
    if (part) part.split(',').forEach(function (x) { if (x) out[x] = true; });
    return out;
  }

  function pageResult(doc, cursor) {
    const page = pageOf(cursor);
    const all = parseCards(doc);
    const prev = prevIdsOf(cursor);
    const items = all.filter(function (x) { return !prev[x.id]; });
    const more = all.length > 0 && hasNext(doc, page);
    return {
      items,
      next: more ? String(page + 1) + '|' + all.map(function (x) { return x.id; }).join(',') : null,
    };
  }

  function baseHeaders(cookie) {
    const h = {
      'User-Agent': UA,
      Referer: origin() + '/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
    if (cookie) h.Cookie = cookie;
    return h;
  }

  // ---------- CDNLah PoW ----------
  // 页面 <script id="__cdnlah_pow_config">{"seed","difficulty","verify_path","redirect","challenge_cookie","metadata_field","metadata_token"}
  // 找 nonce（16 位小写十六进制，从 0 递增），使 sha256hex(seed + nonce) 以 difficulty 个 '0' 开头；
  // 然后 POST(form) verify_path：seed、nonce、redirect、challenge_cookie、<metadata_field>=<metadata_token>，
  // 302 + Set-Cookie: _chg_waf_pow=…; Expires=+5 分钟; HttpOnly; Secure。
  function parsePowConfig(html) {
    const m = String(html || '').match(/<script[^>]+id=["']__cdnlah_pow_config["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }

  function hex16(n) {
    let s = n.toString(16);
    while (s.length < 16) s = '0' + s;
    return s;
  }

  function leadingZeroNibbles(bytes, d) {
    const full = d >> 1;
    for (let i = 0; i < full; i++) if (bytes[i] !== 0) return false;
    if (d & 1) return (bytes[full] >> 4) === 0;
    return true;
  }

  // 宿主对一次连续同步执行有 1 秒上限（超过即强行中断，连续 3 次停用插件），一次调用还有约 30 秒时限。
  // 难度 4 期望 65536 次 digest，手机上可能要一分钟以上，所以：
  //  ① 每 40ms 让出一次事件循环（QuickJS 实测最长连续段 54ms）；
  //  ② 进度按 seed 记在插件内存里，本次调用快到时限就先返回「请稍后重试」，下次调用从断点接着算；
  //  ③ 同一时间只算一份，其它并发调用等它。
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  const powProgress = {};   // seed -> 下一个要试的 nonce
  async function solvePow(seed, difficulty, ctx) {
    const limit = Math.pow(16, difficulty) * 24;   // 期望 16^d 次，24 倍时失败概率 < e^-24
    const t0 = Date.now();
    let n = powProgress[seed] || 0;
    let slice = Date.now();
    for (; n < limit; n++) {
      const nonce = hex16(n);
      const h = hg.crypto.digest('sha256', seed + nonce);
      if (leadingZeroNibbles(h, difficulty)) {
        delete powProgress[seed];
        hg.log.info('pow solved', { tries: n + 1, ms: Date.now() - t0, difficulty });
        return nonce;
      }
      if (Date.now() - slice > 40) {
        if (ctx && ctx.signal && ctx.signal.aborted) { powProgress[seed] = n; return null; }
        if (ctx && typeof ctx.deadline === 'number' && ctx.deadline - Date.now() < 2000) {
          powProgress[seed] = n + 1;
          // RATE_LIMITED 要带 retryAfterSec，宿主据此在该时间内禁止重试并提示（协议 §8.2）
          fail('RATE_LIMITED', '站点安全验证计算中（已尝试 ' + (n + 1) + ' 次），请稍后下拉刷新', { retryAfterSec: 3 });
        }
        await tick();
        slice = Date.now();
      }
    }
    delete powProgress[seed];
    return null;
  }

  function cookieFrom(setCookies, name) {
    const list = Array.isArray(setCookies) ? setCookies : [];
    for (let i = 0; i < list.length; i++) {
      const raw = String(list[i]);
      const eq = raw.indexOf('=');
      if (eq < 0) continue;
      if (raw.slice(0, eq).trim() !== name) continue;
      const semi = raw.indexOf(';');
      const value = raw.slice(eq + 1, semi < 0 ? undefined : semi).trim();
      let expiresAt = Date.now() + 5 * 60 * 1000;
      const ma = raw.match(/max-age=(\d+)/i);
      const ex = raw.match(/expires=([^;]+)/i);
      if (ma) expiresAt = Date.now() + parseInt(ma[1], 10) * 1000;
      else if (ex) { const t = Date.parse(ex[1]); if (Number.isFinite(t)) expiresAt = t; }
      return { pair: name + '=' + value, expiresAt };
    }
    return null;
  }

  async function getCookie() {
    if (memCookie && memCookie.expiresAt - 20000 > Date.now()) return memCookie.pair;
    try {
      const c = await hg.storage.get(POW_KEY);
      if (c && c.pair && c.expiresAt - 20000 > Date.now()) { memCookie = c; return c.pair; }
    } catch (_) {}
    return null;
  }

  async function passChallenge(cfg, ctx) {
    const seed = String(cfg.seed || '');
    const difficulty = Number(cfg.difficulty || 0);
    if (!seed || !difficulty || !cfg.verify_path) fail('UPSTREAM_CHANGED', '安全验证页结构已变化');
    if (difficulty > MAX_DIFFICULTY) {
      fail('UNSUPPORTED', '站点工作量验证难度过高（' + difficulty + ' 位），插件内无法在合理时间内求解');
    }
    const nonce = await solvePow(seed, difficulty, ctx);
    if (!nonce) fail('UPSTREAM_ERROR', '工作量验证求解失败');
    const form = {
      seed,
      nonce,
      redirect: String(cfg.redirect || '/'),
    };
    if (cfg.challenge_cookie) form.challenge_cookie = String(cfg.challenge_cookie);
    if (cfg.metadata_field && cfg.metadata_token) form[String(cfg.metadata_field)] = String(cfg.metadata_token);
    const res = await hg.http.fetch({
      url: absUrl(String(cfg.verify_path)),
      method: 'POST',
      headers: Object.assign(baseHeaders(), { Origin: origin() }),
      body: { form },
      redirect: 'manual',
      timeoutMs: 15000,
      signal: ctx && ctx.signal,
    });
    const name = String(cfg.challenge_cookie || '_chg_waf_pow');
    const c = cookieFrom(res.setCookies, name);
    if (!c) fail('UPSTREAM_ERROR', '安全验证未通过（HTTP ' + res.status + '）');
    memCookie = c;
    try { await hg.storage.set(POW_KEY, c, { ttlSec: Math.max(30, Math.floor((c.expiresAt - Date.now()) / 1000)) }); } catch (_) {}
    return c.pair;
  }

  async function fetchHtml(url, ctx) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cookie = await getCookie();
      const res = await hg.http.fetch({
        url,
        headers: baseHeaders(cookie),
        responseType: 'text',
        timeoutMs: 20000,
        retry: 1,
        maxBytes: 8 * 1024 * 1024,
        signal: ctx && ctx.signal,
      });
      const body = typeof res.data === 'string' ? res.data : '';
      const cfg = (res.status === 492 || body.indexOf('__cdnlah_pow_config') >= 0) ? parsePowConfig(body) : null;
      if (cfg) {
        memCookie = null;
        try { await hg.storage.delete(POW_KEY); } catch (_) {}
        // 未解完的题目继续用原题（实测题目放置 3 分钟后提交仍有效），否则断点进度作废
        if (!pendingChallenge || Date.now() - pendingChallenge.at > 150000) pendingChallenge = { cfg, at: Date.now() };
        if (!solving) {
          const task = pendingChallenge.cfg;
          solving = passChallenge(task, ctx).then(function (v) { solving = null; pendingChallenge = null; return v; }, function (e) { solving = null; throw e; });
        }
        await solving;
        continue;
      }
      if (res.status === 404) fail('NOT_FOUND', '页面不存在');
      if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
      return body;
    }
    fail('UPSTREAM_ERROR', '多次通过安全验证后仍被拦截');
  }

  // ---------- 解析 ----------
  function vidOf(href) {
    const m = String(href || '').match(/\/v\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
  }

  function parseCards(doc) {
    const items = [];
    const seen = {};
    const cards = doc.select('.card');
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const a = card.first('a[href*="/v/"]');
      if (!a) continue;
      const id = vidOf(a.attr('href'));
      if (!id || seen[id]) continue;
      const img = card.first('img.card-img-top') || card.first('img');
      const t = card.first('.two-lines a') || card.first('.card-body a');
      const title = ((t && t.text()) || (img && img.attr('alt')) || '').trim();
      if (!title) continue;
      seen[id] = true;
      const item = { id, title, type: 'movie' };
      const src = img && (img.attr('data-src') || img.attr('src'));
      if (src && !/imgdef/.test(src)) item.cover = absUrl(src);
      const label = card.first('.imagelabel');
      const lt = label && label.text().trim();
      if (lt) item.badge = lt.slice(0, 8);
      items.push(item);
    }
    return items;
  }

  function hasNext(doc, page) {
    const nx = doc.first('.pagination li.next');
    if (nx) return !/\bdisabled\b/.test(nx.attr('class') || '');
    const links = doc.select('.pagination a[data-page]');
    for (let i = 0; i < links.length; i++) {
      if (parseInt(links[i].attr('data-page'), 10) + 1 > page) return true;
    }
    return false;
  }

  async function listPage(path, query, cursor, ctx) {
    const page = pageOf(cursor);
    const q = [];
    for (const k in (query || {})) if (query[k]) q.push(k + '=' + encodeURIComponent(query[k]));
    if (page > 1) q.push('page=' + page);
    const url = origin() + encodeURI(path) + (q.length ? '?' + q.join('&') : '');
    const html = await fetchHtml(url, ctx);
    return pageResult(hg.html.parse(html), cursor);
  }

  async function loadCats(ctx) {
    try {
      const html = await fetchHtml(origin() + '/', ctx);
      const doc = hg.html.parse(html);
      const links = doc.select('a[href^="/cat/"]');
      const out = [];
      const seen = {};
      for (let i = 0; i < links.length; i++) {
        const m = (links[i].attr('href') || '').match(/^\/cat\/(\d+)$/);
        const label = links[i].text().trim();
        if (!m || !label || seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ id: 'cat:' + m[1], label, sorts: SORTS });
      }
      if (out.length) return out;
    } catch (e) {
      if (e && e.code === 'RATE_LIMITED') throw e;
    }
    return FALLBACK_CATS.map(function (c) { return { id: 'cat:' + c[0], label: c[1], sorts: SORTS }; });
  }

  function metaContent(doc, sel) {
    const n = doc.first(sel);
    const v = n && n.attr('content');
    return v ? v.trim() : '';
  }

  async function loadVideo(id, ctx) {
    const vid = vidOf('/v/' + String(id).replace(/^.*\/v\//, ''));
    if (!vid) fail('INVALID_ARGUMENT', '作品 ID 无效');
    const html = await fetchHtml(origin() + '/v/' + vid, ctx);
    const doc = hg.html.parse(html);
    return { vid, doc, html };
  }

  function streamUrlOf(doc, html) {
    const s = doc.first('#myvideo source[src]') || doc.first('video source[src]');
    let src = s && s.attr('src');
    if (!src) {
      const m = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/);
      src = m && m[0];
    }
    return src ? absUrl(src) : '';
  }

  return {
    endpoints: {
      list() { return [{ id: 'main', label: '主站', url: SITE }]; },
    },

    home: {
      async getSections(params, ctx) {
        const latest = await listPage('/', null, '1', ctx);
        const sections = [];
        if (latest.items.length) {
          sections.push({ id: 'latest', title: '最新更新', layout: 'grid', imageAspect: 'landscape', items: latest.items, more: !!latest.next });
        }
        try {
          const hot = await listPage('/', { sort: 'hits' }, '1', ctx);
          if (hot.items.length) sections.push({ id: 'hits', title: '最多观看', layout: 'row', imageAspect: 'landscape', items: hot.items.slice(0, 24), more: true });
        } catch (_) {}
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const id = String(params.sectionId || '');
        if (id === 'hits') return listPage('/', { sort: 'hits' }, params.cursor, ctx);
        return listPage('/', null, params.cursor, ctx);
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const cats = await loadCats(ctx);
        return [{ id: 'all', label: '全部', sorts: SORTS }].concat(cats);
      },
      async list(params, ctx) {
        const cid = String(params.categoryId || 'all');
        const sort = SORT_PARAM[params.sort || 'new'] || '';
        const query = sort ? { sort } : null;
        if (cid.indexOf('cat:') === 0) return listPage('/cat/' + cid.slice(4), query, params.cursor, ctx);
        return listPage('/', query, params.cursor, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = String((params && params.query) || '').trim();
        if (!q) return { items: [], next: null };
        const page = pageOf(params.cursor);
        const url = origin() + '/q/' + encodeURIComponent(q) + (page > 1 ? '?page=' + page : '');
        const html = await fetchHtml(url, ctx);
        return pageResult(hg.html.parse(html), params.cursor);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const r = await loadVideo(params.id, ctx);
        const doc = r.doc;
        const h1 = doc.first('h1.title');
        const title = (metaContent(doc, 'meta[property="og:title"]') || (h1 && h1.ownText()) || r.vid).trim();
        const detail = {
          id: r.vid,
          title,
          type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id: r.vid, index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        const video = doc.first('#myvideo');
        const cover = metaContent(doc, 'meta[property="og:image"]') || (video && video.attr('poster'));
        if (cover) { detail.cover = absUrl(cover); detail.backdrop = absUrl(cover); }
        const desc = metaContent(doc, 'meta[name="description"]');
        if (desc && desc !== title) detail.description = desc;
        const tags = [];
        const crumbs = doc.select('.breadcrumb a[href^="/cat/"]');
        for (let i = 0; i < crumbs.length; i++) { const t = crumbs[i].text().trim(); if (t) tags.push(t); }
        if (tags.length) detail.tags = tags.slice(0, 20);
        const related = parseCards(doc).filter(function (x) { return x.id !== r.vid; });
        if (related.length) detail.related = related.slice(0, 24);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const r = await loadVideo(params.episodeId || params.mediaId, ctx);
        const url = streamUrlOf(r.doc, r.html);
        if (!url) fail('CONTENT_LOCKED', '未找到播放地址');
        return {
          streams: [{
            url,
            kind: 'media',
            format: /\.mp4(\?|$)/i.test(url) ? 'progressive' : 'hls',
            headers: { 'User-Agent': UA, Referer: origin() + '/' },
          }],
        };
      },

      matchUrl(params) {
        let u;
        try { u = new URL(String(params.url || '')); } catch (_) { return null; }
        if (!/(^|\.)pornlulu\.net$/i.test(u.hostname)) return null;
        const id = vidOf(u.pathname);
        return id ? { mediaId: id, episodeId: id } : null;
      },
    },
  };
}
