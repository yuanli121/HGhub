// TVBox JSON 接口通用适配器（HPP 插件）
// 填一个 TVBox 公共 JSON 接口地址（饭太硬/唐三/道长这类，多仓 config 或单站 api.php/provide/vod），
// 即可在 HGhub 里浏览、搜索、详情、播放。纯接口适配，不依赖任何 jar/蜘蛛。
export const meta = {
  id: 'tvbox.generic',
  name: 'TVBox 接口',
  version: '1.0.0',
  protocol: 1,
  description: '通用 TVBox JSON 接口适配：填一个公共接口地址（多仓配置含 sites 数组，或单站 api.php/provide/vod），即可浏览、搜索与播放。',
  author: 'community',
  kind: 'source',
  allowInsecureHttp: true,
  timeouts: { read: 20 },
  defaultHeaders: { 'User-Agent': 'okhttp/3.15' },
  settings: [
    {
      key: 'api',
      type: 'text',
      label: '接口地址',
      description: 'TVBox JSON 接口地址：多仓配置（含 sites 数组）或单站 api.php/provide/vod 地址。',
      default: 'https://api.apibdzy.com/api.php/provide/vod',
    },
    { key: 'timeoutSec', type: 'number', label: '请求超时（秒）', default: 15, min: 5, max: 30 },
  ],
};

const UA = 'okhttp/3.15';

export default function (hg) {
  let sitesCache = null;          // 解析后的站点列表（配置重载后自动重建）
  const classSeen = {};           // origin -> {id:label} 从列表页收集到的分类

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function apiUrl() {
    const v = hg.settings.get('api');
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) fail('UNSUPPORTED', '请先在插件设置里填写 TVBox 接口地址');
    return s;
  }

  function timeoutMs() {
    const n = Number(hg.settings.get('timeoutSec'));
    return Number.isFinite(n) && n >= 5 && n <= 30 ? Math.floor(n * 1000) : 15000;
  }

  // TVBox 配置/接口常见前导 // 注释，JSON.parse 前先清掉
  function parseJsonC(text) {
    const lines = String(text || '').split('\n');
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trimStart();
      if (t.startsWith('//')) continue;
      kept.push(lines[i]);
    }
    try {
      return JSON.parse(kept.join('\n'));
    } catch (e) {
      return null;
    }
  }

  async function getJson(url, query, ctx, label) {
    const res = await hg.http.fetch({
      url,
      query,
      headers: { 'User-Agent': UA },
      responseType: 'json',
      timeoutMs: timeoutMs(),
      retry: 1,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', (label || '接口') + '暂时不可用（HTTP ' + res.status + '）');
    if (!res.data || typeof res.data !== 'object') fail('UPSTREAM_CHANGED', (label || '接口') + '返回结构已变化');
    if (res.data.code !== undefined && res.data.code !== 1) {
      fail('UPSTREAM_ERROR', res.data.msg || (label || '接口') + '失败');
    }
    return res.data;
  }

  function baseOf(api) {
    // 去掉 ?ac=list 这类装饰查询串，统一自己拼 ac/pg/wd
    return String(api).split('?')[0];
  }

  function originOf(api) {
    try {
      return new URL(api).origin;
    } catch (e) {
      return '';
    }
  }

  // 解析配置：多仓（sites 数组）→ 站点数组；单站对象（有 api 字段）→ 单元素；
  // 多仓聚合（urls 数组）→ 跟随第一项再取一层。只收 JSON 接口站，跳过 jar/蜘蛛。
  // 地址本身就是 api.php/provide/vod 时直接当单站用。
  async function loadSites(ctx) {
    if (sitesCache) return sitesCache;
    let url = apiUrl();
    if (/(api\.php|provide\/vod)/i.test(url)) {
      sitesCache = [{ name: '接口站', api: baseOf(url), searchable: true }];
      return sitesCache;
    }
    for (let depth = 0; depth < 3; depth++) {
      const res = await hg.http.fetch({
        url,
        headers: { 'User-Agent': UA },
        responseType: 'text',
        timeoutMs: timeoutMs(),
        retry: 1,
        signal: ctx && ctx.signal,
      });
      if (!res.ok) fail('UPSTREAM_ERROR', '接口地址无法访问（HTTP ' + res.status + '）');
      const data = parseJsonC(res.data);
      if (!data || typeof data !== 'object') fail('UPSTREAM_CHANGED', '接口内容不是有效 JSON');
      // 拿到的像 TVBox 数据响应（code/list）而不是配置 → 说明填的就是单站 API
      if (data.sites === undefined && data.api === undefined && data.urls === undefined) {
        sitesCache = [{ name: '接口站', api: baseOf(url), searchable: true }];
        return sitesCache;
      }
      if (Array.isArray(data.sites) && data.sites.length) {
        const sites = [];
        for (let i = 0; i < data.sites.length; i++) {
          const s = data.sites[i];
          const api = s && s.api;
          if (typeof api !== 'string' || !/^https?:\/\//i.test(api)) continue; // 跳过 csp_ 蜘蛛 / jar 站
          sites.push({
            name: String(s.name || api),
            api: baseOf(api),
            searchable: s.searchable !== 0,
          });
        }
        if (!sites.length) fail('UPSTREAM_CHANGED', '配置里只有 jar/蜘蛛站点，没有可用的 JSON 接口');
        sitesCache = sites;
        return sitesCache;
      }
      if (typeof data.api === 'string' && /^https?:\/\//i.test(data.api)) {
        sitesCache = [{ name: String(data.name || data.api), api: baseOf(data.api), searchable: true }];
        return sitesCache;
      }
      if (Array.isArray(data.urls) && data.urls.length) {
        const u = data.urls[0];
        const next = typeof u === 'string' ? u : u && u.url;
        if (typeof next === 'string' && /^https?:\/\//i.test(next)) {
          url = next;
          continue;
        }
      }
      fail('UPSTREAM_CHANGED', '没识别出 TVBox 接口结构（sites / api / urls 都没有）');
    }
    fail('UPSTREAM_CHANGED', '接口跳转层级过多');
  }

  function findSite(origin) {
    for (let i = 0; i < sitesCache.length; i++) {
      if (originOf(sitesCache[i].api) === origin) return sitesCache[i];
    }
    return null;
  }

  // mediaId = "<api origin>|<vod_id>"，稳定且能反查站点
  function splitMedia(id) {
    const s = String(id || '');
    const k = s.indexOf('|');
    if (k <= 0) fail('INVALID_ARGUMENT', '条目 ID 无效');
    const origin = s.slice(0, k);
    const vodId = s.slice(k + 1);
    if (!findSite(origin)) fail('NOT_FOUND', '条目所属站点已不在接口配置里');
    return [origin, vodId];
  }

  // categoryId = "<origin>|t|<type_id>"；"<origin>|t|" 表示全部
  function splitCate(id) {
    const s = String(id || '');
    const parts = s.split('|');
    if (parts.length !== 3 || parts[1] !== 't') fail('INVALID_ARGUMENT', '分类 ID 无效');
    if (!findSite(parts[0])) fail('NOT_FOUND', '分类所属站点已不在接口配置里');
    return [parts[0], parts[2]];
  }

  function numOf(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  function stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function typeGuess(typeName) {
    const t = String(typeName || '');
    if (/电影/.test(t)) return 'movie';
    if (/综艺/.test(t)) return 'variety';
    if (/动漫|番/.test(t)) return 'anime';
    if (/纪录片|纪实/.test(t)) return 'documentary';
    if (/短剧/.test(t)) return 'short';
    if (/剧/.test(t)) return 'series';
    return 'other';
  }

  function itemOf(origin, v) {
    if (!v || typeof v !== 'object') return null;
    const vodId = v.vod_id != null ? String(v.vod_id) : '';
    if (!vodId) return null;
    const title = String(v.vod_name || '').trim();
    if (!title) return null;
    const item = {
      id: origin + '|' + vodId,
      title,
      type: typeGuess(v.type_name),
    };
    if (v.vod_pic) item.cover = String(v.vod_pic);
    const desc = stripHtml(v.vod_content);
    if (desc) item.description = desc;
    const tags = [];
    if (v.type_name) tags.push(String(v.type_name));
    if (v.vod_area) tags.push(String(v.vod_area));
    if (tags.length) item.tags = tags.slice(0, 20);
    const year = numOf(v.vod_year);
    if (year != null) item.year = year;
    const score = numOf(v.vod_score);
    if (score != null && score > 0) item.score = score;
    const remarks = String(v.vod_remarks || '').trim();
    if (remarks) item.badge = remarks.slice(0, 8);
    if (/完结|全$/.test(remarks)) item.status = 'finished';
    return item;
  }

  function itemsOf(origin, data) {
    const rows = Array.isArray(data && data.list) ? data.list : [];
    const out = [];
    const seen = {};
    for (let i = 0; i < rows.length && out.length < 100; i++) {
      const item = itemOf(origin, rows[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
    }
    return out;
  }

  function collectClasses(origin, data) {
    const rows = Array.isArray(data && data.list) ? data.list : [];
    const map = classSeen[origin] || (classSeen[origin] = {});
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && r.type_id != null && r.type_name && !map[String(r.type_id)]) {
        map[String(r.type_id)] = String(r.type_name);
      }
    }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // videolist 响应里的 class 字段（多数饭太硬类接口都有），没有就返回 null
  async function discoverClasses(site, ctx) {
    try {
      const data = await getJson(site.api, { ac: 'videolist', pg: 1 }, ctx, site.name + '分类');
      const rows = Array.isArray(data.class) ? data.class : [];
      if (rows.length) {
        const map = classSeen[originOf(site.api)] || (classSeen[originOf(site.api)] = {});
        for (let i = 0; i < rows.length; i++) {
          const c = rows[i];
          if (c && c.type_id != null && c.type_name) map[String(c.type_id)] = String(c.type_name);
        }
      }
    } catch (e) { /* 拿不到分类不致命，列表页会逐渐收集 */ }
  }

  function siteClasses(site) {
    const map = classSeen[originOf(site.api)] || {};
    const out = [];
    for (const id in map) out.push({ id, label: map[id] });
    return out;
  }

  async function listVideos(site, query, cursor, ctx, label) {
    const q = Object.assign({ ac: 'videolist', pg: pageOf(cursor) }, query || {});
    const data = await getJson(site.api, q, ctx, label || site.name);
    const origin = originOf(site.api);
    collectClasses(origin, data);
    const page = numOf(data.page);
    const pagecount = numOf(data.pagecount);
    const next = page && pagecount && page < pagecount ? String(page + 1) : null;
    return {
      items: itemsOf(origin, data),
      next,
      total: numOf(data.total),
    };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sites = await loadSites(ctx);
        const sections = [];
        // 默认站：最新更新网格 + 前几个分类的横排
        const first = sites[0];
        const o1 = originOf(first.api);
        const latest = await listVideos(first, undefined, '1', ctx, first.name);
        if (latest.items.length) {
          sections.push({ id: o1 + '|t|', title: first.name + '·最新', layout: 'grid', imageAspect: 'portrait', items: latest.items, more: true });
        }
        await discoverClasses(first, ctx);
        const classes = siteClasses(first);
        for (let i = 0; i < classes.length && i < 4; i++) {
          try {
            const page = await listVideos(first, { t: classes[i].id }, '1', ctx, classes[i].label);
            if (page.items.length) {
              sections.push({ id: o1 + '|t|' + classes[i].id, title: first.name + '·' + classes[i].label, layout: 'row', imageAspect: 'portrait', items: page.items, more: true });
            }
          } catch (e) { /* 单分类失败不影响整页 */ }
        }
        // 其余站点各给一个最新横排
        for (let i = 1; i < sites.length && i < 7; i++) {
          try {
            const page = await listVideos(sites[i], undefined, '1', ctx, sites[i].name);
            if (page.items.length) {
              sections.push({ id: originOf(sites[i].api) + '|t|', title: sites[i].name, layout: 'row', imageAspect: 'portrait', items: page.items, more: true });
            }
          } catch (e) { /* 单站失败不影响整页 */ }
        }
        return { items: sections, next: null };
      },

      async listSection(params, ctx) {
        const [origin, typeId] = splitCate(params.sectionId);
        const site = findSite(origin);
        const query = typeId ? { t: typeId } : undefined;
        return listVideos(site, query, params.cursor, ctx, site.name);
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const sites = await loadSites(ctx);
        const tree = [];
        for (let i = 0; i < sites.length; i++) {
          const site = sites[i];
          const o = originOf(site.api);
          const children = [{ id: o + '|t|', label: '全部' }];
          const classes = siteClasses(site);
          for (let j = 0; j < classes.length; j++) {
            children.push({ id: o + '|t|' + classes[j].id, label: classes[j].label });
          }
          if (sites.length === 1) {
            // 单站：直接平铺分类
            return children;
          }
          tree.push({ id: o, label: site.name, children });
        }
        return tree;
      },

      getFilters(params) {
        return {};
      },

      async list(params, ctx) {
        const [origin, typeId] = splitCate(params.categoryId);
        const site = findSite(origin);
        const query = typeId ? { t: typeId } : undefined;
        return listVideos(site, query, params.cursor, ctx, site.name);
      },
    },

    search: {
      async search(params, ctx) {
        const query = String(params.query || '').trim();
        if (!query) return { items: [], next: null };
        const sites = await loadSites(ctx);
        const page = pageOf(params.cursor);
        const targets = [];
        for (let i = 0; i < sites.length; i++) {
          if (sites[i].searchable) targets.push(sites[i]);
        }
        if (!targets.length) targets.push(sites[0]);
        const results = await Promise.all(
          targets.map(function (site) {
            return listVideos(site, { wd: query }, String(page), ctx, site.name + '搜索').catch(function (e) {
              return null; // 单站失败不拖垮聚合
            });
          }),
        );
        const items = [];
        const seen = {};
        let hasNext = false;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (!r) continue;
          if (r.next) hasNext = true;
          for (let j = 0; j < r.items.length && items.length < 100; j++) {
            const it = r.items[j];
            if (seen[it.id]) continue;
            seen[it.id] = true;
            items.push(it);
          }
        }
        if (!items.length) fail('UPSTREAM_ERROR', '全部站点搜索失败或没有结果');
        return { items, next: hasNext ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const [origin, vodId] = splitMedia(params.id);
        const site = findSite(origin);
        const data = await getJson(site.api, { ac: 'detail', ids: vodId }, ctx, '详情');
        const row = Array.isArray(data.list) ? data.list[0] : data.list;
        if (!row || typeof row !== 'object') fail('NOT_FOUND', '内容不存在');
        const item = itemOf(origin, row);
        if (!item) fail('NOT_FOUND', '内容不存在');
        // 播放列表：vod_play_from / vod_play_url 以 $$$ 分隔线路，线路内 # 分隔各集，集内 name$url
        const froms = String(row.vod_play_from || '').split('$$$');
        const urlSegs = String(row.vod_play_url || '').split('$$$');
        const playlists = [];
        for (let i = 0; i < froms.length; i++) {
          const labelRaw = froms[i].trim();
          const label = labelRaw && !/^\d+$/.test(labelRaw) ? labelRaw : '线路' + (i + 1);
          const seg = (urlSegs[i] || '').trim();
          const entries = seg ? seg.split('#') : [];
          const episodes = [];
          for (let j = 0; j < entries.length; j++) {
            const k = entries[j].indexOf('$');
            if (k <= 0) continue;
            const name = entries[j].slice(0, k).trim();
            const u = entries[j].slice(k + 1).trim();
            if (!/^https?:\/\//i.test(u)) continue;
            episodes.push({ id: 'p' + i + '|' + j, index: j + 1, episodeNumber: j + 1, label: name || String(j + 1) });
          }
          if (episodes.length) {
            playlists.push({ id: 'p' + i, label, kind: i === 0 ? 'main' : 'other', episodes });
          }
        }
        if (!playlists.length) fail('CONTENT_LOCKED', '该内容没有可用的播放地址');
        const detail = Object.assign({}, item, { playlists });
        const people = [];
        if (row.vod_actor) {
          const actors = String(row.vod_actor).split(/[,，]/);
          for (let i = 0; i < actors.length; i++) {
            const n = actors[i].trim();
            if (n) people.push({ name: n, role: '演员' });
          }
        }
        if (row.vod_director && String(row.vod_director).trim()) {
          people.push({ name: String(row.vod_director).trim(), role: '导演' });
        }
        if (people.length) detail.people = people;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const [origin, vodId] = splitMedia(params.mediaId);
        const site = findSite(origin);
        const epId = String(params.episodeId || '');
        const parts = epId.split('|');
        const pi = parseInt(parts[0] === undefined ? '' : parts[0].replace('p', ''), 10);
        const ei = parseInt(parts[1], 10);
        if (!Number.isFinite(pi) || !Number.isFinite(ei)) fail('INVALID_ARGUMENT', '分集 ID 无效');
        // 每次取详情拿最新地址，天然满足 reason=refresh 的“不返回旧缓存地址”
        const data = await getJson(site.api, { ac: 'detail', ids: vodId }, ctx, '播放');
        const row = Array.isArray(data.list) ? data.list[0] : data.list;
        if (!row || typeof row !== 'object') fail('NOT_FOUND', '内容不存在');
        const froms = String(row.vod_play_from || '').split('$$$');
        const urlSegs = String(row.vod_play_url || '').split('$$$');
        const seg = (urlSegs[pi] || '').trim();
        const entries = seg ? seg.split('#') : [];
        const entry = entries[ei];
        if (!entry) fail('CONTENT_LOCKED', '该集不可播');
        const k = entry.indexOf('$');
        const name = k > 0 ? entry.slice(0, k).trim() : '';
        const u = (k > 0 ? entry.slice(k + 1) : entry).trim();
        if (!/^https?:\/\//i.test(u)) {
          fail('CONTENT_LOCKED', '该集地址不是可直接播放的链接（可能走解析/协议，暂不支持）');
        }
        let format = 'hls';
        if (/\.(mp4|flv|mkv|avi|mov|webm|m4v|mpg|wmv)(\?|$)/i.test(u)) format = 'progressive';
        return {
          streams: [{
            url: u,
            kind: 'media',
            format,
            label: name || undefined,
            headers: { Referer: origin + '/', 'User-Agent': UA },
          }],
        };
      },
    },
  };
}
