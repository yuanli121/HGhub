export const meta = {
  id: 'netflixgc.source',
  name: '奈飞工厂',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '奈飞工厂（netflixgc.com）：首页与分类走站内 ds_api/vod 接口（POST 返回 JSON），搜索走 /vodsearch，播放页 player_aaaa 的 encrypt=2 用 base64+unescape 解开就是 m3u8。',
  mature: false,
  linkDomains: ['p.bfp261112.com', 'img1.wsyzy.org', 'image.baidu.com', 'www.netflixgc.com', 'netflixgc.com', 'vip.ffzy-play7.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.netflixgc.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HIDDEN_CATS = new Set(['57']);

const CATS = [
  { id: '1', label: '电影' },
  { id: '2', label: '连续剧' },
  { id: '3', label: '漫剧' },
  { id: '23', label: '综艺' },
  { id: '24', label: '纪录片' },
];

const HOME_SECTIONS = [
  { title: '最新电影', type: '1', by: 'time', mediaType: 'movie' },
  { title: '最热连续剧', type: '2', by: 'hits', mediaType: 'series' },
  { title: '高分电影', type: '1', by: 'score', mediaType: 'movie' },
  { title: '最新漫剧', type: '3', by: 'time', mediaType: 'anime' },
  { title: '最新综艺', type: '23', by: 'time', mediaType: 'variety' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?netflixgc\.com\/voddetail\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?netflixgc\.com\/vodplay\/(\d+)-(\d+)-(\d+)\.html/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');

// 站点的缓存层偶尔把整页 HTML 当成 JSON 字符串吐出来（引号、\/ 都被转义）
function unwrapBody(text) {
  const raw = norm(text);
  if (raw.length > 2 && raw.trim().charCodeAt(0) === 34) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && parsed.trim().charAt(0) === '<') return parsed;
    } catch (error) {
      // 不是 JSON 就按原样用
    }
  }
  return raw;
}
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

export default hg => {
  async function fetchText(path, ctx, ttl, init) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      method: (init && init.method) || 'GET',
      ...(init && init.body ? { body: init.body } : {}),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json',
        Referer: `${SITE}/`,
        'X-Requested-With': 'XMLHttpRequest',
        ...((init && init.headers) || {}),
      },
      retry: 1,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return unwrapBody(res.data);
  }

  async function fetchJson(path, ctx, body, ttl) {
    const text = await fetchText(path, ctx, ttl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new hg.PluginError('UPSTREAM_CHANGED', '列表接口返回格式已变化');
    }
    if (!data || data.code !== 1) {
      throw new hg.PluginError('UPSTREAM_ERROR', trim(data && data.msg) || '列表接口没有返回数据');
    }
    return data;
  }

  async function fetchDoc(path, ctx, ttl) {
    const doc = hg.html.parse(await fetchText(path, ctx, ttl));
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function coverOf(raw) {
    let url = norm(raw).trim();
    if (!url) return '';
    if (url.startsWith('//')) url = `https:${url}`;
    // 站点把封面套了一层百度图片代理，代理返回 0 字节空响应，这里取出真实地址
    if (/^https?:\/\/image\.baidu\.com\/search\/down\?/i.test(url)) {
      const m = url.match(/[?&]url=([^&]+)/i);
      if (m) {
        let inner = m[1];
        try {
          inner = decodeURIComponent(inner);
        } catch {
          // 保持原样
        }
        if (/^https?:\/\//i.test(inner)) url = inner;
      }
    }
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function itemsOfJson(rows, mediaType) {
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
      const id = String(row && row.vod_id ? row.vod_id : '');
      const title = trim(row && row.vod_name);
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const item = { id, title, type: mediaType || 'other' };
      const cover = coverOf(row.vod_pic || row.vod_pic_thumb);
      if (cover) item.cover = cover;
      const remark = trim(row.vod_remarks);
      if (remark && remark.length <= 10) item.badge = remark;
      const score = Number(row.vod_douban_score);
      if (Number.isFinite(score) && score > 0 && score <= 10) item.score = score;
      const actor = trim(row.vod_actor);
      if (actor) item.tags = actor.split(/[,，]/).map(t => trim(t)).filter(Boolean).slice(0, 6);
      out.push(item);
    }
    return out;
  }

  function itemsOfDoc(root) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const img = anchor.first('img');
      const head = anchor.first('h3') || anchor.parent().first('h3');
      const title = trim(head && head.text()) || trim(img && img.attr('alt')) || trim(anchor.attr('title'));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: 'other' };
      const cover = coverOf(img && (img.attr('data-src') || img.attr('data-original') || img.attr('src')));
      if (cover) item.cover = cover;
      const badge = anchor.parent().first('span.slide-info-remarks');
      const badgeText = trim(badge && badge.text());
      if (badgeText && badgeText.length <= 10) item.badge = badgeText;
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

  // player_aaaa 里 encrypt=2 的地址：base64 → unescape
  function decodeUrl(raw, encrypt) {
    let value = norm(raw);
    const mode = String(encrypt === undefined || encrypt === null ? '' : encrypt);
    if (mode === '2') {
      try {
        value = hg.codec.utf8Decode(hg.codec.base64Decode(value));
      } catch {
        return '';
      }
      value = value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else if (mode === '1') {
      value = value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    return value.replace(/\\\//g, '/');
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const sec of HOME_SECTIONS) {
          let data;
          try {
            data = await fetchJson('/index.php/ds_api/vod', ctx, `type=${sec.type}&page=1&limit=12&by=${sec.by}`, 900);
          } catch (error) {
            if (error && (error.code === 'CANCELLED' || error.code === 'RATE_LIMITED')) throw error;
            continue;
          }
          // 接口会忽略 limit，自己截断到 12 条
          const items = itemsOfJson(data.list, sec.mediaType).slice(0, 12);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title: sec.title, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.filter(c => !HIDDEN_CATS.has(c.id)).map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const id = trim(params.categoryId);
        const cat = CATS.find(c => c.id === id);
        if (!cat) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params.cursor);
        const data = await fetchJson('/index.php/ds_api/vod', ctx, `type=${cat.id}&page=${page}&limit=40&by=time`, 300);
        const items = itemsOfJson(data.list);
        const out = { items };
        const pagecount = Number(data.pagecount);
        if (items.length && Number.isFinite(pagecount) && page < pagecount) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const doc = await fetchDoc(`/vodsearch/${encodeURIComponent(query)}-------------.html`, ctx, 120);
        return { items: itemsOfDoc(doc), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/voddetail/${id}.html`, ctx, 300);

        const head = doc.first('h3.slide-info-title') || doc.first('h1');
        let title = trim(head && head.text());
        if (!title) {
          const og = doc.first('meta[property="og:title"]');
          title = trim(og && og.attr('content'));
        }
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'series', playlists: [] };

        const img = doc.first('img[data-src]') || doc.first('img');
        const cover = coverOf(img && (img.attr('data-src') || img.attr('data-original') || img.attr('src')));
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        // 分集：每个 div.anthology-list-box 对应一条线路
        const bySid = new Map();
        for (const box of doc.select('div.anthology-list-box')) {
          for (const anchor of box.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            const sid = m[2];
            const list = bySid.get(sid) || [];
            list.push({ nid: Number(m[3]), label: trim(anchor.text()) || `第${list.length + 1}集` });
            bySid.set(sid, list);
          }
        }

        const sids = [...bySid.keys()].sort((a, b) => Number(a) - Number(b));
        for (const sid of sids) {
          const rows = bySid.get(sid).sort((a, b) => a.nid - b.nid);
          const episodes = rows.map((row, i) => ({ id: `${sid}-${row.nid}`, index: i + 1, label: row.label }));
          if (!episodes.length) continue;
          detail.playlists.push({ id: sid, label: `线路 ${sid}`, kind: 'main', episodes });
        }

        // 电影等单片：只有播放按钮
        if (!detail.playlists.length) {
          const seen = new Set();
          for (const anchor of doc.select('a')) {
            const link = norm(anchor.attr('data-link')) || norm(anchor.attr('href'));
            const m = link.match(HREF_PLAY_RE);
            if (!m || m[1] !== id) continue;
            const sid = m[2];
            if (seen.has(sid)) continue;
            seen.add(sid);
            detail.playlists.push({
              id: sid,
              label: `线路 ${sid}`,
              kind: 'main',
              episodes: [{ id: `${sid}-${m[3]}`, index: 1, label: '正片' }],
            });
          }
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const count = detail.playlists[0].episodes.length;
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        detail.type = count > 1 ? 'series' : 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const nid = m[2];
        const candidates = [m[1]];
        for (const sid of ['1', '2', '3', '4', '5', '6', '7']) {
          if (candidates.length >= 3) break;
          if (!candidates.includes(sid)) candidates.push(sid);
        }

        let lastReason = '';
        for (const sid of candidates) {
          let html;
          try {
            html = await fetchText(`/vodplay/${id}-${sid}-${nid}.html`, ctx, 0);
          } catch (error) {
            if (error && error.code === 'NOT_FOUND') continue;
            throw error;
          }
          const dataMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\\?\/?script>/);
          if (!dataMatch) continue;
          let player = null;
          try {
            player = JSON.parse(dataMatch[1].replace(/\\\//g, '/'));
          } catch {
            continue;
          }
          const url = decodeUrl(player && player.url, player && player.encrypt);
          if (!/^https?:\/\//i.test(url)) continue;

          const probe = await probeMedia(url, ctx);
          if (probe.res && probe.res.ok) {
            const headers = probe.res.headers || {};
            const finalUrl = probe.res.url || url;
            const contentType = norm(headers['content-type']).toLowerCase();
            const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType);
            return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
          }
          if (!probe.res) {
            // 探测失败（网络被拦）时仍然交给宿主试一次
            hg.log.warn(`线路 ${sid} 探测失败，直接返回上游地址`);
            return { streams: [{ url, kind: 'media', format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive' }] };
          }
          lastReason = String(probe.res.status);
          hg.log.warn(`线路 ${sid} 取流不可用（${lastReason}），尝试其他线路`);
        }
        throw new hg.PluginError('CONTENT_LOCKED', lastReason
          ? `线路都取不到流（最后状态 ${lastReason}），换一部或稍后再试`
          : '这条线路没有解析出播放地址，换一条线路试试');
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
