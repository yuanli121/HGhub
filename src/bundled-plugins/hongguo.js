// 红果短剧聚合插件（HPP）
// 聚合多个短剧平台公开接口（西饭短剧/星芽短剧），搜索聚合、详情与播放均走各平台直链。
// 参考社区 TVBox 聚合源（cluntop/tvbox 聚合短剧.js）的接口表，按 HPP 协议重写实现。
// 西饭：OPPO 系短剧，无签名；播放地址为 302 跳转的带签名 mp4（约 1 小时有效）。
// 星芽：登录一次换 token（无密码），分类/详情/播放直链带签名与过期时间。
export const meta = {
  id: 'duanju.agg',
  name: '红果短剧',
  version: '1.0.0',
  protocol: 1,
  description: '短剧聚合源：西饭短剧 + 星芽短剧，热门分类、搜索聚合、直链播放（mp4）。',
  author: 'community',
  kind: 'source',
  allowInsecureHttp: true,
  timeouts: { read: 15 },
  defaultHeaders: { 'User-Agent': 'okhttp/3.12.11' },
  settings: [
    { key: 'xifan', type: 'switch', label: '启用西饭短剧', default: true },
    { key: 'xingya', type: 'switch', label: '启用星芽短剧', default: true },
    { key: 'timeoutSec', type: 'number', label: '请求超时（秒）', default: 12, min: 5, max: 30 },
  ],
};

const UA = 'okhttp/3.12.11';
const XF_HOST = 'https://xifan-api-cn.youlishipin.com';
const XY_HOST = 'https://app.whjzjx.cn';
const XY_LOGIN = 'https://u.shytkjgs.com/user/v1/account/login';
const XY_DEVICE = '24250683a3bdb3f118dff25ba4b1cba1a';

// 星芽分类（theater_class_id）
const XY_CLASSES = [
  { id: '1', label: '热播' },
  { id: '2', label: '新剧' },
  { id: '7', label: '优选好剧' },
  { id: '8', label: '会员专属' },
  { id: '3', label: '新番' },
  { id: '5', label: '阳光剧场' },
];
// 西饭分类（categoryId@categoryName）
const XF_CLASSES = [
  { id: '68', label: '都市' },
  { id: '68', label: '甜宠' },
  { id: '81', label: '现代言情' },
  { id: '81', label: '战神' },
  { id: '79', label: '逆袭' },
  { id: '81', label: '重生' },
  { id: '79', label: '婚恋' },
  { id: '81', label: '赘婿' },
  { id: '80', label: '玄幻' },
];

const PAGE_SIZE = 24;

export default function (hg) {
  let xyToken = null;

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function on(platform) {
    const v = hg.settings.get(platform);
    return v === undefined ? true : !!v;
  }

  function timeoutMs() {
    const n = Number(hg.settings.get('timeoutSec'));
    return Number.isFinite(n) && n >= 5 && n <= 30 ? Math.floor(n * 1000) : 12000;
  }

  // ---- 通用请求 ----
  async function getJson(url, ctx, extraHeaders, cacheTtl) {
    const res = await hg.http.fetch({
      url,
      headers: Object.assign({ 'User-Agent': UA }, extraHeaders || null),
      responseType: 'text',
      timeoutMs: timeoutMs(),
      retry: 1,
      cache: cacheTtl ? { ttlSec: cacheTtl } : undefined,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '上游不可达（HTTP ' + res.status + '）');
    let data;
    try { data = JSON.parse(res.data); } catch (e) { fail('UPSTREAM_CHANGED', '上游返回不是 JSON'); }
    return data;
  }

  async function postJson(url, body, ctx, extraHeaders) {
    const res = await hg.http.fetch({
      url,
      method: 'POST',
      headers: Object.assign({ 'User-Agent': UA }, extraHeaders || null),
      body: { json: body },
      responseType: 'text',
      timeoutMs: timeoutMs(),
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '上游不可达（HTTP ' + res.status + '）');
    let data;
    try { data = JSON.parse(res.data); } catch (e) { fail('UPSTREAM_CHANGED', '上游返回不是 JSON'); }
    return data;
  }

  // ---- 星芽 ----
  async function xyLogin(ctx) {
    if (xyToken) return xyToken;
    const data = await postJson(XY_LOGIN, { device: XY_DEVICE }, ctx, {
      'Content-Type': 'application/json', platform: '1', 'User-Agent': 'okhttp/4.10.0',
    });
    const token = data && data.data && data.data.token;
    if (!token) fail('UPSTREAM_CHANGED', '星芽登录接口结构变化');
    xyToken = token;
    return xyToken;
  }

  async function xyAuthHeaders(ctx) {
    return { authorization: await xyLogin(ctx) };
  }

  async function xyHomePage(classId, page, ctx) {
    const data = await getJson(
      XY_HOST + '/cloud/v2/theater/home_page?theater_class_id=' + encodeURIComponent(classId || '1') +
      '&type=1&class2_ids=0&page_num=' + (page || 1) + '&page_size=' + PAGE_SIZE,
      ctx, await xyAuthHeaders(ctx), 120);
    const list = (data && data.data && data.data.list) || [];
    const items = [];
    for (const row of list) {
      const t = row && row.theater;
      if (!t) continue;
      items.push({
        id: 'xy|' + t.id,
        title: t.title,
        type: 'tv',
        cover: t.cover_url || undefined,
        badge: t.total ? '全' + t.total + '集' : undefined,
        tags: t.theme ? [t.theme] : undefined,
        episodeCount: Number(t.total) || undefined,
      });
    }
    return items;
  }

  async function xySearch(query, ctx) {
    const data = await postJson(XY_HOST + '/v3/search', { text: query }, ctx, await xyAuthHeaders(ctx));
    const rows = data && data.data && data.data.theater && data.data.theater.search_data || [];
    return rows.map(function (i) {
      return {
        id: 'xy|' + i.id,
        title: i.title,
        type: 'tv',
        cover: i.cover_url || undefined,
        badge: i.total ? '全' + i.total + '集' : undefined,
        episodeCount: Number(i.total) || undefined,
      };
    });
  }

  async function xyDetail(id, ctx) {
    const data = await getJson(XY_HOST + '/v2/theater_parent/detail?theater_parent_id=' + encodeURIComponent(id), ctx, await xyAuthHeaders(ctx));
    return (data && data.data) || null;
  }

  // ---- 西饭 ----
  async function xfPortal(categoryId, categoryName, offset, ctx) {
    const params = 'reqType=aggregationPage&offset=' + (offset || 0) +
      '&categoryId=' + encodeURIComponent(categoryId || '') +
      '&quickEngineVersion=-1&scene=&categoryNames=' + encodeURIComponent(categoryName || '') +
      '&categoryVersion=1&density=1.5&pageID=page_theater&version=2001001&androidVersionCode=28' +
      '&appId=drama&teenMode=false&userBaseMode=false';
    const data = await getJson(XF_HOST + '/xifan/drama/portalPage?' + params, ctx, null, 120);
    return (data && data.result && data.result.elements) || [];
  }

  async function xfSearch(query, ctx) {
    const data = await getJson(
      XF_HOST + '/xifan/search/getSearchList?reqType=search&offset=0&keyword=' + encodeURIComponent(query) +
      '&quickEngineVersion=-1&scene=', ctx, null, 60);
    return (data && data.result && data.result.elements) || [];
  }

  function xfItemsFromElements(elements) {
    const items = [];
    for (const s of elements || []) {
      for (const v of s.contents || []) {
        const d = v.duanjuVo;
        if (!d || !d.duanjuId) continue;
        items.push({
          id: 'xf|' + d.duanjuId + '|' + (d.source || ''),
          title: d.title,
          type: 'tv',
          cover: d.coverImageUrl || undefined,
          badge: d.total ? '全' + d.total + '集' : undefined,
          episodeCount: Number(d.total) || undefined,
        });
      }
    }
    return items;
  }

  async function xfDetail(duanjuId, source, ctx) {
    const data = await getJson(
      XF_HOST + '/xifan/drama/getDuanjuInfo?duanjuId=' + encodeURIComponent(duanjuId) +
      '&source=' + encodeURIComponent(source || ''), ctx, null, 120);
    return (data && data.result) || null;
  }

  // ---- HPP 能力 ----
  function enabledPlatforms() {
    const plats = [];
    if (on('xifan')) plats.push('xf');
    if (on('xingya')) plats.push('xy');
    return plats;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const plats = enabledPlatforms();
        if (!plats.length) fail('UNSUPPORTED', '请先在插件设置里启用至少一个平台');
        const sections = [];
        if (plats.includes('xy')) {
          try {
            const hot = await xyHomePage('1', 1, ctx);
            if (hot.length) sections.push({ id: 'sec|xy|hot', title: '星芽 · 热播短剧', layout: 'grid', imageAspect: 'portrait', items: hot });
          } catch (e) { /* 单平台失败不影响其他分区 */ }
          try {
            const news = await xyHomePage('2', 1, ctx);
            if (news.length) sections.push({ id: 'sec|xy|new', title: '星芽 · 新剧上架', layout: 'row', imageAspect: 'portrait', items: news });
          } catch (e) { /* 同上 */ }
        }
        if (plats.includes('xf')) {
          try {
            const elements = await xfPortal('', '', 0, ctx);
            const items = xfItemsFromElements(elements);
            if (items.length) sections.push({ id: 'sec|xf|hot', title: '西饭 · 精选短剧', layout: 'grid', imageAspect: 'portrait', items: items.slice(0, 30) });
          } catch (e) { /* 同上 */ }
        }
        if (!sections.length) fail('UPSTREAM_ERROR', '所有平台均不可用');
        return { items: sections };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const plats = enabledPlatforms();
        const cats = [];
        if (plats.includes('xy')) {
          cats.push({
            id: 'xy', label: '星芽短剧',
            children: [
              { id: 'xy|cls|1', label: '热播' },
              { id: 'xy|cls|2', label: '新剧' },
              { id: 'xy|cls|7', label: '优选好剧' },
              { id: 'xy|cls|8', label: '会员专属' },
              { id: 'xy|cls|3', label: '新番' },
              { id: 'xy|cls|5', label: '阳光剧场' },
            ],
          });
        }
        if (plats.includes('xf')) {
          cats.push({
            id: 'xf', label: '西饭短剧',
            children: [
              { id: 'xf|cat||', label: '精选' },
              { id: 'xf|cat|68|都市', label: '都市' },
              { id: 'xf|cat|68|甜宠', label: '甜宠' },
              { id: 'xf|cat|81|现代言情', label: '现代言情' },
              { id: 'xf|cat|81|战神', label: '战神' },
              { id: 'xf|cat|79|逆袭', label: '逆袭' },
              { id: 'xf|cat|81|重生', label: '重生' },
              { id: 'xf|cat|79|婚恋', label: '婚恋' },
              { id: 'xf|cat|81|赘婿', label: '赘婿' },
              { id: 'xf|cat|80|玄幻', label: '玄幻' },
            ],
          });
        }
        if (!cats.length) fail('UNSUPPORTED', '请先在插件设置里启用至少一个平台');
        return cats;
      },

      async list(params, ctx) {
        const cid = String(params.categoryId || '');
        const page = parseInt(params.cursor || '1', 10) || 1;
        if (cid.startsWith('xy|cls|')) {
          const classId = cid.slice('xy|cls|'.length);
          const items = await xyHomePage(classId, page, ctx);
          return { items, next: items.length === PAGE_SIZE ? String(page + 1) : null };
        }
        if (cid.startsWith('xf|cat|')) {
          const rest = cid.slice('xf|cat|'.length);
          const bar = rest.indexOf('|');
          const catId = bar >= 0 ? rest.slice(0, bar) : rest;
          const catName = bar >= 0 ? rest.slice(bar + 1) : '';
          const elements = await xfPortal(catId, catName, (page - 1) * 30, ctx);
          const items = xfItemsFromElements(elements);
          return { items, next: items.length ? String(page + 1) : null };
        }
        fail('NOT_FOUND', '未知分类');
      },

      async getFilters(params, ctx) {
        return {};
      },
    },

    search: {
      async search(params, ctx) {
        const query = String(params.query || '').trim();
        if (!query) fail('INVALID_ARGS', '请输入搜索关键词');
        const plats = enabledPlatforms();
        if (!plats.length) fail('UNSUPPORTED', '请先在插件设置里启用至少一个平台');
        const jobs = [];
        if (plats.includes('xy')) jobs.push(xySearch(query, ctx).then(function (items) { return items; }).catch(function () { return []; }));
        if (plats.includes('xf')) jobs.push(xfSearch(query, ctx).then(xfItemsFromElements).catch(function () { return []; }));
        const groups = await Promise.all(jobs);
        const seen = {};
        const merged = [];
        for (const g of groups) {
          for (const item of g) {
            if (!seen[item.id]) {
              seen[item.id] = true;
              merged.push(item);
            }
          }
          if (merged.length >= 80) break;
        }
        return { items: merged.slice(0, 80), next: null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String(params.id || '');
        const bar = id.indexOf('|');
        const plat = bar > 0 ? id.slice(0, bar) : '';
        const rest = bar > 0 ? id.slice(bar + 1) : '';
        if (plat === 'xy') {
          const d = await xyDetail(rest, ctx);
          if (!d) fail('NOT_FOUND', '剧集不存在');
          const episodes = (d.theaters || []).map(function (t, i) {
            return {
              id: 'xy|' + d.id + '|' + t.num,
              index: i,
              episodeNumber: Number(t.num) || (i + 1),
              label: '第' + t.num + '集',
            };
          });
          return {
            id: id,
            title: d.title,
            type: 'tv',
            cover: d.cover_url || undefined,
            description: d.introduction || undefined,
            tags: (d.class_two || []).map(function (c) { return c.class_name; }),
            episodeCount: episodes.length,
            playlists: [{ id: 'pl|xy|' + d.id, label: '星芽短剧', kind: 'main', episodes }],
          };
        }
        if (plat === 'xf') {
          const bar2 = rest.indexOf('|');
          const duanjuId = bar2 >= 0 ? rest.slice(0, bar2) : rest;
          const source = bar2 >= 0 ? rest.slice(bar2 + 1) : '';
          const d = await xfDetail(duanjuId, source, ctx);
          if (!d) fail('NOT_FOUND', '剧集不存在');
          const episodes = (d.episodeList || []).map(function (e, i) {
            return {
              id: 'xf|' + duanjuId + '|' + e.episodeId,
              index: i,
              episodeNumber: Number(e.index) || (i + 1),
              label: '第' + (e.index || i + 1) + '集',
            };
          });
          return {
            id: id,
            title: d.title,
            type: 'tv',
            cover: d.coverImageUrl || undefined,
            description: d.desc || undefined,
            tags: d.categories || undefined,
            episodeCount: episodes.length,
            playlists: [{ id: 'pl|xf|' + duanjuId, label: '西饭短剧', kind: 'main', episodes }],
          };
        }
        fail('NOT_FOUND', '未知资源');
      },

      async resolvePlayback(params, ctx) {
        const mediaId = String(params.mediaId || '');
        const epId = String(params.episodeId || '');
        const bar = mediaId.indexOf('|');
        const plat = bar > 0 ? mediaId.slice(0, bar) : '';
        if (plat === 'xy') {
          const theaterId = bar > 0 ? mediaId.slice(bar + 1) : '';
          // 每次重新拉详情：签名播放地址会过期，拿到最新地址与过期时间
          const d = await xyDetail(theaterId, ctx);
          if (!d) fail('NOT_FOUND', '剧集不存在');
          const num = epId.split('|').pop();
          const t = (d.theaters || []).find(function (x) { return String(x.num) === String(num); }) || (d.theaters || [])[0];
          if (!t) fail('NOT_FOUND', '剧集分集不存在');
          const url = t.son_video_url;
          if (!url) fail('CONTENT_LOCKED', '该集暂无播放地址');
          return {
            streams: [{ url, kind: 'media', format: 'progressive', label: '流畅' }],
            expiresAt: t.video_expiry_time || undefined,
          };
        }
        if (plat === 'xf') {
          const bar2 = mediaId.slice(bar + 1).indexOf('|');
          const duanjuId = bar2 >= 0 ? mediaId.slice(bar + 1, bar + 1 + bar2) : mediaId.slice(bar + 1);
          const d = await xfDetail(duanjuId, '', ctx);
          if (!d) fail('NOT_FOUND', '剧集不存在');
          const episodeId = epId.split('|').pop();
          const e = (d.episodeList || []).find(function (x) { return String(x.episodeId) === String(episodeId); }) || (d.episodeList || [])[0];
          if (!e) fail('NOT_FOUND', '剧集分集不存在');
          const url = e.playUrl;
          if (!url) fail('CONTENT_LOCKED', '该集暂无播放地址');
          // playUrl 会 302 到约 1 小时有效的签名 mp4；播放器跟随跳转即可
          return {
            streams: [{ url, kind: 'media', format: 'progressive', label: '超清' }],
            expiresAt: Date.now() + 3500 * 1000,
          };
        }
        fail('NOT_FOUND', '未知资源');
      },
    },
  };
}
