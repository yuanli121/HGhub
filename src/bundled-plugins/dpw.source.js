export const meta = {
  id: 'dpw.source',
  name: '66大片网',
  version: '1.1.0',
  protocol: 1,
  kind: 'source',
  description:
    '66大片网（77dpw.vip）：苹果CMS + mxpro 模板。首页六个分区、五个频道分页、详情与分集 HLS。列表走站内 ajax 数据接口；播放页的片源是 base64 再 urlencode 的密文，解开后只有「极速」那条是直连 m3u8，腾讯/爱奇艺/芒果/B站那几条跳正版平台，按 external 交给系统打开。站内搜索要图形验证码，未提供。',
  mature: false,
  linkDomains: ['77dpw.vip'],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const BASE = 'https://www.77dpw.vip';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// 苹果CMS 的 ajax 列表接口：分类页原生就是靠它做「加载更多」，字段比 HTML 全，还带页码。
const AJAX = '/index.php/ajax/data';

// 详情页的线路标签就是源名，实测与播放页里的 from 一一对应：
//   极速   → jsm3u8  → vv.jisuzyv.com 的 m3u8
//   腾讯视频 → qq      → v.qq.com
//   爱奇艺  → qiyi    → iqiyi.com
//   芒果TV  → mgtv    → mgtv.com
// 宿主 0.0.5 起支持 kind:"external"，正版那几条不再排掉，播放时交系统打开。
const PLATFORM_TAB = /腾讯|爱奇艺|优酷|芒果|B站|bilibili|搜狐|PPTV|咪咕|抖音|乐视|AcFun/i;

const EXTERNAL_APP = [
  [/qq|腾讯/i, '腾讯视频'],
  [/qiyi|奇异|爱奇艺/i, '爱奇艺'],
  [/youku|优酷/i, '优酷'],
  [/bilibili|B站/i, '哔哩哔哩'],
  [/mgtv|芒果/i, '芒果TV'],
  [/sohu|搜狐/i, '搜狐视频'],
  [/pptv|pp视频/i, 'PP视频'],
  [/migu|咪咕/i, '咪咕视频'],
  [/letv|乐视/i, '乐视视频'],
  [/acfun/i, 'AcFun'],
];

function appOf(...hints) {
  const text = hints.filter(Boolean).join(' ');
  for (const [re, app] of EXTERNAL_APP) if (re.test(text)) return app;
  return '';
}

// 外部打开不附带请求头、Cookie 和变换，宿主只把地址交给系统，所以这里不带 headers。
function externalStream(url, label, from) {
  const app = appOf(from, label, url);
  const stream = { url, kind: 'external' };
  if (app) stream.external = { app };
  stream.label = (app || trim(label) || '外部打开').slice(0, 60) + ' · 外部打开';
  return stream;
}

const CATS = [
  { id: '1', label: '电影', type: 'movie' },
  { id: '2', label: '动漫', type: 'anime' },
  { id: '3', label: '剧集', type: 'series' },
  { id: '4', label: '短剧', type: 'short' },
  { id: '5', label: '综艺', type: 'variety' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?77dpw\.vip\/voddetail\/(\d+)\.html/i;
const HREF_DETAIL_RE = /\/voddetail\/(\d+)\.html/;
const HREF_PLAY_RE = /\/vodplay\/(\d+)-(\d+)-(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let base64Impl = null;

// 站里的地址是 encrypt=2：先 base64，再整串 percent-encode。
//   JTY4JTc0… → %68%74%74%70%73… → https://…
function decodeUrl(raw, encrypt) {
  let text = trim(norm(raw));
  if (!text) return '';
  if (Number(encrypt) === 2 && base64Impl) {
    try {
      const bytes = base64Impl(text);
      if (bytes && bytes.length) {
        let out = '';
        for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
        text = out;
      }
    } catch {
      // 解不动就按原样往下走
    }
  }
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      text = text.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
  }
  return trim(text);
}

function imageOf(raw) {
  const url = trim(raw);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (/\/load\.gif|placeholder|^\/$/i.test(url)) return '';
  if (url.startsWith('/')) return `${BASE}${url}`;
  return url;
}

function typeOf(typeId, typeName, episodes) {
  const byId = CATS.find(c => c.id === String(typeId));
  if (byId) return byId.type;
  const t = norm(typeName);
  if (/动漫|动画/.test(t)) return 'anime';
  if (/综艺/.test(t)) return 'variety';
  if (/短剧/.test(t)) return 'short';
  if (/纪录/.test(t)) return 'documentary';
  if (/剧|连续/.test(t)) return 'series';
  return episodes > 1 ? 'series' : 'movie';
}

export default function (hg) {
  base64Impl = s => hg.codec.base64Decode(s);

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${BASE}/` },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 900 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  async function ajax(tid, page, ctx, ttl) {
    const res = await hg.http.fetch({
      url: `${BASE}${AJAX}`,
      query: { mid: '1', tid: String(tid || 0), page: String(page), limit: '20' },
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: `${BASE}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      responseType: 'json',
      retry: 1,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 900 } } : {}),
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `列表接口返回 ${res.status}`);
    const data = typeof res.data === 'string' ? safeJson(res.data) : res.data;
    if (!data || !Array.isArray(data.list)) {
      throw new hg.PluginError('UPSTREAM_CHANGED', '列表接口结构已变化');
    }
    return data;
  }

  function itemOf(row) {
    const id = String(row && row.vod_id);
    const title = trim(row && row.vod_name);
    if (!/^\d+$/.test(id) || !title) return null;
    const serial = Number(row.vod_serial);
    const total = Number(row.vod_total);
    const item = {
      id,
      title: title.slice(0, 200),
      type: typeOf(row.type_id, row.type_name, Number.isFinite(serial) ? serial : 0),
    };
    const cover = imageOf(row.vod_pic);
    if (cover) item.cover = cover;
    const blurb = trim(row.vod_blurb) || trim(String(row.vod_content || '').replace(/<[^>]+>/g, ''));
    if (blurb) item.description = blurb.slice(0, 400);
    const tags = [row.type_name, row.vod_area, row.vod_year].map(v => trim(norm(v))).filter(Boolean);
    if (tags.length) item.tags = tags.slice(0, 4);
    const score = Number(row.vod_score);
    if (Number.isFinite(score) && score > 0) item.score = Math.min(10, score);
    const year = Number(row.vod_year);
    if (Number.isFinite(year) && year > 1900) item.year = year;
    if (row.vod_isend !== undefined) item.status = Number(row.vod_isend) === 1 ? 'finished' : 'ongoing';
    if (Number.isFinite(total) && total > 0) item.episodeCount = total;
    else if (Number.isFinite(serial) && serial > 0) item.episodeCount = serial;
    const remark = trim(row.vod_remarks);
    if (remark && !item.episodeCount && remark.length <= 8) item.badge = remark;
    return item;
  }

  function pageOf(data, builder) {
    const page = Number(data.page) || 1;
    const pages = Number(data.pagecount) || 1;
    const out = { items: (data.list || []).map(builder).filter(Boolean) };
    const total = Number(data.total);
    if (Number.isFinite(total) && total > 0) out.total = total;
    if (page < pages) out.next = String(page + 1);
    return out;
  }

  // mxpro 模板的线路面板 id 全叫 panel1，认不出 sid，只能靠顺序：
  // 第 i 个 module-tab-item 对应第 i 个 module-play-list-content，sid 从分集链接里取。
  function playlistsOf(doc, id) {
    const tabNames = doc
      .select('.module-tab-item')
      .map(t => trim(t.attr('data-dropdown-value') || t.text()));
    const panes = doc.select('.module-play-list-content');
    const playlists = [];
    panes.forEach((pane, i) => {
      const label = tabNames[i] || '';
      const episodes = [];
      const seenNid = new Set();
      for (const anchor of pane.select('a')) {
        const m = norm(anchor.attr('href')).match(HREF_PLAY_RE);
        if (!m || m[1] !== id) continue;
        const sid = m[2];
        const nid = Number(m[3]);
        if (!Number.isInteger(nid) || seenNid.has(nid)) continue;
        seenNid.add(nid);
        const span = anchor.first('span');
        episodes.push({
          id: `s${sid}e${nid}`,
          index: episodes.length + 1,
          episodeNumber: nid,
          label: trim((span && span.text()) || anchor.attr('title')) || String(nid),
        });
      }
      if (!episodes.length) return;
      const sid = episodes[0].id.slice(1).replace(/e\d+$/, '');
      if (playlists.some(p => p.id === `s${sid}`)) return;
      playlists.push({
        id: `s${sid}`,
        label: (label || `线路${sid}`).slice(0, 200),
        kind: 'main',
        episodes,
      });
    });
    return playlists;
  }

  return {
    home: {
      async getSections(params, ctx) {
        // 一次 ajax 就一百多 KB，全部并起来发，串着等要三四秒。
        const [latest, ...rest] = await Promise.all([
          ajax(0, 1, ctx, 600),
          ...CATS.map(cat => ajax(cat.id, 1, ctx, 600)),
        ]);
        const pick = data => (data.list || []).map(itemOf).filter(Boolean).slice(0, 24);
        const sections = [
          { id: 'latest', title: '最新更新', layout: 'grid', items: pick(latest) },
        ];
        CATS.forEach((cat, i) => {
          const items = pick(rest[i]);
          if (items.length) sections.push({ id: `c${cat.id}`, title: cat.label, layout: 'row', items });
        });
        if (sections.length < 2) throw new hg.PluginError('UPSTREAM_CHANGED', '首页拿不到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return CATS.map(c => ({ id: c.id, label: c.label }));
      },

      async list(params, ctx) {
        const id = trim(params && params.categoryId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const data = await ajax(id, page, ctx, 120);
        const out = pageOf(data, itemOf);
        const t = typeOf(id, '', 0);
        for (const item of out.items) item.type = t;
        return out;
      },
    },

    // 站内搜索要图形验证码（/index.php/ajax/verify_check?type=search），
    // 没有登录态就过不去，所以不提供 search 能力。

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const doc = await fetchDoc(`/voddetail/${id}.html`, ctx, 0);

        let title = '';
        const h1 = doc.first('h1');
        if (h1) title = trim(h1.text());
        if (!title) {
          const t = doc.first('.module-info-name') || doc.first('title');
          title = trim(t && t.text()).split(/\s*[-_|]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const out = { id, title: title.slice(0, 200), type: 'movie', playlists: [] };

        const coverImg = doc.first('.module-item-pic img') || doc.first('.module-info-pic img');
        const cover = imageOf(
          (coverImg &&
            (coverImg.attr('data-original') || coverImg.attr('data-src') || coverImg.attr('src'))) || ''
        );
        if (cover) out.cover = cover;

        const intro = doc.first('.module-info-introduction') || doc.first('.vod_content');
        const overview = trim(intro && intro.text());
        if (overview) out.description = overview.slice(0, 5000);

        // 分类/年份/地区都在 module-info-item 里，形如「分类：电影」
        const tags = [];
        let catName = '';
        let year = 0;
        for (const span of doc.select('.module-info-item')) {
          const text = trim(span.text());
          const m = text.match(/^(分类|类型|年份|地区|语言)[：:](.+)$/);
          if (!m) continue;
          if (m[1] === '分类' || m[1] === '类型') catName = trim(m[2]);
          else if (m[1] === '年份') year = Number(trim(m[2]).replace(/[^0-9]/g, '')) || 0;
          else if (m[1] === '地区') tags.push(trim(m[2]));
        }
        if (catName) tags.unshift(catName);
        if (year) tags.push(String(year));
        if (tags.length) out.tags = tags.slice(0, 6);

        const playlists = playlistsOf(doc, id);
        if (!playlists.length) {
          throw new hg.PluginError(
            'CONTENT_LOCKED',
            '这部只挂了腾讯视频/爱奇艺/芒果TV 的正版页，没有直连片源'
          );
        }

        const total = Math.max(...playlists.map(p => p.episodes.length));
        out.type = typeOf('', catName, total);
        out.playlists = playlists;
        if (total > 1) {
          if (out.type === 'movie') out.type = 'series';
          out.episodeCount = total;
          out.totalEpisodes = total;
        }
        return out;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const sid = (trim(params && params.playlistId).match(/^s(\d+)$/) || [])[1];
        const nid = (trim(params && params.episodeId).match(/e(\d+)$/) || [])[1];
        if (!sid || !nid) throw new hg.PluginError('INVALID_ARGUMENT', '分集标识不合法');

        // 地址是现签的，不缓存；每次播放重新读一遍播放页。
        const html = await fetchText(`/vodplay/${id}-${sid}-${nid}.html`, ctx, 0);
        const m = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!m) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页里没有播放器配置');
        const cfg = safeJson(m[1].trim());
        if (!cfg) throw new hg.PluginError('UPSTREAM_CHANGED', '播放器配置解析失败');

        const url = decodeUrl(cfg.url, cfg.encrypt);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这条线路没有给出地址');
        const from = trim(cfg.from);
        if (!/\.m3u8(\?|$)/i.test(url)) {
          // 正版平台页：宿主播不了，但地址本身有效，交系统打开。
          if (/^https?:\/\//i.test(url)) return { streams: [externalStream(url, from, from)] };
          throw new hg.PluginError('CONTENT_LOCKED', `${from || '这条线路'} 没有可播放的地址`);
        }
        // 这里刻意不探活：极速的 CDN（vv.jisuzyv.com）只放行国内网络，
        // 从别的线路去探必然拿不到清单，探出来的「失效」是假的。
        return {
          streams: [
            {
              url,
              kind: 'media',
              format: 'hls',
              label: (trim(cfg.from) || '直连').slice(0, 40),
            },
          ],
        };
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        const d = raw.match(DETAIL_RE);
        if (d) return { mediaId: d[1] };
        const p = raw.match(/\/vodplay\/(\d+)-(\d+)-(\d+)\.html/i);
        if (p) return { mediaId: p[1], episodeId: `s${p[2]}e${p[3]}` };
        const c = raw.match(/^https?:\/\/(?:www\.)?77dpw\.vip\/vodtype\/(\d+)/i);
        if (c) return { categoryId: c[1] };
        return null;
      },
    },
  };
}
