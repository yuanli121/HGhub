export const meta = {
  id: 'heiliao.source',
  name: '黑料网',
  version: '1.0.3',
  protocol: 1,
  kind: 'source',
  description: '黑料网（heiliao.com）：首页最新、三十余个吃瓜分区、关键词搜索、详情与多线路 HLS 短剧。视频地址由服务端渲染进详情页的播放器配置，带 auth_key 直连，key 也是绝对地址。',
  mature: true,
  linkDomains: ['heiliao.com', 'otdfytkw.cc', 'bspaawtn.cc', 'd1vpyad429lawp.cloudfront.net'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

// heiliao.com 走 Cloudflare，部分地区解析不出来；站方在 heiliao88.com 挂了三条
// CloudFront 备用线路，内容完全一致。按顺序探，谁通用谁。
const SITE_CANDIDATES = [
  'https://heiliao.com',
  'https://3jci2.otdfytkw.cc',
  'https://9zie6.bspaawtn.cc',
  'https://d1vpyad429lawp.cloudfront.net',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IMAGE_BASE = 'https://pic.biacea.cn';
// 站内图不是标准图片，是 AES-128-CBC 密文。密钥在 /static/v4/__base/js/image.js 里
// 用 cc("102_53_...") 这种十进制转字符的方式写死，解出来是下面这两串。
const IMG_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const IMG_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';
const BASE_KEY = 'heiliao.base.v1';

const DETAIL_RE = /^https?:\/\/(?:heiliao\.com|[a-z0-9]+\.[a-z0-9-]+\.cc|d1vpyad429lawp\.cloudfront\.net)\/archives\/(\d+)\/?/i;
const HREF_DETAIL_RE = /\/archives\/(\d+)\/?/;
// 分类页是 /{slug}/ 这种短横段，排除静态与功能路径。
const HREF_CAT_RE = /^\/([a-z]{2,12})\/$/;
const RESERVED_SLUGS = new Set([
  'index', 'static', 'html', 'archives', 'search', 'page', 'user', 'login', 'register',
  'about', 'contact', 'faq', 'app', 'download', 'tags', 'tag', 'api', 'av', 'memora',
]);

// 抽三条详情实测 m3u8 覆盖率，这几类全是图文或者没有点播源，列出来只会点进去空等：
//   youliao 有料局 0/3   mrrb 日榜黑料 0/3   zbjx 周榜精选 0/3   ybrg 月榜热瓜 0/3
//   jqxs 黑料小说 1/3    sjb 体育直播是流不是点播
const EXCLUDED_SLUGS = new Set(['youliao', 'jqxs', 'sjb', 'mrrb', 'zbjx', 'ybrg']);

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
  if (url.startsWith('/static/') || url.startsWith('/html/')) return '';
  if (url.startsWith('/')) return `${IMAGE_BASE}${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

// 封面必须带变换，直接给字符串地址宿主拿到的是一坨密文。
function coverRef(url) {
  if (!url) return null;
  return {
    url,
    transform: { type: 'aes-cbc', key: IMG_KEY_B64, iv: IMG_IV_B64, padding: 'pkcs7' },
  };
}

function shortBadge(text) {
  const t = trim(text);
  if (!t) return '';
  return t.length <= 8 ? t : t.slice(0, 8);
}

export default function (hg) {
  let catCache = null;
  let baseCache = null;

  // 先看缓存，再按候选顺序实测；DNS 挂掉的那条会抛 NETWORK，直接跳过。
  async function siteBase(ctx) {
    if (baseCache) return baseCache;
    try {
      const saved = await hg.storage.get(BASE_KEY);
      if (saved && typeof saved.url === 'string' && saved.url) {
        baseCache = saved.url;
        return baseCache;
      }
    } catch {
      // 缓存异常按无缓存处理
    }
    let lastError = null;
    for (const base of SITE_CANDIDATES) {
      try {
        const res = await hg.http.fetch({
          url: `${base}/`,
          headers: { 'User-Agent': UA, Accept: 'text/html' },
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
          retry: 0,
          signal: ctx.signal,
        });
        if (res.ok && norm(res.data).includes('video-item')) {
          baseCache = base;
          try {
            await hg.storage.set(BASE_KEY, { url: base, at: Date.now() });
          } catch {
            // 忽略缓存异常
          }
          return base;
        }
        lastError = new hg.PluginError('UPSTREAM_ERROR', `${base} 返回 ${res.status}`);
      } catch (error) {
        if (error && error.code === 'CANCELLED') throw error;
        lastError = error;
      }
    }
    throw lastError instanceof hg.PluginError
      ? lastError
      : new hg.PluginError('NETWORK', '主站和三条备用线路都连不上');
  }

  async function fetchText(path, ctx, ttl) {
    const base = await siteBase(ctx);
    const url = /^https?:\/\//i.test(path) ? path : `${base}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${base}/` },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function cardOf(anchor) {
    const href = norm(anchor.attr('href'));
    const m = href.match(HREF_DETAIL_RE);
    if (!m) return null;
    const title = trim(
      (anchor.first('.title') && anchor.first('.title').text()) ||
        (anchor.first('h3') && anchor.first('h3').text()) ||
        (anchor.first('img') && anchor.first('img').attr('alt')) ||
        anchor.text()
    );
    if (!title) return null;
    const item = { id: m[1], title: title.slice(0, 200), type: 'short' };
    const img = anchor.first('img');
    if (img) {
      const ref = coverRef(imageOf(img.attr('z-image-loader-url') || img.attr('data-src') || img.attr('src')));
      if (ref) item.cover = ref;
    }
    const hot = anchor.first('.ishot');
    if (hot) {
      const badge = shortBadge(hot.text());
      if (badge) item.badge = badge;
    }
    return item;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    const add = anchor => {
      const card = cardOf(anchor);
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      out.push(card);
    };
    // 正文卡片在 .video-item 里；抓不到才退回全量扫描。
    for (const node of root.select('.video-item')) {
      const anchors = node.select('a');
      if (anchors.length) add(anchors[0]);
    }
    if (out.length) return out;
    for (const anchor of root.select('a')) add(anchor);
    return out;
  }

  function cardsFromJson(list) {
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(list) ? list : []) {
      const id = trim(String(row && row.id));
      const title = trim(row && row.title);
      if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
      seen.add(id);
      const item = { id, title: title.slice(0, 200), type: 'short' };
      const ref = coverRef(imageOf(row.thumb || row.thumb_show));
      if (ref) item.cover = ref;
      if (row.is_hot) item.badge = '热';
      out.push(item);
    }
    return out;
  }

  // 播放器配置是详情页里的一段转义 JSON：video.url 和 video.urls[] 都是 m3u8。
  function streamsOf(html) {
    const text = norm(html);
    const found = [];
    const seen = new Set();
    const pushUrl = (raw, name) => {
      const url = trim(norm(raw).replace(/\\\//g, '/'));
      if (!/^https?:\/\//i.test(url)) return;
      if (!/\.m3u8(\?|$)/i.test(url.split('#')[0])) return;
      if (seen.has(url)) return;
      seen.add(url);
      const entry = { url, kind: 'media', format: 'hls' };
      const label = trim(name);
      if (label) entry.label = label.slice(0, 40);
      found.push(entry);
    };

    // urls:[{name,url},...] —— 线路名在这里
    const listMatch = text.match(/"urls"\s*:\s*\[([\s\S]{0,4000}?)\]/);
    if (listMatch) {
      for (const m of listMatch[1].matchAll(/\{[^{}]{0,400}?\}/g)) {
        const body = m[0];
        const u = body.match(/"url"\s*:\s*"([^"]+)"/);
        if (!u) continue;
        const n = body.match(/"name"\s*:\s*"([^"]{0,40})"/);
        pushUrl(u[1], n ? n[1] : '');
      }
    }
    // 主地址兜底（urls 缺失或解析失败时）
    const mainMatch = text.match(/"video"\s*:\s*\{[\s\S]{0,600}?"url"\s*:\s*"([^"]+)"/);
    if (mainMatch) pushUrl(mainMatch[1], '主线');
    return found;
  }

  async function categoriesOf(ctx) {
    if (catCache) return catCache;
    const doc = await fetchDoc('/', ctx, 1800);
    const seen = new Map();
    for (const anchor of doc.select('a')) {
      const href = norm(anchor.attr('href'));
      const m = href.match(HREF_CAT_RE);
      if (!m || RESERVED_SLUGS.has(m[1]) || EXCLUDED_SLUGS.has(m[1])) continue;
      const label = trim(anchor.text());
      if (!label || label.length > 12) continue;
      if (seen.has(m[1])) continue;
      seen.set(m[1], label);
    }
    const cats = Array.from(seen.entries()).map(([slug, label]) => ({ id: slug, label }));
    if (!cats.length) throw new hg.PluginError('UPSTREAM_CHANGED', '没解析到分类导航');
    catCache = cats;
    return cats;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const items = cardsOf(doc).slice(0, 30);
        if (!items.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return {
          items: [{ id: 'latest', title: '最新黑料', layout: 'grid', items }],
          next: null,
        };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return categoriesOf(ctx);
      },

      async list(params, ctx) {
        const slug = trim(params && params.categoryId);
        if (!/^[a-z]{2,12}$/.test(slug)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const path = page > 1 ? `/${slug}/page/${page}/` : `/${slug}/`;
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
        const body = `word=${encodeURIComponent(query)}&page=${page}`;
        const base = await siteBase(ctx);
        const res = await hg.http.fetch({
          url: `${base}/index/search_article`,
          method: 'POST',
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${base}/index/search?keyword=${encodeURIComponent(query)}`,
            Origin: base,
          },
          body,
          responseType: 'json',
          retry: 0,
          signal: ctx.signal,
        });
        if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `搜索返回 ${res.status}`);
        const payload = typeof res.data === 'string' ? safeJson(res.data) : res.data;
        const data = payload && payload.data;
        if (!data) return { items: [], next: null };
        const items = cardsFromJson(data.list);
        const out = { items };
        const totalPage = Number(data.total_page);
        if (Number.isInteger(totalPage) && page < totalPage) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/archives/${id}/`, ctx, 0);

        let title = '';
        const h1 = doc.first('h1');
        if (h1) title = trim(h1.text());
        if (!title) {
          const t = doc.first('title');
          title = trim(t && t.text()).split(/\s*[-_|]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title: title.slice(0, 200), type: 'movie', playlists: [] };

        const html = await fetchText(`/archives/${id}/`, ctx, 0);

        // og:image 是站点品牌图，真正的封面在播放器配置的 pic 或正文首图里。
        let cover = '';
        const picMatch = html.match(/"pic"\s*:\s*"([^"]+)"/);
        if (picMatch) cover = imageOf(picMatch[1].replace(/\\\//g, '/'));
        if (!cover) {
          for (const img of doc.select('img')) {
            const cand = imageOf(img.attr('z-image-loader-url') || img.attr('data-src') || img.attr('src'));
            if (cand && /pic\.biacea\.cn/i.test(cand)) { cover = cand; break; }
          }
        }
        const coverImg = coverRef(cover);
        if (coverImg) detail.cover = coverImg;

        const streams = streamsOf(html);
        if (!streams.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条是图文爆料，没有可播放的视频');
        }
        detail.playlists = [
          {
            id: 'main',
            label: '播放线路',
            kind: 'main',
            episodes: streams.map((s, i) => ({
              id: `s${i}`,
              index: i + 1,
              episodeNumber: i + 1,
              label: (s.label || `线路${i + 1}`).slice(0, 200),
            })),
          },
        ];
        detail.episodeCount = streams.length;
        detail.totalEpisodes = streams.length;
        detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const episodeId = trim(params && params.episodeId);
        const idx = Number(norm(episodeId).replace(/^s/, ''));
        const html = await fetchText(`/archives/${id}/`, ctx, 0);
        const streams = streamsOf(html);
        if (!streams.length) throw new hg.PluginError('CONTENT_LOCKED', '这条是图文爆料，没有可播放的视频');

        const ordered = [];
        const seen = new Set();
        const first = Number.isInteger(idx) ? streams[idx] : null;
        for (const s of [first, ...streams]) {
          if (!s || seen.has(s.url)) continue;
          seen.add(s.url);
          ordered.push(s);
        }

        // auth_key 有时效，取到就探一次，坏了换下一条线路。
        let lastError = null;
        for (const s of ordered) {
          try {
            const probe = await hg.http.fetch({
              url: s.url,
              responseType: 'text',
              headers: { 'User-Agent': UA, Referer: `${await siteBase(ctx)}/` },
              timeoutMs: 8000,
              maxBytes: 512 * 1024,
              retry: 0,
              signal: ctx.signal,
            });
            if (probe.ok && norm(probe.data).startsWith('#EXTM3U')) return { streams: [s] };
            lastError = new hg.PluginError('CONTENT_LOCKED', `这条线路取流失败（${probe.status}）`);
          } catch (error) {
            if (error && error.code === 'CANCELLED') throw error;
            lastError = error instanceof hg.PluginError ? error : new hg.PluginError('CONTENT_LOCKED', '这条线路连不上');
          }
        }
        throw lastError || new hg.PluginError('CONTENT_LOCKED', '取不到播放地址');
      },

      async matchUrl(params) {
        const m = norm(params && params.url).match(DETAIL_RE);
        return m ? { mediaId: m[1] } : null;
      },
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
