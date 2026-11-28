export const meta = {
  id: 'mfdmgw.source',
  name: '免费动漫',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description:
    '免费动漫（mfdmgw.com）：苹果CMS + mxpro 模板。首页轮播与五个语言分区、热榜与追剧周表，全站列表走站内 ajax 接口分页；搜索改用 ajax 建议接口，绕开站内图形验证码；详情含分集，播放页从 player_aaaa 取直连 m3u8，同一部同时存在非凡与暴风两路来源时都会给出，可在播放器里切换。',
  mature: false,
  linkDomains: [
    'mfdmgw.com',
    'www.mfdmgw.com',
    'img.picbf.com',
    'fffgood.com',
    'vip.ffzy-plays.com',
    'vip.ffzy-play6.com',
    'vip.ffzy-play9.com',
    'vip.ffzy-online.com',
    'vip.ffzy-online2.com',
    'bfeng11.com',
    'v.fengbao14.com',
    'c1.ddbbffcdn.com',
  ],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 25 },
};

const BASE = 'https://www.mfdmgw.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 站点把内容拆成五个语言分区，另有热榜与追剧周表两个聚合页。
// 分类页只渲染首屏（33~71 部）而且翻页无效——page/2 与 page/1 内容完全一致，
// 所以「全部动漫」改走站内 ajax 接口分页，能翻到全站一万两千多部。
const CATS = [
  { id: 'all', label: '全部动漫', kind: 'ajax' },
  { id: '1', label: '日本动漫', kind: 'type' },
  { id: '2', label: '国产动漫', kind: 'type' },
  { id: '3', label: '欧美动漫', kind: 'type' },
  { id: '4', label: '港台动漫', kind: 'type' },
  { id: '5', label: '海外动漫', kind: 'type' },
  { id: 'hot', label: '热榜', kind: 'label' },
  { id: 'new', label: '今日更新', kind: 'label' },
  { id: 'week', label: '追剧周表', kind: 'label' },
];

const CAT_MAP = new Map(CATS.map(c => [c.id, c]));
const AJAX_LIMIT = 30; // 站点对 limit 有上限，给 50 以上会被重置成 10
const SEARCH_LIMIT = 100; // 建议接口的 page 参数无效，只能靠 limit 一次取够

const DETAIL_RE = /^https?:\/\/(?:www\.)?mfdmgw\.com\/index\.php\/vod\/detail\/id\/(\d+)\.html/i;
const DETAIL_HREF_RE = /\/index\.php\/vod\/detail\/id\/(\d+)\.html/;
const PLAY_PATH_RE = /\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;

// 播放来源：非凡（ff）与暴风（bfzy）各一套 CDN。非凡对海外出口直接地域拒绝，
// 所以两路都返回，让用户自己切。
const SOURCE_LABEL = [
  [/^ff/i, '非凡线路'],
  [/^bfzy/i, '暴风线路'],
  [/^ty/i, '天翼线路'],
];

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
  if (url.startsWith('/template/') || url.startsWith('/static')) return '';
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

// mxpro 这版把真正的封面挂在 data-original 上，src 一律是同一张橙色占位图
// （/upload/mxprocms/ 目录下的 logo 图）。实测首页 139 张卡片的 src 完全相同，
// 所以按 src 取会整屏都是占位图。
const PLACEHOLDER_DIR = '/upload/mxprocms/';

function coverOf(img) {
  if (!img) return '';
  for (const raw of [img.attr('data-original'), img.attr('data-src'), img.attr('src')]) {
    const url = imageOf(raw);
    if (!url) continue;
    if (url.includes(PLACEHOLDER_DIR)) continue;
    // 豆瓣图床会 301 到 https，直接给 https 少一跳
    return url.replace(/^http:\/\/lain\.bgm\.tv\//i, 'https://lain.bgm.tv/');
  }
  return '';
}

function sourceLabel(from) {
  const key = trim(from);
  if (!key) return '';
  for (const [re, label] of SOURCE_LABEL) if (re.test(key)) return label;
  return key.slice(0, 20);
}

// 播放页把配置内联成 `var player_aaaa={...}`，vod_data 里还套一层对象，
// 用正则截到行尾会被内层右括号骗到，所以按括号配对扫。
function playerConfig(html) {
  const at = html.indexOf('player_aaaa');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return safeJson(html.slice(start, i + 1));
    }
  }
  return null;
}

function playUrlOf(html) {
  const cfg = playerConfig(html);
  if (!cfg) return '';
  const url = trim(norm(cfg.url).replace(/\\\//g, '/').replace(/&amp;/g, '&'));
  return /^https?:\/\//i.test(url) ? url : '';
}

export default function (hg) {
  let catCache = null;
  const episodeCache = new Map();
  const CACHE_KEEP = 6;
  const CACHE_TTL = 120000;

  function remember(key, value) {
    episodeCache.delete(key);
    episodeCache.set(key, { at: Date.now(), value });
    while (episodeCache.size > CACHE_KEEP) episodeCache.delete(episodeCache.keys().next().value);
  }

  function recall(key) {
    const hit = episodeCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL) {
      episodeCache.delete(key);
      return null;
    }
    return hit.value;
  }

  async function request(path, ctx, options) {
    const opts = options || {};
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    const headers = {
      'User-Agent': UA,
      Accept: 'text/html,application/json',
      Referer: `${BASE}/`,
    };
    if (opts.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await hg.http.fetch({
      url,
      method: opts.method || 'GET',
      headers,
      ...(opts.body ? { body: opts.body } : {}),
      retry: 0,
      signal: ctx.signal,
      ...(opts.ttl ? { cache: { ttlSec: opts.ttl, staleIfErrorSec: 600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  function cardOf(node) {
    const href = norm(node.attr('href'));
    const m = href.match(DETAIL_HREF_RE);
    if (!m) return null;

    const titleNode = node.first('.module-poster-item-title');
    let title = titleNode ? trim(titleNode.text()) : '';
    if (!title) title = trim(node.attr('title'));
    if (!title) {
      const img = node.first('img');
      title = trim(img && img.attr('alt'));
    }
    if (!title) return null;

    const item = { id: m[1], title: title.slice(0, 200), type: 'anime' };
    const cover = coverOf(node.first('img'));
    if (cover) item.cover = cover;
    const note = node.first('.module-item-note');
    if (note) {
      const text = trim(note.text());
      if (text) item.badge = text.slice(0, 20);
    }
    return item;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const node of root.select('.module-poster-item')) {
      const card = cardOf(node);
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
    }
    if (out.length) return out;
    // 热榜页是纯排名列表（.module-paper-item-main），站点这版没给封面，只能空着。
    for (const anchor of root.select('.module-paper-item-main a')) {
      const m = norm(anchor.attr('href')).match(DETAIL_HREF_RE);
      if (!m || seen.has(m[1])) continue;
      const titleNode = anchor.first('.module-paper-item-infotitle');
      const title = trim(titleNode ? titleNode.text() : anchor.text());
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title: title.slice(0, 200), type: 'anime' };
      const rank = anchor.first('.module-paper-item-num');
      if (rank) {
        const text = trim(rank.text());
        if (text) item.badge = `No.${text}`.slice(0, 20);
      }
      out.push(item);
    }
    return out;
  }

  function ajaxItem(row) {
    const id = trim(String((row && row.vod_id) || ''));
    const title = trim(row && row.vod_name);
    if (!/^\d+$/.test(id) || !title) return null;
    const item = { id, title: title.slice(0, 200), type: 'anime' };
    const cover = imageOf(row.vod_pic);
    if (cover) item.cover = cover;
    const note = trim(row.vod_remarks);
    if (note) item.badge = note.slice(0, 20);
    return item;
  }

  function categoriesOf() {
    if (!catCache) {
      catCache = [
        {
          id: 'all',
          label: '动漫',
          children: CATS.filter(c => c.id !== 'all').map(c => ({ id: c.id, label: c.label })),
        },
      ];
    }
    return catCache;
  }

  async function detailOf(id, ctx) {
    const html = await request(`/index.php/vod/detail/id/${id}.html`, ctx, { ttl: 0 });
    const doc = hg.html.parse(html);

    let title = '';
    const h1 = doc.first('h1');
    if (h1) title = trim(h1.text());
    if (!title) {
      const t = doc.first('title');
      title = trim(t && t.text()).split(/\s*[-–]\s*/)[0];
    }
    if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

    const episodes = [];
    const seen = new Set();
    for (const anchor of doc.select('.module-play-list a')) {
      const href = norm(anchor.attr('href'));
      const m = href.match(PLAY_PATH_RE);
      if (!m || m[1] !== id) continue;
      const nid = Number(m[3]);
      if (!Number.isInteger(nid) || seen.has(nid)) continue;
      seen.add(nid);
      episodes.push({ nid, sid: Number(m[2]) || 1 });
    }
    episodes.sort((a, b) => a.nid - b.nid);

    const result = { doc, title, episodes };
    remember(id, result);
    return result;
  }

  async function playOf(id, sid, nid, ctx) {
    const html = await request(`/index.php/vod/play/id/${id}/sid/${sid}/nid/${nid}.html`, ctx, { ttl: 0 });
    const cfg = playerConfig(html);
    if (!cfg) return null;
    if (Number(cfg.points) > 0) return null;
    const url = playUrlOf(html);
    if (!url) return null;
    return { url, from: trim(cfg.from) };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = hg.html.parse(await request('/', ctx, { ttl: 600 }));
        const sections = [];

        const banner = [];
        const seenBanner = new Set();
        for (const slide of doc.select('.swiper-slide')) {
          const link = slide.first('.banner');
          if (!link) continue;
          const m = norm(link.attr('href')).match(DETAIL_HREF_RE);
          if (!m || seenBanner.has(m[1])) continue;
          const titleNode = slide.first('.v-title');
          const title = trim(titleNode && titleNode.text());
          if (!title) continue;
          seenBanner.add(m[1]);
          const item = { id: m[1], title: title.slice(0, 200), type: 'anime' };
          // 轮播封面写在 style="background: url(...) ..." 里
          const style = norm(link.attr('style'));
          const bg = style.match(/url\((['"]?)([^'")]+)\1\)/i);
          const cover = imageOf(bg && bg[2]);
          if (cover && !cover.includes(PLACEHOLDER_DIR)) {
            item.cover = cover.replace(/^http:\/\/lain\.bgm\.tv\//i, 'https://lain.bgm.tv/');
          }
          const noteNode = slide.first('.v-ins p');
          if (noteNode) {
            const note = trim(noteNode.text());
            if (note) item.badge = note.slice(0, 20);
          }
          banner.push(item);
        }
        if (banner.length) {
          sections.push({
            id: 'banner',
            title: '精选推荐',
            layout: 'banner',
            imageAspect: 'landscape',
            items: banner.slice(0, 10),
          });
        }

        // 语言分区各占一个 .module，标题在 .module-heading 里
        for (const block of doc.select('.module')) {
          // 首页也挂着排行榜区块，那版列表没有封面，整块放上去会花一屏空白，跳过它。
          const items = cardsOf(block).filter(item => item.cover);
          if (items.length < 3) continue;
          const head = block.first('.module-title') || block.first('.module-heading');
          let title = '';
          if (head) {
            // 标题节点里嵌着英文副标题（ribendongman / RANKING 之类），先摘掉再取
            const en = head.first('.module-title-en');
            const full = trim(head.text());
            const extra = en ? trim(en.text()) : '';
            title = trim(extra && full.includes(extra) ? full.split(extra)[0] : full);
          }
          title = title.replace(/\s*(更多|选择类型).*$/, '').trim();
          title = (title || '推荐').slice(0, 20);
          if (sections.some(s => s.title === title)) continue;
          sections.push({
            id: `s${sections.length}`,
            title,
            layout: 'grid',
            items: items.slice(0, 24),
            more: true,
          });
          if (sections.length >= 8) break;
        }

        if (sections.length) return { items: sections, next: null };

        const fallback = cardsOf(doc).slice(0, 30);
        if (!fallback.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: [{ id: 'latest', title: '最新动漫', layout: 'grid', items: fallback }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return categoriesOf();
      },

      async list(params, ctx) {
        const catId = trim(params && params.categoryId).toLowerCase();
        const cat = CAT_MAP.get(catId);
        if (!cat) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);

        if (cat.kind === 'ajax') {
          const raw = await request('/index.php/ajax/data', ctx, {
            method: 'POST',
            body: `mid=1&page=${page}&limit=${AJAX_LIMIT}`,
            ttl: 120,
          });
          const data = safeJson(raw);
          const rows = (data && Array.isArray(data.list) && data.list) || [];
          const items = rows.map(ajaxItem).filter(Boolean);
          const out = { items };
          const total = Number(data && data.total);
          if (Number.isFinite(total) && total > 0) out.total = total;
          if (items.length >= AJAX_LIMIT) out.next = String(page + 1);
          return out;
        }

        // 分类页与榜单页都只渲染一屏，没有翻页控件，page>1 返回的还是第一屏。
        if (page > 1) return { items: [], next: null };
        const path =
          cat.kind === 'type'
            ? `/index.php/vod/type/id/${cat.id}.html`
            : `/index.php/label/${cat.id}.html`;
        const doc = hg.html.parse(await request(path, ctx, { ttl: 120 }));
        const items = cardsOf(doc);
        return { items, next: null };
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        // 站内搜索页要图形验证码，建议接口不需要，而且 limit 没有上限。
        const raw = await request(
          `/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`,
          ctx,
          { ttl: 300 }
        );
        const data = safeJson(raw);
        const rows = (data && Array.isArray(data.list) && data.list) || [];
        const items = [];
        const seen = new Set();
        for (const row of rows) {
          const id = trim(String((row && row.id) || ''));
          const title = trim(row && row.name);
          if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
          seen.add(id);
          const item = { id, title: title.slice(0, 200), type: 'anime' };
          const cover = imageOf(row.pic);
          if (cover) item.cover = cover;
          items.push(item);
        }
        return { items, next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const info = await detailOf(id, ctx);
        const detail = { id, title: info.title.slice(0, 200), type: 'anime', playlists: [] };

        const cover = coverOf(
          info.doc.first('.module-item-pic img') || info.doc.first('.module-item-cover img')
        );
        if (cover) detail.cover = cover;

        const intro = info.doc.first('.module-info-introduction-content');
        if (intro) {
          const text = trim(intro.text());
          if (text) detail.overview = text.slice(0, 400);
        }

        const genres = [];
        for (const anchor of info.doc.select('.module-info-tag-link a')) {
          const text = trim(anchor.text());
          if (text && text.length <= 12 && !genres.includes(text)) genres.push(text);
        }
        if (genres.length) detail.genres = genres.slice(0, 8);

        if (!info.episodes.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '这一部还没有片源');
        }

        const multi = info.episodes.length > 1;
        detail.playlists = [
          {
            id: 'main',
            label: multi ? '选集' : '播放线路',
            kind: 'main',
            episodes: info.episodes.map((ep, i) => ({
              id: `e${ep.nid}`,
              index: i + 1,
              episodeNumber: i + 1,
              label: multi ? `第${ep.nid}集` : info.title,
            })),
          },
        ];
        if (multi) {
          detail.episodeCount = info.episodes.length;
          detail.totalEpisodes = info.episodes.length;
        }
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const wanted = trim(params && params.episodeId).replace(/^e/, '');
        const nid = /^\d+$/.test(wanted) && Number(wanted) > 0 ? Number(wanted) : 1;

        // 第一路永远取；第二路只是补充，失败就当没有，不能拖累播放。
        let picked = nid;
        let first = await playOf(id, 1, picked, ctx);
        // 分集号对不上（旧链接、越界）就退回第 1 集，比直接报错有用
        if (!first && picked !== 1) {
          picked = 1;
          first = await playOf(id, 1, picked, ctx);
        }
        if (!first) throw new hg.PluginError('CONTENT_LOCKED', '这一集还没有片源');

        const streams = [];
        const push = play => {
          const stream = {
            url: play.url,
            kind: 'media',
            format: 'hls',
            headers: { 'User-Agent': UA, Referer: `${BASE}/` },
          };
          const label = sourceLabel(play.from);
          if (label) stream.label = label;
          streams.push(stream);
        };
        push(first);

        const second = await playOf(id, 2, picked, ctx).catch(error => {
          if (error && error.code === 'CANCELLED') throw error;
          return null;
        });
        if (second && second.url !== first.url) push(second);

        return { streams };
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        if (!raw) return null;
        const play = raw.match(PLAY_PATH_RE);
        if (play) return { mediaId: play[1], episodeId: `e${play[3]}` };
        const detail = raw.match(DETAIL_RE);
        if (detail) return { mediaId: detail[1] };
        const type = raw.match(/\/index\.php\/vod\/type\/id\/([1-5])\.html/i);
        if (type) return { categoryId: type[1] };
        const label = raw.match(/\/index\.php\/label\/(hot|new|week)\.html/i);
        if (label) return { categoryId: label[1].toLowerCase() };
        return null;
      },
    },
  };
}
