export const meta = {
  id: 'auete.source',
  name: 'Auete影视',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: 'Auete影视网（aeete.com）：首页五组热映/最新分区、五个频道与子频道分页、详情多线路；播放页把 m3u8 以 base64 内联，插件内解码。站内搜索需图形验证码，未提供搜索。',
  mature: false,
  linkDomains: ['www.aeete.com', 'aeete.com', 'vip.dytt-network.com', 'i1.vvmp4.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.aeete.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  { id: 'Movie', label: '电影', type: 'movie' },
  { id: 'Tv', label: '电视剧', type: 'series' },
  { id: 'Tv/neidi', label: '国产剧', type: 'series' },
  { id: 'Tv/hanju', label: '韩剧', type: 'series' },
  { id: 'Tv/riju', label: '日剧', type: 'series' },
  { id: 'Tv/oumei', label: '欧美剧', type: 'series' },
  { id: 'Dm', label: '动漫', type: 'anime' },
  { id: 'Zy', label: '综艺', type: 'variety' },
  { id: 'qita', label: '其他', type: 'other' },
];

// 详情 /Tv/neidi/wenchengchuanqi/、/Movie/aqp/slug/，播放 …/play-0-1.html
// mediaId 就存这条目录路径（去掉首尾斜杠），层级多少都能还原
const PATH_RE = /^\/((?:Movie|Tv|Dm|Zy|qita)(?:\/[a-z0-9_\-]+)+)\//i;
const HREF_EPISODE_RE = /\/play-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function mediaIdOf(href) {
  const raw = norm(href).split('?')[0].split('#')[0];
  const m = raw.match(PATH_RE);
  return m ? m[1] : '';
}

function pathOf(mediaId) {
  const id = norm(mediaId).replace(/^\/+|\/+$/g, '');
  if (!/^(Movie|Tv|Dm|Zy|qita)(\/[a-z0-9_\-]+)+$/i.test(id)) return null;
  return `/${id}/`;
}

function mediaTypeOf(catTop, label) {
  if (catTop === 'Movie') return 'movie';
  if (catTop === 'Dm') return 'anime';
  if (catTop === 'Zy') return 'variety';
  if (catTop === 'Tv') return 'series';
  const text = norm(label);
  if (/动漫/.test(text)) return 'anime';
  if (/综艺/.test(text)) return 'variety';
  if (/电影|片/.test(text)) return 'movie';
  return 'other';
}

export default hg => {
  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
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
    const doc = hg.html.parse(await fetchText(path, ctx, ttl));
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const item of root.select('li')) {
      const anchor = item.first('a');
      if (!anchor) continue;
      const href = norm(item.attr('data-href')) || norm(anchor.attr('href'));
      const mediaId = mediaIdOf(href);
      if (!mediaId || seen.has(mediaId)) continue;
      const img = item.first('img');
      const titleNode = item.select('a[title]').find(a => trim(a.attr('title')));
      const title = trim(titleNode && titleNode.attr('title')) || trim(img && img.attr('alt')) || trim(anchor.attr('title'));
      if (!title) continue;
      seen.add(mediaId);
      const out0 = { id: mediaId, title, type: mediaTypeOf(mediaId.split('/')[0], '') };
      const cover = coverOf(img && (img.attr('data-src') || img.attr('src')));
      if (cover) out0.cover = cover;
      const tag = item.first('span.hdtag');
      const tagText = trim(tag && tag.text());
      if (tagText && tagText.length <= 16) out0.badge = tagText;
      const rating = item.first('span.rating');
      const score = Number(trim(rating && rating.text()).replace(/[^\d.]/g, ''));
      if (Number.isFinite(score) && score > 0 && score <= 10) out0.score = score;
      out.push(out0);
    }
    return out;
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', headers: { 'User-Agent': UA }, signal: ctx.signal });
      if (!res.ok) res = await hg.http.fetch({ url, headers: { 'User-Agent': UA, Range: 'bytes=0-1' }, signal: ctx.signal });
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  function playlistsOf(doc) {
    const out = [];
    const seen = new Set();
    for (const list of doc.select('ul.episode-list')) {
      const card = list.parent();
      const head = (card && (card.first('div.card-header') || card.parent().first('div.card-header'))) || null;
      let label = trim(head && head.text());
      const lineMatch = label.match(/云播\s*([A-Za-z0-9]+)\s*线/);
      if (lineMatch) label = `云播${lineMatch[1]}线`;
      if (!label) label = '默认线路';
      label = label.replace(/^『[^』]*』/, '').slice(0, 24) || '默认线路';

      const episodes = [];
      let vfrom = '';
      for (const anchor of list.select('a')) {
        const m = norm(anchor.attr('href')).match(HREF_EPISODE_RE);
        if (!m) continue;
        vfrom = m[1];
        const index = episodes.length + 1;
        episodes.push({
          id: `${m[1]}-${m[2]}`,
          index,
          label: trim(anchor.attr('title')) || trim(anchor.text()) || `第${index}集`,
        });
      }
      if (!episodes.length || !vfrom || seen.has(vfrom)) continue;
      seen.add(vfrom);
      out.push({ id: vfrom, label, kind: 'main', episodes });
    }
    return out;
  }

  function decodeNow(html) {
    const m = norm(html).match(/var\s+now\s*=\s*base64decode\(\s*"([^"]+)"\s*\)/);
    if (!m) return '';
    try {
      return hg.codec.utf8Decode(hg.codec.base64Decode(m[1]));
    } catch {
      return '';
    }
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seen = new Set();
        for (const card of doc.select('div.card')) {
          const list = card.first('ul.threadlist');
          if (!list) continue;
          const head = card.first('div.card-header');
          const title = trim(head && head.text()).replace(/\s*(今日更新|更多\s*>).*$/, '').trim();
          if (!title || seen.has(title)) continue;
          const items = cardsOf(list);
          if (!items.length) continue;
          seen.add(title);
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
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
        const id = trim(params.categoryId);
        const cat = CATS.find(c => c.id === id);
        if (!cat) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params.cursor);
        const base = `/${cat.id}/index`;
        const path = page === 1 ? `${base}.html` : `${base}${page}.html`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc).map(item => ({ ...item, type: cat.type }));
        const out = { items };
        const nextPath = `${base}${page + 1}.html`;
        if (items.length && doc.select(`a[href="${nextPath}"]`).length) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const dir = pathOf(trim(params.id));
        if (!dir) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(dir, ctx, 300);

        const ogTitle = doc.first('meta[property="og:title"]');
        let title = trim(ogTitle && ogTitle.attr('content'));
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const top = norm(params.id).split('/')[0];
        const detail = { id: trim(params.id), title, type: mediaTypeOf(top, ''), playlists: [] };

        const ogImg = doc.first('meta[property="og:image"]');
        const img = doc.first('img');
        const cover = coverOf(norm(ogImg && ogImg.attr('content')) || norm(img && (img.attr('data-src') || img.attr('src'))));
        if (cover) detail.cover = cover;

        const ogDesc = doc.first('meta[property="og:description"]');
        const description = trim(ogDesc && ogDesc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        detail.playlists = playlistsOf(doc);

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        if (detail.type !== 'movie' && count === 1) detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const dir = pathOf(trim(params.mediaId));
        if (!dir) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const index = Number(m[2]) + 1;
        const tried = new Set();
        const attempt = async (vfrom, nid) => {
          const key = `${vfrom}-${nid}`;
          if (tried.has(key)) return null;
          tried.add(key);
          let html;
          try {
            html = await fetchText(`${dir}play-${vfrom}-${nid}.html`, ctx, 0);
          } catch (error) {
            if (error && error.code === 'NOT_FOUND') return null;
            throw error;
          }
          const url = decodeNow(html);
          if (!/^https?:\/\//i.test(url)) return null;
          const probe = await probeMedia(url, ctx);
          if (probe.res && probe.res.ok) {
            const headers = probe.res.headers || {};
            const finalUrl = probe.res.url || url;
            const contentType = norm(headers['content-type']).toLowerCase();
            const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType);
            return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
          }
          hg.log.warn(`线路 ${vfrom} 取流不可用（${probe.res ? probe.res.status : '网络失败'}），尝试其他线路`);
          return null;
        };

        const direct = await attempt(m[1], m[2]);
        if (direct) return direct;

        // 当前线路取不到（常见于按地区封的 CDN），回详情页找别的线路同一集
        let doc = null;
        try {
          doc = await fetchDoc(dir, ctx, 300);
        } catch {
          doc = null;
        }
        if (doc) {
          for (const pl of playlistsOf(doc)) {
            if (pl.id === m[1]) continue;
            const ep = pl.episodes[index - 1] || pl.episodes[0];
            if (!ep) continue;
            const play = ep.id.match(/^(\d+)-(\d+)$/);
            if (!play) continue;
            const result = await attempt(play[1], play[2]);
            if (result) return result;
          }
        }
        throw new hg.PluginError('CONTENT_LOCKED', '所有线路都取不到流，可能是该站按地区限制，换一部或稍后再试');
      },

      async matchUrl(params) {
        const url = norm(params.url);
        const u = url.replace(/^https?:\/\/(?:www\.)?aeete\.com/i, '');
        const mediaId = mediaIdOf(u);
        if (!mediaId) return null;
        const ep = u.match(HREF_EPISODE_RE);
        if (ep) return { mediaId, episodeId: `${ep[1]}-${ep[2]}` };
        return { mediaId };
      },
    },
  };
};
