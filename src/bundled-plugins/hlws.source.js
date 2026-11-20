export const meta = {
  id: 'hlws.source',
  name: '51黑料',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '51黑料网（51hlws.com）：首页分区、十四分类分页、搜索、详情与 HLS 直连；封面自动切到明文图源。',
  mature: true,
  linkDomains: ['51hlws.com', 'www.51hlws.com', 'pic.gyezbp.cn', 'imgpublic.ycomesc.live'],
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://51hlws.com';
const PLAIN_PIC_HOST = 'imgpublic.ycomesc.live';

const CATS = [
  { slug: 'jinriheiliao', label: '今日黑料' },
  { slug: 'bichiregua', label: '必吃热瓜' },
  { slug: 'zhutidasai', label: '主题大赛' },
  { slug: 'shenghuoheiliao', label: '素人私拍' },
  { slug: 'luanlunshequ', label: '乱伦社区' },
  { slug: 'bilujingping', label: '网黄专区' },
  { slug: 'jingxuanheji', label: '探花精选' },
  { slug: 'wanghongheiliao', label: '明星网红' },
  { slug: 'toupaixiemi', label: '偷拍泄密' },
  { slug: 'xiaoyuanyinluan', label: '校园淫乱' },
  { slug: 'gouxueduanju', label: 'AI短剧' },
  { slug: 'AVnvyou', label: 'AV女优' },
  { slug: 'AIfuli', label: '精选动漫' },
  { slug: 'lieqizhongkou', label: '猎奇重口' },
];

const HOME_SECTIONS = [
  { title: '最新更新', path: '' },
  { title: '今日黑料', path: '/category/jinriheiliao/' },
  { title: '必吃热瓜', path: '/category/bichiregua/' },
  { title: '探花精选', path: '/category/jingxuanheji/' },
  { title: '明星网红', path: '/category/wanghongheiliao/' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?51hlws\.com\/(?:archives|index\.php\/archives)\/(\d+)(?:\.html|\/)?/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

// 站点把原图以 AES 密文放在 pic.* 上，明文原件在另一个域名，路径一致
function plainCover(url) {
  const raw = norm(url);
  if (!raw) return '';
  if (/^\/\//.test(raw)) return `https:${raw.replace(/gyezbp\.cn/, PLAIN_PIC_HOST)}`;
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/^https?:\/\/[^/]+/i, `https://${PLAIN_PIC_HOST}`);
}

export default hg => {
  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return res.data;
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const card of root.select('div.post-card')) {
      const m = norm(card.attr('id')).match(/post-card-(\d+)/);
      if (!m || seen.has(m[1])) continue;
      const head = card.first('h2.post-card-title');
      const img = card.first('img');
      const title = trim(head && head.text()) || trim(img && img.attr('alt'));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: 'movie' };
      const cover = plainCover(norm(img && img.attr('z-image-loader-url')) || norm(img && img.attr('src')));
      if (cover && !/\/usr\//.test(cover)) item.cover = cover;
      const badge = card.first('span.wraps');
      const badgeText = trim(badge && badge.text());
      if (badgeText && badgeText.length <= 8) item.badge = badgeText;
      out.push(item);
    }
    return out;
  }

  function hasNext(root, nextHref) {
    if (root.select(`a[href="${nextHref}"]`).length) return true;
    const info = root.first('span.page-info');
    const text = trim(info && info.text());
    const m = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    return !!(m && Number(m[1]) < Number(m[2]));
  }

  function playerNodes(doc) {
    return doc.select('div.dplayer');
  }

  function configOf(node) {
    const raw = norm(node.attr('data-config'));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', signal: ctx.signal });
      if (!res.ok) {
        res = await hg.http.fetch({ url, headers: { Range: 'bytes=0-1' }, signal: ctx.signal });
      }
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const sec of HOME_SECTIONS) {
          const doc = await fetchDoc(sec.path || '/', ctx, 900);
          const items = cardsOf(doc);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title: sec.title, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map((c, i) => ({ id: String(i + 1), label: c.label }));
      },

      async list(params, ctx) {
        const id = norm(params.categoryId);
        const idx = Number(id) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= CATS.length) {
          throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        }
        const cat = CATS[idx];
        const want = pageNo(params.cursor);
        const base = `/category/${cat.slug}/`;
        const path = want === 1 ? base : `${base}${want}/`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && hasNext(doc, `${base}${want + 1}/`)) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const want = pageNo(params.cursor);
        const base = `/search/${encodeURIComponent(query)}/`;
        const path = want === 1 ? base : `${base}${want}/`;
        const doc = await fetchDoc(path, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && hasNext(doc, `${base}${want + 1}/`)) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/archives/${id}/`, ctx, 120);

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+-\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'movie', playlists: [] };

        const bodyImg = doc.first('img[z-image-loader-url]');
        const cover = plainCover(norm(bodyImg && bodyImg.attr('z-image-loader-url')));
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        const players = playerNodes(doc);
        const tagSet = [];
        for (const node of players) {
          for (const one of norm(node.attr('data-video_tag_name')).split(',')) {
            const text = trim(one);
            if (text && text.length <= 30 && tagSet.indexOf(text) < 0) tagSet.push(text);
          }
        }
        const category = trim(players.length ? players[0].attr('data-video_type_name') : '');
        if (category && tagSet.indexOf(category) < 0) tagSet.unshift(category);
        if (tagSet.length) detail.tags = tagSet.slice(0, 20);

        const episodes = [];
        for (const node of players) {
          const videoId = trim(node.attr('data-video_id'));
          if (!videoId) continue;
          const fullTitle = trim(node.attr('data-video_title'));
          const index = episodes.length + 1;
          const ep = { id: videoId, index, label: players.length > 1 ? String(index) : '正片' };
          if (fullTitle && players.length > 1) ep.title = fullTitle.slice(-60);
          episodes.push(ep);
        }
        if (!episodes.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '这篇只有图集，没有可播放的视频');
        }
        detail.playlists.push({ id: 'main', label: '正片', kind: 'main', episodes });
        if (episodes.length === 1) detail.type = 'movie';
        else detail.type = 'series';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const want = trim(params.episodeId);

        // 播放地址里的 auth_key 由页面渲染时签出，不缓存，每次现取
        const doc = hg.html.parse(await fetchText(`/archives/${id}/`, ctx, 0));
        const players = playerNodes(doc);
        if (!players.length) throw new hg.PluginError('CONTENT_LOCKED', '这篇没有可播放的视频');

        let node = players.find(n => trim(n.attr('data-video_id')) === want);
        if (!node && players.length === 1) node = players[0];
        if (!node) throw new hg.PluginError('CONTENT_LOCKED', '这个分集已不存在，回到详情刷新一下');

        const config = configOf(node);
        const video = config && config.video;
        const url = norm(video && video.url);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这条视频没有播放地址');

        const probe = await probeMedia(url, ctx);
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');

        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = norm(video && video.type) === 'hls'
          || /\.m3u8(\?|$)/i.test(finalUrl)
          || /mpegurl/.test(contentType);

        const stream = { url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' };
        return { streams: [stream] };
      },

      async matchUrl(params) {
        const m = norm(params.url).match(DETAIL_RE);
        if (!m) return null;
        return { mediaId: m[1] };
      },
    },
  };
};
