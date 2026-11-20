export const meta = {
  id: 'dhvideo.source',
  name: '豆花电影网',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '豆花电影网（dhvideo.cc）：五个频道分页、搜索、多线路详情；播放走 /api/m3u8 跳转到 HLS，遇 sha1 工作量校验时插件内自行求解。',
  mature: false,
  linkDomains: ['dhvideo.cc', 'box.dyrs.com.de', 'vip1.wzzym3u8.cc', 'vip1.mt320.com', 'v.fengbao14.com'],
  timeouts: { read: 30, playback: 30 },
};

const SITE = 'https://dhvideo.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TOKEN_KEY = 'dhv.season';

const CATS = [
  { id: 'dianying', label: '电影', type: 'movie' },
  { id: 'dianshiju', label: '电视剧', type: 'series' },
  { id: 'zongyi', label: '综艺', type: 'variety' },
  { id: 'dongman', label: '动漫', type: 'anime' },
  { id: 'duanju', label: '短剧', type: 'short' },
];

const HREF_MEDIA_RE = /^\/(movie|tv)\/([0-9a-z]+)-(\d+)\.html/;
const MEDIA_ID_RE = /^(movie|tv)_([0-9a-z]+)-(\d+)$/;
// 详情页 /movie/{hash}-{id}.html，播放页 /movie/{hash}/{id}.html
const DETAIL_RE = /^https?:\/\/dhvideo\.cc\/(movie|tv)\/([0-9a-z]+)-(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/dhvideo\.cc\/(movie|tv)\/([0-9a-z]+)\/(\d+)\.html/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export default hg => {
  function hexOf(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  // 站点在请求过密时会回一个「正在检测」页：找出 i 使 sha1(hash + i) === target
  async function solveChallenge(html) {
    const hash = (html.match(/var\s+hash\s*=\s*'([0-9a-f]{16,})'/) || [])[1];
    const target = (html.match(/var\s+target\s*=\s*'([0-9a-f]{16,})'/) || [])[1];
    if (!hash || !target) return null;
    const cacheKey = `pow:${hash}`;
    const cached = await hg.storage.get(cacheKey).catch(() => undefined);
    if (typeof cached === 'number') return cached;
    const max = 6000000;
    const chunk = 2000;
    for (let base = 0; base < max; base += chunk) {
      const end = Math.min(base + chunk, max);
      for (let i = base; i < end; i++) {
        if (hexOf(hg.crypto.digest('sha1', hash + i)) === target) {
          hg.storage.set(cacheKey, i, { ttlSec: 3600 }).catch(() => {});
          return i;
        }
      }
      await Promise.resolve();
    }
    return null;
  }

  function withAttackKey(url, key) {
    if (/[?&]attack_key=/.test(url)) return url.replace(/([?&])attack_key=[^&]*/, `$1attack_key=${key}`);
    return `${url}${url.indexOf('?') >= 0 ? '&' : '?'}attack_key=${key}`;
  }

  async function fetchPage(path, ctx, options) {
    const opts = options || {};
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    let current = url;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await hg.http.fetch({
          url: current,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/json',
            Referer: `${SITE}/`,
          },
          maxBytes: opts.maxBytes || 4194304,
          signal: ctx.signal,
          ...(opts.ttl ? { cache: { ttlSec: opts.ttl, staleIfErrorSec: 3600 } } : {}),
        });
      } catch (error) {
        // 宿主把 429 冷却成错误时，只能让用户稍后再试
        if (error && error.code === 'RATE_LIMITED') {
          throw new hg.PluginError('RATE_LIMITED', '站点限流了，等半分钟再试', { retryAfterSec: 40 });
        }
        throw error;
      }
      const body = norm(res.data);
      if (res.status === 429 || /passChallenge/.test(body)) {
        const key = await solveChallenge(body);
        if (key == null) {
          throw new hg.PluginError('RATE_LIMITED', '站点要求人机校验，等半分钟再试', { retryAfterSec: 40 });
        }
        hg.log.info(`站点人机校验，attack_key=${key}`);
        current = withAttackKey(url, key);
        continue;
      }
      if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
      if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
      if (/<title>\s*正在检测/.test(body)) {
        throw new hg.PluginError('RATE_LIMITED', '站点要求人机校验，等半分钟再试', { retryAfterSec: 40 });
      }
      return { body, url: res.url || current, res };
    }
    throw new hg.PluginError('RATE_LIMITED', '站点人机校验没通过，等半分钟再试', { retryAfterSec: 60 });
  }

  async function fetchDoc(path, ctx, options) {
    const { body } = await fetchPage(path, ctx, options);
    const doc = hg.html.parse(body);
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const href = norm(anchor.attr('href'));
      const m = href.match(HREF_MEDIA_RE);
      if (!m) continue;
      const mediaId = `${m[1]}_${m[2]}-${m[3]}`;
      if (seen.has(mediaId)) continue;
      const img = anchor.first('img');
      const title = trim(anchor.attr('title')) || trim(img && img.attr('alt'));
      if (!title) continue;
      seen.add(mediaId);
      const item = { id: mediaId, title, type: fallbackType || (m[1] === 'movie' ? 'movie' : 'series') };
      const cover = coverOf(img && (img.attr('data-src') || img.attr('src')));
      if (cover) item.cover = cover;
      out.push(item);
    }
    return out;
  }

  function parseMediaId(mediaId) {
    const m = norm(mediaId).match(MEDIA_ID_RE);
    if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
    return { type: m[1], hash: m[2], id: m[3] };
  }

  async function loadSeason(mediaId, origin, ctx) {
    const cacheKey = `${TOKEN_KEY}|${mediaId}|${origin}`;
    const cached = await hg.storage.get(cacheKey).catch(() => undefined);
    if (cached && Array.isArray(cached.list) && cached.list.length) return cached.list;

    const { type, hash, id } = parseMediaId(mediaId);
    const path = `/${type}/${hash}/${id}.html?origin=${encodeURIComponent(origin)}`;
    const { body } = await fetchPage(path, ctx, { maxBytes: 8388608 });
    const start = body.indexOf('xg_video_player_doc');
    if (start < 0) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页没有播放数据');
    const slice = body.slice(start, start + 4000000);
    const first = slice.match(/aa:\s*JSON\.parse\('([\s\S]*?)'\)/);
    const next = slice.match(/nexturl:\s*JSON\.parse\('([\s\S]*?)'\)/);
    const unpack = raw => {
      const text = raw.replace(/\\u0022/g, '"').replace(/\\u0027/g, "'").replace(/\\'/g, "'");
      return JSON.parse(text);
    };
    const list = [];
    try {
      if (first) list.push(unpack(first[1]));
      if (next) {
        for (const row of unpack(next[1])) list.push(row);
      }
    } catch {
      throw new hg.PluginError('UPSTREAM_CHANGED', '播放数据解析失败');
    }
    const clean = list
      .filter(row => row && typeof row.url === 'string' && row.url)
      .map(row => ({ origin: norm(row.origin), url: norm(row.url), title: trim(row.title) }));
    if (!clean.length) throw new hg.PluginError('CONTENT_LOCKED', '这条线路没有取到播放地址');
    await hg.storage.set(cacheKey, { list: clean }, { ttlSec: 10800 }).catch(() => {});
    return clean;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const cat of CATS) {
          let doc;
          try {
            doc = await fetchDoc(`/${cat.id}.html`, ctx, 900);
          } catch (error) {
            if (error && (error.code === 'RATE_LIMITED' || error.code === 'CANCELLED')) throw error;
            continue;
          }
          const items = cardsOf(doc, cat.type);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title: `最新${cat.label}`, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const id = trim(params.categoryId);
        const cat = CATS.find(c => c.id === id);
        if (!cat) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params.cursor);
        const doc = await fetchDoc(`/${cat.id}.html?page=${page}`, ctx, 300);
        const items = cardsOf(doc, cat.type);
        const out = { items };
        const nextLink = `/${cat.id}.html?page=${page + 1}`;
        if (items.length && doc.select(`a[href="${nextLink}"]`).length) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const doc = await fetchDoc(`/s.html?name=${encodeURIComponent(query)}`, ctx, 120);
        return { items: cardsOf(doc), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const { type, hash, id } = parseMediaId(trim(params.id));
        const doc = await fetchDoc(`/${type}/${hash}-${id}.html`, ctx, 300);

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id: trim(params.id), title, type: type === 'movie' ? 'movie' : 'series', playlists: [] };

        let cover = '';
        for (const img of doc.select('img')) {
          const src = norm(img.attr('src')) || norm(img.attr('data-src'));
          if (/\/img\/cover\//.test(src) || /\/img\/id\//.test(src)) { cover = coverOf(src); break; }
        }
        if (!cover) {
          const og = doc.first('meta[property="og:image"]');
          cover = coverOf(og && og.attr('content'));
        }
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        // 线路：a[href*="?origin=xxx"]，文字形如 "[3] vip"
        const seen = new Set();
        for (const anchor of doc.select('a')) {
          const m = norm(anchor.attr('href')).match(/[?&]origin=([a-zA-Z0-9_]+)/);
          if (!m) continue;
          const origin = m[1];
          if (seen.has(origin)) continue;
          seen.add(origin);
          const text = trim(anchor.text());
          const countMatch = text.match(/\[(\d+)\]/);
          const count = countMatch ? Number(countMatch[1]) : 0;
          const label = trim(text.replace(/\[\d+\]/, '')) || origin;
          const episodes = [];
          for (let i = 1; i <= Math.max(count, 1); i++) {
            episodes.push({ id: String(i), index: i, label: count > 1 ? `第${i}集` : '正片' });
          }
          detail.playlists.push({ id: origin, label: count > 1 ? `${label}（${count}）` : label, kind: 'main', episodes });
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        // vip 走站点自己的 box.dyrs 解析，最容易 500；把它排到最后，直连线路优先
        detail.playlists.sort((a, b) => (a.id === 'vip' ? 1 : 0) - (b.id === 'vip' ? 1 : 0));
        detail.episodeCount = detail.playlists[0].episodes.length;
        detail.totalEpisodes = detail.episodeCount;
        if (type === 'movie' && detail.episodeCount === 1) detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const mediaId = trim(params.mediaId);
        parseMediaId(mediaId);
        const origin = trim(params.playlistId) || 'vip';
        const index = Number(trim(params.episodeId));
        if (!Number.isInteger(index) || index < 1) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const list = await loadSeason(mediaId, origin, ctx);
        const row = list[index - 1];
        if (!row) throw new hg.PluginError('CONTENT_LOCKED', '这一集不在该线路的列表里，换条线路试试');

        const target = row.url.startsWith('http') ? row.url : `${SITE}${row.url}`;
        let res = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          res = await hg.http.fetch({
            url: target,
            headers: { 'User-Agent': UA, Referer: `${SITE}/`, Accept: '*/*' },
            redirect: 'follow',
            maxBytes: 1048576,
            signal: ctx.signal,
          }).catch(error => {
            if (error && error.code === 'RATE_LIMITED') {
              throw new hg.PluginError('RATE_LIMITED', '站点限流了，等半分钟再试', { retryAfterSec: 40 });
            }
            throw error;
          });
          if (res.ok || res.status < 500) break;
        }
        if (!res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `这条线路取流失败（${res.status}），换一条线路试试`);
        }
        const finalUrl = res.url || target;
        const contentType = norm(res.headers && res.headers['content-type']).toLowerCase();
        const isHls = /mpegurl/.test(contentType) || /\.m3u8(\?|$)/i.test(finalUrl) || norm(res.data).indexOf('#EXTM3U') === 0;
        if (!isHls) throw new hg.PluginError('CONTENT_LOCKED', '这条线路返回的不是播放列表，换条线路试试');
        return { streams: [{ url: finalUrl, kind: 'media', format: 'hls' }] };
      },

      async matchUrl(params) {
        const url = norm(params.url);
        const play = url.match(PLAY_RE);
        if (play) return { mediaId: `${play[1]}_${play[2]}-${play[3]}` };
        const detail = url.match(DETAIL_RE);
        if (detail) return { mediaId: `${detail[1]}_${detail[2]}-${detail[3]}` };
        return null;
      },
    },
  };
};
