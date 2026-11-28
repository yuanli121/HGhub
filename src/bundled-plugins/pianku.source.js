export const meta = {
  id: 'pianku.source',
  name: '片库',
  version: '1.1.0',
  protocol: 1,
  kind: 'source',
  description:
    '片库（4k01.pianku.online）：苹果CMS 模板自建站。首页分区、四个主分类与子分类、关键词搜索、详情与分集 HLS。播放页把片源写在 player_aaaa 里，其中「备用线路」「自营4K60帧」两条是直连 m3u8，腾讯/优酷/B站/爱奇艺那几条跳正版平台，按 external 交给系统打开。',
  mature: false,
  linkDomains: ['pianku.online'],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const BASE = 'https://4k01.pianku.online';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 站里同一部片子常挂五条线路：自有 m3u8 两三条，剩下的是腾讯、优酷、B站、爱奇艺的
// 播放页。宿主 0.0.5 起支持 kind:"external"，这些地址能交给系统浏览器打开，所以不再
// 按标签排掉，而是保留在选集里，播放时按地址类型分流。
const PLATFORM_TAB = /腾讯|优酷|奇异|爱奇艺|B站|bilibili|芒果|搜狐|PPTV|咪咕|抖音|乐视|AcFun/i;

const EXTERNAL_APP = [
  [/qq|腾讯/i, '腾讯视频'],
  [/qiyi|奇异|爱奇艺/i, '爱奇艺'],
  [/youku|优酷/i, '优酷'],
  [/bilibili|B站/i, '哔哩哔哩'],
  [/mgtv|芒果/i, '芒果TV'],
  [/sohu|搜狐/i, '搜狐视频'],
  [/pptv|pp视频/i, 'PP视频'],
  [/migu|咪咕/i, '咪咕视频'],
  [/letv|乐视/i, '乐视视频'],
  [/acfun/i, 'AcFun'],
];

function appOf(...hints) {
  const text = hints.filter(Boolean).join(' ');
  for (const [re, app] of EXTERNAL_APP) if (re.test(text)) return app;
  return '';
}

// 外部打开不附带请求头、Cookie 和变换，宿主只把地址交给系统，所以这里不带 headers。
function externalStream(url, label, from) {
  const app = appOf(from, label, url);
  const stream = { url, kind: 'external' };
  if (app) stream.external = { app };
  stream.label = (app || trim(label) || '外部打开').slice(0, 60) + ' · 外部打开';
  return stream;
}

const CAT_TYPE = { 20: 'movie', 37: 'series', 43: 'anime', 45: 'variety' };
const SUB_PARENT = {
  28: 'movie', 29: 'movie', 30: 'movie', 31: 'movie', 32: 'movie', 33: 'movie',
  34: 'movie', 35: 'movie', 36: 'movie', 21: 'movie', 22: 'movie', 23: 'movie',
  24: 'movie', 25: 'movie', 26: 'movie', 27: 'movie', 46: 'movie', 47: 'movie',
  38: 'series', 39: 'series', 40: 'series', 41: 'series', 42: 'series',
  44: 'anime', 48: 'variety', 49: 'variety', 50: 'variety',
};

const DETAIL_RE = /^https?:\/\/4k01\.pianku\.online\/voddetail\/(\d+)\.html/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 封面来自腾讯/优酷的图床，也有站内 /upload/。站内相对路径补全域名。
function imageOf(raw) {
  const url = trim(raw);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (/^\/load\.gif/i.test(url)) return '';
  if (url.startsWith('/')) return `${BASE}${url}`;
  return url;
}

function typeOf(catId, name, episodes) {
  const byId = CAT_TYPE[Number(catId)] || SUB_PARENT[Number(catId)];
  if (byId) return byId;
  const t = norm(name);
  if (/动漫|动画/.test(t)) return 'anime';
  if (/综艺/.test(t)) return 'variety';
  if (/纪录/.test(t)) return 'documentary';
  if (/剧|连续/.test(t)) return 'series';
  if (episodes > 1) return 'series';
  return 'movie';
}

export default function (hg) {
  let catCache = null;

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${BASE}/` },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 900 } } : {}),
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
    const box = anchor.first('.vod-info');
    const title = trim(
      (box && box.first('.title') && box.first('.title').text()) ||
        anchor.attr('title') ||
        anchor.text()
    );
    if (!title) return null;
    const item = { id: m[1], title: title.slice(0, 200), type: 'movie' };

    const img = anchor.first('img');
    const cover = imageOf(
      (img && (img.attr('data-original') || img.attr('data-src') || img.attr('src'))) || ''
    );
    if (cover) item.cover = cover;

    const sub = box && box.first('.subtitle');
    const subText = trim(sub && sub.text());
    const tag = subText.split(/\s*\/\s*/)[0];
    if (tag) {
      item.type = typeOf('', tag, 0);
      item.tags = [tag];
    }
    const year = (subText.match(/\b(19|20)\d{2}\b/) || [])[0];
    if (year) {
      item.year = Number(year);
      if (item.tags) item.tags = [tag, year];
    }
    const remarks = anchor.first('.remarks');
    const note = trim(remarks && remarks.text());
    if (note && note.length <= 8 && !/^\d{4}年/.test(note)) item.badge = note;
    return item;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const card = cardOf(anchor);
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
    }
    return out;
  }

  async function categoriesOf(ctx) {
    if (catCache) return catCache;
    const doc = await fetchDoc('/', ctx, 1800);
    const seen = new Map();
    for (const anchor of doc.select('a')) {
      const m = norm(anchor.attr('href')).match(/^\/vodtype\/(\d+)\.html$/);
      if (!m) continue;
      const label = trim(anchor.text());
      if (!label || label.length > 12 || label === '更多') continue;
      if (seen.has(m[1])) continue;
      seen.set(m[1], label);
    }
    const cats = Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
    if (!cats.length) throw new hg.PluginError('UPSTREAM_CHANGED', '没解析到分类导航');
    catCache = cats;
    return cats;
  }

  // 详情页：标题、封面、简介都在 detail-* 里，线路和分集在 play-source-section。
  async function detailOf(id, ctx) {
    const doc = await fetchDoc(`/voddetail/${id}.html`, ctx, 0);

    const h1 = doc.first('h1.detail-title');
    let title = '';
    if (h1) {
      // 标题里套了个 detail-remarks 的档期，得先剔掉。
      const note = h1.first('.detail-remarks');
      title = trim(h1.text());
      const remark = trim(note && note.text());
      if (remark && title.endsWith(remark)) title = trim(title.slice(0, -remark.length));
    }
    if (!title) {
      const t = doc.first('title');
      title = trim(t && t.text()).split(/\s*[-_|]\s*/)[0];
    }
    if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

    const coverImg = doc.first('.detail-pic img') || doc.first('.detail-pic');
    const cover = imageOf(
      (coverImg && (coverImg.attr('data-original') || coverImg.attr('data-src') || coverImg.attr('src'))) || ''
    );

    const meta = [];
    let catName = '';
    let year = 0;
    let area = '';
    for (const row of doc.select('.detail-meta span')) {
      const text = trim(row.text());
      if (!text) continue;
      if (/^分类[：:]/.test(text)) {
        catName = trim(text.replace(/^分类[：:]/, ''));
      } else if (/^年份[：:]/.test(text)) {
        const n = Number(text.replace(/[^0-9]/g, ''));
        if (Number.isFinite(n)) year = n;
      } else if (/^地区[：:]/.test(text)) {
        area = trim(text.replace(/^地区[：:]/, ''));
      } else if (/^主演[：:]/.test(text)) {
        const names = trim(text.replace(/^主演[：:]/, '')).split(/[,，\/、]/).map(s => s.trim()).filter(Boolean);
        if (names.length) meta.push({ people: names.slice(0, 8) });
      } else if (/^导演[：:]/.test(text)) {
        const names = trim(text.replace(/^导演[：:]/, '')).split(/[,，\/、]/).map(s => s.trim()).filter(Boolean);
        if (names.length) meta.push({ director: names[0] });
      }
    }

    const desc = doc.first('.detail-desc p');
    const overview = trim(desc && desc.text());

    // 线路：source-tab-item 给标签，source-pane 给分集
    const tabs = new Map();
    for (const tab of doc.select('.source-tab-item')) {
      const target = norm(tab.attr('data-target')).replace(/^playlist-/, '');
      if (!/^\d+$/.test(target)) continue;
      tabs.set(target, trim(tab.text()));
    }
    const playlists = [];
    for (const pane of doc.select('.source-pane')) {
      const sid = norm(pane.attr('id')).replace(/^playlist-/, '');
      if (!/^\d+$/.test(sid)) continue;
      const label = tabs.get(sid) || `线路${sid}`;
      const episodes = [];
      const seenNid = new Set();
      for (const anchor of pane.select('a')) {
        const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
        if (!m || m[1] !== id || m[2] !== sid) continue;
        const nid = Number(m[3]);
        if (!Number.isInteger(nid) || seenNid.has(nid)) continue;
        seenNid.add(nid);
        episodes.push({
          id: `s${sid}e${nid}`,
          index: episodes.length + 1,
          episodeNumber: nid,
          label: trim(anchor.attr('title') || anchor.text()) || String(nid),
        });
      }
      if (!episodes.length) continue;
      playlists.push({ id: `s${sid}`, label: label.slice(0, 200), kind: 'main', episodes });
    }

    return { doc, title, cover, playlists, overview, catName, year, area, meta };
  }

  function metaOf(detail) {
    const out = {};
    if (detail.overview) out.description = detail.overview.slice(0, 5000);
    const tags = [detail.catName, detail.area, detail.year ? String(detail.year) : ''].filter(Boolean);
    if (tags.length) out.tags = tags;
    const people = [];
    for (const row of detail.meta) {
      if (row.director) people.push({ name: row.director, role: '导演' });
      if (row.people) for (const name of row.people) people.push({ name, role: '演员' });
    }
    if (people.length) out.people = people.slice(0, 12);
    return out;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 600);
        const sections = [];
        const seen = new Set();
        for (const block of doc.select('section, .section')) {
          const head = block.first('h2') || block.first('.section-title');
          const title = trim(head && head.text()).replace(/\s*更多\s*$/, '');
          if (!title || title.length > 16 || seen.has(title)) continue;
          const items = cardsOf(block);
          if (items.length < 3) continue;
          seen.add(title);
          sections.push({
            id: `s${sections.length}`,
            title,
            // 首页第一块是轮播的精选推荐，后面每块是六格网格。
            layout: sections.length === 0 ? 'banner' : 'grid',
            items: items.slice(0, 24),
          });
          if (sections.length >= 9) break;
        }
        if (!sections.length) {
          const items = cardsOf(doc).slice(0, 30);
          if (!items.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
          sections.push({ id: 'latest', title: '最新收录', layout: 'grid', items });
        }
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return categoriesOf(ctx);
      },

      async list(params, ctx) {
        const id = trim(params && params.categoryId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const path = page > 1 ? `/vodtype/${id}-${page}.html` : `/vodtype/${id}.html`;
        const doc = await fetchDoc(path, ctx, 120);
        const items = cardsOf(doc);
        const t = typeOf(id, '', 0);
        for (const item of items) item.type = t;
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
        // 苹果CMS 的搜索路径是一串固定横杠，关键词走 wd 参数。
        const path = `/vodsearch/${'-'.repeat(13)}.html?wd=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
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
        const detail = await detailOf(id, ctx);

        const out = { id, title: detail.title.slice(0, 200), type: 'movie', playlists: [] };
        if (detail.cover) out.cover = detail.cover;
        Object.assign(out, metaOf(detail));

        if (!detail.playlists.length) {
          throw new hg.PluginError(
            'CONTENT_LOCKED',
            '这部只挂了腾讯/优酷/B站/爱奇艺的正版页，没有直连片源'
          );
        }

        const total = Math.max(...detail.playlists.map(p => p.episodes.length));
        out.type = typeOf('', detail.catName, total);
        out.playlists = detail.playlists;
        if (total > 1) {
          if (out.type === 'movie') out.type = 'series';
          out.episodeCount = total;
          out.totalEpisodes = total;
        }
        return out;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const playlistId = trim(params && params.playlistId);
        const episodeId = trim(params && params.episodeId);
        const sid = (playlistId.match(/^s(\d+)$/) || [])[1];
        const nid = (episodeId.match(/e(\d+)$/) || [])[1];
        if (!sid || !nid) throw new hg.PluginError('INVALID_ARGUMENT', '分集标识不合法');

        // 每次播放都重抓播放页：player_aaaa 里的地址是现签的，缓存住迟早失效。
        const html = await fetchText(`/vodplay/${id}-${sid}-${nid}.html`, ctx, 0);
        const m = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!m) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页里没有播放器配置');
        const cfg = safeJson(m[1].trim());
        if (!cfg) throw new hg.PluginError('UPSTREAM_CHANGED', '播放器配置解析失败');

        const url = trim(norm(cfg.url).replace(/\\\//g, '/'));
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这条线路没有给出地址');
        const from = trim(cfg.from);
        if (!/\.m3u8(\?|$)/i.test(url)) {
          // 正版平台页：宿主播不了，但地址本身有效，交系统打开。
          if (/^https?:\/\//i.test(url)) return { streams: [externalStream(url, from, from)] };
          throw new hg.PluginError('CONTENT_LOCKED', `${from || '这条线路'} 没有可播放的地址`);
        }
        return {
          streams: [
            {
              url,
              kind: 'media',
              format: 'hls',
              label: (from || '直连').slice(0, 40),
            },
          ],
        };
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        const d = raw.match(DETAIL_RE);
        if (d) return { mediaId: d[1] };
        const p = raw.match(/\/vodplay\/(\d+)-(\d+)-(\d+)\.html/i);
        if (p) return { mediaId: p[1], episodeId: `s${p[2]}e${p[3]}` };
        const c = raw.match(/^https?:\/\/4k01\.pianku\.online\/vodtype\/(\d+)/i);
        if (c) return { categoryId: c[1] };
        return null;
      },
    },
  };
}
