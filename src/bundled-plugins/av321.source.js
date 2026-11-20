export const meta = {
  id: 'av321.source',
  name: '321AV',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '321AV 站点数据源：首页分区、分类、搜索、详情与 HLS 直连。',
  mature: true,
  linkDomains: ['321av.art'],
  defaultHeaders: { Referer: 'https://321av.art/' },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://321av.art';
const ENTRY = `${SITE}/enter`;
const CATEGORIES = [
  { id: '20', label: '有码影片' },
  { id: '21', label: '无码影片' },
  { id: '22', label: '中文字幕' },
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

// 卡片：div.thumbnail.group → a[href=/vodplay/{id}-...] + img(data-src) + span(时长) + div.truncate a(标题)
function cardsOf(root) {
  const out = [];
  for (const node of root.select('div.thumbnail.group')) {
    const link = node.first('a');
    const href = norm(link && link.attr('href'));
    const id = (href.match(/\/vodplay\/(\d+)-/) || [])[1];
    if (!id) continue;
    const img = node.first('img');
    const cover = norm(img && (img.attr('data-src') || img.attr('src')));
    const titleNode = node.first('div.truncate a');
    const item = {
      id,
      title: norm(titleNode && titleNode.text()) || norm(img && img.attr('alt')),
      type: 'movie',
    };
    if (cover && !/loading\.png$/.test(cover)) item.cover = cover;
    for (const span of node.select('span')) {
      const sec = durationSec(span.text());
      if (sec) { item.durationSec = sec; break; }
    }
    out.push(item);
  }
  return out;
}

// 标题往上找最近的、含卡片网格的祖先；祖先里出现第二个标题说明已经越过分区边界（页尾）
function sectionOf(heading) {
  let node = heading;
  for (let i = 0; i < 5; i++) {
    node = node.parent();
    if (!node) return null;
    if (node.select('h2').length > 1) return null;
    if (node.select('div.thumbnail.group').length) return node;
  }
  return null;
}

export default hg => {
  async function page(path, ctx, ttl) {
    const res = await hg.http.fetch({
      url: path.startsWith('http') ? path : `${SITE}${path}`,
      cache: { ttlSec: ttl || 300, staleIfErrorSec: 3600 },
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return hg.html.parse(res.data);
  }

  function scriptText(doc, needle) {
    for (const node of doc.select('script')) {
      const text = node.html();
      if (text && text.indexOf(needle) >= 0) return text;
    }
    return '';
  }

  function playerConfig(doc) {
    const text = scriptText(doc, 'player_aaaa');
    const at = text.indexOf('{', text.indexOf('player_aaaa'));
    if (at < 0) return null;
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(at, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  // 播放页里番号出现两处：video_poster_url 的路径段，或 player_aaaa.url 的 base64 JSON
  function episodeCode(doc) {
    for (const node of doc.select('script')) {
      const text = node.html() || '';
      const m = text.match(/video_poster_url\s*=\s*"([^"]+)"/);
      if (m) {
        const segs = m[1].split('/').filter(Boolean);
        if (segs.length >= 2) return decodeURIComponent(segs[segs.length - 2]);
      }
    }
    const conf = playerConfig(doc);
    if (!conf || !conf.url) return '';
    try {
      const raw = decodeURIComponent(conf.url);
      const json = JSON.parse(atob(raw));
      for (const row of json.ss || []) {
        for (const cell of row) {
          if (typeof cell !== 'string') continue;
          const parts = cell.split(/[?#]/)[0].split('/').filter(Boolean);
          const cn = parts.indexOf('cn');
          if (cn >= 0 && cn < parts.length - 1) return parts[parts.length - 1];
        }
      }
    } catch {
      return '';
    }
    return '';
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await page('/enter', ctx, 900);
        const sections = [];
        for (const heading of doc.select('h2')) {
          const title = heading.text();
          if (!title || title.length > 12) continue;
          const container = sectionOf(heading);
          if (!container) continue;
          const items = cardsOf(container);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
          if (sections.length >= 6) break;
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATEGORIES.map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const id = norm(params.categoryId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const want = pageNo(params.cursor);
        const path = want === 1 ? `/vodtype/${id}.html` : `/vodtype/${id}-${want}.html`;
        const doc = await page(path, ctx, 300);
        const items = cardsOf(doc);
        if (!items.length) throw new hg.PluginError('NOT_FOUND', '该页没有内容');
        const nextHref = `/vodtype/${id}-${want + 1}.html`;
        const hasNext = doc.select('a[href="' + nextHref + '"]').length > 0;
        const out = { items };
        if (hasNext) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = norm(params.query).trim();
        if (!query) return { items: [], next: null };
        const want = pageNo(params.cursor);
        const encoded = encodeURIComponent(query);
        const path = want === 1
          ? `/index.php/vod/search.html?wd=${encoded}`
          : `/vod/search/page/${want}/wd/${encoded}.html`;
        const doc = await page(path, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        const nextHref = `/vod/search/page/${want + 1}/wd/${encoded}.html`;
        if (doc.select('a[href="' + nextHref + '"]').length > 0) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await page(`/vodplay/${id}-1-1.html`, ctx, 600);
        const heading = doc.first('h1');
        const title = norm(heading && heading.text());
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');
        const detail = { id, title, type: 'movie' };
        const image = doc.first('meta[property="og:image"]');
        const cover = norm(image && image.attr('content'));
        if (cover) detail.cover = cover;
        const desc = doc.first('meta[name="description"]');
        if (desc && desc.attr('content')) detail.description = norm(desc.attr('content'));
        const conf = playerConfig(doc);
        const vod = (conf && conf.vod_data) || {};
        const tags = [vod.vod_class].map(norm).filter(Boolean);
        if (tags.length) detail.tags = tags;
        const actor = norm(vod.vod_actor);
        if (actor) {
          const people = actor.split(/[,，\/]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
          if (people.length) detail.people = people.map(name => ({ name, role: '演员' }));
        }
        detail.playlists = [
          {
            id: 'main',
            label: '正片',
            episodes: [{ id: '1-1', index: 1, label: '正片' }],
          },
        ];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await page(`/vodplay/${id}-1-1.html`, ctx, 600);
        const code = episodeCode(doc);
        if (!code) throw new hg.PluginError('UPSTREAM_CHANGED', '无法从播放页解析番号');
        const res = await hg.http.fetch({
          url: `${SITE}/private-getvideo/${encodeURIComponent(code)}`,
          responseType: 'json',
          cache: { ttlSec: 900 },
          signal: ctx.signal,
        });
        if (!res.ok) throw new hg.PluginError('CONTENT_LOCKED', `取流接口返回 ${res.status}`);
        const playlist = res.data && res.data.playlist;
        if (!Array.isArray(playlist) || !playlist.length) {
          throw new hg.PluginError('CONTENT_LOCKED', '该作品暂无可播放地址');
        }
        const streams = playlist
          .filter(entry => entry && /^https?:\/\//.test(norm(entry.url)))
          .map((entry, i) => {
            const url = norm(entry.url);
            const stream = { url, kind: 'media', format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive' };
            const hd = url.match(/\/(\d{3,4})p\//);
            stream.label = hd ? `${hd[1]}P` : `线路${i + 1}`;
            return stream;
          });
        if (!streams.length) throw new hg.PluginError('CONTENT_LOCKED', '取流接口没有返回可用地址');
        return { streams };
      },

      async matchUrl(params, ctx) {
        const url = norm(params.url);
        const m = url.match(/^https?:\/\/321av\.art\/(?:vodplay\/(\d+)-|voddetail\/(\d+))/i);
        if (!m) return null;
        const id = m[1] || m[2];
        return { mediaId: id, episodeId: '1-1' };
      },
    },
  };
};
