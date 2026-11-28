export const meta = {
  id: 'avjb',
  name: 'AVJB',
  version: '1.0.1',
  protocol: 1,
  description: 'AVJB（avjb.com）：分类（运行时从站点分类页解析）、搜索、免费视频 HLS 播放。会员/金币/VIP 内容游客无法播放，已在列表中过滤。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['avjb.com'],
  defaultHeaders: {
    Referer: 'https://avjb.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://avjb.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 兜底分类（2026-11 实测 /categories/ 现存；运行时优先从站点解析）
const EMPTY_CATS = ['女主播', '主播福利', '传媒映画', '三级电影'];
const FALLBACK = [["剧情主题", [["3d4a6e58c1ecaa694e79df22ce6230a6", "校园剧情"], ["9da4ab1067c562949177a3c4ee51486a", "旅行剧情"], ["a3665c2f0a85fc128dcbb394a7a45bd3", "职场剧情"], ["69f0f187cf5451170be2d47792b0961a", "秘密禁忌与背叛剧情"], ["55a11df96ab7d807b6fd477df9a63ab3", "婚姻与家庭剧情"], ["3258931ccc53bcc937aaf9defeeb57ab", "喜剧轻松剧情"], ["8ccdda36342dda37f37b8207d6b08f27", "恋爱与约会剧情"], ["f55db4f8f6c775f4c50770902206594e", "邻里生活剧情"]]], ["玩法推荐", [["106d2424c60ca7d4cbe8f303ae25f753", "自慰与手部玩法"], ["c216c7f1783dca2b878bd00bd68acec1", "射精与高潮"], ["426d7277ef8a7a3941917b97a66dd5c5", "体位玩法"], ["35afc155d527d5a892c7656fac3c5843", "肛门玩法"], ["259237b594d4cec1672db89ce8ee45e0", "支配与束缚"], ["9d325d3d9ed2cc431143e6c42814ff9b", "常规性交"], ["7b43c401900fda19fd81d224ca4b50e2", "多人互动"], ["6d09eabb325066957e2012825de866ae", "玩具与辅助玩法"], ["34956d4102137d53d264404c4ab126fd", "口腔玩法"], ["cd7eb3fad5d61c25732b50e767182e31", "亲密与前戏"]]], ["身材分类", [["e4aa70f45594d062d8cf35da1f24bb69", "运动健美体型"], ["2e99251dcc9e1f5f72fc6abb07b075f1", "臀腰特征"], ["ca7b4f3765581a3f878fec96ea8b4e46", "丰满曲线体型"], ["249fed1b69ff6926239a4d04f0f405c3", "娇小纤细体型"], ["fd48c0b7690381b2febb475e8cef9a9b", "腿部特征"], ["dc0a5ffbefc1d795a4f7f0f1ca714b47", "胸部特征"], ["a32c7fc0e6e9352c0a8d6e1c59de8ed2", "高挑修长体型"], ["352f9552400d6c65b5cb4cee23f6a063", "肤色与外观特征"], ["de066999b25410c9d86b27115428c83e", "成熟体态"]]], ["场景环境", [["0ec0f1389f16fe8905d3a5136871db93", "专业摄影棚场景"], ["49c045255a6dec7c0487aee43b68a514", "职场办公场景"], ["25a5caeaba2f6d8db74b4c57933a0cee", "户外自然场景"], ["633a4b6b7396b6f17f6bce784f2f98b4", "酒店与旅行住宿场景"], ["791b7b749782acedd5941e58be8504c2", "交通工具场景"], ["f3011cfafaeea989da0b675d243860d3", "家庭室内场景"], ["07631e343f8ccb5db01d3cbf9190979c", "医疗护理场景"], ["bab6e3a7439500fbf74b120f274734aa", "公共空间场景"], ["6c9e1c2ea70f32db5be0f615889ccb59", "娱乐社交场景"], ["2bca2cce8c3253e95af334ea840a1720", "校园教育场景"]]], ["角色扮演", [["54965eff48082b405d331e2c591e9ab7", "Cosplay与幻想角色"], ["18cc04036a8c240171e5c0b774d615d8", "服务业与制服角色"], ["d2cce57bdd9985032737271520039454", "医疗与护理角色"], ["ed14de6fbeb12755bbe4d300987bccca", "职场与商务角色"], ["6f0edd0cc332f3f61206b8461f249c16", "偶像与演艺角色"], ["fdc7ab2075e9f0e86d6f75525b707336", "邻里与生活关系"], ["a274e16e05e31abe2f5f774496f8b866", "校园与教育角色"], ["d2d17b3e7f2a262554384e78439f4bae", "家庭与伴侣角色"], ["83277573d59f680b24b48eabbb9f6478", "执法与权力角色"]]], ["情侣与关系", [["d0ce21aeed987ea1c8774689da6fd5d0", "单人表演"], ["4537a0086735dc1f14523f171b2900ba", "朋友与熟人关系"], ["e6b5a0f44f82b3cffffbb25db285c912", "职场上下级关系"], ["a871da909755e69f0663fe2aa4e973c0", "家庭亲属关系"], ["192acf3c119033c5bd9c4c387228bd28", "情侣与婚姻关系"], ["1f2dd6d428fbb567b6330c5510e4a1ac", "邻里与租住关系"], ["ddda8f1092e0d92bd20053aea26da507", "师生与指导关系"], ["09e2df807de96d1658ab404752a61f84", "陌生邂逅关系"], ["672765d9e4ff08a0d1096ba97e091cb1", "多人组合关系"]]], ["其他分类", [["school-girls", "School Girls"], ["amateur", "Amateur"], ["solowork", "Solowork"], ["90884db3ccf63485ae6bd49c0110269f", "主播福利"], ["a0b14da040498ca8c3882059087b722c", "欧美风情"], ["cba2b3bf1b2d7959c9defe5bf2ebd542", "东南亚"], ["5c977f3f8c18750a85d37f8d301f4f51", "网红黑料"], ["mgs", "MGS動画"], ["e93b363376180bd0b49b90d343aa5cbc", "無修正動画"], ["b83d6021cfa5cc3a3feff746a6f72b12", "卡通动漫"], ["cef1b78f39437e59468b08a2f76b5c9f", "モザイク破壊"], ["21c031e02ee6ad29acda82b9625b28ef", "国产自拍"], ["cd80c93db2d41150d80f5668f6e20b7f", "高清无码"], ["fc2", "FC2"], ["63cbb0b26b6f7ca4bd17265169418bea", "エロ動画"], ["ddc1aab6fe0d5609e60d6941280b7660", "高清有码"], ["9e1f70dc69906a3341c6c8c18648d864", "素人投稿"], ["6eec9fd0dad785e04651354b8ddab749", "中文字幕"], ["humiliation", "Humiliation"], ["sailor-suit", "Sailor Suit"], ["restraints", "Restraints"], ]]];

// 固定栏目：path 为列表路径（第 N 页 = path + N + '/'）
const FIXED = [
  { id: 'free', label: '免费专区', path: '/free/' },
  { id: 'new', label: '最新更新', path: '/new/' },
  { id: 'most-popular', label: '最多观看', path: '/most-popular/' },
  { id: 'top-rated', label: '最高评分', path: '/top-rated/' },
];

export default function (hg) {
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers(ref) { return { 'User-Agent': UA, Referer: ref || SITE + '/' }; }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  async function fetchHtml(url, ctx, ref) {
    const res = await hg.http.fetch({ url, headers: headers(ref), responseType: 'text', timeoutMs: 15000, retry: 1, maxBytes: 8 * 1024 * 1024, signal: ctx && ctx.signal });
    if (res.status === 404) return null;
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  // 视频页需要 slug（/video/<数字>/<slug>/），所以条目 id = "<数字>/<slug>"
  function videoIdOf(s) { const m = String(s || '').match(/\/video\/(\d+\/[^/?#]+)\//); return m ? decodeURIComponent(m[1]) : ''; }
  function pageUrlOf(id) {
    const m = String(id || '').match(/^(\d+)\/([^/?#]+)/);
    if (!m) fail('INVALID_ARGUMENT', '作品 ID 无效');
    return { num: m[1], url: SITE + '/video/' + m[1] + '/' + encodeURIComponent(m[2]) + '/' };
  }

  // 只保留游客可播的免费卡片（class 无 private / premium）
  function parseCards(html) {
    const doc = hg.html.parse(html);
    const nodes = doc.select('div.item');
    const items = [];
    const seen = {};
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const cls = String(n.attr('class') || '');
      if (/\b(private|premium)\b/.test(cls)) continue;
      const a = n.first('a[href*="/video/"]');
      if (!a) continue;
      const id = videoIdOf(a.attr('href'));
      if (!id || seen[id]) continue;
      const strong = n.first('strong.title');
      const title = clean(a.attr('title') || (strong ? strong.text() : ''));
      if (!title) continue;
      seen[id] = 1;
      const item = { id, title, type: 'movie' };
      const img = n.first('img.thumb') || n.first('img');
      const cover = img && (img.attr('data-original') || img.attr('data-webp'));
      if (cover && /^https?:/.test(cover)) item.cover = cover;
      const d = n.first('.duration');
      if (d) { const t = clean(d.text()); if (t) item.badge = t.slice(0, 8); }
      items.push(item);
    }
    return items;
  }

  function hasNext(html) { return /<li class="next">/.test(html); }
  function currentPage(html) { const m = html.match(/page-current"><span>(\d+)/); return m ? parseInt(m[1], 10) : 1; }

  // 抓列表页：游客可播的免费卡片占比不高，且站点翻页会有少量重叠。
  // 一次最多取 3 个站点页凑够 8 条；cursor = "站点页码~上一批已出现的作品编号(逗号分隔)"，用于跨页去重。
  function parseCursor(c) {
    const m = String(c || '').match(/^(\d+)(?:~(.*))?$/);
    return { page: m ? Math.max(1, parseInt(m[1], 10)) : 1, seen: m && m[2] ? m[2].split(',') : [] };
  }
  async function listPath(path, cursor, ctx) {
    const cur = parseCursor(cursor);
    let p = cur.page;
    const seen = {};
    cur.seen.forEach(function (x) { seen[x] = 1; });
    const out = [];
    let more = false, fetched = 0, first = true;
    for (let k = 0; k < 10; k++) {
      const html = await fetchHtml(SITE + path + (p > 1 ? p + '/' : ''), ctx);
      if (html === null) { if (first && p === 1) fail('NOT_FOUND', '分类不存在'); more = false; break; }
      first = false;
      if (p > 1 && currentPage(html) !== p) { more = false; break; }   // 越界页回落
      fetched++;
      const items = parseCards(html);
      for (let i = 0; i < items.length; i++) {
        const num = items[i].id.split('/')[0];
        if (seen[num]) continue;
        seen[num] = 1;
        out.push(items[i]);
      }
      more = hasNext(html);
      if (!more || out.length >= 8) break;   // 免费条目稀疏时继续往后翻，最多 10 页
      p++;
    }
    // 只有「已凑够一页且后面还有」才声明下一页；再预取一页确认其中确实有新的免费条目，避免下一页为空
    let next = null;
    if (more && out.length >= 8) {
      try {
        const peekHtml = await fetchHtml(SITE + path + (p + 1) + '/', ctx);
        if (peekHtml !== null && currentPage(peekHtml) === p + 1) {
          const peek = parseCards(peekHtml).filter(function (x) { return !seen[x.id.split('/')[0]]; });
          if (peek.length) next = (p + 1) + '~' + Object.keys(seen).slice(-40).join(',');
        }
      } catch (_) {}
    }
    return { items: out, next: next };
  }

  let catCache = null;
  async function loadCategories(ctx) {
    if (catCache) return catCache;
    const groups = [];
    try {
      const html = await fetchHtml(SITE + '/categories/', ctx);
      if (html) {
        const doc = hg.html.parse(html);
        const secs = doc.select('section.group');
        for (let i = 0; i < secs.length; i++) {
          const h = secs[i].first('h2');
          const label = h ? clean(h.text()) : '';
          const cards = secs[i].select('a.cat-card');
          const children = [];
          for (let j = 0; j < cards.length; j++) {
            const m = String(cards[j].attr('href') || '').match(/\/categories\/([^/]+)\//);
            const t = cards[j].first('.t');
            const name = clean(t ? t.text() : cards[j].attr('title'));
            // 这些分类下游客可看的免费内容为 0（2026-11 实测），直接不显示
            if (name && EMPTY_CATS.some(function (k) { return name.indexOf(k) === 0; })) continue;
            if (m && name) children.push({ id: 'c:' + m[1], label: name });
          }
          if (label && children.length) groups.push({ id: 'g:' + i, label, children });
        }
      }
    } catch (e) { /* 回落到内置 */ }
    if (!groups.length) {
      FALLBACK.forEach(function (g, i) {
        groups.push({ id: 'g:' + i, label: g[0], children: g[1].map(function (c) { return { id: 'c:' + c[0], label: c[1] }; }) });
      });
    }
    catCache = groups;
    return groups;
  }

  function pathOfCategory(id) {
    for (let i = 0; i < FIXED.length; i++) if (FIXED[i].id === id) return FIXED[i].path;
    if (id.indexOf('c:') === 0) return '/categories/' + encodeURIComponent(id.slice(2)) + '/';
    return '';
  }

  function guessFormat(u) { return /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'progressive'; }

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
        const defs = [['new', '最新更新', '/new/'], ['most-popular', '最多观看', '/most-popular/'], ['top-rated', '最高评分', '/top-rated/']];
        const out = [];
        for (let i = 0; i < defs.length; i++) {
          try {
            const html = await fetchHtml(SITE + defs[i][2], ctx);
            const items = html ? parseCards(html) : [];
            if (items.length) out.push({ id: defs[i][0], title: defs[i][1], layout: 'grid', imageAspect: 'landscape', items });
          } catch (e) { if (!out.length && i === defs.length - 1) throw e; }
        }
        return { items: out, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const tree = [{ id: 'fixed', label: '精选', children: FIXED.map(function (f) { return { id: f.id, label: f.label }; }) }];
        const groups = await loadCategories(ctx);
        return tree.concat(groups);
      },
      async list(params, ctx) {
        const id = (params && params.categoryId) || 'free';
        const path = pathOfCategory(id);
        if (!path) fail('INVALID_ARGUMENT', '未知分类');
        return listPath(path, params && params.cursor, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        return listPath('/search/' + encodeURIComponent(q) + '/', params && params.cursor, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const pu = pageUrlOf(params && params.id);
        const page = await fetchHtml(pu.url, ctx);
        if (page === null) fail('NOT_FOUND', '视频不存在或已删除');
        const doc = hg.html.parse(page);
        const og = function (p) { const e = doc.first('meta[property="' + p + '"]'); return e ? e.attr('content') : ''; };
        const h1 = doc.first('h1#videoTitle') || doc.first('h1');
        const title = clean(h1 ? h1.text() : og('og:title'));
        const detail = {
          id: params.id,
          title: title || ('AVJB ' + pu.num),
          type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id: params.id, index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        const cover = og('og:image'); if (cover) detail.cover = cover;
        const desc = clean(og('og:description')); if (desc) detail.description = desc;
        const tags = doc.select('a[href*="/tags/"]').map(function (a) { return clean(a.text()); }).filter(function (t) { return t && t.length < 20; });
        if (tags.length) detail.tags = tags.slice(0, 12);
        const ld = page.match(/"duration":\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
        if (ld) detail.durationSec = (+ld[1] || 0) * 3600 + (+ld[2] || 0) * 60 + (+ld[3] || 0);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const pu = pageUrlOf(params && (params.episodeId || params.mediaId));
        const pageUrl = pu.url;
        const html = await fetchHtml(pageUrl, ctx);
        if (html === null) fail('NOT_FOUND', '视频不存在或已删除');
        const csrf = (html.match(/PLAYER_CSRF\s*=\s*"([^"]+)"/) || [])[1];
        if (!csrf) {
          if (/no-player|paywall/.test(html)) fail('CONTENT_LOCKED', '该视频为会员/金币/VIP 专享，游客无法播放');
          fail('UPSTREAM_CHANGED', '未找到播放参数');
        }
        const res = await hg.http.fetch({
          url: SITE + '/player/spped.php?csrf=' + encodeURIComponent(csrf),
          headers: headers(pageUrl), responseType: 'json', timeoutMs: 15000, retry: 1, signal: ctx && ctx.signal,
        });
        if (!res.ok || !res.data) fail('UPSTREAM_ERROR', '线路接口暂时不可用（HTTP ' + res.status + '）');
        const sources = Array.isArray(res.data.sources) ? res.data.sources.filter(function (s) { return s && /^https:\/\//.test(s.url || ''); }) : [];
        if (!sources.length) fail('UPSTREAM_CHANGED', '未返回播放线路');
        const def = res.data.defaultKey;
        sources.sort(function (a, b) { return (b.key === def ? 1 : 0) - (a.key === def ? 1 : 0); });
        const h = headers(SITE + '/');
        const streams = sources.map(function (s) {
          return { url: s.url, kind: 'media', format: guessFormat(s.url), headers: h, label: s.name || s.key };
        });
        // MP4 不冒充已验证的 HLS 备用；只对接口实际下发的多条 HLS 做切换。
        const hlsStreams = streams.filter(function (st) { return st.format === 'hls'; });
        return { streams: streams[0].format === 'hls' && hlsStreams.length > 1 ? (await verifiedHls(hlsStreams, ctx)).concat(streams.filter(function (st) { return st.format !== 'hls'; })) : streams };
      },
    },
  };
}
