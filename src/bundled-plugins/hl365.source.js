export const meta = {
  id: 'hl365.source',
  name: '黑料不打烊',
  version: '1.1.0',
  protocol: 1,
  kind: 'source',
  description:
    '黑料不打烊（hl365.com）：Typecho + Mirages 主题，首页最新流、二十个吃瓜分区、关键词搜索、详情与分集 HLS。播放地址由服务端渲染进播放器 data-config，带 auth_key 直连，key 与切片都是绝对地址；auth_key 里的时间位只参与签名、不随时间失效，详情页按 90 秒复用。',
  mature: true,
  linkDomains: ['hl365.com', 'pic.biacea.cn', 'micgqv.cn', 'ucjosl.cn'],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 25 },
};

const BASE = 'https://hl365.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 抽十条详情实测播放器覆盖率，这两类基本是图文图集，列出来只会点进去空等：
//   whzj 网黄专辑 2/10（清一色「持续更新中」的图册帖）
//   mrrg 每日热瓜 4/10（大半是「合集」图文，视频散落在少数帖里）
// 优选投放有视频，但整版是世界杯、球星绯闻一类搬运稿，不跟站内主打同路，按需求不收录。
// 其余二十类都在 80% 以上，24hcg/hlda/rgtj 有零星图文帖，留在分类里由详情页挡掉。
const EXCLUDED_SLUGS = new Set(['whzj', 'mrrg', 'youxuan']);

const RESERVED_SLUGS = new Set([
  'index', 'static', 'archives', 'search', 'page', 'user', 'login', 'register',
  'about', 'contact', 'faq', 'app', 'download', 'tags', 'tag', 'api', 'feed',
  'category', 'author', 'back-home', 'weixin', 'join', 'dh', 'contribute',
]);

// 图床 pic.biacea.cn 上挂的不是图片本体，是 AES-128-CBC 密文，直接给地址宿主拿到一坨
// 二进制。密钥跟 heiliao 那条同源，解出来是 710×240 的 JPEG/PNG。
const IMG_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const IMG_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';

// 下架帖不给 404，而是 302 到导流页；命中就当内容不存在处理。
const FUNNEL_RE = /(back-home|app)\.html/i;
const DETAIL_RE = /^https?:\/\/hl365\.com\/archives\/(\d+)(?:\.html)?\/?/i;
const HREF_DETAIL_RE = /\/archives\/(\d+)(?:\.html)?\/?/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function imageOf(raw) {
  const url = trim(raw);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/usr/') || url.startsWith('/static/')) return '';
  if (url.startsWith('/')) return `${BASE}${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 播放器配置里的地址是 JSON 转义的斜杠，另外偶尔带 &amp;。
function unescapeUrl(raw) {
  return trim(norm(raw).replace(/\\\//g, '/').replace(/&amp;/g, '&'));
}

function shortBadge(text) {
  const t = trim(text).split(/[,，、]/)[0];
  if (!t) return '';
  return t.length <= 8 ? t : t.slice(0, 8);
}

// 图床地址一律走解密变换；站点自己的主题图（/usr/themes/）是明文，imageOf 已经滤掉。
function coverRef(url) {
  if (!url) return null;
  return {
    url,
    transform: { type: 'aes-cbc', key: IMG_KEY_B64, iv: IMG_IV_B64, padding: 'pkcs7' },
  };
}

export default function (hg) {
  let catCache = null;
  // 播放页下发的 auth_key 形如 `exp-rand-uid-md5`。那个 exp 只是签名材料，CDN 只校验
  // md5 对不对，不拿它跟当前时间比：同一地址超过 exp 八分钟仍 200，而删掉 auth_key、
  // 改一位 hash、把 exp 挪到过去，全都立刻 400。所以地址不会随时间失效，
  // 详情页可以短时间复用，不必每集都重抓一遍。
  // 宿主会先 getDetail 再 resolvePlayback，个别时候还会预加载下一集，
  // 留几条最近的小容量缓存就够，不必无限增长。
  const detailCache = new Map();
  const DETAIL_TTL = 90000;
  const DETAIL_KEEP = 4;

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${BASE}/` },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 900 } } : {}),
    });
    // 下架帖不给 404，改成 302 踢去 back-home.html / app.html；跟随后 URL 会变，
    // 没跟随时拿到裸 3xx，两种都按内容不存在处理。
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (res.status >= 300 && res.status < 400) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (res.ok && FUNNEL_RE.test(norm(res.url))) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function cardOf(node) {
    const anchor = node.select('a')[0] || node;
    const href = norm(anchor.attr('href'));
    const m = href.match(HREF_DETAIL_RE);
    if (!m) return null;
    const head = node.first('[itemprop="headline"]');
    let title = trim(
      (head && (head.first('p') || head).text()) ||
        (node.first('.post-card-bottom-text') && node.first('.post-card-bottom-text').text()) ||
        (node.first('img') && node.first('img').attr('alt')) ||
        anchor.text()
    );
    if (!title) return null;
    const item = { id: m[1], title: title.slice(0, 200), type: 'short' };

    const meta = node.first('meta[itemprop="image"]');
    const img = node.first('img');
    const cover = imageOf(
      (meta && meta.attr('content')) ||
        (img && (img.attr('z-image-loader-url') || img.attr('data-src') || img.attr('src'))) ||
        ''
    );
    // 只对图床地址加解密变换，主题自带的 png 是明文。
    if (cover && /pic\.biacea\.cn/i.test(cover)) {
      const ref = coverRef(cover);
      if (ref) item.cover = ref;
    } else if (cover) {
      item.cover = cover;
    }

    const info = node.first('.post-card-info');
    if (info) {
      const cats = info.select('span').map(s => trim(s.text())).filter(Boolean).join(',');
      const badge = shortBadge(cats);
      if (badge) item.badge = badge;
    }
    return item;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    const add = node => {
      const card = cardOf(node);
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      out.push(card);
    };
    for (const node of root.select('article')) add(node);
    if (out.length) return out;
    // 搜索页与个别模板不套 article，退回按链接兜底。
    for (const anchor of root.select('a')) add(anchor);
    return out;
  }

  // 一集一个 .dplayer，配置里 video.url 就是这条的 m3u8。
  function episodesOf(root) {
    const list = [];
    const seen = new Set();
    for (const node of root.select('.dplayer')) {
      const cfg = safeJson(norm(node.attr('data-config')).trim());
      const video = cfg && cfg.video;
      const url = unescapeUrl(video && video.url);
      if (!/^https?:\/\//i.test(url) || !/\.m3u8(\?|$)/i.test(url.split('#')[0])) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const index = Number(norm(node.attr('data-video_index')));
      list.push({
        index: Number.isInteger(index) && index >= 0 ? index : list.length,
        title: trim(node.attr('data-video_title')),
        pic: imageOf(unescapeUrl(video.pic)),
        kind: trim(video.type) || 'hls',
        url,
      });
    }
    list.sort((a, b) => a.index - b.index);
    return list;
  }

  async function categoriesOf(ctx) {
    if (catCache) return catCache;
    const doc = await fetchDoc('/', ctx, 1800);
    const seen = new Map();
    for (const anchor of doc.select('a')) {
      const href = norm(anchor.attr('href'));
      const m = href.match(/^\/category\/([a-z0-9]{2,12})\/$/i);
      if (!m) continue;
      const slug = m[1].toLowerCase();
      if (RESERVED_SLUGS.has(slug) || EXCLUDED_SLUGS.has(slug) || seen.has(slug)) continue;
      const label = trim(anchor.text());
      if (!label || label.length > 12) continue;
      seen.set(slug, label);
    }
    const cats = Array.from(seen.entries()).map(([slug, label]) => ({ id: slug, label }));
    if (!cats.length) throw new hg.PluginError('UPSTREAM_CHANGED', '没解析到分类导航');
    catCache = cats;
    return cats;
  }

  // doc 是宿主侧解析出的节点句柄，只在本次调用作用域内有效，不能跨调用缓存；
  // 只要选集时传 doc:false，命中缓存就不必重新解析 HTML。
  async function detailOf(id, ctx, options) {
    const force = !!(options && options.force);
    const needDoc = !(options && options.doc === false);
    const hit = detailCache.get(id);
    if (!force && !needDoc && hit && Date.now() - hit.at < DETAIL_TTL) {
      return { doc: null, episodes: hit.episodes, title: hit.title };
    }
    const html = await fetchText(`/archives/${id}.html`, ctx, 0);
    // 详情页侧栏会铺五十来条相关推荐；导流页只有两条置顶，落错地方就别当成图文帖。
    if ((html.match(/\/archives\/\d+\.html/g) || []).length < 8) {
      throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    }
    const doc = hg.html.parse(html);
    const episodes = episodesOf(doc);

    let title = '';
    const h1 = doc.first('h1');
    if (h1) title = trim(h1.text());
    if (!title) {
      const head = doc.first('[itemprop="headline"]');
      title = head ? trim((head.first('p') || head).text()) : '';
    }
    if (!title) {
      const t = doc.first('title');
      title = trim(t && t.text()).split(/\s*[-_|]\s*/)[0];
    }
    if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');
    detailCache.delete(id);
    detailCache.set(id, { at: Date.now(), episodes, title });
    while (detailCache.size > DETAIL_KEEP) detailCache.delete(detailCache.keys().next().value);
    return { doc, episodes, title };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 600);
        const items = cardsOf(doc).slice(0, 30);
        if (!items.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: [{ id: 'latest', title: '最新黑料', layout: 'grid', items }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return categoriesOf(ctx);
      },

      async list(params, ctx) {
        const slug = trim(params && params.categoryId).toLowerCase();
        if (!/^[a-z0-9]{2,12}$/.test(slug)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        if (EXCLUDED_SLUGS.has(slug)) throw new hg.PluginError('NOT_FOUND', '这个分区没有可播放的视频');
        const page = pageNo(params && params.cursor);
        const path = page > 1 ? `/category/${slug}/${page}/` : `/category/${slug}/`;
        const doc = await fetchDoc(path, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 15) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params && params.cursor);
        const path = page > 1
          ? `/search/${encodeURIComponent(query)}/${page}/`
          : `/search/${encodeURIComponent(query)}/`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 15) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const { doc, episodes, title } = await detailOf(id, ctx);

        const detail = { id, title: title.slice(0, 200), type: 'short', playlists: [] };

        const meta = doc.first('meta[itemprop="image"]');
        const img = doc.first('img[z-image-loader-url]');
        const cover = imageOf(
          (episodes[0] && episodes[0].pic) ||
            (meta && meta.attr('content')) ||
            (img && img.attr('z-image-loader-url')) ||
            ''
        );
        if (cover && /pic\.biacea\.cn/i.test(cover)) {
          const ref = coverRef(cover);
          if (ref) detail.cover = ref;
        } else if (cover) {
          detail.cover = cover;
        }

        const desc = doc.first('meta[name="description"]');
        if (desc) {
          const text = trim(desc.attr('content'));
          if (text) detail.overview = text.slice(0, 400);
        }

        if (!episodes.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条是图文爆料，没有可播放的视频');
        }

        const multi = episodes.length > 1;
        detail.playlists = [
          {
            id: 'main',
            label: multi ? '分集' : '播放线路',
            kind: 'main',
            episodes: episodes.map((ep, i) => ({
              id: `e${ep.index}`,
              index: i + 1,
              episodeNumber: i + 1,
              label: (multi ? `第${i + 1}集` : ep.title || title).slice(0, 200),
            })),
          },
        ];
        if (multi) {
          detail.episodeCount = episodes.length;
          detail.totalEpisodes = episodes.length;
        }
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const wanted = trim(params && params.episodeId).replace(/^e/, '');
        const idx = Number(wanted);

        let episodes = [];
        let picked = null;
        let probe = null;
        // 缓存里的地址实测不会随时间失效；万一探不通，丢掉缓存重抓一次再试，
        // 站点哪天真上了时间校验也能自愈。
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const detail = await detailOf(id, ctx, { doc: false, force: attempt > 0 });
          episodes = detail.episodes;
          if (!episodes.length) {
            throw new hg.PluginError('CONTENT_LOCKED', '这条是图文爆料，没有可播放的视频');
          }
          picked = episodes.find(ep => ep.index === idx) || episodes[0];
          probe = await hg.http.fetch({
            url: picked.url,
            responseType: 'text',
            headers: { 'User-Agent': UA, Referer: `${BASE}/` },
            timeoutMs: 8000,
            maxBytes: 512 * 1024,
            retry: 0,
            signal: ctx.signal,
          }).catch(error => {
            if (error && error.code === 'CANCELLED') throw error;
            return null;
          });
          if (probe && probe.ok && norm(probe.data).startsWith('#EXTM3U')) break;
        }

        if (probe && probe.ok && norm(probe.data).startsWith('#EXTM3U')) {
          const stream = {
            url: picked.url,
            kind: 'media',
            format: 'hls',
            headers: { 'User-Agent': UA, Referer: `${BASE}/` },
          };
          if (episodes.length > 1) stream.label = `第${picked.index + 1}集`;
          return { streams: [stream] };
        }
        throw new hg.PluginError(
          'CONTENT_LOCKED',
          probe && !probe.ok
            ? `片源返回 ${probe.status}，换一集或稍后再试`
            : '片源没有响应，稍后再试'
        );
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        const m = raw.match(DETAIL_RE);
        if (m) return { mediaId: m[1] };
        const c = raw.match(/^https?:\/\/hl365\.com\/category\/([a-z0-9]{2,12})\/?/i);
        if (c && !EXCLUDED_SLUGS.has(c[1].toLowerCase())) return { categoryId: c[1].toLowerCase() };
        return null;
      },
    },
  };
}
