export const meta = {
  id: 'hhkan.source',
  name: '好好看',
  version: '1.0.3',
  protocol: 1,
  kind: 'source',
  description: '好好看（hhkan1.com）：首页分区、五个频道、关键词搜索、详情与多线路 HLS。站点用 cdndefend 的 JS 挑战挡爬虫，插件里把那道 SHA1 工作量证明直接算出来拿 cookie，全程不需要浏览器。',
  mature: false,
  linkDomains: ['hhkan1.com', 'www.hhkan1.com'],
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://www.hhkan1.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 封面在页面里是 /vod1/... 的相对路径。主站那条路径要过 cdndefend 且直接回 403，
// 真正的图片域名是 vres.*；实测该域名不需要 cookie，是最省事的取法。
const IMAGE_BASE = 'https://vres.jzxjlj.com';
const IMAGE_PREFIX = '/vod1/';
const COOKIE_KEY = 'cdndefend.cookie.v1';
// 挑战种子里第几位是校验偏移：n1 = parseInt(c[0], 16)，目标字节是 0xb0 0x0b。
const TARGET = [0xb0, 0x0b];

const CHALLENGE_RE = /const a0_0x2a54=\['([0-9A-Fa-f]+)'/;
const DETAIL_RE = /^https?:\/\/(?:www\.)?hhkan1\.com\/detail\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?hhkan1\.com\/play\/(\d+)-(\d+)-(\d+)\.html/i;
const HREF_DETAIL_RE = /\/detail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/play\/(\d+)-(\d+)-(\d+)\.html/;

const CATS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视剧', type: 'series' },
  { id: '3', label: '动漫', type: 'anime' },
  { id: '4', label: '综艺', type: 'variety' },
  { id: '6', label: '短剧', type: 'short' },
];
const CAT_TYPE = new Map(CATS.map(c => [c.id, c.type]));

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

// 标题里塞了 𝕜𝕜𝕪𝕤𝟘𝟙.𝕔𝕠𝕞 这种数学字母做的水印，属于 U+1D400 段，直接抹掉。
function cleanTitle(text) {
  return trim(
    norm(text)
      .replace(/[\u{1D400}-\u{1D7FF}]/gu, '')
      .replace(/\s*\.\s*(?=[\s]|$)/g, ' ')
  );
}

export default function (hg) {
  let cookieCache = null;

  function sha1Bytes(text) {
    return hg.crypto.digest('sha1', text);
  }

  // 单块 SHA1：种子是 ASCII(40 字节)，拼上十进制 i（最多 6 位）再加 0x80 和 8 字节长度，
  // 正好 55 字节，仍然塞得进一个 64 字节块。整块一次压缩就够，不必走多块循环。
  // 这么写是因为 hg.crypto.digest 每次都要跨 JS↔原生边界、序列化参数和结果，
  // 挑战平均要试几万次，那个开销才是超时的根源；纯 JS 单块每次是微秒级。
  function solveSeedBlock(seed, n1) {
    const N = seed.length;
    const sb = new Uint8Array(64);
    for (let k = 0; k < N; k += 1) sb[k] = seed.charCodeAt(k) & 0xff;
    const W = new Int32Array(80);
    const digits = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 400000; i += 1) {
      let d = 0;
      let n = i;
      if (n === 0) {
        digits[0] = 0;
        d = 1;
      } else {
        while (n > 0) {
          digits[d] = n % 10;
          n = (n / 10) | 0;
          d += 1;
        }
      }
      for (let k = 0; k < d; k += 1) sb[N + k] = digits[d - 1 - k] + 48;
      const len = N + d;
      sb[len] = 0x80;
      for (let k = len + 1; k < 56; k += 1) sb[k] = 0;
      const bl = len * 8;
      sb[56] = 0; sb[57] = 0; sb[58] = 0; sb[59] = 0;
      sb[60] = (bl >>> 24) & 0xff;
      sb[61] = (bl >>> 16) & 0xff;
      sb[62] = (bl >>> 8) & 0xff;
      sb[63] = bl & 0xff;

      let a = 0x67452301;
      let b = 0xefcdab89;
      let c = 0x98badcfe;
      let dd = 0x10325476;
      let e = 0xc3d2e1f0;
      for (let t = 0; t < 80; t += 1) {
        if (t < 16) {
          W[t] = (sb[t * 4] << 24) | (sb[t * 4 + 1] << 16) | (sb[t * 4 + 2] << 8) | sb[t * 4 + 3];
        } else {
          const x = W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16];
          W[t] = (x << 1) | (x >>> 31);
        }
        let f;
        let k2;
        if (t < 20) { f = (b & c) | (~b & dd); k2 = 0x5a827999; }
        else if (t < 40) { f = b ^ c ^ dd; k2 = 0x6ed9eba1; }
        else if (t < 60) { f = (b & c) | (b & dd) | (c & dd); k2 = 0x8f1bbcdc; }
        else { f = b ^ c ^ dd; k2 = 0xca62c1d6; }
        const t2 = ((((a << 5) | (a >>> 27)) + f + e + k2 + W[t]) | 0);
        e = dd;
        dd = c;
        c = (b << 30) | (b >>> 2);
        b = a;
        a = t2;
      }
      const h0 = (0x67452301 + a) | 0;
      const h1 = (0xefcdab89 + b) | 0;
      const h2 = (0x98badcfe + c) | 0;
      const h3 = (0x10325476 + dd) | 0;
      const h4 = (0xc3d2e1f0 + e) | 0;
      // 字节 p 落在第 p>>2 个 h 字上，再按大端取该字里的第 p&3 字节。
      const at = p => {
        const word = p < 4 ? h0 : p < 8 ? h1 : p < 12 ? h2 : p < 16 ? h3 : h4;
        return (word >>> (24 - (p & 3) * 8)) & 0xff;
      };
      if (at(n1) === TARGET[0] && at(n1 + 1) === TARGET[1]) return `${seed}${i}`;
    }
    return '';
  }

  // cdndefend 的挑战：找最小 i 让 sha1(c + i) 在偏移 n1 处等于 0xb0 0x0b，
  // 然后 cookie 就是 cdndefend_js_cookie=<c><i>。
  function solveSeed(seed) {
    const n1 = parseInt(seed[0], 16);
    if (!Number.isFinite(n1) || n1 < 0 || n1 > 18) return '';
    // 种子长度 + 6 位 + 0x80 + 长度字段还在一个块内才走快路径。
    if (seed.length + 15 > 64) {
      for (let i = 0; i < 400000; i += 1) {
        const sum = sha1Bytes(seed + i);
        if (sum[n1] === TARGET[0] && sum[n1 + 1] === TARGET[1]) return `${seed}${i}`;
      }
      return '';
    }
    return solveSeedBlock(seed, n1);
  }

  async function loadCookie(ctx) {
    if (cookieCache) return cookieCache;
    try {
      const saved = await hg.storage.get(COOKIE_KEY);
      if (saved && typeof saved.value === 'string' && saved.value) {
        cookieCache = saved.value;
        return cookieCache;
      }
    } catch {
      // 缓存异常按无缓存处理
    }
    const res = await hg.http.fetch({
      url: `${SITE}/`,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      retry: 0,
      signal: ctx.signal,
    });
    const body = norm(res.data);
    const m = body.match(CHALLENGE_RE);
    if (!m) {
      if (res.ok) return '';
      throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    }
    const solved = solveSeed(m[1]);
    if (!solved) throw new hg.PluginError('UPSTREAM_CHANGED', '防护挑战解不出来');
    cookieCache = `cdndefend_js_cookie=${solved}`;
    try {
      await hg.storage.set(COOKIE_KEY, { value: cookieCache, at: Date.now() });
    } catch {
      // 忽略缓存异常
    }
    return cookieCache;
  }

  async function rawFetch(url, ctx, cookie, ttl) {
    return hg.http.fetch({
      url,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${SITE}/`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
  }

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${SITE}${path}`;
    let cookie = await loadCookie(ctx);
    let res = await rawFetch(url, ctx, cookie, ttl);

    // cookie 过期或被清掉时会重新回到 850，解一次再试。
    if (res.status === 850) {
      cookieCache = null;
      try {
        await hg.storage.delete(COOKIE_KEY);
      } catch {
        // 忽略
      }
      cookie = await loadCookie(ctx);
      res = await rawFetch(url, ctx, cookie, ttl);
    }

    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function imageOf(raw) {
    const url = trim(raw);
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith(IMAGE_PREFIX)) return `${IMAGE_BASE}${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url : '';
  }

  // 卡片里有两张 img：第一张是 id=noneCoverImg 的占位图，真封面在第二张。
  const PLACEHOLDER_RE = /(?:logo_placeholder|noneCoverImg|\/images\/p\/logo|empty-box|avatar|placeholder)/i;

  function coverOfCard(anchor) {
    for (const img of anchor.select('img')) {
      for (const cand of [img.attr('data-original'), img.attr('data-src'), img.attr('src')]) {
        const url = imageOf(cand);
        if (url && !PLACEHOLDER_RE.test(url)) return url;
      }
    }
    for (const cand of [anchor.attr('data-original'), anchor.attr('data-src')]) {
      const url = imageOf(cand);
      if (url && !PLACEHOLDER_RE.test(url)) return url;
    }
    return '';
  }

  function shortBadge(text) {
    const t = trim(text);
    if (!t) return '';
    if (t.length <= 8) return t;
    const ep = t.match(/(\d+)\s*[集话話期]/);
    if (ep) return `更至${ep[1]}`.slice(0, 8);
    return '';
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const img = anchor.first('img');
      const holder = anchor.parent();
      const title =
        cleanTitle(anchor.attr('title')) ||
        cleanTitle(img && img.attr('alt')) ||
        cleanTitle(anchor.text()) ||
        cleanTitle(holder && holder.first('.detail-title') && holder.first('.detail-title').text());
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title: title.slice(0, 200), type: fallbackType || 'other' };
      const cover = coverOfCard(anchor);
      if (cover) item.cover = cover;
      const badge = shortBadge(holder && holder.first('.detail-note') && holder.first('.detail-note').text());
      if (badge) item.badge = badge;
      out.push(item);
    }
    return out;
  }

  function playlistsOf(doc) {
    const labels = doc.select('.source-item-label').map(e => trim(e.text()));
    const groups = new Map();
    for (const anchor of doc.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
      if (!m) continue;
      const sid = m[2];
      const nid = Number(m[3]);
      if (!Number.isInteger(nid) || nid < 1) continue;
      const list = groups.get(sid) || [];
      if (list.some(e => e.nid === nid)) continue;
      list.push({ nid, label: trim(anchor.text()) });
      groups.set(sid, list);
    }
    // 线路顺序必须跟页面上 .source-item 的先后一致，按 sid 数字排会错位。
    const ordered = Array.from(groups.entries());
    const out = [];
    ordered.forEach(([sid, list], index) => {
      list.sort((a, b) => a.nid - b.nid);
      const label = labels[index] || `线路 ${index + 1}`;
      out.push({
        id: sid,
        label: label.slice(0, 40),
        kind: 'main',
        episodes: list.map((e, i) => ({
          id: `${sid}-${e.nid}`,
          index: i + 1,
          // 同一集在不同线路上的 nid 完全不同，所以集号只能取序号。
          episodeNumber: i + 1,
          label: (e.label || `第${i + 1}集`).slice(0, 200),
        })),
      });
    });
    return out;
  }

  // 播放页把地址写在 gogogo() 里的 playSource.src；APP 独占线路这里是空串。
  function streamOf(html) {
    const m = norm(html).match(/playSource\s*=\s*\{\s*src\s*:\s*"([^"]*)"/);
    const url = m ? trim(m[1]) : '';
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) return null;
    const isHls = /\.m3u8(\?|$)/i.test(url.split('#')[0]);
    return { url, kind: 'media', format: isHls ? 'hls' : 'progressive' };
  }

  async function resolveOne(id, sid, nid, ctx) {
    const html = await fetchText(`/play/${id}-${sid}-${nid}.html`, ctx, 0);
    const stream = streamOf(html);
    if (!stream) {
      if (/仅供\s*APP|APP端观看/i.test(html)) {
        throw new hg.PluginError('CONTENT_LOCKED', '这条线路只给 App 看');
      }
      throw new hg.PluginError('CONTENT_LOCKED', '这条线路没给出播放地址');
    }
    // 提取到地址不代表 CDN 认它，先探一次再交付；探不到就让上层换线路。
    try {
      const probe = await hg.http.fetch({
        url: stream.url,
        responseType: 'text',
        headers: { 'User-Agent': UA, Range: 'bytes=0-2047' },
        timeoutMs: 6000,
        maxBytes: 256 * 1024,
        retry: 0,
        signal: ctx.signal,
      });
      const body = norm(probe.data);
      const okBody = stream.format === 'hls' ? body.startsWith('#EXTM3U') : body.length > 0;
      if (!probe.ok || !okBody) throw new hg.PluginError('CONTENT_LOCKED', `这条线路取流失败（${probe.status}）`);
    } catch (error) {
      if (error && error.code === 'CANCELLED') throw error;
      if (error instanceof hg.PluginError) throw error;
      throw new hg.PluginError('CONTENT_LOCKED', '这条线路连不上');
    }
    return stream;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seen = new Set();

        const push = (title, root, layout) => {
          const name = trim(title);
          if (!name || seen.has(name)) return;
          const items = cardsOf(root, 'other');
          if (!items.length) return;
          seen.add(name);
          sections.push({ id: `s${sections.length}`, title: name.slice(0, 200), layout, items: items.slice(0, 24) });
        };

        // 首页由若干「标题 + 卡片区」组成，按顺序切片即可。
        for (const block of doc.select('.fs-margin-section')) {
          const head =
            block.first('.section-header') ||
            block.first('.header') ||
            block.first('.title') ||
            block.first('h2') ||
            block.first('h3');
          const title = trim(head && head.text()).replace(/\s*查看更多\s*$/, '');
          if (!title || title.length > 24) continue;
          push(title, block, sections.length === 0 ? 'row' : 'grid');
          if (sections.length >= 6) break;
        }

        if (!sections.length) {
          push('精选推荐', doc, 'grid');
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const tid = trim(params && params.categoryId);
        if (!/^\d+$/.test(tid)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const path = page > 1 ? `/channel/${tid}-${page}.html` : `/channel/${tid}.html`;
        const doc = await fetchDoc(path, ctx, 120);
        const items = cardsOf(doc, CAT_TYPE.get(tid) || 'other');
        const out = { items };
        if (items.length >= 24) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        // 搜索要带页面下发的 t 令牌，否则一律 0 结果。
        const doc = await fetchDoc('/', ctx, 0);
        const tokenNode = doc.first('input[name="t"]');
        const token = trim(tokenNode && tokenNode.attr('value'));
        if (!token) throw new hg.PluginError('UPSTREAM_CHANGED', '搜索令牌没找到');
        const page = pageNo(params && params.cursor);
        const kw = encodeURIComponent(query);
        const path = `/search?k=${kw}&t=${encodeURIComponent(token)}${page > 1 ? `&page=${page}` : ''}`;
        const result = await fetchDoc(path, ctx, 60);
        const items = cardsOf(result, 'other');
        const out = { items };
        if (items.length >= 20) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/detail/${id}.html`, ctx, 300);

        let title = '';
        const tag = doc.first('title');
        const tagText = trim(tag && tag.text());
        if (tagText) title = cleanTitle(tagText.split(/\s*[-_]\s*/)[0]);
        if (!title) title = cleanTitle(doc.first('.detail-title') && doc.first('.detail-title').text());
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title: title.slice(0, 200), type: 'movie', playlists: [] };

        let cover = '';
        for (const img of doc.select('img')) {
          for (const cand of [img.attr('data-original'), img.attr('data-src'), img.attr('src')]) {
            const url = imageOf(cand);
            if (url && !PLACEHOLDER_RE.test(url)) { cover = url; break; }
          }
          if (cover) break;
        }
        if (cover) detail.cover = cover;

        const descNode = doc.first('.detail-desc');
        const description = cleanTitle(descNode && descNode.text());
        if (description) detail.description = description.slice(0, 5000);

        detail.playlists = playlistsOf(doc);
        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        detail.type = count > 1 ? 'series' : 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params && params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
        const sid = m[1];
        const nid = m[2];

        let firstError = null;
        try {
          return { streams: [await resolveOne(id, sid, nid, ctx)] };
        } catch (error) {
          if (error && error.code === 'CANCELLED') throw error;
          firstError = error;
        }

        // 首条线路常常是 App 独占，按集号平移到其它线路。
        let playlists = [];
        try {
          const doc = await fetchDoc(`/detail/${id}.html`, ctx, 300);
          playlists = playlistsOf(doc);
        } catch (error) {
          if (error && error.code === 'CANCELLED') throw error;
        }
        const current = playlists.find(p => p.id === sid);
        const seq = current ? current.episodes.findIndex(e => e.id === `${sid}-${nid}`) : -1;
        for (const pl of playlists) {
          if (pl.id === sid) continue;
          const cand = seq >= 0 ? pl.episodes[seq] : pl.episodes.length === 1 ? pl.episodes[0] : null;
          if (!cand) continue;
          const parts = cand.id.split('-');
          if (parts.length !== 2) continue;
          try {
            return { streams: [await resolveOne(id, parts[0], parts[1], ctx)] };
          } catch (error) {
            if (error && error.code === 'CANCELLED') throw error;
          }
        }
        throw firstError || new hg.PluginError('CONTENT_LOCKED', '所有线路都取不到地址，稍后再试');
      },

      async matchUrl(params) {
        const url = norm(params && params.url);
        const play = url.match(PLAY_RE);
        if (play) return { mediaId: play[1], episodeId: `${play[2]}-${play[3]}` };
        const detail = url.match(DETAIL_RE);
        if (detail) return { mediaId: detail[1] };
        return null;
      },
    },
  };
}
