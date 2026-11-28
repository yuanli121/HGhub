export const meta = {
  id: 'avtoday',
  name: 'avtoday',
  version: '1.0.4',
  protocol: 1,
  description: 'avtoday：分类、搜索、详情与 HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['avtoday.io'],
  defaultHeaders: {
    Referer: 'https://avtoday.io/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://avtoday.io';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function headers() {
    return { 'User-Agent': UA, Referer: origin() + '/' };
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  async function fetchHtml(url, ctx, extra) {
    const res = await hg.http.fetch({
      url,
      headers: Object.assign(headers(), extra || {}),
      responseType: 'text',
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  // 中文分类路径必须编码：未编码的 絲襪.html?page=2 会被站点当成第 1 页
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return encodeUrl(href);
    if (href.startsWith('//')) return encodeUrl('https:' + href);
    const o = origin();
    return encodeUrl(href.startsWith('/') ? o + href : o + '/' + href);
  }

  function pathId(href) {
    try {
      const u = new URL(absUrl(href));
      return u.pathname.replace(/\/$/, '');
    } catch (_) {
      return String(href || '');
    }
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function nextUrl(base, page) {
    const b = base.replace(/([?&])page=\d+&?/, '$1').replace(/[?&]$/, '');
    return page > 1 ? b + (b.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page : b;
  }

  function hasNext(html, page) {
    return html.indexOf('page=' + (page + 1) + '"') >= 0;
  }

  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const seen = {};   // 首页同一部片会在多个板块重复渲染（实测 29 个块里只有 22 个唯一地址），
                       // 不去重宿主会逐条报 warn「重复条目已丢弃」；pathId 为空的是广告位（如 /live），直接跳过
    const nodes = doc.select('.thumbnail');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].first('.video-title a');
      const title = a && a.text();
      if (!title || title.indexOf('[廣告]') >= 0) continue;
      const href = a.attr('href');
      if (!href) continue;
      const id = pathId(href);
      if (!id || id === '/' || seen[id]) continue;
      seen[id] = true;
      const preview = nodes[i].first('.preview-video');
      const style = preview && preview.attr('style');
      const coverM = style && style.match(/url\('(.*?)'\)/);
      const tag = nodes[i].first('.video-tag');
      const item = { id: id, title: title.trim(), type: 'movie' };
      if (coverM) item.cover = absUrl(coverM[1]);
      if (tag) {
        const note = tag.text().trim();
        if (note) item.badge = note.slice(0, 8);
      }
      items.push(item);
    }
    return items;
  }

  async function loadTabs(ctx) {
    const html = await fetchHtml(origin() + '/catalog', ctx);
    const doc = hg.html.parse(html);
    const slides = doc.select('.swiper-wrapper > .swiper-slide');
    const items = [];
    for (let i = 0; i < slides.length; i++) {
      const nameEl = slides[i].first('.btn-categories__title');
      const a = slides[i].first('a.btn-categories');
      const name = nameEl ? nameEl.text().trim() : '';
      const href = a && a.attr('href');
      if (!name || !href) continue;
      { const u = absUrl(href); if (u.indexOf(origin().replace(/^https?:\/\//, '').replace(/^www\./, '')) < 0) continue; }   // 跳过站外广告链接（Telegram、导航站等）
      items.push({ id: absUrl(href), label: name });
    }
    return items.length ? items : [{ id: origin() + '/catalog', label: '目录' }];
  }

  return {
    endpoints: { list() { return [{ id: 'main', label: '主站', url: SITE }]; } },

    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml(origin() + '/', ctx);
        return { items: [{ id: 'latest', title: '最新', layout: 'grid', items: parseCards(html) }], next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        return loadTabs(ctx);
      },
      async list(params, ctx) {
        const cat = (params && params.categoryId) || origin() + '/';
        const page = pageOf(params && params.cursor);
        const url = nextUrl(absUrl(cat), page);
        const html = await fetchHtml(url, ctx);
        const items = parseCards(html);
        if (!items.length || !hasNext(html, page)) return { items, next: null };
        // 站点在最后一页仍渲染 Next，而越界页码会 302 回第 1 页：不跟随跳转预取，被重定向或为空即到底
        const pr = await hg.http.fetch({ url: nextUrl(url, page + 1), headers: headers(), responseType: 'text', redirect: 'manual', timeoutMs: 15000, signal: ctx && ctx.signal });
        if (pr.status >= 300 && pr.status < 400) return { items, next: null };
        const probe = pr.ok ? parseCards(pr.data) : [];
        const first = {}; items.forEach(function (x) { first[x.id] = 1; });
        const fresh = probe.filter(function (x) { return !first[x.id]; });
        return { items, next: fresh.length ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const page = pageOf(params && params.cursor);
        const res = await hg.http.fetch({ url: origin() + '/search?s=' + encodeURIComponent(q) + '&page=' + page, headers: headers(), responseType: 'text', timeoutMs: 15000, signal: ctx && ctx.signal });
        if (res.status === 403 || /Just a moment|cf-chl/.test(res.data || '')) fail('UPSTREAM_ERROR', '站点搜索被 Cloudflare 人机验证拦截，暂不可用；请从分类浏览');
        if (!res.ok) fail('UPSTREAM_ERROR', '搜索暂时不可用（HTTP ' + res.status + '）');
        const html = res.data;
        const items = parseCards(html);
        return { items, next: items.length ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const url = absUrl(id);
        const html = await fetchHtml(url, ctx);
        const doc = hg.html.parse(html);
        const titleEl = doc.first('h1') || doc.first('.video-title');
        const title = titleEl ? titleEl.text().trim() : String(id);
        return {
          id: pathId(id),
          title,
          type: 'movie',
          playlists: [{
            id: 'main',
            label: '默认',
            episodes: [{ id: pathId(id), index: 1, episodeNumber: 1, label: '播放' }],
          }],
        };
      },

      async resolvePlayback(params, ctx) {
        const episodeId = params && params.episodeId;
        if (!episodeId) fail('INVALID_ARGUMENT', '缺少分集 ID');
        const pageUrl = absUrl(episodeId);
        // 详情页路径形如 /cht/video/FC2PPV-5008104.html，播放器只认不带 .html 的编号
        const code = (pageUrl.split('/video/')[1] || '').replace(/\/$/, '').replace(/\.html?$/i, '');
        if (!code) fail('INVALID_ARGUMENT', '作品编号无效');
        const playerUrl = origin() + '/player?s=' + encodeURIComponent(code);
        const html = await fetchHtml(playerUrl, ctx, { Referer: pageUrl });
        // 2026-11 起多数作品给 video_link（mp4，签名绑定 UA），m3u8_url 为空；两者都试
        const pick = function (name) { const m = html.match(new RegExp(name + "\\s*=\\s*'([^']*)'")); return m ? m[1].trim() : ''; };
        const mp4 = pick('video_link'), m3u8 = pick('m3u8_url');
        const url = mp4 || m3u8;
        if (!url) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{
            url: url,
            kind: 'media',
            format: mp4 ? (/\.m3u8(\?|$)/i.test(mp4) ? 'hls' : 'progressive') : 'hls',
            headers: { 'User-Agent': UA, Referer: origin() + '/' },   // UA 必须与取签名时一致
          }],
        };
      },
    },
  };
}
