export const meta = {
  id: 'haose',
  name: '好色TV',
  version: '1.0.2',
  protocol: 1,
  description: '好色TV（boot.pirvmpmir.cc）：成人视频、好色短剧、好色黑料（图文帖内嵌视频）、精选分类与搜索。播放走站点 playback 接口，封面为 AES-CBC 加密图。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['boot.pirvmpmir.cc', 'pirvmpmir.cc', 'qnlycc.cn', 'tjyyjk.cn'],
  defaultHeaders: {
    Referer: 'https://boot.pirvmpmir.cc/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://boot.pirvmpmir.cc';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 站点图片是加密的：路径含 /upload_01/ 等目录的，内容是 AES-128-CBC（与 911爆料网、黄果短剧、91Porna 同一套密钥，实测解出 JPEG）
const IMG_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const IMG_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';

// 精选标签（/tag/ 页只有一部分，内置常用的；运行时再从 /tag/ 页补充）
const SORTS = [{ id: 'new', label: '最新' }, { id: 'hot', label: '最热' }];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers(extra) {
    return Object.assign({ 'User-Agent': UA, Referer: origin() + '/', 'Accept-Language': 'zh-CN,zh;q=0.9' }, extra || {});
  }
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function abs(u) {
    if (!u) return '';
    u = String(u).trim().replace(/&amp;/g, '&');
    if (u.indexOf('//') === 0) u = 'https:' + u;
    else if (u.charAt(0) === '/') u = origin() + u;
    return encodeUrl(u);
  }
  // 封面：data-fallback-src 是原图（加密），data-src 是 webp 转码版（明文但站点会改，优先原图 + 解密）
  function imgRef(card) {
    const raw = card.attr('data-fallback-src') || card.attr('data-src') || card.attr('src') || '';
    if (!raw || /placeholder|poster_loading/.test(raw)) return undefined;
    return imgUrlRef(abs(raw));
  }
  // 单张图地址 → 资源引用：加密图返回带 transform 的对象，明文图返回字符串
  function imgUrlRef(url) {
    let path = '';
    try { path = new URL(url).pathname; } catch (_) { return url; }
    if (!/\/(upload_01|upload|uploads|xiao|hc237|upload-images)\//.test(path)) return url;
    // 详情页 og:image 指向 imgpublic.*：那是站点已解好的明文图，不能再解密（实测按密钥解会得到乱码）
    let host = ''; try { host = new URL(url).hostname; } catch (_) {}
    if (/^imgpublic\./.test(host)) return url;
    return { url, transform: { type: 'aes-cbc', key: IMG_KEY_B64, iv: IMG_IV_B64, padding: 'pkcs7' } };
  }
  function bodyImgRef(raw) { return imgUrlRef(abs(raw)); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function secs(t) {
    const m = String(t || '').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : undefined;
  }

  async function fetchHtml(url, ctx, allow404) {
    const res = await hg.http.fetch({ url, headers: headers(), responseType: 'text', timeoutMs: 20000, retry: 1, maxBytes: 8 * 1024 * 1024, signal: ctx && ctx.signal });
    if (res.status === 404) { if (allow404) return null; fail('NOT_FOUND', '页面不存在'); }
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }
  async function postJson(path, body, referer, ctx) {
    const res = await hg.http.fetch({
      url: origin() + path, method: 'POST', body: { json: body || {} }, responseType: 'json', timeoutMs: 20000, retry: 1,
      headers: headers({ 'Content-Type': 'application/json', Accept: 'application/json', Origin: origin(), Referer: referer || origin() + '/' }),
      signal: ctx && ctx.signal,
    });
    if (!res.ok || !res.data || Number(res.data.code) !== 200 || !res.data.data) {
      fail('UPSTREAM_ERROR', (res.data && (res.data.msg || res.data.message)) || '播放服务暂不可用（HTTP ' + res.status + '）');
    }
    return res.data.data;
  }

  // 下一页：以 <link rel="next"> 为准；越界页站点返回 404
  function nextHref(html) {
    const m = html.match(/<link rel="next" href="([^"]+)"/);
    if (!m) return '';
    try { return new URL(m[1].replace(/&amp;/g, '&')).pathname; } catch (_) { return m[1]; }
  }

  // ---- 列表卡片 ----
  // 成人视频：li.all-video-card；搜索/标签：.video-card-v2；短剧：a.drama-card；黑料：article.gossip-card
  function parseVideoCards(doc) {
    const out = [], seen = {};
    const cards = doc.select('li.all-video-card, .video-card-v2');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const a = c.first('a[data-vk]') || c.first('a[href^="/video/"]');
      const href = a && a.attr('href');
      const m = href && href.match(/\/video\/(\d+)\//);
      if (!m || seen[m[1]]) continue;
      const img = c.first('img');
      const title = clean((a && a.attr('title')) || (img && img.attr('alt')) || '');
      if (!title) continue;
      seen[m[1]] = 1;
      const it = { id: 'v' + m[1], title, type: 'movie' };
      const cover = img && imgRef(img);
      if (cover) { it.cover = cover; it.backdrop = cover; }
      const tm = c.first('.all-video-card__badge--time') || c.first('.video-card-v2__duration');
      const d = tm && secs(clean(tm.text()));
      if (d) it.durationSec = d;
      const hd = c.first('.all-video-card__badge--hd');
      if (hd) it.badge = clean(hd.text()).slice(0, 8);
      out.push(it);
    }
    return out;
  }
  function parseDramaCards(doc) {
    const out = [], seen = {};
    const cards = doc.select('a.drama-card');
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i];
      const m = (a.attr('href') || '').match(/\/drama\/(\d+)\//);
      if (!m || seen[m[1]]) continue;
      const title = clean(a.attr('title') || (a.first('h2') && a.first('h2').text()) || '');
      if (!title) continue;
      seen[m[1]] = 1;
      const it = { id: 'd' + m[1], title, type: 'series' };
      const img = a.first('img');
      const cover = img && imgRef(img);
      if (cover) it.cover = cover;
      const eps = a.first('.drama-card__eps');
      const em = eps && clean(eps.text()).match(/(\d+)/);
      if (em) it.episodeCount = Number(em[1]);
      const st = a.first('.drama-card__state');
      if (st) it.badge = clean(st.text()).slice(0, 8);
      const p = a.first('p');
      if (p) { const d = clean(p.text()); if (d) it.description = d.slice(0, 200); }
      out.push(it);
    }
    return out;
  }
  function parseGossipCards(doc) {
    const out = [], seen = {};
    const cards = doc.select('article.gossip-card');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const a = c.first('a.gossip-card__cover') || c.first('a[href^="/gossip/"]');
      const m = a && (a.attr('href') || '').match(/\/gossip\/(\d+)\//);
      if (!m || seen[m[1]]) continue;
      const title = clean((a && a.attr('title')) || (c.first('h2') && c.first('h2').text()) || '');
      if (!title) continue;
      seen[m[1]] = 1;
      const it = { id: 'g' + m[1], title, type: 'short' };
      const img = c.first('img');
      const cover = img && imgRef(img);
      if (cover) { it.cover = cover; it.backdrop = cover; }
      const tags = c.select('.gossip-card__tags a');
      if (tags.length) it.tags = tags.slice(0, 6).map(function (t) { return clean(t.text()); }).filter(Boolean);
      const tm = c.first('time');
      if (tm && tm.attr('datetime')) { const t = Date.parse(tm.attr('datetime')); if (Number.isFinite(t)) { it.publishedAt = t; it.year = new Date(t).getFullYear(); } }
      out.push(it);
    }
    return out;
  }

  // 栏目 → 路径与解析器
  const SECTIONS = {
    video: { label: '成人视频', path: '/video/', parse: parseVideoCards, pager: function (p, sort) { return p > 1 ? '/video/page/' + p + '/' : '/video/'; }, sortable: true },
    drama: { label: '好色短剧', path: '/drama/', parse: parseDramaCards, pager: function (p) { return p > 1 ? '/drama/page/' + p + '/' : '/drama/'; }, sortable: true },
    gossip: { label: '好色黑料', path: '/gossip/', parse: parseGossipCards, pager: function (p) { return p > 1 ? '/gossip/page/' + p + '/' : '/gossip/'; }, sortable: true },
  };

  async function listSection(key, sort, cursor, ctx) {
    const sec = SECTIONS[key];
    const page = pageOf(cursor);
    let url = origin() + sec.pager(page);
    if (sort === 'hot') url += '?sort=hot';
    const html = await fetchHtml(url, ctx, page > 1);
    if (html === null) return { items: [], next: null };
    const doc = hg.html.parse(html);
    const items = sec.parse(doc);
    return { items, next: items.length && nextHref(html) ? String(page + 1) : null };
  }

  // 标签与搜索：结果是 .video-card-v2（视频）；翻页是 /tag/{名}/video/{N}/、/search/{词}/page/{N}/
  async function listTag(name, cursor, ctx) {
    const page = pageOf(cursor);
    const base = origin() + '/tag/' + encodeURIComponent(name) + '/';
    const url = page > 1 ? base + 'video/' + page + '/' : base;
    const html = await fetchHtml(url, ctx, page > 1);
    if (html === null) return { items: [], next: null };
    const items = parseVideoCards(hg.html.parse(html));
    return { items, next: items.length && nextHref(html) ? String(page + 1) : null };
  }

  let tagCache = null;
  async function loadTags(ctx) {
    if (tagCache) return tagCache;
    const out = [], seen = {};
    try {
      for (let p = 1; p <= 3; p++) {
        const html = await fetchHtml(origin() + '/tag/' + (p > 1 ? 'page/' + p + '/' : ''), ctx, true);
        if (!html) break;
        const re = /href="\/tag\/([^"\/]+)\/"[^>]*>\s*([^<]{1,16}?)\s*</g;
        let m;
        while ((m = re.exec(html))) {
          let name; try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; }
          if (name === 'page' || seen[name]) continue;
          seen[name] = 1;
          out.push({ id: 't:' + name, label: clean(m[2]) || name });
        }
        if (!/rel="next"/.test(html)) break;
      }
    } catch (_) {}
    tagCache = out;
    return out;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        const v = await listSection('video', 'hot', '1', ctx);
        if (v.items.length) sections.push({ id: 'video', title: '热门视频', layout: 'grid', imageAspect: 'landscape', items: v.items, more: !!v.next });
        try {
          const d = await listSection('drama', 'hot', '1', ctx);
          if (d.items.length) sections.push({ id: 'drama', title: '好色短剧', layout: 'row', imageAspect: 'portrait', items: d.items, more: !!d.next });
        } catch (_) {}
        try {
          const g = await listSection('gossip', 'new', '1', ctx);
          if (g.items.length) sections.push({ id: 'gossip', title: '好色黑料', layout: 'grid', imageAspect: 'landscape', items: g.items, more: !!g.next });
        } catch (_) {}
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const id = String(params.sectionId || 'video');
        return listSection(SECTIONS[id] ? id : 'video', id === 'gossip' ? 'new' : 'hot', params.cursor, ctx);
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const tree = [
          { id: 'video', label: '成人视频', sorts: SORTS },
          { id: 'drama', label: '好色短剧', sorts: SORTS },
          { id: 'gossip', label: '好色黑料', sorts: SORTS },
        ];
        const tags = await loadTags(ctx);
        if (tags.length) tree.push({ id: 'tags', label: '精选分类', children: tags });
        return tree;
      },
      async list(params, ctx) {
        const cid = String(params.categoryId || 'video');
        if (cid.indexOf('t:') === 0) return listTag(cid.slice(2), params.cursor, ctx);
        if (!SECTIONS[cid]) fail('INVALID_ARGUMENT', '未知分类');
        return listSection(cid, params.sort === 'hot' ? 'hot' : 'new', params.cursor, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = clean(params && params.query);
        if (!q) return { items: [], next: null };
        const page = pageOf(params.cursor);
        const base = origin() + '/search/' + encodeURIComponent(q) + '/';
        const html = await fetchHtml(page > 1 ? base + 'page/' + page + '/' : base, ctx, page > 1);
        if (html === null) return { items: [], next: null };
        const items = parseVideoCards(hg.html.parse(html));
        return { items, next: items.length && nextHref(html) ? String(page + 1) : null };
      },
    },

    // 好色黑料是「图文帖，部分带视频」：作为图文（文字正文 + 文内视频）浏览。
    // 正文图片是 AES 加密的，协议规定富文本里的图片宿主不做字节变换，所以正文里的图片去掉，封面保留。
    articles: {
      async list(params, ctx) {
        const r = await listSection('gossip', 'new', params.cursor, ctx);
        return {
          items: r.items.map(function (it) {
            const a = { id: it.id.slice(1), title: it.title };
            if (it.cover) a.cover = it.cover;
            if (it.tags) a.tags = it.tags;
            if (it.publishedAt) a.publishedAt = it.publishedAt;
            return a;
          }),
          next: r.next,
        };
      },
      async getDetail(params, ctx) {
        const n = String((params && params.id) || '').replace(/^g/, '');
        if (!/^\d+$/.test(n)) fail('INVALID_ARGUMENT', '帖子 ID 无效');
        const html = await fetchHtml(origin() + '/gossip/' + n + '/', ctx);
        const doc = hg.html.parse(html);
        const h1 = doc.first('h1');
        const d = { id: n, title: clean(h1 ? h1.text() : '') || ('黑料 ' + n) };
        const body = doc.first('.gossip-post__body');
        if (body) {
          // 宿主声明 article.image 时，正文里的加密图交给宿主解密（<img data-hpp>），否则只能舍弃
          const richImages = !!(hg.env && Array.isArray(hg.env.features) && hg.env.features.indexOf('article.image') >= 0);
          let h = body.html();
          h = h.replace(/<img\b[^>]*>/gi, function (tag) {
            if (!richImages) return '';
            const src = tag.match(/\bdata-src="([^"]+)"/) || tag.match(/\bsrc="([^"]+)"/) || tag.match(/\bdata-original="([^"]+)"/);
            const raw = src ? src[1] : '';
            if (!raw || /placeholder|poster_loading/.test(raw)) return '';
            const ref = bodyImgRef(raw);
            const alt = (tag.match(/\balt="([^"]*)"/) || [])[1] || '';
            if (typeof ref === 'string') return '<img src="' + ref + '" alt="' + alt + '">';
            return '<img src="' + ref.url + '" alt="' + alt + '" data-hpp=\''
              + JSON.stringify({ transform: ref.transform }) + '\'>';
          });
          h = h.replace(/<p>\s*<\/p>/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').trim();
          d.contentHtml = h;
          d.contentText = h.replace(/<\/(p|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n\s*\n+/g, '\n\n').trim();
        }
        const og = doc.first('meta[property="og:image"]');
        if (og && og.attr('content')) d.cover = og.attr('content');
        const desc = doc.first('meta[name="description"]');
        if (desc && desc.attr('content')) d.summary = clean(desc.attr('content')).slice(0, 200);
        const tags = doc.select('.gossip-post a[href^="/tag/"]').map(function (a) { return clean(a.text()); }).filter(Boolean);
        if (tags.length) d.tags = tags.slice(0, 10);
        try {
          const info = await postJson('/gossip/' + n + '/playback', {}, origin() + '/gossip/' + n + '/', ctx);
          const vids = Array.isArray(info.videos) ? info.videos : [];
          if (vids.length) {
            d.mediaId = 'g' + n;
            d.streams = vids.slice(0, 16).map(function (v, i) {
              return { url: v.url, kind: 'media', format: 'hls', label: vids.length > 1 ? '视频 ' + (i + 1) : '视频', headers: { 'User-Agent': UA, Referer: origin() + '/' } };
            });
          }
        } catch (_) {}
        return d;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '');
        const kind = id.charAt(0), n = id.slice(1);
        if (!/^\d+$/.test(n)) fail('INVALID_ARGUMENT', '作品 ID 无效');
        if (kind === 'v') {
          const html = await fetchHtml(origin() + '/video/' + n + '/', ctx);
          const doc = hg.html.parse(html);
          const h1 = doc.first('h1');
          const title = clean(h1 ? h1.text() : '') || ('视频 ' + n);
          const detail = { id, title, type: 'movie', playlists: [{ id: 'main', label: '默认', episodes: [{ id: '1', index: 1, episodeNumber: 1, label: '播放' }] }] };
          const og = doc.first('meta[property="og:image"]');
          const v = doc.first('#videoPlayer');
          const coverRaw = (v && v.attr('data-cover')) || (v && v.attr('poster')) || (og && og.attr('content'));
          if (coverRaw) { const cr = imgRef({ attr: function (k) { return k === 'data-fallback-src' ? coverRaw : ''; } }); if (cr) { detail.cover = cr; detail.backdrop = cr; } }
          const desc = doc.first('meta[name="description"]');
          if (desc && desc.attr('content')) detail.description = clean(desc.attr('content')).slice(0, 400);
          const kw = doc.first('meta[name="keywords"]');
          const tags = doc.select('a[href^="/tag/"]').map(function (a) { return clean(a.text()); }).filter(function (t) { return t && t.length <= 10; });
          if (tags.length) detail.tags = tags.filter(function (t, i) { return tags.indexOf(t) === i; }).slice(0, 12);
          return detail;
        }
        if (kind === 'd') {
          const html = await fetchHtml(origin() + '/drama/' + n + '/', ctx);
          const doc = hg.html.parse(html);
          const h1 = doc.first('h1');
          const title = clean(h1 ? h1.text() : '') || ('短剧 ' + n);
          const eps = [];
          const seen = {};
          const links = doc.select('a[href*="/episode/"]');
          for (let i = 0; i < links.length; i++) {
            const m = (links[i].attr('href') || '').match(new RegExp('/drama/' + n + '/episode/(\\d+)/'));
            if (!m || seen[m[1]]) continue;
            seen[m[1]] = 1;
            eps.push({ id: m[1], index: eps.length + 1, episodeNumber: eps.length + 1, label: String(eps.length + 1) });
          }
          if (!eps.length) fail('NOT_FOUND', '该短剧暂无分集');
          const detail = { id, title, type: 'series', episodeCount: eps.length, playlists: [{ id: 'main', label: '默认', episodes: eps }] };
          const og = doc.first('meta[property="og:image"]');
          if (og && og.attr('content')) { const cr = imgRef({ attr: function (k) { return k === 'data-fallback-src' ? og.attr('content') : ''; } }); if (cr) { detail.cover = cr; detail.backdrop = cr; } }
          const desc = doc.first('meta[name="description"]');
          if (desc && desc.attr('content')) detail.description = clean(desc.attr('content')).slice(0, 500);
          return detail;
        }
        if (kind === 'g') {
          const html = await fetchHtml(origin() + '/gossip/' + n + '/', ctx);
          const doc = hg.html.parse(html);
          const h1 = doc.first('h1');
          const title = clean(h1 ? h1.text() : '') || ('黑料 ' + n);
          // 先问播放接口有几个视频；没有视频的帖子是纯图文
          const info = await postJson('/gossip/' + n + '/playback', {}, origin() + '/gossip/' + n + '/', ctx);
          const vids = Array.isArray(info.videos) ? info.videos : [];
          if (!vids.length) fail('NOT_FOUND', '该帖子没有视频（纯图文）');
          const detail = { id, title, type: 'short', episodeCount: vids.length,
            playlists: [{ id: 'main', label: '帖内视频', episodes: vids.map(function (_, i) { return { id: String(i), index: i + 1, episodeNumber: i + 1, label: String(i + 1) }; }) }] };
          const og = doc.first('meta[property="og:image"]');
          if (og && og.attr('content')) { const cr = imgRef({ attr: function (k) { return k === 'data-fallback-src' ? og.attr('content') : ''; } }); if (cr) { detail.cover = cr; detail.backdrop = cr; } }
          const desc = doc.first('meta[name="description"]');
          if (desc && desc.attr('content')) detail.description = clean(desc.attr('content')).slice(0, 400);
          const tags = doc.select('.gossip-post a[href^="/tag/"]').map(function (a) { return clean(a.text()); }).filter(Boolean);
          if (tags.length) detail.tags = tags.slice(0, 10);
          return detail;
        }
        fail('INVALID_ARGUMENT', '作品 ID 无效');
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && params.mediaId) || '');
        const kind = id.charAt(0), n = id.slice(1);
        const ep = String((params && params.episodeId) || '0');
        if (!/^\d+$/.test(n)) fail('INVALID_ARGUMENT', '作品 ID 无效');
        let url = '', duration;
        if (kind === 'v') {
          const d = await postJson('/videos/' + n + '/playback', {}, origin() + '/video/' + n + '/', ctx);
          const s = d.streams || {};
          url = s.main || s.hevc || '';
        } else if (kind === 'd') {
          const d = await postJson('/drama/' + n + '/playback/', { episode_id: Number(ep) }, origin() + '/drama/' + n + '/episode/' + ep + '/', ctx);
          url = d.url || '';
          if (d.episode && d.episode.duration) duration = d.episode.duration;
        } else if (kind === 'g') {
          const d = await postJson('/gossip/' + n + '/playback', {}, origin() + '/gossip/' + n + '/', ctx);
          const vids = Array.isArray(d.videos) ? d.videos : [];
          const i = Math.max(0, Math.min(vids.length - 1, parseInt(ep, 10) || 0));
          url = (vids[i] && vids[i].url) || '';
        } else fail('INVALID_ARGUMENT', '作品 ID 无效');
        if (!url) fail('CONTENT_LOCKED', '站点没有下发播放地址');
        // 地址带 auth_key 时效签名（约 2 小时），每次现取
        const res = { streams: [{ url, kind: 'media', format: 'hls', headers: { 'User-Agent': UA, Referer: origin() + '/' } }], expiresAt: Date.now() + 90 * 60 * 1000 };
        if (duration) res.durationSec = duration;
        return res;
      },

      matchUrl(params) {
        const m = String((params && params.url) || '').match(/pirvmpmir\.cc\/(video|drama|gossip)\/(\d+)\//);
        if (!m) return null;
        return { mediaId: (m[1] === 'video' ? 'v' : m[1] === 'drama' ? 'd' : 'g') + m[2] };
      },
    },
  };
}
