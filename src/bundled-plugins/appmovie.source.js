export const meta = {
  id: 'appmovie.source',
  name: 'APP影院',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: 'APP影院（appmovie.art）：首页四个热映分区、八个频道分页、搜索、详情与多线路 m3u8 直连。',
  mature: false,
  linkDomains: ['www.appmovie.art', 'appmovie.art', 'v1.ppqrrs.com', 'play.xluuss.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.appmovie.art';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '连续剧', type: 'series' },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动漫', type: 'anime' },
  { id: '13', label: '国产剧', type: 'series' },
  { id: '14', label: '港台剧', type: 'series' },
  { id: '15', label: '日韩剧', type: 'series' },
  { id: '16', label: '欧美剧', type: 'series' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?appmovie\.art\/index\.php\/vod\/detail\/id\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?appmovie\.art\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/i;
const HREF_DETAIL_RE = /\/vod\/detail\/id\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function mediaTypeOf(label, episodeCount) {
  const text = norm(label);
  if (/动漫|动画/.test(text)) return 'anime';
  if (/综艺/.test(text)) return 'variety';
  if (/短剧/.test(text)) return 'short';
  if (/电影|片$/.test(text)) return 'movie';
  if (/剧/.test(text)) return 'series';
  return episodeCount > 1 ? 'series' : 'movie';
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
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
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
      const cover = coverOf(img && (img.attr('data-original') || img.attr('data-src') || img.attr('src')));
      if (cover) item.cover = cover;
      const remark = trim(anchor.parent() && anchor.parent().first('span.pic-text') && anchor.parent().first('span.pic-text').text());
      if (remark && remark.length <= 8) item.badge = remark;
      out.push(item);
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

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seen = new Set();
        for (const panel of doc.select('div.stui-pannel')) {
          const head = panel.first('h3.title') || panel.first('h3');
          const title = trim(head && head.text()).replace(/^[【\[]|[】\]]$/g, '');
          if (!title || seen.has(title)) continue;
          const list = panel.first('ul.stui-vodlist');
          if (!list) continue;
          const items = cardsOf(list);
          if (!items.length) continue;
          seen.add(title);
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
          if (sections.length >= 6) break;
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
        const path = page === 1
          ? `/index.php/vod/show/id/${cat.id}.html`
          : `/index.php/vod/show/id/${cat.id}/page/${page}.html`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc, cat.type);
        const out = { items };
        const nextPath = `/index.php/vod/show/id/${cat.id}/page/${page + 1}.html`;
        if (items.length && doc.select(`a[href="${nextPath}"]`).length) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params.cursor);
        const kw = encodeURIComponent(query);
        const path = page === 1
          ? `/index.php/vod/search.html?wd=${kw}`
          : `/index.php/vod/search/page/${page}/wd/${kw}.html`;
        const doc = await fetchDoc(path, ctx, 120);
        const out = { items: cardsOf(doc), next: null };
        const nextPath = `/index.php/vod/search/page/${page + 1}/wd/${kw}.html`;
        if (out.items.length && doc.select(`a[href="${nextPath}"]`).length) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/index.php/vod/detail/id/${id}.html`, ctx, 300);

        const head = doc.first('h3.title') || doc.first('h1');
        let title = trim(head && head.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'series', playlists: [] };

        const img = doc.first('img[data-original]') || doc.first('img');
        const cover = coverOf(img && (img.attr('data-original') || img.attr('src')));
        if (cover) detail.cover = cover;

        const descBox = doc.first('div.stui-content__desc');
        const desc = trim(descBox && descBox.text());
        if (desc) {
          detail.description = desc.slice(0, 5000);
        } else {
          const meta = doc.first('meta[name="description"]');
          const metaText = trim(meta && meta.attr('content'));
          if (metaText) detail.description = metaText.slice(0, 5000);
        }

        // 分类名（类型：xxx）用来判定 media type
        let catLabel = '';
        const typeLink = norm(doc.select('a').map(a => norm(a.attr('href')) + '\u0000' + trim(a.text())).find(x => /\/vod\/search\/class\//.test(x)) || '');
        if (typeLink) catLabel = typeLink.split('\u0000')[1] || '';

        const seen = new Set();
        for (const panel of doc.select('div.stui-pannel')) {
          const list = panel.first('ul.stui-content__playlist');
          if (!list) continue;
          const headNode = panel.first('h3.title') || panel.first('h3');
          const label = trim(headNode && headNode.text()) || '默认线路';
          const episodes = [];
          let sid = '';
          for (const anchor of list.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            sid = m[2];
            const index = episodes.length + 1;
            episodes.push({
              id: `${m[2]}-${m[3]}`,
              index,
              label: trim(anchor.text()) || `第${index}集`,
            });
          }
          if (!episodes.length || !sid || seen.has(sid)) continue;
          seen.add(sid);
          detail.playlists.push({ id: sid, label, kind: 'main', episodes });
        }

        // 电影/单片：只有「立即播放」按钮，没有分集列表
        if (!detail.playlists.length) {
          for (const anchor of doc.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            const sid = m[2];
            if (seen.has(sid)) continue;
            seen.add(sid);
            detail.playlists.push({
              id: sid,
              label: `线路 ${sid}`,
              kind: 'main',
              episodes: [{ id: `${m[2]}-${m[3]}`, index: 1, label: '正片' }],
            });
          }
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        detail.type = mediaTypeOf(catLabel, count);
        if (detail.type === 'series' && count === 1) detail.type = 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
        const page = `/index.php/vod/play/id/${id}/sid/${m[1]}/nid/${m[2]}.html`;

        const html = await fetchText(page, ctx, 0);
        const dataMatch = html.match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!dataMatch) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页结构已变化');
        let player = null;
        try {
          player = JSON.parse(dataMatch[1].replace(/\\\//g, '/'));
        } catch {
          throw new hg.PluginError('UPSTREAM_CHANGED', '播放数据解析失败');
        }

        let url = norm(player && player.url).replace(/\\\//g, '/');
        if (norm(player && player.encrypt) === '1') {
          try {
            url = decodeURIComponent(url);
          } catch {
            // 保持原样
          }
        }
        if (!/^https?:\/\//i.test(url)) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路要专用播放器解析，换一条线路试试');
        }

        const probe = await probeMedia(url, ctx);
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}），换一条线路试试`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');
        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType) || norm(player && player.from).indexOf('m3u8') >= 0;
        return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
      },

      async matchUrl(params) {
        const url = norm(params.url);
        const play = url.match(PLAY_RE);
        if (play) return { mediaId: play[1], episodeId: `${play[2]}-${play[3]}` };
        const detail = url.match(DETAIL_RE);
        if (detail) return { mediaId: detail[1] };
        return null;
      },
    },
  };
};
