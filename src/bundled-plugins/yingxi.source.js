export const meta = {
  id: 'yingxi.source',
  name: '影夕视频',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '影夕视频（yingxivod.com）：首页最近更新与四个频道、分类分页（地区/首字母/排序）、搜索、详情与直连播放；电视直播频道不暴露。播放页 player_aaaa 明文给出地址，站内 m3u8proxy 的真实地址自行还原；CDN 见到 Referer 就 403，所以默认头里刻意不带 Referer。',
  mature: false,
  linkDomains: ['yingxivod.com', 'www.yingxivod.com'],
  // 关键：绝不在这里放 Referer。cf*.yfvodcdn.com 与 cf*.magicvodcdn.com
  // 只要收到 Referer（哪怕是本站的）就回 403，只有完全不带才放行。
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://yingxivod.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE_SIZE = 60;

const SORTS = [
  { id: 'time', label: '最新' },
  { id: 'hits', label: '最热' },
  { id: 'score', label: '评分' },
];

const CATS = [
  {
    id: '1',
    label: '电影',
    type: 'movie',
    children: [
      { id: '6', label: '动作片' },
      { id: '7', label: '喜剧片' },
      { id: '8', label: '爱情片' },
      { id: '9', label: '科幻片' },
      { id: '10', label: '恐怖片' },
      { id: '11', label: '剧情片' },
      { id: '12', label: '战争片' },
    ],
  },
  {
    id: '2',
    label: '电视剧',
    type: 'series',
    children: [
      { id: '13', label: '国产剧' },
      { id: '14', label: '港台剧' },
      { id: '15', label: '日韩剧' },
      { id: '16', label: '欧美剧' },
      { id: '20', label: '海外剧' },
    ],
  },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动画片', type: 'anime' },
  { id: '19', label: '纪录片', type: 'documentary' },
];

const CAT_TYPE = new Map();
const CAT_LABEL = new Map();
for (const cat of CATS) {
  CAT_TYPE.set(cat.id, cat.type);
  CAT_LABEL.set(cat.id, cat.label);
  for (const child of cat.children || []) {
    CAT_TYPE.set(child.id, cat.type);
    CAT_LABEL.set(child.id, child.label);
  }
}

const DETAIL_RE = /^https?:\/\/(?:www\.)?yingxivod\.com\/vod\/detail\/id\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?yingxivod\.com\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/i;
const HREF_DETAIL_RE = /\/vod\/detail\/id\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;
const PLACEHOLDER_RE = /(?:^|\/)(?:load(?:ing)?|blank|placeholder|spacer|lazy)[^/]*\.(?:gif|png|jpe?g|webp)$/i;

const AREAS = ['内地', '台湾', '香港', '日本', '韩国', '泰国', '欧美'];
const LETTERS = '0-9 A B C D E F G H I J K L M N O P Q R S T U V W X Y Z'.split(' ');

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function mediaTypeOf(label, episodeCount) {
  const text = norm(label);
  if (/动画|动漫/.test(text)) return 'anime';
  if (/综艺/.test(text)) return 'variety';
  if (/纪录/.test(text)) return 'documentary';
  if (/短剧|微短剧/.test(text)) return 'short';
  if (/电影|片$/.test(text)) return 'movie';
  if (/剧/.test(text)) return 'series';
  return episodeCount > 1 ? 'series' : 'movie';
}

// 站点时间一律北京时间，转 Unix 毫秒；算出来落在未来就当作没有。
function toMs(text) {
  const m = norm(text).match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0) - 8, Number(m[5] || 0), Number(m[6] || 0));
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  if (ms > Date.now() + 3600 * 1000) return undefined;
  return Math.round(ms);
}

export default function (hg) {
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
    return /^https?:\/\//i.test(url) ? url : '';
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

  function shortBadge(text) {
    const t = trim(text);
    if (!t) return '';
    if (/^(?:更新至|更至|全)\s*\d+\s*集$/.test(t)) return t.length <= 8 ? t : '';
    const ep = t.match(/^(?:更新至|更至|全)\s*(\d+)\s*集$/);
    if (ep) return `更至${ep[1]}集`.slice(0, 8);
    return t.length <= 8 ? t : '';
  }

  // 卡片里封面 <a> 没有 title，标题在同级 .vodlist_title 里；也有的页面标题就是 <a> 的文本。
  // 所以先按 li.vodlist_item 整卡解析，拿不到再退回逐 <a> 扫。
  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();

    const build = (anchor, holder) => {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) return null;
      const img = (holder || anchor).first('img');
      const titleNode = holder && (holder.first('.vodlist_title') || holder.first('.detail .name'));
      const title =
        trim(anchor.attr('title')) ||
        trim(titleNode && titleNode.text()) ||
        trim(anchor.text()) ||
        trim(img && (img.attr('alt') || img.attr('title')));
      if (!title) return null;
      seen.add(m[1]);
      const item = { id: m[1], title: title.slice(0, 200), type: fallbackType || 'other' };
      const cover = pickCover(anchor, img);
      if (cover) item.cover = cover;
      const badgeNode = anchor.first('span.pic_text') || (holder && holder.first('span.pic_text'));
      const badge = shortBadge(badgeNode && badgeNode.text());
      if (badge) item.badge = badge;
      return item;
    };

    for (const holder of root.select('li.vodlist_item')) {
      const anchor = holder.select('a').find(a => HREF_DETAIL_RE.test(norm(a.attr('href'))));
      const item = anchor ? build(anchor, holder) : null;
      if (item) out.push(item);
    }
    if (out.length) return out;

    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const parent = anchor.parent();
      const grand = parent && parent.parent();
      const item = build(anchor, parent && parent.select('.vodlist_title').length ? parent : grand || parent);
      if (item) out.push(item);
    }
    return out;
  }

  function episodesOf(doc) {
    const groups = new Map();
    for (const pane of doc.select('[id^="playlist"], .playlistbox')) {
      for (const anchor of pane.select('a')) {
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
    }
    if (!groups.size) {
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
    }
    const out = [];
    for (const [sid, list] of groups) {
      list.sort((a, b) => a.nid - b.nid);
      out.push({
        id: sid,
        label: groups.size > 1 ? `线路 ${sid}` : '高清线路',
        kind: 'main',
        episodes: list.map((e, i) => ({
          id: `${sid}-${e.nid}`,
          index: i + 1,
          episodeNumber: e.nid,
          label: (e.label || `第${e.nid}集`).slice(0, 200),
        })),
      });
    }
    return out;
  }

  // 站点顺序固定：/vod/show[/area/A][/by/B]/id/T[/letter/L][/page/N].html
  function showPath(tid, opts) {
    const o = opts || {};
    const page = pageNo(o.page);
    const segs = ['/vod/show'];
    const area = trim(o.area);
    const by = trim(o.by);
    const letter = trim(o.letter);
    if (area) segs.push(`area/${encodeURIComponent(area)}`);
    if (by) segs.push(`by/${encodeURIComponent(by)}`);
    segs.push(`id/${encodeURIComponent(tid)}`);
    if (letter) segs.push(`letter/${encodeURIComponent(letter)}`);
    if (page > 1) segs.push(`page/${page}`);
    return `${segs.join('/')}.html`;
  }

  function nextPathOf(path, page) {
    const clean = path.replace(/\/page\/\d+\.html$/, '').replace(/\.html$/, '');
    return page > 1 ? `${clean}/page/${page}.html` : `${clean}.html`;
  }

  function hasNextPage(doc, path, page) {
    const target = nextPathOf(path, page + 1);
    return doc.select('a').some(a => norm(a.attr('href')) === target);
  }

  function parsePlayerData(html) {
    const anchor = html.indexOf('player_aaaa') >= 0 ? html.indexOf('player_aaaa') : html.indexOf('player_data');
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

  // 站内 m3u8proxy.php?u=<urlencoded 真实地址> 是给浏览器绕盗链用的；
  // 我们把真实地址还原出来直连，少一跳也少一个会挂的中转。
  function realStreamUrl(raw) {
    const url = norm(raw).replace(/\\\//g, '/').trim();
    if (!url) return '';
    const abs = /^https?:\/\//i.test(url) ? url : url.startsWith('//') ? `https:${url}` : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`;
    if (/m3u8proxy\.php/i.test(abs)) {
      try {
        const inner = new URL(abs).searchParams.get('u');
        if (inner && /^https?:\/\//i.test(inner)) return inner;
      } catch {
        // 落到原地址
      }
    }
    return abs;
  }

  function streamOf(url) {
    const clean = url.split('?')[0].toLowerCase();
    const isHls = clean.endsWith('.m3u8') || /m3u8proxy/i.test(url);
    const isMp4 = clean.endsWith('.mp4');
    const stream = { url, kind: 'media', format: isHls || !isMp4 ? 'hls' : 'progressive' };
    return stream;
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
    const opts = { page, area: pick('area'), letter: pick('letter'), by: trim(params && params.sort) };
    const path = showPath(tid, opts);
    const doc = await fetchDoc(path, ctx, 120);
    const items = cardsOf(doc, CAT_TYPE.get(tid));
    const out = { items };
    if (items.length >= PAGE_SIZE || hasNextPage(doc, path, page)) out.next = String(page + 1);
    return out;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seenTitles = new Set();

        // 频道标题里会拼上「最近更新 506」这类计数，去掉再显示。
        const cleanTitle = text =>
          trim(text)
            .replace(/\s*最近更新\s*\d+\s*$/, '')
            .replace(/\s*共\s*\d+\s*(?:部|集)\s*$/, '')
            .trim();

        const push = (title, anchors, layout, moreHref) => {
          const name = cleanTitle(title);
          if (!name || seenTitles.has(name)) return;
          const items = cardsOf(anchors, 'other');
          if (!items.length) return;
          seenTitles.add(name);
          const tidMatch = norm(moreHref).match(/\/vod\/show\/id\/(\d+)/);
          const tid = tidMatch && CAT_TYPE.has(tidMatch[1]) ? tidMatch[1] : '';
          const section = {
            id: tid ? `cat:${tid}` : `s${sections.length}`,
            title: name.slice(0, 200),
            layout,
            items,
          };
          if (tid) section.more = true;
          sections.push(section);
        };

        // 首页最上面是「最近更新」的 tab 组，第一个 tab 的内容就是最新入库。
        const firstTab = doc.select('#con_latest_1')[0] || doc.select('.latest-item')[0];
        if (firstTab) push('最近更新', firstTab, 'grid', '/vod/show/id/1.html');

        for (const panel of doc.select('.pannel')) {
          const list = panel.first('.vodlist') || panel.first('ul') || panel;
          const head = panel.first('.pannel_head .title') || panel.first('.pannel_head') || panel.first('.title');
          const moreLink = panel.select('a').find(a => /\/vod\/show\/id\/\d+/.test(norm(a.attr('href'))));
          const items = cardsOf(list, 'other');
          if (!items.length) continue;
          push(head && head.text(), list, 'grid', moreLink && moreLink.attr('href'));
          if (sections.length >= 6) break;
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
        return CATS.map(cat => ({
          id: cat.id,
          label: cat.label,
          ...(cat.children ? { children: cat.children.map(c => ({ id: c.id, label: c.label })) } : {}),
        }));
      },

      async getFilters(params) {
        const tid = trim(params && params.categoryId);
        if (!CAT_TYPE.has(tid)) return { filters: [], sorts: [] };
        return {
          filters: [
            { id: 'area', label: '地区', options: AREAS.map(a => ({ id: a, label: a })) },
            { id: 'letter', label: '首字母', options: LETTERS.map(l => ({ id: l, label: l })) },
          ],
          sorts: SORTS.map(s => ({ id: s.id, label: s.label })),
        };
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
        const kw = encodeURIComponent(query);
        const path = page > 1 ? `/vod/search/page/${page}/wd/${kw}.html` : `/vod/search.html?wd=${kw}`;
        const doc = await fetchDoc(path, ctx, 60);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= PAGE_SIZE || hasNextPage(doc, path, page)) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/vod/detail/id/${id}.html`, ctx, 300);

        const heads = doc.select('.pannel_head .title');
        const head = (heads.length && heads[0]) || doc.first('.hd_tit');
        let title = trim(head && head.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split('_')[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title: title.slice(0, 200), type: 'series', playlists: [] };

        const poster = doc.first('.vodlist_thumb') || doc.first('.content_thumb');
        const cover = poster ? pickCover(poster, poster.first('img') || poster) : '';
        if (cover) detail.cover = cover;

        const rows = doc.select('.content_detail li.data').map(li => trim(li.text()));
        const info = rows.join(' ');
        const year = (info.match(/年份：\s*(\d{4})/) || [])[1] || '';
        const area = (info.match(/地区：\s*(\S+)/) || [])[1] || '';
        const genre = (info.match(/类型：\s*(.+?)(?:\s*(?:状态|主演|导演|更新|$))/) || [])[1] || '';
        const status = (info.match(/状态：\s*(.+?)(?:\s*(?:主演|导演|更新|$))/) || [])[1] || '';
        const actor = (info.match(/主演：\s*(.+?)(?:\s*导演：|$)/) || [])[1] || '';
        const director = (info.match(/导演：\s*(.+?)$/) || [])[1] || '';

        const descNode = doc.first('.content_detail li.desc') || doc.first('li.desc') || doc.first('.content_detail .desc');
        let description = trim(descNode && descNode.text()).replace(/^简介：\s*/, '');
        if (!description) {
          const meta = doc.first('meta[name="description"]');
          description = trim(meta && meta.attr('content'));
        }
        if (description) detail.description = description.slice(0, 5000);

        const splitNames = value =>
          norm(value)
            .split(/[,，/、]/)
            .map(s => s.trim().slice(0, 30))
            .filter(s => s && s !== '未填写' && s !== '未知');

        const tags = [];
        for (const t of splitNames(genre)) tags.push(t);
        if (area && area !== '未填写') tags.push(area.slice(0, 30));
        if (year) tags.push(year);
        if (tags.length) detail.tags = Array.from(new Set(tags)).slice(0, 20);
        if (year) detail.year = Number(year) || undefined;

        const people = [];
        for (const name of splitNames(director)) people.push({ name, role: '导演' });
        for (const name of splitNames(actor)) people.push({ name, role: '演员' });
        if (people.length) detail.people = people.slice(0, 30);

        if (/已完结|完结|全\d+集/.test(status)) detail.status = 'finished';
        else if (/更新|连载/.test(status)) detail.status = 'ongoing';

        const updatedMs = toMs((info.match(/更新：\s*(\d{4}-\d{2}-\d{2}[^\s]*)/) || [])[1]);
        if (updatedMs !== undefined) detail.updatedAt = updatedMs;

        // 频道 ID 从面包屑里拿，导航链接会混进来，取最后一个命中的。
        const crumbTid = doc
          .select('a')
          .map(a => ({ href: norm(a.attr('href')), text: trim(a.text()) }))
          .filter(x => /\/vod\/type\/id\/(\d+)\.html/.test(x.href) && CAT_TYPE.has(x.href.match(/(\d+)\.html/)[1]))
          .map(x => ({ tid: x.href.match(/(\d+)\.html/)[1], text: x.text }))
          .pop();

        detail.playlists = episodesOf(doc);
        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        detail.type = (crumbTid && CAT_TYPE.get(crumbTid.tid)) || mediaTypeOf(genre, count);
        if (count === 1 && detail.type === 'series') detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params && params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const html = await fetchText(`/vod/play/id/${id}/sid/${m[1]}/nid/${m[2]}.html`, ctx, 0);
        const player = parsePlayerData(html);
        if (!player) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页结构已变化');

        const note = trim(player.note);
        if (note && /VIP|会员|订阅|付费|登录/.test(note)) throw new hg.PluginError('CONTENT_LOCKED', note);

        const raw = norm(player.url).trim();
        if (!raw) throw new hg.PluginError('CONTENT_LOCKED', '这条线路没给出可播放地址');

        const url = realStreamUrl(raw);
        if (!/^https?:\/\//i.test(url)) throw new hg.PluginError('CONTENT_LOCKED', '这条线路要专用播放器解析');
        return { streams: [streamOf(url)] };
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
