export const meta = {
  id: 'juzong.source',
  name: '剧踪影院',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '剧踪影院（juzong01.me）：首页分区、四分类分页、搜索、详情与「剧踪独家」加密线路解析（经 wgart 接口换取直链）。',
  mature: false,
  linkDomains: ['www.juzong01.me', 'juzong01.me'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://www.juzong01.me';
const WG = 'https://jzpic.ok1333.cn';
const TOKEN_KEY = 'wg.token';
const TOKEN_TTL = 600000;

const TYPES = [
  { id: '1', label: '电影' },
  { id: '2', label: '剧集' },
  { id: '3', label: '综艺' },
  { id: '4', label: '动漫' },
];

const MEDIA_URL_RE = /\.(m3u8|mp4|flv|ts|mkv|mov)(\?|$)/i;
const DETAIL_RE = /^https?:\/\/(?:www\.)?juzong01\.me\/voddetail\/(\d+)\/?/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?juzong01\.me\/vodplay\/(\d+)-(\d+)-(\d+)\/?/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\/?/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\/?/;

const norm = s => (typeof s === 'string' ? s : '');
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};
const trim = s => norm(s).replace(/\s+/g, ' ').trim();

function mediaTypeOf(label, episodeCount) {
  const text = norm(label);
  if (/纪录/.test(text)) return 'documentary';
  if (/短剧/.test(text)) return 'short';
  if (/动漫|动画|番剧|国漫/.test(text)) return 'anime';
  if (/综艺|真人秀|脱口秀/.test(text)) return 'variety';
  if (/片$/.test(text)) return 'movie';
  if (/剧/.test(text)) return 'series';
  if (/电影/.test(text)) return 'movie';
  return episodeCount > 1 ? 'series' : 'movie';
}

function unescapePercent(text) {
  let out = norm(text);
  out = out.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  out = out.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return out;
}

function base64Text(hg, text) {
  const bytes = hg.codec.base64Decode(norm(text).replace(/\s+/g, ''));
  return hg.codec.utf8Decode(bytes);
}

export default hg => {
  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const request = () => hg.http.fetch({
      url,
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    let res = await request();
    // 首次访问或搜索页会被上一道 403 拦截页要求带 Cookie 重放一次
    if (res.status === 403 && /location\.href\s*=/.test(norm(res.data))) {
      res = await request();
    }
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return res.data;
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  const PLACEHOLDER_RE = /(?:^|\/)(?:load(?:ing)?|blank|placeholder|spacer|lazy|nopic|default)[^\/]*\.(?:gif|png|jpe?g|webp)$/i;

  function coverOf(raw) {
    const url = norm(raw);
    if (!url || /^data:/i.test(url)) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${SITE}${url}`;
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function pickCover(anchor) {
    const img = anchor.first('img');
    const cands = [
      anchor.attr('data-original'),
      anchor.attr('data-src'),
      anchor.attr('data-background'),
      img && img.attr('data-original'),
      img && img.attr('data-src'),
      img && img.attr('src'),
    ];
    for (const cand of cands) {
      const url = coverOf(cand);
      if (url && !PLACEHOLDER_RE.test(url)) return url;
    }
    const style = norm(anchor.attr('style'));
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    if (m) {
      const url = coverOf(m[2]);
      if (url && !PLACEHOLDER_RE.test(url)) return url;
    }
    return '';
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    const itemType = fallbackType || 'other';
    const anchors = root.select('a.stui-vodlist__thumb')
      .concat(root.select('a[href*="/voddetail/"]'));
    for (const anchor of anchors) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = trim(anchor.attr('title')) || trim(anchor.text());
      if (!title) continue;
      const item = { id: m[1], title, type: itemType };
      const cover = pickCover(anchor);
      if (cover) item.cover = cover;
      const box = anchor.parent();
      const badge = anchor.first('span.pic-text') || (box && box.first('span.pic-text'));
      const badgeText = badge && trim(badge.text());
      if (badgeText && badgeText.length <= 10) item.badge = badgeText;
      out.push(item);
    }
    const withCover = out.filter(item => item.cover);
    return withCover.length ? withCover : out;
  }

  async function wgToken(blob, ctx, force) {
    if (!force) {
      const cached = await hg.storage.get(TOKEN_KEY);
      if (cached && typeof cached.value === 'string' && Date.now() - Number(cached.at || 0) < TOKEN_TTL) {
        return cached.value;
      }
    }
    const res = await hg.http.fetch({
      url: `${WG}/`,
      query: { url: blob, ep: '1' },
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `解析页返回 ${res.status}`);
    const m = norm(res.data).match(/WGART_PARSE_TOKEN="([^"]+)"/);
    if (!m) throw new hg.PluginError('UPSTREAM_CHANGED', '解析页结构已变化');
    await hg.storage.set(TOKEN_KEY, { value: m[1], at: Date.now() }, { ttlSec: 1800 });
    return m[1];
  }

  async function wgApi(blob, token, ctx) {
    const res = await hg.http.fetch({
      url: `${WG}/wgart/api.php`,
      query: { action: 'try_json_api', video_url: blob, parse_token: token },
      headers: { Accept: 'application/json' },
      responseType: 'json',
      signal: ctx.signal,
    });
    const body = res.status === 200 && res.data && typeof res.data === 'object' ? res.data : null;
    if (body && body.success && body.data && typeof body.data.url === 'string' && body.data.url) {
      return { data: body.data };
    }
    const message = norm(body && body.message);
    const authFail = res.status === 401 || res.status === 403 || /无权访问|令牌|token/i.test(message);
    return { data: null, authFail };
  }

  async function wgResolve(blob, ctx) {
    let token = await wgToken(blob, ctx, false).catch(() => '');
    let first = token ? await wgApi(blob, token, ctx) : { data: null, authFail: true };
    if (first.data) return first.data;
    if (!first.authFail) return null;
    token = await wgToken(blob, ctx, true);
    const second = await wgApi(blob, token, ctx);
    if (second.data) return second.data;
    await hg.storage.delete(TOKEN_KEY);
    return null;
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', signal: ctx.signal });
      if (!res.ok) {
        res = await hg.http.fetch({
          url,
          headers: { Range: 'bytes=0-1' },
          signal: ctx.signal,
        });
      }
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  const playPath = (id, sid, nid) => `/vodplay/${id}-${sid}-${nid}/`;

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const seen = new Set();
        const sections = [];
        for (const pannel of doc.select('div.stui-pannel')) {
          const head = pannel.first('h3.title');
          const title = trim(head && head.text());
          if (!title || seen.has(title)) continue;
          const items = cardsOf(pannel);
          if (!items.length) continue;
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
        return TYPES.map(t => ({ id: t.id, label: t.label }));
      },

      async list(params, ctx) {
        const id = norm(params.categoryId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const want = pageNo(params.cursor);
        const path = want === 1
          ? `/vodshow/${id}-----------/`
          : `/vodshow/${id}--------${want}---/`;
        const doc = await fetchDoc(path, ctx, 300);
        const meta = TYPES.find(t => t.id === id);
        const items = cardsOf(doc, meta ? mediaTypeOf(meta.label, 0) : '');
        const out = { items };
        if (items.length && doc.select(`a[href="/vodshow/${id}--------${want + 1}---/"]`).length) {
          out.next = String(want + 1);
        }
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const path = `/vodsearch/-------------.html?wd=${encodeURIComponent(query)}`;
        const doc = await fetchDoc(path, ctx, 0);
        return { items: cardsOf(doc), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = norm(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/voddetail/${id}/`, ctx, 600);

        const titleNode = doc.first('h1.title') || doc.first('h1');
        let title = trim(titleNode && titleNode.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+[-_]\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'movie', playlists: [] };

        const poster = doc.first('div.stui-content__thumb a') || doc.first('div.stui-content__thumb img') || doc.first('img.lazyload');
        const coverUrl = poster ? pickCover(poster.first('img') || poster) : '';
        if (coverUrl) detail.cover = coverUrl;

        const crumb = doc.first('div.v_path');
        const crumbLinks = crumb ? crumb.select('a') : [];
        const categoryLabel = crumbLinks.length > 1 ? trim(crumbLinks[1].text()) : '';

        const dataNode = doc.first('div.stui-content__detail p.data');
        const dataText = trim(dataNode && dataNode.text());
        const yearMatch = dataText.match(/年份[：:]\s*(\d{4})/);
        if (yearMatch) detail.year = Number(yearMatch[1]);

        const tags = [];
        if (dataNode) {
          for (const a of dataNode.select('a[href*="/vodtype/"]')) {
            const text = trim(a.text());
            if (text && text.length <= 30 && tags.indexOf(text) < 0) tags.push(text);
          }
        }
        if (tags.length) detail.tags = tags.slice(0, 20);

        const sketch = doc.first('span.detail-content') || doc.first('span.detail-sketch');
        const description = trim(sketch && sketch.text());
        if (description) detail.description = description.slice(0, 5000);

        let episodeTotal = 0;
        for (const panel of doc.select('div.playlist')) {
          const head = panel.first('h3.title');
          const label = trim(head && head.text());
          const episodes = [];
          for (const anchor of panel.select('ul.stui-content__playlist a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            const index = episodes.length + 1;
            const epLabel = trim(anchor.text());
            episodes.push({
              id: `${m[2]}-${m[3]}`,
              index,
              label: epLabel || String(index),
            });
          }
          if (!episodes.length) continue;
          const sid = episodes[0].id.split('-')[0];
          if (detail.playlists.some(p => p.id === `p${sid}`)) continue;
          detail.playlists.push({
            id: `p${sid}`,
            label: label || `线路 ${sid}`,
            kind: 'main',
            episodes,
          });
          if (!episodeTotal) episodeTotal = episodes.length;
        }

        if (!detail.playlists.length) throw new hg.PluginError('UPSTREAM_CHANGED', '没有解析到播放列表');
        detail.type = mediaTypeOf(categoryLabel, episodeTotal);
        if (categoryLabel) {
          detail.tags = (detail.tags || []).filter(t => t !== categoryLabel);
          detail.tags.unshift(categoryLabel);
        }
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = norm(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        let sid;
        let nid;
        const epm = norm(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (epm) {
          sid = epm[1];
          nid = epm[2];
        } else {
          const pm = norm(params.playlistId).match(/^p?(\d+)$/);
          if (!pm) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
          sid = pm[1];
          nid = '1';
        }

        const html = await fetchText(playPath(id, sid, nid), ctx, 300);
        const dataMatch = norm(html).match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!dataMatch) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页结构已变化');
        let playerData;
        try {
          playerData = JSON.parse(dataMatch[1]);
        } catch {
          throw new hg.PluginError('UPSTREAM_CHANGED', '播放数据解析失败');
        }

        let raw = norm(playerData.url);
        if (!raw) throw new hg.PluginError('CONTENT_LOCKED', '该分集没有播放地址');
        const encrypt = String(playerData.encrypt == null ? '0' : playerData.encrypt);
        if (encrypt === '1') raw = unescapePercent(raw);
        else if (encrypt === '2') raw = unescapePercent(base64Text(hg, raw));

        let url = '';
        let probe = { res: null };
        const direct = /^https?:\/\//i.test(raw) && MEDIA_URL_RE.test(raw);
        if (direct) {
          probe = await probeMedia(raw, ctx);
          // 探测被网络掐断时仍然按直链返回，交给播放器自己再请求一次
          if (!probe.res || probe.res.ok) url = raw;
        }
        if (!url) {
          // 剧踪独家线路是加密串，腾讯/优酷这类是播放页，统一交给 wgart 接口换取直链
          const resolved = await wgResolve(raw, ctx);
          if (!resolved) {
            throw new hg.PluginError('CONTENT_LOCKED', '这条线路暂时取不到地址，换一条线路试试');
          }
          url = norm(resolved.url);
          if (!/^https?:\/\//i.test(url)) throw new hg.PluginError('CONTENT_LOCKED', '取到的地址不可用');
          probe = await probeMedia(url, ctx);
        }
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');
        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const format = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType) ? 'hls' : 'progressive';

        let label = '';
        const size = Number(headers['content-length']);
        if (format === 'progressive' && Number.isFinite(size) && size > 52428800) {
          label = size >= 1073741824
            ? `${(size / 1073741824).toFixed(1)} GB`
            : `${Math.round(size / 1048576)} MB`;
        }

        const stream = { url: finalUrl, kind: 'media', format };
        if (label) stream.label = label;
        return { streams: [stream] };
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
