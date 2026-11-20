export const meta = {
  id: 'hanime16.source',
  name: 'H動漫 hanime16',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: 'hanime16 数据源：首页分区、类型与排序、搜索、详情，直连 1080P/720P/480P。',
  mature: true,
  linkDomains: ['www.hanime16.com', 'hanime16.com'],
  defaultHeaders: { Referer: 'https://www.hanime16.com/' },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://www.hanime16.com';
const SORTS = [
  { value: '最新上市', label: '最新上市' },
  { value: '最新上傳', label: '最新上传' },
];
const GENRES = ['裏番', '泡麵番', 'Motion Anime', '3DCG', '2.5D', '2D動畫', 'AI生成', 'MMD', 'Cosplay'];

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

function cardsOf(root) {
  const out = [];
  const seen = new Set();
  const push = item => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  // A 型：首页行、排序页 —— div.video-item-container 内含 a.video-link
  for (const node of root.select('div.video-item-container')) {
    const link = node.first('a.video-link') || node.first('a');
    const id = (norm(link && link.attr('href')).match(/[?&]v=(\d+)/) || [])[1];
    if (!id) continue;
    const img = node.first('img.main-thumb') || node.first('img');
    const item = {
      id,
      title: norm(node.attr('title')) || norm(node.first('div.title') && node.first('div.title').text()),
      type: 'anime',
    };
    const cover = norm(img && (img.attr('src') || img.attr('data-src')));
    if (cover) item.cover = cover;
    const sec = durationSec(norm(node.first('div.duration') && node.first('div.duration').text()));
    if (sec) item.durationSec = sec;
    push(item);
  }

  // B 型：类型页、搜索页 —— 外层 a 包着 div.home-rows-videos-div，标题在 .home-rows-videos-title
  for (const node of root.select('div.home-rows-videos-div')) {
    const anchor = node.parent();
    const id = (norm(anchor && anchor.attr('href')).match(/[?&]v=(\d+)/) || [])[1];
    if (!id) continue;
    const img = node.first('img');
    const item = {
      id,
      title: norm(node.first('div.home-rows-videos-title') && node.first('div.home-rows-videos-title').text()),
      type: 'anime',
    };
    const cover = norm(img && (img.attr('src') || img.attr('data-src')));
    if (cover) item.cover = cover;
    push(item);
  }

  return out;
}

function hasNext(doc, nextPage) {
  return doc.select('a[href*="page=' + nextPage + '"]').length > 0;
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

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/enter', ctx, 900);
        const titles = doc.select('a.horizontal-row-title');
        const wrappers = doc.select('div.home-rows-videos-wrapper');
        const seen = new Set();
        const sections = [];
        const count = Math.min(titles.length, wrappers.length);
        for (let i = 0; i < count; i++) {
          const title = norm(titles[i].text()).replace(/查看更多/g, '').replace(/arrow_forward_ios/g, '').trim();
          const items = cardsOf(wrappers[i]);
          if (!title || !items.length || seen.has(title)) continue;
          seen.add(title);
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
          if (sections.length >= 8) break;
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return [
          {
            id: 'sort',
            label: '排序',
            children: SORTS.map(s => ({ id: `s:${s.value}`, label: s.label })),
          },
          {
            id: 'genre',
            label: '类型',
            children: GENRES.map(g => ({ id: `g:${g}`, label: g })),
          },
        ];
      },

      async list(params, ctx) {
        // 宿主点父分类时会直接传 'sort' / 'genre'，这两种要落到各自的第一个子项
        const raw = norm(params.categoryId).trim();
        let key;
        let value;
        if (raw === 'sort') {
          key = 'sort';
          value = SORTS[0].value;
        } else if (raw === 'genre') {
          key = 'genre';
          value = GENRES[0];
        } else {
          const sep = raw.indexOf(':');
          if (sep < 1) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
          const kind = raw.slice(0, sep);
          key = kind === 's' ? 'sort' : kind === 'g' ? 'genre' : '';
          value = raw.slice(sep + 1);
          if (!key || !value) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        }
        const want = pageNo(params.cursor);
        const doc = await fetchDoc(`/search?${key}=${encodeURIComponent(value)}&page=${want}`, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && hasNext(doc, want + 1)) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = norm(params.query).trim();
        if (!query) return { items: [], next: null };
        const want = pageNo(params.cursor);
        const doc = await fetchDoc(`/search?query=${encodeURIComponent(query)}&page=${want}`, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length && hasNext(doc, want + 1)) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/watch?v=${id}`, ctx, 600);
        const heading = doc.first('h3#shareBtn-title') || doc.first('div.video-title') || doc.first('h1');
        let title = norm(heading && heading.text());
        if (!title) {
          const og = doc.first('meta[property="og:title"]');
          title = norm(og && og.attr('content')).replace(/\s*-\s*hanime16\.com\s*$/, '').trim();
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');
        const detail = { id, title, type: 'anime' };
        const video = doc.first('video');
        const poster = norm(video && video.attr('poster'));
        if (poster) detail.cover = poster;
        const caption = doc.first('div.video-caption-text');
        const description = norm(caption && caption.text()).trim();
        if (description) detail.description = description;
        else {
          const desc = doc.first('meta[name="description"]');
          if (desc && desc.attr('content')) detail.description = norm(desc.attr('content'));
        }
        // 真正的标签在 video-tags-wrapper 里，顶部导航的 genre 链接不是本片标签
        const tags = [];
        for (const link of doc.select('div.video-tags-wrapper a')) {
          const text = norm(link.text()).replace(/^#\s*/, '').replace(/\s*\(\d+\)\s*$/, '').trim();
          if (text && text.length < 20 && tags.indexOf(text) < 0) tags.push(text);
        }
        if (tags.length) detail.tags = tags.slice(0, 8);
        detail.playlists = [{ id: 'main', label: '正片', episodes: [{ id: 'main-1', index: 1, label: '正片' }] }];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/watch?v=${id}`, ctx, 600);
        const sources = [];
        for (const node of doc.select('source')) {
          const url = norm(node.attr('src'));
          if (!/^https?:\/\//.test(url)) continue;
          const height = Number(node.attr('size'));
          sources.push({ url, height: Number.isFinite(height) ? height : undefined });
        }
        if (!sources.length) throw new hg.PluginError('CONTENT_LOCKED', '该作品暂无可播放地址');
        sources.sort((a, b) => (b.height || 0) - (a.height || 0));

        const streams = [];
        for (const source of sources) {
          let url = source.url;
          let ok = true;
          try {
            const probe = await hg.http.fetch({
              url,
              method: 'HEAD',
              headers: { Referer: `${SITE}/` },
              signal: ctx.signal,
            });
            ok = probe.ok;
            if (probe.url) url = probe.url;
          } catch {
            ok = false;
          }
          if (!ok) continue;
          const stream = { url, kind: 'media', format: 'progressive' };
          if (source.height) {
            stream.height = source.height;
            stream.label = `${source.height}P`;
          }
          streams.push(stream);
        }
        if (!streams.length) throw new hg.PluginError('CONTENT_LOCKED', '取流地址全部不可用');
        return { streams };
      },

      async matchUrl(params, ctx) {
        const m = norm(params.url).match(/^https?:\/\/(?:www\.)?hanime16\.com\/watch\?v=(\d+)/i);
        if (!m) return null;
        return { mediaId: m[1], episodeId: 'main-1' };
      },
    },
  };
}
