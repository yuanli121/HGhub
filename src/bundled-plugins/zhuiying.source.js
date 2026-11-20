export const meta = {
  id: 'zhuiying.source',
  name: '追影',
  version: '1.0.2',
  protocol: 1,
  kind: 'source',
  description: '追影（zhuiying3.cc）：首页九个分区、六个分类、搜索、详情与多线路解析（player_api 的 md5 token 在插件内自算）。',
  mature: false,
  linkDomains: ['zhuiying3.cc', 'www.zhuiying3.cc', 'del.mt320.com', 'v.fengbao14.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://zhuiying3.cc';
// 同一套站的备用域名：主域被墙/换线/边缘 404 时自动轮换
// 六个官方镜像（发布页 www.zhuiying.vip 列的），两批不同机房，哪条通就走哪条
const HOSTS = [
  'https://zhuiying3.cc',
  'https://zhuiying3.com',
  'https://zhuiying1.cc',
  'https://zhuiying1.com',
  'https://zhuiying2.cc',
  'https://zhuiying2.com',
];
const HOST_KEY = 'zy.host';
// token = md5(baseKey + ts + UA)，UA 必须与发请求时的一致
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  { id: 'dianying', label: '电影', type: 'movie' },
  { id: 'dianshiju', label: '电视剧', type: 'series' },
  { id: 'dongman', label: '动漫', type: 'anime' },
  { id: 'zongyi', label: '综艺', type: 'variety' },
  { id: 'duanju', label: '短剧', type: 'short' },
  { id: 'aiju', label: 'AI剧', type: 'short' },
];

const VIDEO_RE = /^https?:\/\/(?:www\.)?zhuiying3\.cc\/video\/([A-Za-z0-9]+)\.html/i;
const PLAY_RE = /^https?:\/\/(?:www\.)?zhuiying3\.cc\/play\/([A-Za-z0-9]+)-(\d+)-(\d+)\.html/i;
const HREF_VIDEO_RE = /\/video\/([A-Za-z0-9]+)\.html/;
const HREF_PLAY_RE = /\/play\/([A-Za-z0-9]+)-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();

function mediaTypeOf(label, episodeCount) {
  const text = norm(label);
  if (/电影|片$/.test(text)) return 'movie';
  if (/动漫|动画/.test(text)) return 'anime';
  if (/综艺/.test(text)) return 'variety';
  if (/短剧|AI/.test(text)) return 'short';
  if (/剧/.test(text)) return 'series';
  return episodeCount > 1 ? 'series' : 'movie';
}

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
      return res.data;
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
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${host}/` },
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
        return res.data;
      }
      lastStatus = res.status;
      // 403/404/5xx 说明这条线路不适合，换下一个域名
    }
    if (lastStatus) {
      throw new hg.PluginError('UPSTREAM_ERROR', `${HOSTS.length} 个镜像都返回 ${lastStatus}，可能是当前网络被拦`);
    }
    if (lastError) throw lastError;
    throw new hg.PluginError('NETWORK', `${HOSTS.length} 个镜像都连不上，检查网络或代理`);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function cardsOf(root, fallbackType) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_VIDEO_RE);
      if (!m || seen.has(m[1])) continue;
      const titleNode = anchor.first('div.card-title') || anchor.first('.card-title');
      const img = anchor.first('img');
      let title = trim(titleNode && titleNode.text()) || trim(anchor.attr('title')) || trim(img && img.attr('alt'));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: fallbackType || 'other' };
      const cover = norm(img && img.attr('src'));
      if (/^https?:\/\//i.test(cover)) item.cover = cover;
      const status = trim(anchor.first('span.card-status') && anchor.first('span.card-status').text());
      if (status && status.length <= 8) item.badge = status;
      const scoreNode = anchor.first('.score-num');
      const score = Number(trim(scoreNode && scoreNode.text()));
      if (Number.isFinite(score) && score > 0 && score <= 10) item.score = score;
      const tags = [];
      for (const tag of anchor.select('.yk-tag')) {
        const text = trim(tag.text());
        if (text && text.length <= 30 && tags.indexOf(text) < 0) tags.push(text);
      }
      if (tags.length) item.tags = tags.slice(0, 20);
      out.push(item);
    }
    return out;
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', headers: { 'User-Agent': UA }, signal: ctx.signal });
      if (!res.ok) {
        res = await hg.http.fetch({ url, headers: { 'User-Agent': UA, Range: 'bytes=0-1' }, signal: ctx.signal });
      }
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  function hexOf(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function configField(html, name) {
    const m = norm(html).match(new RegExp(`${name}\\s*:\\s*"([^"]*)"`));
    return m ? m[1].replace(/\\\//g, '/') : '';
  }

  function decodePayload(data) {
    const reversed = norm(data).split('').reverse().join('');
    const bytes = hg.codec.base64Decode(reversed);
    const text = hg.codec.utf8Decode(bytes);
    return JSON.parse(text);
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 900);
        const sections = [];
        const seen = new Set();
        for (const block of doc.select('section.section')) {
          const head = block.first('h2.section-title') || block.first('h2');
          const title = trim(head && head.text());
          if (!title || seen.has(title)) continue;
          const items = cardsOf(block);
          if (!items.length) continue;
          seen.add(title);
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
          if (sections.length >= 9) break;
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
        // 站点的分类页只有一页，没有翻页参数
        const doc = await fetchDoc(`/vodshow/${cat.id}-----------.html`, ctx, 300);
        return { items: cardsOf(doc, cat.type), next: null };
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const doc = await fetchDoc(`/vod/search/wd/${encodeURIComponent(query)}.html`, ctx, 120);
        return { items: cardsOf(doc), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^[A-Za-z0-9]+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        let doc;
        try {
          doc = await fetchDoc(`/video/${id}.html`, ctx, 300);
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

        const img = doc.first('img.detail-poster') || doc.first('.detail-poster-wrap img') || doc.first('img');
        let cover = norm(img && (img.attr('data-src') || img.attr('src')));
        if (!/^https?:\/\//i.test(cover)) {
          const og = doc.first('meta[property="og:image"]');
          cover = norm(og && og.attr('content'));
        }
        if (/^https?:\/\//i.test(cover)) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        let catLabel = '';
        for (const a of doc.select('a')) {
          const href = norm(a.attr('href'));
          if (!/^\/vodshow\//.test(href)) continue;
          const text = trim(a.text());
          if (text && text.length <= 8) { catLabel = text; break; }
        }

        // 线路：div.source-tab[data-target="ep-list-{sid}"]，分集在 #ep-list-{sid}
        const tabs = [];
        for (const tab of doc.select('div.source-tab')) {
          const target = norm(tab.attr('data-target')).match(/ep-list-(\d+)/);
          if (!target) continue;
          tabs.push({ sid: target[1], label: trim(tab.text()).replace(/\s+/g, ' ').slice(0, 20) });
        }

        for (const tab of tabs) {
          const list = doc.first(`#ep-list-${tab.sid}`);
          if (!list) continue;
          const episodes = [];
          for (const anchor of list.select('a')) {
            const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
            if (!m) continue;
            const index = episodes.length + 1;
            episodes.push({
              id: `${m[2]}-${m[3]}`,
              index,
              label: trim(anchor.attr('data-name')) || trim(anchor.text()) || String(index),
            });
          }
          if (!episodes.length) continue;
          if (detail.playlists.some(p => p.id === tab.sid)) continue;
          detail.playlists.push({
            id: tab.sid,
            label: tab.label || `线路 ${tab.sid}`,
            kind: 'main',
            episodes,
          });
        }

        if (!detail.playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '这部还没有可播放的剧集');
        const primary = detail.playlists[0];
        detail.episodeCount = primary.episodes.length;
        detail.totalEpisodes = primary.episodes.length;
        detail.type = mediaTypeOf(catLabel, primary.episodes.length);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^[A-Za-z0-9]+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const m = trim(params.episodeId).match(/^(\d+)-(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');
        const sid = m[1];
        const nid = m[2];
        const page = `/play/${id}-${sid}-${nid}.html`;

        let html;
        try {
          html = await fetchText(page, ctx, 0);
        } catch (error) {
          if (error && error.code === 'UPSTREAM_ERROR' && /404/.test(error.message)) {
            throw new hg.PluginError('CONTENT_LOCKED', '这一集已经失效，换一集或换线路试试');
          }
          throw error;
        }
        const directUrl = configField(html, 'directUrl');
        let url = '';
        let urltype = '';

        if (/^https?:\/\//i.test(directUrl) && /m3u8/i.test(directUrl)) {
          url = directUrl;
          urltype = 'hls';
        } else {
          const baseKey = configField(html, 'baseKey');
          const requestUrl = configField(html, 'requestUrl');
          const sourceType = configField(html, 'sourceType');
          if (!baseKey || !requestUrl) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页缺少解析参数');
          if (sourceType && sourceType !== 'nby') {
            throw new hg.PluginError('CONTENT_LOCKED', '这条线路类型不支持，换一条线路试试');
          }

          const ts = Math.floor(Date.now() / 1000);
          const token = hexOf(hg.crypto.digest('md5', baseKey + ts + UA));
          const host = await pickHost(ctx);
          const res = await hg.http.fetch({
            url: `${host}/player_api.php`,
            method: 'POST',
            headers: {
              'User-Agent': UA,
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: `${host}${page}`,
              Origin: host,
            },
            body: `url=${encodeURIComponent(requestUrl)}&timestamp=${ts}&token=${token}`,
            signal: ctx.signal,
          });
          if (res.status === 429) {
            throw new hg.PluginError('RATE_LIMITED', '解析接口被限流，稍等再试', { retryAfterSec: 20 });
          }
          if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `解析接口返回 ${res.status}`);
          let body = null;
          try {
            body = JSON.parse(res.data);
          } catch {
            throw new hg.PluginError('UPSTREAM_CHANGED', '解析接口返回格式已变化');
          }
          if (!body || body.error || !body.data) {
            throw new hg.PluginError('CONTENT_LOCKED', trim(body && (body.msg || body.error)) || '这条线路解析失败，换一条试试');
          }
          let payload = null;
          try {
            payload = decodePayload(body.data);
          } catch {
            throw new hg.PluginError('UPSTREAM_CHANGED', '解析结果解码失败');
          }
          url = norm(payload && payload.jmurl);
          urltype = norm(payload && payload.urltype);
          if (!/^https?:\/\//i.test(url)) {
            throw new hg.PluginError('CONTENT_LOCKED', '这条线路没有返回播放地址');
          }
        }

        const probe = await probeMedia(url, ctx);
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');
        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = /hls|m3u8/i.test(urltype) || /\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/.test(contentType);
        return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
      },

      async matchUrl(params) {
        const url = norm(params.url);
        const play = url.match(PLAY_RE);
        if (play) return { mediaId: play[1], episodeId: `${play[2]}-${play[3]}` };
        const video = url.match(VIDEO_RE);
        if (video) return { mediaId: video[1] };
        return null;
      },
    },
  };
};
