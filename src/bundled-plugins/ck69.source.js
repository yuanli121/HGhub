export const meta = {
  id: 'ck69.source',
  name: '黄色仓库',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '黄色仓库（69ck1）数据源：首页分区、五个分类、搜索、详情与 m3u8 直连。',
  mature: true,
  linkDomains: ['www.69ck1.com', '69ck1.com'],
  defaultHeaders: { Referer: 'https://www.69ck1.com/' },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.69ck1.com';
const TYPES = [
  { id: '1', label: '麻豆' },
  { id: '2', label: '中字' },
  { id: '3', label: '国产' },
  { id: '4', label: '欧美' },
  { id: '5', label: '日韩' },
];

const norm = s => (typeof s === 'string' ? s : '');
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function durationSec(text) {
  const parts = norm(text).trim().split(':').map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const PLAY_RE = /\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)/;

function cardsOf(root) {
  const out = [];
  const seen = new Set();
  const push = item => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  for (const anchor of root.select('a.stui-vodlist__thumb')) {
    const m = norm(anchor.attr('href')).match(PLAY_RE);
    if (!m) continue;
    const item = { id: m[1], title: norm(anchor.attr('title')), type: 'movie' };
    const cover = norm(anchor.attr('data-original')) || norm(anchor.attr('src'));
    if (cover && !/^data:/.test(cover)) item.cover = cover;
    const box = anchor.parent();
    const dur = box && box.first('span.pic-text');
    const sec = dur && durationSec(dur.text());
    if (sec) item.durationSec = sec;
    push(item);
  }

  if (!out.length) {
    for (const anchor of root.select('a[href*="/vod/play/"]')) {
      const m = norm(anchor.attr('href')).match(PLAY_RE);
      if (!m) continue;
      push({ id: m[1], title: norm(anchor.attr('title')) || norm(anchor.text()), type: 'movie' });
    }
  }
  return out;
}

export default hg => {
  async function fetchDoc(path, ctx, ttl) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : `${SITE}${path}`,
      cache: { ttlSec: ttl || 300, staleIfErrorSec: 3600 },
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return hg.html.parse(res.data);
  }

  function streamUrlFrom(doc) {
    for (const frame of doc.select('iframe')) {
      const src = norm(frame.attr('src'));
      if (src.indexOf('video_url=') < 0) continue;
      const raw = src.slice(src.indexOf('video_url=') + 'video_url='.length).split('&')[0];
      try {
        const url = decodeURIComponent(raw);
        if (/^https?:\/\//i.test(url)) return url;
      } catch {
        return '';
      }
    }
    return '';
  }

  const playPath = (id, sid, nid) => `/index.php/vod/play/id/${id}/sid/${sid || 1}/nid/${nid || 1}.html`;

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/enter', ctx, 900);
        const seen = new Set();
        const sections = [];
        for (const pannel of doc.select('div.stui-pannel')) {
          const titleNode = pannel.first('h3.title');
          const title = norm(titleNode && titleNode.text()).trim();
          if (!title) continue;
          const items = cardsOf(pannel);
          if (!items.length || seen.has(title)) continue;
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
        return TYPES.map(t => ({ id: t.id, label: t.label }));
      },

      async list(params, ctx) {
        const id = norm(params.categoryId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const want = pageNo(params.cursor);
        const path = want === 1
          ? `/index.php/vod/type/id/${id}.html`
          : `/index.php/vod/type/id/${id}/page/${want}.html`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && doc.select(`a[href*="/page/${want + 1}.html"]`).length) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = norm(params.query).trim();
        if (!query) return { items: [], next: null };
        const want = pageNo(params.cursor);
        const kw = encodeURIComponent(query);
        const path = want === 1
          ? `/index.php/vod/search.html?wd=${kw}`
          : `/index.php/vod/search/page/${want}/wd/${kw}.html`;
        const doc = await fetchDoc(path, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        const nextHref = `/index.php/vod/search/page/${want + 1}/wd/${kw}.html`;
        if (items.length && doc.select(`a[href="${nextHref}"]`).length) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(playPath(id, 1, 1), ctx, 600);
        // 播放页第一个 stui-pannel 是「目录」导航，标题要取包含播放器的那一块
        let title = '';
        for (const pannel of doc.select('div.stui-pannel')) {
          if (!pannel.select('iframe').length) continue;
          const head = pannel.first('h3.title');
          if (head) { title = norm(head.text()).trim(); break; }
        }
        if (!title) {
          const tag = doc.first('title');
          title = norm(tag && tag.text()).split(/\s+-\s+/)[0].trim();
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');
        const detail = { id, title, type: 'movie' };
        const desc = doc.first('meta[name="description"]');
        if (desc && desc.attr('content')) detail.description = norm(desc.attr('content'));
        detail.playlists = [{ id: 'main', label: '正片', episodes: [{ id: '1-1', index: 1, label: '正片' }] }];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const [sid, nid] = norm(params.episodeId).split('-');
        const doc = await fetchDoc(playPath(id, sid, nid), ctx, 600);
        const url = streamUrlFrom(doc);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '该作品暂无可播放地址');
        const probe = await hg.http.fetch({
          url,
          method: 'HEAD',
          cache: { ttlSec: 600 },
          signal: ctx.signal,
        });
        if (!probe.ok) throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.status}）`);
        const stream = { url, kind: 'media', format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive' };
        return { streams: [stream] };
      },

      async matchUrl(params, ctx) {
        const m = norm(params.url).match(/^https?:\/\/(?:www\.)?69ck1\.com(\/index\.php)?\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)/i);
        if (!m) return null;
        return { mediaId: m[2], episodeId: `${m[3]}-${m[4]}` };
      },
    },
  };
}
