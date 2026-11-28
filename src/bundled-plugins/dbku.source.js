export const meta = {
  id: 'dbku.source',
  name: '独播库',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '独播库（dbku.tv）：macCMS myui 站，首页八个分区、八个频道（地区/年代/类型/语言/排序筛选）、搜索、详情与 HLS 直连。播放页 player_data 的 Base64 + URL 编码自行还原，取流无鉴权、无时效签名。',
  mature: false,
  linkDomains: ['dbku.tv', 'www.dbku.tv', 'vid.dbokutv.com'],
  defaultHeaders: {
    Referer: 'https://www.dbku.tv/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.dbku.tv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 站内只有这八个频道，标签是通用分类名，运行期不再改写。
const CATS = [
  { id: '2', label: '连续剧', type: 'series' },
  { id: '1', label: '电影', type: 'movie' },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动漫', type: 'anime' },
  { id: '13', label: '陆剧', type: 'series' },
  { id: '14', label: '台泰剧', type: 'series' },
  { id: '15', label: '日韩剧', type: 'series' },
  { id: '21', label: '短剧', type: 'short' },
];
const CAT_TYPE = new Map(CATS.map(c => [c.id, c.type]));

const DETAIL_RE = /^https?:\/\/(?:www\.)?dbku\.tv\/voddetail\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?dbku\.tv\/vodplay\/(\d+)-(\d+)-(\d+)\.html/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\.html/;
const PAGE_SIZE = 48;

// /vodshow/{tid}-{area}-{by}-{class}-{lang}-{?}-{?}-{?}-{page}-{?}-{?}-{year}.html
// 站点用固定 11 槽网格，空槽照样留一个连字符，缺一个就 404。
const SLOT = { area: 1, by: 2, genre: 3, lang: 4, page: 8, year: 11 };

const FILTER_TTL_MS = 30 * 60 * 1000;
const PLACEHOLDER_RE = /(?:^|\/)(?:load(?:ing)?|blank|placeholder|spacer|lazy)[^/]*\.(?:gif|png|jpe?g|webp)$/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// 站点时间一律是北京时间（UTC+8，已用 /rss.xml 的 pubDate 校准），要换成 Unix 毫秒。
function toMs(text) {
  const m = norm(text).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0) - 8, Number(m[5] || 0), Number(m[6] || 0));
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  // 兜底：算出来落在未来就不写，宁可不显示也不给出错误时间。
  if (ms > Date.now() + 3600 * 1000) return undefined;
  return Math.round(ms);
}

function showPath(tid, opts) {
  const o = opts || {};
  const slots = ['', '', '', '', '', '', '', '', '', '', ''];
  for (const key of Object.keys(SLOT)) {
    const idx = SLOT[key] - 1;
    if (key === 'page') {
      const n = Number(o.page);
      slots[idx] = Number.isInteger(n) && n > 1 ? String(n) : '';
    } else {
      const value = trim(o[key]);
      slots[idx] = value ? encodeURIComponent(value) : '';
    }
  }
  return `/vodshow/${encodeURIComponent(tid)}${slots.map(s => `-${s}`).join('')}.html`;
}

function slotsOf(href, tid) {
  const path = norm(href).split('?')[0];
  const m = path.match(/\/vodshow\/([^/]+)\.html$/i);
  if (!m) return null;
  const parts = safeDecode(m[1]).split('-');
  if (parts.length !== 12 || parts[0] !== tid) return null;
  return parts.slice(1);
}

function mediaTypeOf(label, episodeCount) {
  const text = norm(label);
  if (/动漫|动画/.test(text)) return 'anime';
  if (/综艺|真人秀/.test(text)) return 'variety';
  if (/短剧|微短剧/.test(text)) return 'short';
  if (/电影|片$|纪录片/.test(text)) return 'movie';
  if (/剧/.test(text)) return 'series';
  return episodeCount > 1 ? 'series' : 'movie';
}

function absoluteUrl(raw, base) {
  const url = norm(raw).trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  if (url.startsWith('//')) return `https:${url}`;
  try {
    return new URL(url, base).toString();
  } catch {
    return '';
  }
}

export default function (hg) {
  const filterCache = new Map();

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${SITE}/` },
      retry: 1,
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

  function coverOf(raw) {
    const url = norm(raw).trim();
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function pickCover(anchor, img) {
    const cands = [
      anchor && anchor.attr('data-original'),
      anchor && anchor.attr('data-src'),
      anchor && anchor.attr('data-background'),
      img && img.attr('data-original'),
      img && img.attr('data-src'),
      img && img.attr('src'),
    ];
    for (const cand of cands) {
      const url = coverOf(cand);
      if (!url || PLACEHOLDER_RE.test(url)) continue;
      return url;
    }
    const style = norm(anchor && anchor.attr('style'));
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    if (m) {
      const url = coverOf(m[2]);
      if (url && !PLACEHOLDER_RE.test(url)) return url;
    }
    return '';
  }

  // badge 上限 8 字符：综艺的期号角标有 10 位，压成 MM-DD 才塞得下。
  function shortBadge(text) {
    const t = trim(text);
    if (!t) return '';
    if (t.length <= 8) return t;
    const date = t.match(/(\d{4})(\d{2})(\d{2})/);
    if (date) return `${date[2]}-${date[3]}`;
    const count = t.match(/(\d+)\s*集/);
    if (count) return `更至${count[1]}集`.slice(0, 8);
    return '';
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const img = anchor.first('img');
      const title = trim(anchor.attr('title')) || trim(img && (img.attr('alt') || img.attr('title')));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: fallbackType || 'other' };
      const cover = pickCover(anchor, img);
      if (cover) item.cover = cover;
      const parent = anchor.parent();
      const badgeNode = anchor.first('span.pic-text') || (parent && parent.first('span.pic-text'));
      const badge = shortBadge(badgeNode && badgeNode.text());
      if (badge) item.badge = badge;
      out.push(item);
    }
    return out;
  }

  function episodesOf(doc) {
    const groups = new Map();
    for (const pane of doc.select('[id^="playlist"]')) {
      const sid = norm(pane.attr('id')).replace(/[^\d]/g, '');
      if (!sid) continue;
      const list = groups.get(sid) || [];
      for (const anchor of pane.select('a')) {
        const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
        if (!m || m[2] !== sid) continue;
        const ep = Number(m[3]);
        if (!Number.isInteger(ep) || ep < 1) continue;
        if (list.some(e => e.ep === ep)) continue;
        list.push({ ep, label: trim(anchor.text()) });
      }
      if (list.length) groups.set(sid, list);
    }
    if (!groups.size) {
      for (const anchor of doc.select('a')) {
        const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
        if (!m) continue;
        const sid = m[2];
        const ep = Number(m[3]);
        const list = groups.get(sid) || [];
        if (!Number.isInteger(ep) || ep < 1 || list.some(e => e.ep === ep)) continue;
        list.push({ ep, label: trim(anchor.text()) });
        groups.set(sid, list);
      }
    }
    const out = [];
    for (const [sid, list] of groups) {
      list.sort((a, b) => a.ep - b.ep);
      out.push({
        id: sid,
        label: groups.size > 1 ? `线路 ${sid}` : '默认线路',
        kind: 'main',
        episodes: list.map((e, i) => ({
          id: `${sid}-${e.ep}`,
          index: i + 1,
          episodeNumber: e.ep,
          label: (e.label || `第${e.ep}集`).slice(0, 200),
        })),
      });
    }
    return out;
  }

  async function filterData(tid, ctx) {
    const hit = filterCache.get(tid);
    if (hit && Date.now() - hit.at < FILTER_TTL_MS) return hit;
    const buckets = { area: new Map(), by: new Map(), genre: new Map(), lang: new Map(), year: new Map() };
    let doc;
    try {
      doc = await fetchDoc(`/vodtype/${encodeURIComponent(tid)}.html`, ctx, 1800);
    } catch (error) {
      if (error && error.code === 'CANCELLED') throw error;
      const empty = { at: Date.now(), filters: [], sorts: [] };
      return empty;
    }
    for (const anchor of doc.select('a')) {
      const slots = slotsOf(anchor.attr('href'), tid);
      if (!slots) continue;
      const label = trim(anchor.text());
      if (!label || label.length > 8) continue;
      for (const key of ['area', 'by', 'genre', 'lang', 'year']) {
        const idx = SLOT[key] - 1;
        const value = slots[idx];
        if (!value) continue;
        const others = slots.filter((v, i) => i !== idx && v);
        if (others.length) continue;
        if (!buckets[key].has(value)) buckets[key].set(value, label);
      }
    }
    const toOptions = key => Array.from(buckets[key], ([id, label]) => ({ id, label }));
    const filters = [];
    for (const [key, label] of [['area', '地区'], ['genre', '类型'], ['year', '年代'], ['lang', '语言']]) {
      const options = toOptions(key);
      if (options.length > 1) filters.push({ id: key, label, options });
    }
    const sorts = toOptions('by');
    const data = { at: Date.now(), filters, sorts };
    filterCache.set(tid, data);
    return data;
  }

  function parsePlayerData(html) {
    const anchor = html.indexOf('player_data');
    if (anchor < 0) return null;
    const start = html.indexOf('{', anchor);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i += 1) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  // encrypt: 0 明文 / 1 URL 编码 / 2 Base64(URL 编码)。本站目前全是 2。
  function playbackUrl(player) {
    let raw = norm(player && player.url).replace(/\\\//g, '/').trim();
    if (!raw) return '';
    const enc = Number(player && player.encrypt);
    if (enc === 2) {
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      try {
        raw = hg.codec.utf8Decode(hg.codec.base64Decode(b64));
      } catch {
        return '';
      }
      raw = safeDecode(raw);
    } else if (enc === 1) {
      raw = safeDecode(raw);
    }
    return raw.trim();
  }

  async function resolveStream(url, ctx) {
    const res = await hg.http.fetch({
      url,
      responseType: 'text',
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: `${SITE}/` },
      timeoutMs: 12000,
      maxBytes: 2 * 1024 * 1024,
      retry: 1,
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('CONTENT_LOCKED', `取流失败（${res.status}）`);
    const text = norm(res.data);
    const finalUrl = res.url || url;
    if (!/#EXTM3U/i.test(text)) {
      if (/\.mp4(\?|$)/i.test(url)) {
        return { streams: [{ url: finalUrl, kind: 'media', format: 'progressive', headers: { Referer: `${SITE}/` } }] };
      }
      throw new hg.PluginError('UPSTREAM_CHANGED', '取回的播放清单不是 HLS');
    }
    let target = finalUrl;
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const base = finalUrl.replace(/[?#].*$/, '');
      const variant = text
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !line.startsWith('#'));
      const resolved = variant ? absoluteUrl(variant, base) : '';
      if (resolved) target = resolved;
    }
    return {
      streams: [{ url: target, kind: 'media', format: 'hls', headers: { Referer: `${SITE}/` } }],
    };
  }

  async function catalogList(params, ctx) {
    const tid = trim(params && params.categoryId);
    if (!CAT_TYPE.has(tid)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
    const page = pageNo(params && params.cursor);
    const filters = (params && params.filters) || {};
    const pick = key => {
      const value = filters[key];
      const first = Array.isArray(value) ? value[0] : value;
      return trim(first);
    };
    const opts = {
      area: pick('area'),
      genre: pick('genre'),
      lang: pick('lang'),
      year: pick('year'),
      by: trim(params && params.sort),
      page,
    };
    const doc = await fetchDoc(showPath(tid, opts), ctx, 120);
    const items = cardsOf(doc, CAT_TYPE.get(tid));
    const out = { items };
    if (items.length) {
      const nextPath = showPath(tid, { ...opts, page: page + 1 });
      const hasNext = doc
        .select('a')
        .some(a => norm(a.attr('href')).split('?')[0] === nextPath) || items.length >= PAGE_SIZE;
      if (hasNext) out.next = String(page + 1);
    }
    return out;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        for (const panel of doc.select('div.myui-panel')) {
          const list = panel.first('ul.myui-vodlist');
          if (!list) continue;
          const head = panel.first('h3.title');
          const title = trim(head && head.text()) || `分区 ${sections.length + 1}`;
          const moreHref = norm((panel.select('a.more')[0] || { attr: () => '' }).attr('href'));
          const tidMatch = moreHref.match(/\/vodtype\/(\d+)\.html/);
          const tid = tidMatch ? tidMatch[1] : '';
          const items = cardsOf(list, tid ? CAT_TYPE.get(tid) || 'other' : 'other');
          if (!items.length) continue;
          const section = {
            id: tid ? `cat:${tid}` : `hot:${sections.length}`,
            title,
            layout: sections.length === 0 ? 'row' : 'grid',
            items,
          };
          if (tid) section.more = true;
          sections.push(section);
          if (sections.length >= 8) break;
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },

      async listSection(params, ctx) {
        const id = trim(params && params.sectionId);
        const m = id.match(/^cat:(\d+)$/);
        if (!m) return { items: [], next: null };
        return catalogList({ categoryId: m[1], cursor: params && params.cursor }, ctx);
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map(c => ({ id: c.id, label: c.label }));
      },

      async getFilters(params, ctx) {
        const tid = trim(params && params.categoryId) || '2';
        if (!CAT_TYPE.has(tid)) return { filters: [], sorts: [] };
        const data = await filterData(tid, ctx);
        return { filters: data.filters, sorts: data.sorts };
      },

      async list(params, ctx) {
        return catalogList(params, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params && params.cursor);
        const path = `/vodsearch/-------------.html?wd=${encodeURIComponent(query)}`;
        const doc = await fetchDoc(path, ctx, 60);
        const items = cardsOf(doc);
        const out = { items };
        if (page === 1 && items.length >= PAGE_SIZE) out.next = '2';
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/voddetail/${id}.html`, ctx, 300);

        const head = doc.first('h1.title') || doc.first('h1');
        let title = trim(head && head.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'series', playlists: [] };

        const poster = doc.first('.myui-content__thumb a') || doc.first('.myui-content__thumb img');
        const cover = poster ? pickCover(poster, poster.first('img') || poster) : '';
        if (cover) detail.cover = cover;

        const infoText = doc
          .select('p.data')
          .map(p => trim(p.text()))
          .join(' ');
        const catLabel = (infoText.match(/分类：([^地]*?)地区：/) || [])[1] || '';
        const year = (infoText.match(/年份：(\d{4})/) || [])[1] || '';
        const area = (infoText.match(/地区：([^年]*?)年份：/) || [])[1] || '';
        const actor = (infoText.match(/主演：(.+?)(?:导演：|$)/) || [])[1] || '';
        const director = (infoText.match(/导演：(.+?)(?:简介：|$)/) || [])[1] || '';
        const updated = (infoText.match(/更新：(\d{4}-\d{2}-\d{2}[^ ]*(?: \d{2}:\d{2}:\d{2})?)/) || [])[1] || '';

        const descBox = doc.first('#desc .content');
        let description = trim(descBox && descBox.text()).replace(/详情$/,'');
        if (!description) {
          const meta = doc.first('meta[name="description"]');
          description = trim(meta && meta.attr('content'));
        }
        if (description) detail.description = description.slice(0, 5000);

        const splitNames = value =>
          norm(value)
            .split(/[,，/、]/)
            .map(s => s.trim().slice(0, 30))
            .filter(Boolean);

        const tags = [];
        if (catLabel) tags.push(...splitNames(catLabel));
        if (year) tags.push(year);
        if (area) tags.push(area);
        if (tags.length) detail.tags = Array.from(new Set(tags)).slice(0, 20);
        if (year) detail.year = Number(year) || undefined;

        // MediaDetail 只认 people，演员/导演统一按角色塞进去。
        const people = [];
        for (const name of splitNames(director)) people.push({ name, role: '导演' });
        for (const name of splitNames(actor)) people.push({ name, role: '演员' });
        if (people.length) detail.people = people.slice(0, 30);

        const updatedMs = toMs(updated);
        if (updatedMs !== undefined) detail.updatedAt = updatedMs;

        // 面包屑里的频道 ID 最准，比详情页的分类字段可靠。
        const crumbTid = (norm((doc.select('#content-container a[href*="/vodtype/"]')[0] || { attr: () => '' }).attr('href')).match(/\/vodtype\/(\d+)\.html/) || [])[1] || '';

        detail.playlists = episodesOf(doc);
        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        detail.type = (crumbTid && CAT_TYPE.get(crumbTid)) || mediaTypeOf(catLabel, count);
        if (count === 1 && (catLabel === '' || !/综艺|动漫/.test(catLabel))) detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params && params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
        const sid = m[1];
        const ep = m[2];

        const html = await fetchText(`/vodplay/${id}-${sid}-${ep}.html`, ctx, 0);
        const player = parsePlayerData(html);
        if (!player) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页结构已变化');

        const note = trim(player.note);
        if (note && /VIP|会员|订阅|付费/.test(note)) throw new hg.PluginError('CONTENT_LOCKED', note);

        const url = playbackUrl(player);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这条线路没给出可播放地址');
        if (!/^https?:\/\//i.test(url)) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路要专用播放器解析');
        }
        return resolveStream(url, ctx);
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
