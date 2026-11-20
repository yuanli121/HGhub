export const meta = {
  id: 'huangguo',
  name: '黄果短剧',
  version: '1.0.3',
  protocol: 1,
  description: '黄果短剧站点源：首页、分类、搜索、详情、HLS 播放与图文。封面走站点公开的 AES-CBC 图片协议。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['huangguoai.com', 'www.huangguoai.com', 'huangguoai.ai'],
  defaultHeaders: {
    Referer: 'https://huangguoai.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
  settings: [
    { key: 'preferHevc', type: 'switch', label: '优先 HEVC 线路', default: false },
  ],
};

const FALLBACK_ORIGIN = 'https://huangguoai.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const COVER_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const COVER_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';
const IMG_HOSTS = {
  'pic.drleao.cn': true,
  'pic.eanfog.cn': true,
  'pic.zdmhyg.cn': true,
  'pic.tuafjz.cn': true,
  'pic.qnlycc.cn': true,
};
const STATIC_CATES = [
  { id: '24', label: 'AI短剧', route: 'ai-duanju' },
  { id: '25', label: 'AI漫剧', route: 'ai-manju' },
  { id: '26', label: 'AI换脸', route: 'ai-huanlian' },
  { id: '27', label: 'AI魔改', route: 'ai-mogai' },
];
const RANK_CATES = [
  { id: 'rank:hot', label: '热播榜', rank: 'hot' },
  { id: 'rank:recommend', label: '推荐榜', rank: 'recommend' },
  { id: 'rank:potential', label: '潜力榜', rank: 'potential' },
];
const SORTS = [
  { id: 'latest', label: '最新更新' },
  { id: 'hot', label: '当前热播' },
  { id: 'original', label: '独家原创' },
  { id: 'random', label: '随机推荐' },
];

export default function (hg) {
  const preferHevc = hg.settings.get('preferHevc') === true;
  let cateCache = null;

  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return FALLBACK_ORIGIN;
  }

  function headers() {
    const o = origin();
    return {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: o + '/',
      Origin: o,
    };
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function asData(res, label) {
    if (!res.ok) fail('UPSTREAM_ERROR', label + '暂时不可用（HTTP ' + res.status + '）');
    const body = res.data;
    if (!body || typeof body !== 'object') fail('UPSTREAM_CHANGED', label + '返回结构已变化');
    if (body.status === 0) fail('UPSTREAM_ERROR', body.msg || label + '失败');
    if (body.data !== undefined) return body.data;
    return body;
  }

  async function getJson(path, query, ctx, label) {
    const res = await hg.http.fetch({
      url: origin() + path,
      query,
      headers: headers(),
      responseType: 'json',
      timeoutMs: 15000,
      retry: 1,
      signal: ctx && ctx.signal,
    });
    return asData(res, label || path);
  }

  async function postJson(path, json, ctx, label) {
    const res = await hg.http.fetch({
      url: origin() + path,
      method: 'POST',
      headers: headers(),
      body: { json: json || {} },
      responseType: 'json',
      timeoutMs: 20000,
      signal: ctx && ctx.signal,
    });
    return asData(res, label || path);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function nextCursor(pagination, page, itemCount) {
    if (pagination && typeof pagination === 'object') {
      const pages = Number(pagination.pages) || 0;
      const total = Number(pagination.total) || 0;
      const size = Number(pagination.size) || itemCount || 20;
      if (pages > 0) return page < pages ? String(page + 1) : null;
      if (total > 0) return page * size < total ? String(page + 1) : null;
    }
    if (itemCount >= 20) return String(page + 1);
    return null;
  }

  function parseTime(value) {
    if (value == null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1e12 ? value : Math.floor(value * 1000);
    }
    const s = String(value).trim().replace(' ', 'T');
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : undefined;
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  function coverRef(url) {
    if (!url) return undefined;
    const href = String(url);
    let host = '';
    try { host = new URL(href).hostname; } catch (_) { return href; }
    // 封面域名会换（pic.drleao.cn → … → pic.qnlycc.cn，2026-11），不再只认域名：
    // 旧域名名单 或 路径含 /upload_01/ 等站点加密图目录 都按 AES-CBC 解密
    let path = '';
    try { path = new URL(href).pathname; } catch (_) {}
    if (!IMG_HOSTS[host] && !/\/(upload_01|upload|uploads|xiao|hc237|upload-images)\//.test(path)) return href;
    return {
      url: href,
      transform: { type: 'aes-cbc', key: COVER_KEY_B64, iv: COVER_IV_B64, padding: 'none' },
    };
  }

  function escapeAttr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
  }
  // 正文图片：src 常是占位图、真图在 data-src；加密目录的图交给宿主解密（需要宿主的 article.image）
  function richContent(html) {
    if (typeof html !== 'string') return html;
    const richImages = !!(hg.env && Array.isArray(hg.env.features) && hg.env.features.indexOf('article.image') >= 0);
    return html.replace(/<img\b[^>]*>/gi, function (tag) {
      const pick = function (name) {
        const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i'));
        return m ? m[1] : '';
      };
      const src = pick('data-src') || pick('data-original') || pick('src');
      if (!src || /placeholder|poster_loading|zw\.png/i.test(src)) return '';
      const alt = escapeAttr(pick('alt'));
      const ref = coverRef(src);
      const base = '<img src="' + escapeAttr(src) + '" alt="' + alt + '"';
      // 旧宿主没有 article.image：加密图解不了，宁可不显示也不留破图
      if (typeof ref !== 'string') return richImages ? base + " data-hpp='" + escapeAttr(JSON.stringify({ transform: ref.transform })) + "'>" : '';
      return base + '>';
    });
  }

  function tagList(tags) {
    if (!Array.isArray(tags)) return undefined;
    const out = [];
    for (let i = 0; i < tags.length && out.length < 20; i++) {
      const t = tags[i];
      const name = typeof t === 'string' ? t : (t && t.name);
      if (name) out.push(String(name));
    }
    return out.length ? out : undefined;
  }

  function authorOf(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const id = raw.id != null ? String(raw.id) : '';
    const name = raw.name ? String(raw.name) : '';
    if (!id && !name) return undefined;
    const a = { id: id || name, name: name || id };
    const avatar = coverRef(raw.avatar);
    if (avatar) a.avatar = avatar;
    if (num(raw.followers) != null) a.followers = num(raw.followers);
    return a;
  }

  function videoItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id != null ? String(raw.id) : (raw.video_id != null ? String(raw.video_id) : '');
    if (!id) return null;
    const title = String(raw.title || '').trim();
    if (!title) return null;
    const episodeCount = num(raw.episode_count);
    const totalEpisodes = num(raw.total_episodes);
    const item = {
      id,
      title,
      type: 'short',
      entryEpisodeId: '1',
    };
    const cover = coverRef(raw.cover);
    if (cover) item.cover = cover;
    const desc = raw.description || raw.synopsis;
    if (desc) item.description = String(desc);
    const tags = tagList(raw.tags);
    if (tags) item.tags = tags;
    const score = num(raw.score);
    if (score != null) item.score = score;
    const publishedAt = parseTime(raw.created_at);
    if (publishedAt != null) {
      item.publishedAt = publishedAt;
      item.year = new Date(publishedAt).getFullYear();
    }
    if (raw.is_finished === true) item.status = 'finished';
    else if (raw.is_finished === false) item.status = 'ongoing';
    if (episodeCount != null) item.episodeCount = episodeCount;
    if (totalEpisodes != null && totalEpisodes > 0) item.totalEpisodes = totalEpisodes;
    const durationSec = num(raw.duration);
    if (durationSec != null) item.durationSec = durationSec;
    const likes = num(raw.like_count) || num(raw.metrics && raw.metrics.like);
    const favorites = num(raw.collect_count) || num(raw.metrics && raw.metrics.collect);
    const comments = num(raw.comment_count) || num(raw.metrics && raw.metrics.comment);
    const plays = num(raw.hot) || num(raw.metrics && raw.metrics.play);
    const stats = {};
    if (plays != null) stats.plays = plays;
    if (plays != null) stats.hot = plays;
    if (likes != null) stats.likes = likes;
    if (favorites != null) stats.favorites = favorites;
    if (comments != null) stats.comments = comments;
    if (Object.keys(stats).length) item.stats = stats;
    const author = authorOf(raw.author);
    if (author) item.author = author;
    if (raw.is_original) item.badge = '原创';
    else if (raw.is_hot) item.badge = '热播';
    else if (raw.rank != null) item.badge = '#' + raw.rank;
    return item;
  }

  function itemsOf(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.videos)) return data.videos;
    return [];
  }

  function mapVideos(data) {
    const out = [];
    const seen = {};
    const rows = itemsOf(data);
    for (let i = 0; i < rows.length; i++) {
      const item = videoItem(rows[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
    }
    return out;
  }

  function pageResult(data, cursor) {
    const page = pageOf(cursor);
    const items = mapVideos(data);
    const pagination = data && data.pagination;
    return {
      items,
      next: nextCursor(pagination, page, items.length),
      total: pagination && num(pagination.total),
    };
  }

  async function loadCates(ctx) {
    if (cateCache) return cateCache;
    try {
      const data = await getJson('/api/site/categories/video', undefined, ctx, '分类');
      const rows = itemsOf(data);
      const cats = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.id == null) continue;
        cats.push({
          id: String(row.id),
          label: String(row.name || row.title || row.id),
          route: row.route ? String(row.route) : undefined,
        });
      }
      if (cats.length) {
        // 站点下线的栏目（如 AI魔改/AI换脸，页面 410「内容已下线」）仍出现在分类接口里：并行探测，去掉总数为 0 的
        const alive = await Promise.all(cats.map(async function (c) {
          try {
            const d = await getJson('/api/videos', { cate_id: c.id, page: 1 }, ctx, '分类探测');
            const pg = d && d.data && d.data.pagination;
            const rows = itemsOf(d);
            return (pg && pg.total > 0) || rows.length ? c : null;
          } catch (_) { return c; }   // 探测失败不误删
        }));
        const kept = alive.filter(Boolean);
        cateCache = kept.length ? kept : cats;
        return cateCache;
      }
    } catch (_) {}
    cateCache = STATIC_CATES.map(function (c) { return { id: c.id, label: c.label, route: c.route }; });
    return cateCache;
  }

  function routeOf(categoryId, cats) {
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].id === categoryId) return cats[i].route;
    }
    for (let j = 0; j < STATIC_CATES.length; j++) {
      if (STATIC_CATES[j].id === categoryId) return STATIC_CATES[j].route;
    }
    return undefined;
  }

  function episodesFrom(detail) {
    const raw = detail && Array.isArray(detail.episodes) ? detail.episodes : [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const ep = raw[i];
      if (!ep || typeof ep !== 'object') continue;
      const no = num(ep.ep_num);
      if (no == null || no <= 0) continue;
      const e = {
        id: String(no),
        index: no,
        episodeNumber: no,
        label: String(no),
      };
      if (ep.title) e.title = String(ep.title);
      const dur = num(ep.duration);
      if (dur != null) e.durationSec = dur;
      if (ep.status === 0) {
        e.locked = true;
        e.lockReason = '暂不可播';
      }
      out.push(e);
    }
    out.sort(function (a, b) { return a.index - b.index; });
    if (out.length) return out;
    const count = num(detail && detail.episode_count) || 1;
    const fallback = [];
    for (let n = 1; n <= count; n++) {
      fallback.push({ id: String(n), index: n, episodeNumber: n, label: String(n) });
    }
    return fallback;
  }

  function streamEntry(url, opts) {
    const s = {
      url,
      kind: 'media',
      format: 'hls',
      headers: {
        Referer: origin() + '/',
        'User-Agent': UA,
      },
    };
    if (opts.codec) s.codec = opts.codec;
    if (opts.label) s.label = opts.label;
    if (opts.cdnKey && opts.cdnValue) s.headers[opts.cdnKey] = opts.cdnValue;
    return s;
  }

  async function listVideos(query, cursor, ctx, label) {
    const page = pageOf(cursor);
    const q = Object.assign({ page: page }, query || {});
    const data = await getJson('/api/videos', q, ctx, label || '列表');
    return pageResult(data, cursor);
  }

  return {
    endpoints: {
      list() {
        return [
          { id: 'main', label: '主站', url: FALLBACK_ORIGIN },
        ];
      },
    },

    home: {
      async getSections(params, ctx) {
        const cats = await loadCates(ctx);
        const latest = await listVideos(undefined, '1', ctx, '首页');
        let hotItems = [];
        try {
          const ranks = await getJson('/api/ranks/hot', undefined, ctx, '热播榜');
          hotItems = mapVideos(ranks).slice(0, 20);
        } catch (_) {}
        const bannerItems = latest.items.slice(0, 6).map(function (it) {
          const copy = Object.assign({}, it);
          if (!copy.backdrop && copy.cover) copy.backdrop = copy.cover;
          return copy;
        });
        const sections = [];
        if (bannerItems.length) {
          sections.push({ id: 'banner', title: '精选', layout: 'banner', imageAspect: 'portrait', items: bannerItems });
        }
        if (hotItems.length) {
          sections.push({ id: 'rank-hot', title: '热播榜', layout: 'row', imageAspect: 'portrait', items: hotItems });
        }
        sections.push({
          id: 'latest',
          title: '全部短剧',
          layout: 'grid',
          imageAspect: 'portrait',
          items: latest.items,
          more: true,
        });
        for (let i = 0; i < cats.length; i++) {
          const cat = cats[i];
          try {
            const page = await listVideos({ cate_id: cat.id }, '1', ctx, cat.label);
            if (page.items.length) {
              sections.push({
                id: 'cate-' + cat.id,
                title: cat.label,
                layout: 'row',
                imageAspect: 'portrait',
                items: page.items,
                more: true,
              });
            }
          } catch (_) {}
        }
        return { items: sections, next: null };
      },

      async listSection(params, ctx) {
        const id = String(params.sectionId || '');
        if (id === 'latest') return listVideos(undefined, params.cursor, ctx, '全部短剧');
        if (id.indexOf('cate-') === 0) {
          return listVideos({ cate_id: id.slice(5) }, params.cursor, ctx, '分类');
        }
        if (id.indexOf('rank-') === 0) {
          const type = id.slice(5) || 'hot';
          const data = await getJson('/api/ranks/' + type, undefined, ctx, '榜单');
          return { items: mapVideos(data), next: null };
        }
        return { items: [], next: null };
      },
    },

    feed: {
      async list(params, ctx) {
        return listVideos(undefined, params.cursor, ctx, '信息流');
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const cats = await loadCates(ctx);
        const tree = [{ id: 'all', label: '全部' }];
        for (let i = 0; i < cats.length; i++) {
          tree.push({
            id: cats[i].id,
            label: cats[i].label,
            sorts: SORTS,
          });
        }
        tree.push({
          id: 'ranks',
          label: '排行榜',
          children: RANK_CATES.map(function (c) { return { id: c.id, label: c.label }; }),
        });
        return tree;
      },

      getFilters(params) {
        const id = String(params.categoryId || '');
        if (id === 'all' || /^\d+$/.test(id)) return { sorts: SORTS };
        return {};
      },

      async list(params, ctx) {
        const id = String(params.categoryId || 'all');
        const sort = params.sort || 'latest';
        if (id === 'ranks' || id.indexOf('rank:') === 0) {
          const type = id === 'ranks' ? 'hot' : id.slice(5);
          const data = await getJson('/api/ranks/' + (type || 'hot'), undefined, ctx, '榜单');
          return { items: mapVideos(data), next: null };
        }
        if (id === 'all' && (!sort || sort === 'latest')) {
          return listVideos(undefined, params.cursor, ctx, '全部');
        }
        const cats = await loadCates(ctx);
        const route = routeOf(id, cats);
        if (route && sort && sort !== 'latest') {
          const page = pageOf(params.cursor);
          const data = await getJson(
            '/api/videos/category/' + route,
            { page, size: 20, sort },
            ctx,
            '分类',
          );
          return pageResult(data, params.cursor);
        }
        const query = {};
        if (id !== 'all') query.cate_id = id;
        return listVideos(query, params.cursor, ctx, '分类');
      },
    },

    search: {
      async search(params, ctx) {
        const query = String(params.query || '').trim();
        if (!query) return { items: [], next: null };
        const page = pageOf(params.cursor);
        const data = await getJson('/api/search', { q: query, page, size: 20 }, ctx, '搜索');
        return pageResult(data, params.cursor);
      },

      async trending(params, ctx) {
        try {
          const data = await getJson('/api/search/hot', undefined, ctx, '热搜');
          const rows = itemsOf(data);
          const words = [];
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const word = typeof row === 'string' ? row : (row && (row.word || row.name || row.keyword || row.tag));
            if (word) words.push(String(word));
          }
          return words;
        } catch (_) {
          return [];
        }
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String(params.id || '').trim();
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const data = await getJson('/api/videos/' + encodeURIComponent(id), undefined, ctx, '详情');
        if (!data || typeof data !== 'object') fail('UPSTREAM_CHANGED', '详情结构已变化');
        const item = videoItem(Object.assign({ id }, data));
        if (!item) fail('NOT_FOUND', '内容不存在');
        const counts = data.counts && typeof data.counts === 'object' ? data.counts : null;
        if (counts) {
          item.stats = item.stats || {};
          if (num(counts.like) != null) item.stats.likes = num(counts.like);
          if (num(counts.collect) != null) item.stats.favorites = num(counts.collect);
          if (num(counts.comment) != null) item.stats.comments = num(counts.comment);
          if (num(counts.hot) != null) {
            item.stats.hot = num(counts.hot);
            item.stats.plays = num(counts.hot);
          }
        }
        const interaction = data.interaction;
        if (interaction && typeof interaction === 'object') {
          item.interaction = {
            liked: !!interaction.liked,
            favorited: !!interaction.collected,
          };
        }
        const people = [];
        if (Array.isArray(data.actors)) {
          for (let i = 0; i < data.actors.length; i++) {
            const a = data.actors[i];
            const name = typeof a === 'string' ? a : (a && a.name);
            if (name) people.push({ name: String(name), role: '演员' });
          }
        }
        const eps = episodesFrom(data);
        const detail = Object.assign({}, item, {
          playlists: [{ id: 'main', label: '正片', kind: 'main', episodes: eps }],
        });
        if (people.length) detail.people = people;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const mediaId = String(params.mediaId || '').trim();
        const episodeId = String(params.episodeId || '1').trim();
        if (!mediaId) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const ep = parseInt(episodeId, 10);
        if (!Number.isFinite(ep) || ep <= 0) fail('INVALID_ARGUMENT', '分集无效');
        const data = await postJson(
          '/api/videos/' + encodeURIComponent(mediaId) + '/episodes/' + ep + '/playback',
          {},
          ctx,
          '播放',
        );
        const streamsRaw = data && data.streams;
        if (!streamsRaw || typeof streamsRaw !== 'object') fail('UPSTREAM_CHANGED', '播放结构已变化');
        const cdn = data.cdn && typeof data.cdn === 'object' ? data.cdn : {};
        const cdnKey = cdn.authKey ? String(cdn.authKey) : '';
        const cdnValue = cdn.authValue ? String(cdn.authValue) : '';
        const codecs = Array.isArray(params.codecs) ? params.codecs : [];
        const wantHevc = preferHevc || codecs[0] === 'hevc';
        const order = wantHevc ? ['hevc', 'main', 'preview'] : ['main', 'hevc', 'preview'];
        const seen = {};
        const streams = [];
        for (let i = 0; i < order.length; i++) {
          const key = order[i];
          const url = streamsRaw[key];
          if (typeof url !== 'string' || !url || seen[url]) continue;
          seen[url] = true;
          streams.push(streamEntry(url, {
            codec: key === 'hevc' ? 'hevc' : 'h264',
            label: key === 'hevc' ? 'HEVC' : (key === 'preview' ? '预览' : '主线'),
            cdnKey,
            cdnValue,
          }));
        }
        if (!streams.length) fail('CONTENT_LOCKED', '未拿到播放地址');
        return {
          streams,
          expiresAt: Date.now() + 8 * 60 * 1000,
        };
      },

      matchUrl(params) {
        const raw = String(params.url || '');
        let u;
        try { u = new URL(raw); } catch (_) { return null; }
        const host = u.hostname.replace(/^www\./, '');
        if (host !== 'huangguoai.com' && host !== 'huangguoai.ai') return null;
        const path = u.pathname;
        let m = path.match(/\/(?:detail|video|play)\/(\d+)/);
        if (!m) m = path.match(/\/(\d+)\/?$/);
        const id = (m && m[1]) || u.searchParams.get('v') || u.searchParams.get('id');
        if (!id) return null;
        const ep = u.searchParams.get('ep') || (path.match(/ep-(\d+)/) || [])[1];
        const out = { mediaId: String(id) };
        if (ep) out.episodeId = String(ep);
        return out;
      },
    },

    articles: {
      async list(params, ctx) {
        const page = pageOf(params.cursor);
        const data = await getJson('/api/posts', { page, size: 20 }, ctx, '图文');
        const rows = itemsOf(data);
        const items = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.id == null) continue;
          const it = {
            id: String(row.id),
            title: String(row.title || row.content || '帖子'),
          };
          const cover = coverRef(row.cover);
          if (cover) it.cover = cover;
          const summary = row.content || row.text || row.description || row.desc;
          if (summary) it.summary = String(summary).slice(0, 500);
          const tags = tagList(row.tags);
          if (tags) it.tags = tags;
          const author = authorOf(row.author) || (row.author_name ? { id: String(row.author_name), name: String(row.author_name) } : undefined);
          if (author) it.author = author;
          const publishedAt = parseTime(row.created_at || row.published_at);
          if (publishedAt != null) it.publishedAt = publishedAt;
          const likes = num(row.like_count);
          const comments = num(row.comment_count);
          if (likes != null || comments != null) {
            it.stats = {};
            if (likes != null) it.stats.likes = likes;
            if (comments != null) it.stats.comments = comments;
          }
          if (row.video_id != null) it.mediaId = String(row.video_id);
          items.push(it);
        }
        return {
          items,
          next: nextCursor(data && data.pagination, page, items.length),
          total: data && data.pagination && num(data.pagination.total),
        };
      },

      async getDetail(params, ctx) {
        const id = String(params.id || '').trim();
        if (!id) fail('INVALID_ARGUMENT', '缺少图文 ID');
        const data = await getJson('/api/posts/' + encodeURIComponent(id), undefined, ctx, '图文详情');
        if (!data || typeof data !== 'object') fail('NOT_FOUND', '图文不存在');
        const title = String(data.title || '帖子');
        const detail = { id, title };
        const cover = coverRef(data.cover);
        if (cover) detail.cover = cover;
        const html = data.content_html || data.content || data.html;
        const text = data.content_text || data.desc || data.text || data.content;
        if (typeof html === 'string' && /<[a-z][\s\S]*>/i.test(html)) detail.contentHtml = richContent(html);
        else if (text) detail.contentText = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const tags = tagList(data.tags);
        if (tags) detail.tags = tags;
        const author = authorOf(data.author);
        if (author) detail.author = author;
        const publishedAt = parseTime(data.created_at || data.published_at);
        if (publishedAt != null) detail.publishedAt = publishedAt;
        if (data.video_id != null) detail.mediaId = String(data.video_id);
        try {
          const play = await postJson('/api/posts/' + encodeURIComponent(id) + '/playback', {}, ctx, '图文播放');
          const videos = play && Array.isArray(play.videos) ? play.videos : [];
          const streams = [];
          for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            const url = typeof v === 'string' ? v : (v && v.url);
            if (typeof url !== 'string' || !url) continue;
            const isMp4 = /\.mp4(\?|$)/i.test(url);
            streams.push({
              url,
              kind: 'media',
              format: isMp4 ? 'progressive' : 'hls',
              label: '第' + (i + 1) + '段',
              headers: { Referer: origin() + '/', 'User-Agent': UA },
            });
          }
          if (streams.length) detail.streams = streams;
        } catch (_) {}
        return detail;
      },
    },

    comments: {
      async list(params, ctx) {
        const target = params.target || {};
        if (target.kind === 'replies') fail('UNSUPPORTED', '暂不支持评论回复列表');
        if (target.kind !== 'media') fail('UNSUPPORTED', '仅支持作品评论');
        const mediaId = String(target.mediaId || '').trim();
        if (!mediaId) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const page = pageOf(params.cursor);
        const query = { page };
        if (target.episodeId) query.ep = target.episodeId;
        const data = await getJson(
          '/api/videos/' + encodeURIComponent(mediaId) + '/comments',
          query,
          ctx,
          '评论',
        );
        const rows = itemsOf(data);
        const items = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.id == null) continue;
          const c = {
            id: String(row.id),
            author: {
              id: row.user_id != null ? String(row.user_id) : undefined,
              name: String(row.nickname || row.author || '用户'),
            },
            text: String(row.text || row.content || ''),
          };
          const avatar = coverRef(row.avatar);
          if (avatar) c.author.avatar = avatar;
          const createdAt = parseTime(row.created_at);
          if (createdAt != null) c.createdAt = createdAt;
          if (num(row.like_count) != null) c.likes = num(row.like_count);
          if (row.liked != null) c.liked = !!row.liked;
          if (num(row.reply_count) != null) c.replyCount = num(row.reply_count);
          if (row.is_pinned) c.pinned = true;
          if (row.ip_region) c.region = String(row.ip_region);
          if (Array.isArray(row.reply_list) && row.reply_list.length) {
            c.replies = row.reply_list.slice(0, 5).map(function (r) {
              return {
                id: String(r.id),
                author: { name: String(r.nickname || '用户') },
                text: String(r.text || r.content || ''),
              };
            });
          }
          items.push(c);
        }
        return {
          items,
          next: nextCursor(data && data.pagination, page, items.length),
        };
      },

      async send(params, ctx) {
        const target = params.target || {};
        if (target.kind !== 'media') fail('UNSUPPORTED', '仅支持作品评论');
        const mediaId = String(target.mediaId || '').trim();
        const text = String(params.text || '').trim();
        if (!mediaId || !text) fail('INVALID_ARGUMENT', '评论内容为空');
        try {
          const data = await postJson(
            '/api/videos/' + encodeURIComponent(mediaId) + '/comments',
            { content: text },
            ctx,
            '发表评论',
          );
          if (data && data.id != null) {
            return {
              id: String(data.id),
              author: { name: String(data.nickname || '我') },
              text: String(data.text || data.content || text),
            };
          }
        } catch (err) {
          if (err && (err.code === 'UPSTREAM_ERROR' || err.code === 'AUTH_REQUIRED')) {
            fail('AUTH_REQUIRED', '发表评论需要登录上游账号');
          }
          throw err;
        }
      },
    },
  };
}
