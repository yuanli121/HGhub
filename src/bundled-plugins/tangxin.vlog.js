export const meta = {
  id: 'tangxin.vlog',
  name: '糖心Vlog',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '糖心Vlog 站点数据源：首页分区、演员与标签、全量索引搜索、m3u8 直连播放。',
  mature: true,
  linkDomains: ['tangxinvlog.app'],
  defaultHeaders: { Referer: 'https://tangxinvlog.app/' },
  timeouts: { read: 25 },
};

const SITE = 'https://tangxinvlog.app';
const INDEX = `${SITE}/search-index.json`;
const MEDIA = 'https://t.5gcdn.xyz/videos';
const REFERER = 'https://tangxinvlog.app/';
const ID_RE = /^[0-9a-f]{16,32}$|^\d+$/;
const MAX_CHILDREN = 120;

const norm = s => (typeof s === 'string' ? s : '');
const fold = s => norm(s).normalize('NFKC').toLowerCase();
const tokens = s => fold(s).split(/\s+/).filter(Boolean);

function durationSec(text) {
  const parts = norm(text).split(':').map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function coverOf(id) {
  return `${MEDIA}/${id}/cover.jpg`;
}

function toItem(row) {
  const [id, title, author, tags, duration, description] = row;
  const item = { id: String(id), title: norm(title), type: 'short', cover: coverOf(id) };
  if (norm(description)) item.description = norm(description);
  if (Array.isArray(tags) && tags.length) item.tags = tags.map(norm).filter(Boolean);
  const sec = durationSec(duration);
  if (sec) item.durationSec = sec;
  if (norm(author)) item.author = { id: `a:${author}`, name: norm(author) };
  return item;
}

// 与站内搜索同一套打分：昵称精确 8、标签精确 6、标题命中 4、昵称/标签包含 3/2、简介兜底 1
function scoreOf(fields, token) {
  const { name, nick, tags: tagList, desc } = fields;
  let score = 0;
  if (nick === token) score += 8;
  else if (nick.includes(token)) score += 3;
  if (tagList.includes(token)) score += 6;
  else if (tagList.some(t => t.includes(token))) score += 2;
  if (name.includes(token)) score += 4;
  if (score === 0 && desc.includes(token)) score += 1;
  return score;
}

function searchAll(rows, normed, query) {
  const words = tokens(query);
  if (!words.length) return [];
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    let total = 0;
    let miss = false;
    for (const word of words) {
      const score = scoreOf(normed[i], word);
      if (score === 0) { miss = true; break; }
      total += score;
    }
    if (miss) continue;
    hits.push({ row: rows[i], total, order: i });
  }
  hits.sort((a, b) => b.total - a.total || a.order - b.order);
  return hits.map(h => h.row);
}

export default hg => {
  let cache = null;

  async function fetchIndex(ctx) {
    const res = await hg.http.fetch({
      url: INDEX,
      responseType: 'json',
      maxBytes: 6 * 1024 * 1024,
      timeoutMs: 25000,
      cache: { ttlSec: 21600, staleIfErrorSec: 86400 },
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `索引返回 ${res.status}`);
    const data = res.data;
    if (!Array.isArray(data) || !data.length || !Array.isArray(data[0])) {
      throw new hg.PluginError('UPSTREAM_CHANGED', '索引结构已变化');
    }
    return data;
  }

  // 归一化字段一次构建、分块让出事件循环：单段同步执行有 1 秒预算，两万次 normalize 会撞上限
  async function buildNormed(rows) {
    const out = new Array(rows.length);
    const CHUNK = 600;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, rows.length);
      for (let j = i; j < end; j++) {
        const row = rows[j];
        out[j] = { name: fold(row[1]), nick: fold(row[2]), tags: (row[3] || []).map(fold), desc: fold(row[5]) };
      }
      if (end < rows.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return out;
  }

  function index(ctx) {
    if (cache && Date.now() - cache.at < 600000) return cache.data;
    const at = Date.now();
    const data = (async () => {
      const rows = await fetchIndex(ctx);
      return { rows, normed: await buildNormed(rows) };
    })().catch(err => {
      if (cache && cache.at === at) cache = null;
      throw err;
    });
    cache = { at, data };
    return data;
  }

  const byId = (entries, id) => entries.find(row => String(row[0]) === id);

  function authorsOf(entries) {
    const map = new Map();
    for (const row of entries) {
      const name = norm(row[2]);
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHILDREN);
  }

  function tagsOf(entries) {
    const map = new Map();
    for (const row of entries) for (const tag of row[3] || []) {
      const name = norm(tag);
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHILDREN);
  }

  function paged(rows, cursor, limit, builder) {
    const start = Math.max(0, Number(cursor) || 0);
    const size = Math.min(100, Math.max(1, Number(limit) || 20));
    const slice = rows.slice(start, start + size);
    const out = { items: slice.map(builder) };
    if (start + size < rows.length) out.next = String(start + size);
    return out;
  }

  function cardsFrom(root) {
    return root.select('article.card').map(card => {
      const link = card.first('a.cover-link');
      const href = norm(link && link.attr('href'));
      const id = (href.match(/\/v\/([^/]+)/) || [])[1];
      if (!id) return null;
      const img = card.first('img');
      const title = norm(card.first('h3.title a') && card.first('h3.title a').text()) || norm(img && img.attr('alt'));
      const item = { id, title, type: 'short', cover: norm(img && img.attr('src')) || coverOf(id) };
      const sec = durationSec(card.first('span.duration') && card.first('span.duration').text());
      if (sec) item.durationSec = sec;
      const nick = norm(card.first('a.nickname') && card.first('a.nickname').text()).replace(/^@+/, '').trim();
      if (nick) item.author = { id: `a:${nick}`, name: nick };
      return item;
    }).filter(Boolean);
  }

  async function homePage(ctx) {
    const res = await hg.http.fetch({
      url: `${SITE}/`,
      cache: { ttlSec: 1800, staleIfErrorSec: 86400 },
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `首页返回 ${res.status}`);
    return hg.html.parse(res.data);
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await homePage(ctx);
        const sections = doc.select('section.section').slice(0, 8).map((section, i) => {
          const title = norm(section.first('h2') && section.first('h2').text());
          return { id: `h${i}`, title, layout: 'grid', items: cardsFrom(section) };
        }).filter(s => s.items.length);
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },

      async listSection(params, ctx) {
        const doc = await homePage(ctx);
        const i = Number(String(params.sectionId || '').replace(/^h/, ''));
        const section = doc.select('section.section')[i];
        if (!section) throw new hg.PluginError('INVALID_ARGUMENT', '未知的首页分区');
        return { items: cardsFrom(section), next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const { rows: entries } = await index(ctx);
        return [
          {
            id: 'authors',
            label: '演员',
            children: authorsOf(entries).map(([name, count]) => ({ id: `a:${name}`, label: `${name} (${count})` })),
          },
          {
            id: 'tags',
            label: '标签',
            children: tagsOf(entries).map(([name, count]) => ({ id: `t:${name}`, label: `${name} (${count})` })),
          },
        ];
      },

      async list(params, ctx) {
        const raw = norm(params.categoryId);
        const sep = raw.indexOf(':');
        if (sep < 1) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const kind = raw.slice(0, sep);
        const value = fold(raw.slice(sep + 1));
        const { rows: entries, normed } = await index(ctx);
        const rows = [];
        for (let i = 0; i < entries.length; i++) {
          const hit = kind === 'a' ? normed[i].nick === value : kind === 't' && normed[i].tags.includes(value);
          if (hit) rows.push(entries[i]);
        }
        return paged(rows, params.cursor, params.limit, toItem);
      },
    },

    search: {
      async search(params, ctx) {
        const query = norm(params.query).trim();
        if (!query) return { items: [], next: null };
        const { rows, normed } = await index(ctx);
        const matched = searchAll(rows, normed, query);
        const out = paged(matched, params.cursor, params.limit, toItem);
        out.total = matched.length;
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!ID_RE.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const { rows: entries } = await index(ctx);
        const row = byId(entries, id);
        if (!row) throw new hg.PluginError('NOT_FOUND', '作品不存在');
        const detail = toItem(row);
        detail.playlists = [
          {
            id: 'main',
            label: '正片',
            episodes: [{ id: `${id}-1`, index: 1, label: '正片', ...(detail.durationSec ? { durationSec: detail.durationSec } : {}) }],
          },
        ];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!ID_RE.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const url = `${MEDIA}/${id}/index.m3u8`;
        const probe = await hg.http.fetch({
          url,
          method: 'HEAD',
          headers: { Referer: REFERER },
          cache: { ttlSec: 600 },
          signal: ctx.signal,
        });
        if (!probe.ok) throw new hg.PluginError('CONTENT_LOCKED', `该作品暂无可播放地址（${probe.status}）`);
        return { streams: [{ url, kind: 'media', format: 'hls', headers: { Referer: REFERER } }] };
      },

      async matchUrl(params, ctx) {
        const m = norm(params.url).match(/^https?:\/\/tangxinvlog\.app\/v\/([^/?#]+)/i);
        if (!m || !ID_RE.test(m[1])) return null;
        return { mediaId: m[1], episodeId: `${m[1]}-1` };
      },
    },
  };
};
