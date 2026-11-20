export const meta = {
  id: 'kxyy.source',
  name: '开心影院',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '开心影院（kxyy1.cc）：四个分类分页、关键词联想搜索、详情与多线路 m3u8 直连；主域异常自动切备用域名。',
  mature: false,
  linkDomains: ['www.kxyy1.cc', 'kxyy1.cc', 'kxyytv.com', 'v.fengbao14.com', 'v.lfthirtytwo.com'],
  timeouts: { read: 20, playback: 30 },
};

const HOSTS = ['https://www.kxyy1.cc', 'https://kxyytv.com', 'https://www.kxyytv.com'];
const HOST_KEY = 'kx.host';

// 站点自己的播放器接管这两类线路，网页端播不了：
//   NBY（YX源）→ nby.php 签名接口，实测返回 {"jmurl":null}
//   hongguo / RRSP（APP专线）→ /static/player/app_only.html「仅 App 可看」
const APP_ONLY_KEYS = { NBY: true, hongguo: true, RRSP: true };
const APP_ONLY_LABEL_RE = /^(YX源|APP专线)/;

const CATS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '电视剧', type: 'series' },
  { id: '3', label: '综艺', type: 'variety' },
  { id: '4', label: '动漫', type: 'anime' },
];

const HOME_SECTIONS = [
  { id: '1', title: '最新电影' },
  { id: '2', title: '最新电视剧' },
  { id: '3', title: '最新综艺' },
  { id: '4', title: '最新动漫' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?(?:kxyy1\.cc|kxyytv\.com)\/voddetail\/(\d+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?(?:kxyy1\.cc|kxyytv\.com)\/vodplay\/(\d+)-(\d+)-(\d+)\.html/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');

// 站点的缓存层偶尔把整页 HTML 当成 JSON 字符串吐出来（引号、\/ 和 \uXXXX 转义）
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
  let currentHost = '';

  async function pickHost(ctx) {
    if (currentHost) return currentHost;
    const saved = await hg.storage.get(HOST_KEY).catch(() => '');
    currentHost = HOSTS.indexOf(saved) >= 0 ? saved : HOSTS[0];
    return currentHost;
  }

  async function fetchText(path, ctx, ttl) {
    if (path.startsWith('http')) {
      const res = await hg.http.fetch({ url: path, signal: ctx.signal });
      if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
      return unwrapBody(res.data);
    }
    const start = HOSTS.indexOf(await pickHost(ctx));
    let lastStatus = 0;
    let lastError = null;
    for (let i = 0; i < HOSTS.length; i++) {
      const host = HOSTS[(start + i) % HOSTS.length];
      let res;
      try {
        res = await hg.http.fetch({
          url: `${host}${path}`,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/json',
            Referer: `${host}/`,
          },
          retry: 1,
          signal: ctx.signal,
          ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
        });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (res.ok) {
        if (host !== currentHost) {
          currentHost = host;
          hg.storage.set(HOST_KEY, host, { ttlSec: 86400 }).catch(() => {});
        }
        return unwrapBody(res.data);
      }
      lastStatus = res.status;
    }
    if (lastStatus) throw new hg.PluginError('UPSTREAM_ERROR', `${HOSTS.length} 个镜像都返回 ${lastStatus}，可能是当前网络被拦`);
    if (lastError) throw lastError;
    throw new hg.PluginError('NETWORK', `${HOSTS.length} 个镜像都连不上，检查网络或代理`);
  }

  async function fetchDoc(path, ctx, ttl) {
    // 站点偶发返回一个解析不出节点的变体页，遇到就换域名重取一次
    for (let attempt = 0; attempt < 2; attempt++) {
      const doc = hg.html.parse(await fetchText(path, ctx, ttl));
      if (doc.select('a').length) return doc;
      hg.log.warn(`页面没有可解析节点，重试（第 ${attempt + 1} 次）：${path}`);
      currentHost = '';
      await hg.storage.delete(HOST_KEY).catch(() => {});
    }
    throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
  }

  function coverOf(img) {
    const raw = norm(img && img.attr('data-src')) || norm(img && img.attr('src'));
    if (!/^https?:\/\//i.test(raw)) return '';
    return raw.replace(/^http:\/\//i, 'https://');
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const head = anchor.first('h3') || anchor.parent().first('h3');
      const img = anchor.first('img');
      let title = trim(head && head.text()) || trim(anchor.attr('title')) || trim(img && img.attr('alt'));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: fallbackType || 'other' };
      const cover = coverOf(img);
      if (cover) item.cover = cover;
      const badge = anchor.first('span.badge');
      const badgeText = trim(badge && badge.text());
      if (badgeText && badgeText.length <= 8) item.badge = badgeText;
      const ribbon = anchor.parent().first('.ribbon') || anchor.parent().first('strong.ribbon');
      const score = Number(trim(ribbon && ribbon.text()));
      if (Number.isFinite(score) && score > 0 && score <= 10) item.score = score;
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
        const sections = [];
        for (const sec of HOME_SECTIONS) {
          let doc;
          try {
            doc = await fetchDoc(`/vodshow/${sec.id}-----------.html`, ctx, 900);
          } catch (error) {
            continue;
          }
          const items = cardsOf(doc);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title: sec.title, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页没有取到内容');
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
        const want = pageNo(params.cursor);
        const doc = await fetchDoc(`/vodshow/${cat.id}--------${want}---.html`, ctx, 300);
        const items = cardsOf(doc, cat.type);
        const out = { items };
        const nextHref = `/vodshow/${cat.id}--------${want + 1}---.html`;
        if (items.length && doc.select(`a[href="${nextHref}"]`).length) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        // 站内搜索页是空壳，实际用 maccms 的联想接口拿结果
        let data = null;
        try {
          const text = await fetchText(`/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}`, ctx, 120);
          data = JSON.parse(text);
        } catch (error) {
          return { items: [], next: null };
        }
        const rows = Array.isArray(data && data.list) ? data.list : [];
        const items = [];
        const seen = new Set();
        for (const row of rows) {
          const id = String(row && row.id ? row.id : '');
          const title = trim(row && row.name);
          if (!id || !title || seen.has(id)) continue;
          seen.add(id);
          const item = { id, title, type: 'other' };
          const pic = norm(row.pic).replace(/^http:\/\//i, 'https://');
          if (/^https?:\/\//i.test(pic)) item.cover = pic;
          items.push(item);
        }
        return { items, next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        let doc;
        try {
          doc = await fetchDoc(`/voddetail/${id}.html`, ctx, 300);
        } catch (error) {
          if (error && error.code === 'UPSTREAM_ERROR' && /404/.test(error.message)) {
            throw new hg.PluginError('NOT_FOUND', '这部片子已经下架');
          }
          throw error;
        }

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s*[-_]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'series', playlists: [] };

        const og = doc.first('meta[property="og:image"]');
        const ogCover = norm(og && og.attr('content'));
        const poster = doc.first('a.cover img') || doc.first('img.lozad') || doc.first('img');
        const cover = /^https?:\/\//i.test(ogCover) ? ogCover : coverOf(poster);
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        // 线路标签：a[href="#tabs-home-{sid}"]
        const labels = {};
        for (const tab of doc.select('a')) {
          const target = norm(tab.attr('href')).match(/#tabs-home-(\d+)/);
          if (!target) continue;
          const text = trim(tab.text()).replace(/\d+\s*$/, '').trim();
          if (text) labels[target[1]] = text.slice(0, 20);
        }

        const sids = [];
        for (const pane of doc.select('div.tab-pane')) {
          const pid = norm(pane.attr('id')).match(/tabs-home-(\d+)/);
          if (pid) sids.push({ sid: pid[1], pane });
        }
        if (!sids.length) {
          // 退路：直接从链接里收集 sid
          const seen = new Set();
          for (const anchor of doc.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (m && !seen.has(m[2])) seen.add(m[2]);
          }
          for (const sid of seen) sids.push({ sid, pane: null });
        }

        for (const entry of sids) {
          const sid = entry.sid;
          const source = entry.pane || doc;
          const episodes = [];
          for (const anchor of source.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m || m[2] !== sid) continue;
            const index = episodes.length + 1;
            episodes.push({ id: `${sid}-${m[3]}`, index, label: trim(anchor.text()) || String(index) });
          }
          if (!episodes.length) continue;
          if (detail.playlists.some(p => p.id === sid)) continue;
          const label = labels[sid] || `线路 ${sid}`;
          if (APP_ONLY_LABEL_RE.test(label)) {
            for (const ep of episodes) {
              ep.locked = true;
              ep.lockReason = '仅 App 可看';
            }
            detail.playlists.push({ id: sid, label: `${label}（仅 App）`, kind: 'other', episodes });
            continue;
          }
          detail.playlists.push({ id: sid, label, kind: 'main', episodes });
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');

        // 类型：优先看详情页的 /vodtype/ 链接
        let catSlug = '';
        for (const a of doc.select('a')) {
          const href = norm(a.attr('href'));
          const m = href.match(/\/vodtype\/([a-z]+)\.html/);
          if (m) { catSlug = m[1]; break; }
        }
        const typeMap = { dianying: 'movie', dianshiju: 'series', zongyi: 'variety', dongman: 'anime', duanju: 'short' };
        const count = detail.playlists[0].episodes.length;
        detail.type = typeMap[catSlug] || (count > 1 ? 'series' : 'movie');
        detail.episodeCount = count;
        detail.totalEpisodes = count;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
        const page = `/vodplay/${id}-${m[1]}-${m[2]}.html`;

        let html;
        try {
          html = await fetchText(page, ctx, 0);
        } catch (error) {
          if (error && error.code === 'UPSTREAM_ERROR' && /404/.test(error.message)) {
            throw new hg.PluginError('CONTENT_LOCKED', '这一集已经失效，换一集或换线路试试');
          }
          throw error;
        }

        const dataMatch = norm(html).match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!dataMatch) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页结构已变化');
        let player = null;
        try {
          player = JSON.parse(dataMatch[1].replace(/\\\//g, '/'));
        } catch {
          throw new hg.PluginError('UPSTREAM_CHANGED', '播放数据解析失败');
        }

        const from = norm(player && player.from);
        if (APP_ONLY_KEYS[from]) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路只在 App 内可播，换一条线路试试');
        }

        let url = norm(player && player.url);
        if (norm(player && player.encrypt) === '1') url = decodeURIComponent(url);
        if (!/^https?:\/\//i.test(url)) {
          throw new hg.PluginError('CONTENT_LOCKED', '这条线路要专用播放器解析，换一条线路试试');
        }

        const probe = await probeMedia(url, ctx);
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');
        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType);
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
