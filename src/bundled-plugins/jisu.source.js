export const meta = {
  id: 'jisu.source',
  name: '极速追剧',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: '极速追剧（jisuzhuiju.com）：首页五个分区、五个频道分页、搜索、详情与多线路 HLS 直连。',
  mature: false,
  linkDomains: ['jisuzhuiju.com', 'www.jisuzhuiju.com', 'vv.jisuzyv.com', 'cibn-edge-5g.1ljx.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://jisuzhuiju.com';

const CHANNELS = [
  { id: '1', label: '电视剧' },
  { id: '2', label: '电影' },
  { id: '3', label: '动漫' },
  { id: '4', label: '综艺' },
];

// 短剧频道（channel=5）整条线都挂在已停用的 vv.jisuzyv.com 上，目录保留没有意义
const HIDDEN_CHANNELS = new Set(['5']);

const DETAIL_RE = /^https?:\/\/(?:www\.)?jisuzhuiju\.com\/detail\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?jisuzhuiju\.com\/vodplay\/(\d+)-([a-z0-9]+)-(\d+)\.html/i;
const HREF_DETAIL_RE = /^\/?detail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-([a-z0-9]+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function coverOf(url) {
  const raw = norm(url);
  if (!/^https?:\/\//i.test(raw)) return '';
  // 站点里混着 http 图床，宿主只允许 https
  return raw.replace(/^http:\/\//i, 'https://');
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
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const titleNode = anchor.first('p.vod-title') || anchor.first('.vod-title');
      let title = trim(titleNode && titleNode.text());
      const img = anchor.first('img');
      if (!title) title = trim(img && img.attr('alt')).replace(/封面图片$/, '');
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: 'other' };
      const cover = coverOf(img && img.attr('src'));
      if (cover) item.cover = cover;
      const badge = anchor.first('span.vod-badge');
      const badgeText = trim(badge && badge.text());
      if (badgeText && badgeText.length <= 8) item.badge = badgeText;
      const sub = trim(anchor.first('p.vod-subtitle') && anchor.first('p.vod-subtitle').text());
      if (sub) {
        const tags = sub.split(/[,，/]/).map(t => trim(t)).filter(t => t && t.length <= 30);
        if (tags.length) item.tags = tags.slice(0, 20);
      }
      out.push(item);
    }
    return out;
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
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seen = new Set();
        for (const block of doc.select('div.vod-section')) {
          const head = block.first('h2.vod-section-title') || block.first('h2');
          const title = trim(head && head.text());
          if (!title || seen.has(title)) continue;
          const items = cardsOf(block);
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
        return CHANNELS.map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const id = trim(params.categoryId);
        if (HIDDEN_CHANNELS.has(id)) throw new hg.PluginError('INVALID_ARGUMENT', '这个频道暂时没有可播放的资源');
        const channel = CHANNELS.find(c => c.id === id);
        if (!channel) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const want = pageNo(params.cursor);
        const path = `/filter?channel=${channel.id}&type=&area=&year=&sort=hot&page=${want}`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        const more = doc.select(`a[href*="page=${want + 1}"]`);
        if (items.length && more.length) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const doc = await fetchDoc(`/search?keyword=${encodeURIComponent(query)}`, ctx, 120);
        return { items: cardsOf(doc), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/detail/${id}.html`, ctx, 300);

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'other', playlists: [] };

        const img = doc.first('img');
        const cover = coverOf(img && img.attr('src'));
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        const kw = doc.first('meta[name="keywords"]');
        const keywords = trim(kw && kw.attr('content')).split(/[,，]/).map(t => trim(t)).filter(t => t && t.length <= 30);
        if (keywords.length) detail.tags = keywords.slice(0, 20);

        // 线路名与面板一一对应：button[data-target="source-N"] → div#source-N
        const labels = {};
        for (const tab of doc.select('button.source-tab')) {
          const target = trim(tab.attr('data-target'));
          const text = trim(tab.text());
          if (target && text) labels[target] = text;
        }

        for (const panel of doc.select('div.source-panel')) {
          const target = trim(panel.attr('id'));
          const label = labels[target] || '';
          const episodes = [];
          let from = '';
          for (const anchor of panel.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            from = m[2];
            const seq = Number(m[3]);
            const index = episodes.length + 1;
            episodes.push({
              id: `${m[2]}-${m[3]}`,
              index,
              label: trim(anchor.text()) || String(index),
              episodeNumber: Number.isFinite(seq) ? seq : undefined,
            });
          }
          if (!episodes.length || !from) continue;
          if (detail.playlists.some(p => p.id === from)) continue;
          detail.playlists.push({
            id: from,
            label: label || from,
            kind: 'main',
            episodes,
          });
          if (!detail.totalEpisodes) detail.totalEpisodes = episodes.length;
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const primary = detail.playlists[0];
        detail.episodeCount = primary.episodes.length;
        detail.type = primary.episodes.length > 1 ? 'series' : 'movie';
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        let from = '';
        let index = '';
        const m = trim(params.episodeId).match(/^([a-z0-9]+)-(\d+)$/);
        if (m) {
          from = m[1];
          index = m[2];
        } else if (/^\d+$/.test(trim(params.playlistId))) {
          from = trim(params.playlistId);
          index = trim(params.episodeId);
        }
        if (!from || !/^\d+$/.test(index)) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const res = await hg.http.fetch({
          url: `${SITE}/api/play-url`,
          query: { vodId: id, playFrom: from, index },
          headers: { Accept: 'application/json', Referer: `${SITE}/vodplay/${id}-${from}-${index}.html` },
          signal: ctx.signal,
        });
        if (res.status === 429) {
          throw new hg.PluginError('RATE_LIMITED', '解析接口被限流，稍等再试', { retryAfterSec: 20 });
        }
        if (!res.ok) {
          throw new hg.PluginError('UPSTREAM_ERROR', `解析接口返回 ${res.status}`);
        }
        let data = null;
        try {
          data = JSON.parse(res.data);
        } catch {
          throw new hg.PluginError('UPSTREAM_CHANGED', '解析接口返回格式已变化');
        }
        const url = trim(data && data.url);
        if (!data || data.code !== 200 || !url) {
          throw new hg.PluginError('CONTENT_LOCKED', trim(data && data.msg) || '这条线路解析失败，换一条试试');
        }
        if (trim(data.mode) === 'iframe') {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路要网页播放器解析，换一条线路试试');
        }

        const probe = await probeMedia(url, ctx);
        if (!probe.res) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路的证书有问题，换一条线路试试');
        }
        if (!probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        const headers = probe.res.headers || {};
        const finalUrl = probe.res.url || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType);
        const stream = { url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' };
        const length = Number(headers['content-length']);
        if (!isHls && Number.isFinite(length) && length > 52428800) {
          stream.label = length >= 1073741824
            ? `${(length / 1073741824).toFixed(1)} GB`
            : `${Math.round(length / 1048576)} MB`;
        }
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
