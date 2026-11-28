export const meta = {
  id: 'cg91.source',
  name: '91吃瓜',
  version: '1.0.2',
  protocol: 1,
  kind: 'source',
  description: '91吃瓜网（91cg1.com）：二十五分类分页、搜索、详情多段视频；正文封面是 AES-128-CBC 密文，交给宿主原生 transform 解密；播放走 DPlayer 配置里的 HLS 直链。',
  mature: true,
  linkDomains: ['91cg1.com', 'www.91cg1.com', 'pic.biacea.cn', 'op.micgqv.cn', 'qw.mkimfs.cn'],
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://www.91cg1.com';

// 封面密文参数：从主题的 zzz.js 字符串表里解出来的 AES-128-CBC key/iv
// 以 Base64 形式交给宿主的原生 transform，宿主逐个封面解密，不占插件运行时
const PIC_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';   // 'f5d965df75336270'
const PIC_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';    // '97b60394abc2fbe1'

// 封面是密文，返回 ResourceRef 让宿主原生解密（data URL 会被宿主判成无效地址）
function coverRef(rawUrl) {
  const url = typeof rawUrl === 'string' ? rawUrl : '';
  if (!/^https?:\/\//i.test(url)) return '';
  if (!/\.(jpe?g|png|webp|gif)$/i.test(url)) return '';
  return {
    url: url.replace(/^http:\/\//i, 'https://'),
    transform: { type: 'aes-cbc', key: PIC_KEY_B64, iv: PIC_IV_B64, padding: 'pkcs7' },
  };
}

const CATS = [
  { slug: 'zxcghl', label: '今日吃瓜' },
  { slug: 'bcdg', label: '必吃大瓜' },
  { slug: 'mrds', label: '每日大赛' },
  { slug: 'stjx', label: 'ST精选' },
  { slug: '91th', label: '91探花' },
  { slug: 'whhl', label: '网红黑料' },
  { slug: 'mxhl', label: '明星黑料' },
  { slug: 'gcwh', label: '网黄合集' },
  { slug: 'hjll', label: '海角乱伦' },
  { slug: 'xyjj', label: '校园禁忌' },
  { slug: 'zptp', label: '自拍偷拍' },
  { slug: 'fclv', label: '反差靓女' },
  { slug: 'lqzk', label: '猎奇重口' },
  { slug: 'crdm', label: '成人动漫' },
  { slug: 'dydj', label: 'AI短剧' },
  { slug: 'aikj', label: '明星AI' },
  { slug: 'qwys', label: '社会奇闻' },
  { slug: 'lpsd', label: '深夜撸片' },
  { slug: 'tgqg', label: '投稿求瓜' },
  { slug: 'rsdg', label: '最高点击' },
  { slug: 'sports-live', label: '体育直播' },
];

const HOME_SECTIONS = [
  { title: '最新更新', path: '' },
  { title: '今日吃瓜', path: '/category/zxcghl/' },
  { title: '必吃大瓜', path: '/category/bcdg/' },
  { title: '网红黑料', path: '/category/whhl/' },
  { title: '91探花', path: '/category/91th/' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?91cg1\.com\/(?:archives|index\.php\/archives)\/(\d+)(?:\.html|\/)?/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

export default hg => {
  // 同族站点（如 91cg2.com 入口页）会把整页 HTML 塞进 document.write(Base64.decode('…'))
  function unwrapShell(html) {
    const raw = norm(html);
    if (/<html/i.test(raw.slice(0, 800))) return raw;
    const m = raw.match(/Base64\.decode\(\s*'([A-Za-z0-9+/=]{200,})'\s*\)/);
    if (!m) return raw;
    try {
      const decoded = hg.codec.utf8Decode(hg.codec.base64Decode(m[1]));
      return decoded.indexOf('<') >= 0 ? decoded : raw;
    } catch (error) {
      return raw;
    }
  }

  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { Accept: 'text/html,application/xhtml+xml,image/*' },
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '这篇内容不存在或已删除');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return unwrapShell(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    const doc = hg.html.parse(await fetchText(path, ctx, ttl));
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const card of root.select('div.post-card')) {
      const m = norm(card.attr('id')).match(/post-card-(\d+)/);
      if (!m || seen.has(m[1])) continue;
      const head = card.first('h2.post-card-title');
      const title = trim(head && head.text());
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: 'movie' };
      const banner = card.html().match(/loadBannerDirect\(\s*'([^']+)'/);
      const cover = coverRef(banner ? banner[1] : '');
      if (cover) item.cover = cover;
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

  function configOf(node) {
    const raw = norm(node.attr('data-config'));
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    } catch {
      return null;
    }
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', signal: ctx.signal });
      if (!res.ok) res = await hg.http.fetch({ url, headers: { Range: 'bytes=0-1' }, signal: ctx.signal });
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
          let doc;
          try {
            doc = await fetchDoc(sec.path || '/', ctx, 900);
          } catch (error) {
            if (error && (error.code === 'CANCELLED' || error.code === 'RATE_LIMITED')) throw error;
            continue;
          }
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
        const doc = await fetchDoc(want === 1 ? base : `${base}${want}/`, ctx, 300);
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
        const doc = await fetchDoc(want === 1 ? base : `${base}${want}/`, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && hasNext(doc, `${base}${want + 1}/`)) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/archives/${id}/`, ctx, 120);

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const og = doc.first('meta[property="og:title"]');
          title = trim(og && og.attr('content'));
        }
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+-\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'movie', playlists: [] };

        // 封面：优先取正文第一张图（密文），解密成 data URL
        let coverSource = '';
        for (const img of doc.select('img')) {
          const raw = norm(img.attr('data-xkrkllgl')) || norm(img.attr('z-image-loader-url'));
          if (/\.(jpe?g|png)$/i.test(raw)) { coverSource = raw; break; }
        }
        if (!coverSource) {
          const nodes = doc.select('div.dplayer');
          if (nodes.length) {
            const config = configOf(nodes[0]);
            coverSource = norm(config && config.video && config.video.pic);
          }
        }
        if (coverSource) {
          const cover = coverRef(coverSource);
          if (cover) detail.cover = cover;
        }

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        const players = doc.select('div.dplayer');
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
          const index = episodes.length + 1;
          const fullTitle = trim(node.attr('data-video_title'));
          episodes.push({
            id: videoId,
            index,
            label: players.length > 1 ? `第${index}段` : '正片',
            ...(players.length > 1 && fullTitle ? { title: fullTitle.slice(-60) } : {}),
          });
        }
        if (!episodes.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '这篇只有图集，没有可播放的视频');
        }
        detail.playlists.push({ id: 'main', label: '正片', kind: 'main', episodes });
        detail.type = episodes.length === 1 ? 'movie' : 'series';
        detail.episodeCount = episodes.length;
        detail.totalEpisodes = episodes.length;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const want = trim(params.episodeId);

        // auth_key 由页面渲染时签出，时效很短，每次现取
        const doc = hg.html.parse(await fetchText(`/archives/${id}/`, ctx, 0));
        const players = doc.select('div.dplayer');
        if (!players.length) throw new hg.PluginError('CONTENT_LOCKED', '这篇没有可播放的视频');

        let node = players.find(n => trim(n.attr('data-video_id')) === want);
        if (!node && players.length === 1) node = players[0];
        if (!node) throw new hg.PluginError('CONTENT_LOCKED', '这个分集已不存在，回详情刷新一下');

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
        return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
      },

      async matchUrl(params) {
        const m = norm(params.url).match(DETAIL_RE);
        if (!m) return null;
        return { mediaId: m[1] };
      },
    },
  };
};
