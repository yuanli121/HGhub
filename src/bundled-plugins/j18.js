export const meta = {
  id: 'j18',
  name: '18J.TV',
  version: '1.0.0',
  protocol: 1,
  description: '18J.TV（18j.tv）：分类（运行时从 /label/sort/ 解析，内置兜底）、搜索、短剧多集、HLS 播放。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['18j.tv'],
  defaultHeaders: {
    Referer: 'https://18j.tv/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://18j.tv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 站点 /label/sort/ 现存分类（2026-11 实测）；Swift 旧版的 t-41/40/28/27/26/13/12 等旧 id 已随改版失效。
// /t/19（无码中字）与 /t/51（东南亚三级）当前页面为空，已剔除；/t/38/39/40/41/10/42/43 现为 301 → /st/ 且无内容，已剔除。
const FALLBACK = [
  ['国产', '1', [['11', '国产自拍'], ['13', '探花现场'], ['15', '国产av'], ['16', '福利姬'], ['12', '吃瓜黑料'], ['14', '乱伦系列'], ['18', '成人主播']]],
  ['短剧', '9', [['36', 'AI短剧'], ['46', '成人漫剧'], ['37', '明星AI魔改']]],
  ['日韩', '2', [['20', 'JAV自拍'], ['21', '中文字幕'], ['22', 'jav无码'], ['23', 'AV解说']]],
  ['欧美', '3', [['24', '欧美大片'], ['25', '黑人专区'], ['26', '留学生']]],
  ['伦理', '4', [['27', '港台三级'], ['28', '日韩三级'], ['29', '欧美三级']]],
  ['另类', '6', [['34', '伪娘'], ['32', '男同GAY'], ['33', '女同百合'], ['35', 'SM重口'], ['45', '东南亚']]],
];
const EMPTY_IDS = { '19': 1, '51': 1 };

const HOT = [
  { id: 'p:/label/hot/by/time/', label: '最新' },
  { id: 'p:/label/hot/by/hits_day/', label: '日榜' },
  { id: 'p:/label/hot/by/hits_week/', label: '周榜' },
  { id: 'p:/label/hot/by/hits_month/', label: '月榜' },
  { id: 'p:/label/hot/by/up/', label: '点赞榜' },
];

export default function (hg) {
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }
  function headers() { return { 'User-Agent': UA, Referer: SITE + '/' }; }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch (e) { return encodeURI(u); } }
  function absUrl(h) {
    h = String(h || '').replace(/&amp;/g, '&');
    if (!h) return '';
    if (/^https?:\/\//i.test(h)) return h;
    if (h.indexOf('//') === 0) return 'https:' + h;
    return SITE + (h.charAt(0) === '/' ? h : '/' + h);
  }

  async function fetchHtml(path, ctx, soft) {
    const res = await hg.http.fetch({
      url: encodeUrl(path.indexOf('http') === 0 ? path : SITE + path),
      headers: headers(), responseType: 'text', timeoutMs: 15000, retry: 1, maxBytes: 8 * 1024 * 1024, signal: ctx && ctx.signal,
    });
    if (res.status === 404 && soft) return null;
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res;
  }

  function idOf(href) {
    const m = String(href || '').match(/\/(?:v|voddetail)\/(\d+)/);
    return m ? m[1] : '';
  }

  // 两种卡片：电影/短视频 .box（a[href=/v/..]），短剧 .dr-card（a[href=/voddetail/..]）
  function parseCards(html) {
    const doc = hg.html.parse(html);
    const items = [];
    const seen = {};
    const boxes = doc.select('div.box');
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const a = b.first('a[href^="/v/"]');
      if (!a) continue;
      const id = idOf(a.attr('href'));
      if (!id || seen[id]) continue;
      const tEl = b.first('.title');
      const title = clean(a.attr('title') || (tEl ? tEl.text() : ''));
      if (!title) continue;
      seen[id] = 1;
      const it = { id, title, type: 'movie' };
      const img = b.first('img');
      const cover = img && (img.attr('data-src') || img.attr('src'));
      if (cover) it.cover = absUrl(cover);
      const sp = b.first('.vodlist_img span');
      if (sp) { const t = clean(sp.text()); if (t) it.badge = t.slice(0, 8); }
      items.push(it);
    }
    const cards = doc.select('li.dr-card');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const a = c.first('a.dr-card__pic');
      if (!a) continue;
      const id = idOf(a.attr('href'));
      if (!id || seen[id]) continue;
      const nm = c.first('.dr-card__name');
      const title = clean((nm ? nm.text() : '') || a.attr('title'));
      if (!title) continue;
      seen[id] = 1;
      const it = { id, title, type: 'short' };
      const img = c.first('img');
      const cover = img && (img.attr('data-src') || img.attr('src'));
      if (cover) it.cover = absUrl(cover);
      const rm = c.first('.dr-card__rm');
      if (rm) { const t = clean(rm.text()); if (t) it.badge = t.slice(0, 8); }
      items.push(it);
    }
    return items;
  }

  // 下一页：以分页条里「下一页」链接为准，游标即该链接路径
  function nextCursor(html) {
    const m = html.match(/<a href="([^"]+)"[^>]*aria-label="下一页"/);
    return m && m[1].charAt(0) === '/' ? m[1].replace(/&amp;/g, '&') : null;
  }

  async function listPath(path, ctx) {
    const res = await fetchHtml(path, ctx, true);
    if (!res) return { items: [], next: null };
    const items = parseCards(res.data);
    return { items, next: items.length ? nextCursor(res.data) : null };
  }

  function pathOfCategory(id) {
    if (id.indexOf('p:') === 0) return id.slice(2);
    if (id.indexOf('t:') === 0) return '/t/' + id.slice(2) + '/';
    return '';
  }

  let catCache = null;
  async function loadCategories(ctx) {
    if (catCache) return catCache;
    const groups = [{ id: 'hot', label: '热度榜', children: HOT }];
    const parsed = [];
    try {
      const res = await fetchHtml('/label/sort/', ctx);
      const html = res.data;
      const parts = html.split('<div class="urhere">');
      for (let i = 0; i < parts.length; i++) {
        const h = parts[i].match(/<h2><a href="\/t\/(\d+)\/">([^<]+)<\/a><\/h2>/);
        if (!h) continue;
        const blk = parts[i].match(/<div class="categories play-tags cat">([\s\S]*?)<\/div>/);
        const kids = [];
        if (blk) {
          const re = /<a href="\/t\/(\d+)\/">([^<]+)<\/a>/g;
          let m;
          while ((m = re.exec(blk[1]))) if (m[1] !== h[1] && !EMPTY_IDS[m[1]]) kids.push({ id: 't:' + m[1], label: clean(m[2]) });
        }
        parsed.push({ id: 'g:' + h[1], label: clean(h[2]), children: [{ id: 't:' + h[1], label: '全部' }].concat(kids) });
      }
    } catch (e) { /* 用兜底 */ }
    if (!parsed.length) {
      FALLBACK.forEach(function (g) {
        parsed.push({ id: 'g:' + g[1], label: g[0], children: [{ id: 't:' + g[1], label: '全部' }].concat(g[2].map(function (c) { return { id: 't:' + c[0], label: c[1] }; })) });
      });
    }
    catCache = groups.concat(parsed);
    return catCache;
  }

  function mediaUrlFrom(html) {
    let m = html.match(/var player_aaaa=(\{[\s\S]*?\})<\/script>/);
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        if (j && typeof j.url === 'string' && /^https?:\/\//.test(j.url)) return j.url;
      } catch (e) { /* 继续 */ }
    }
    m = html.match(/const source = "([^"]+)"/);
    if (m && /^https?:\/\//.test(m[1])) return m[1];
    m = html.match(/https?:\\?\/\\?\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/);
    return m ? m[0].replace(/\\\//g, '/') : '';
  }

  return {
    home: {
      async getSections(params, ctx) {
        const defs = [['new', '最新', '/label/new/'], ['hot', '热门', '/label/hot/by/time/'], ['drama', '最新短剧', '/t/9/']];
        const out = [];
        for (let i = 0; i < defs.length; i++) {
          try {
            const r = await listPath(defs[i][2], ctx);
            if (r.items.length) out.push({ id: defs[i][0], title: defs[i][1], layout: 'grid', imageAspect: 'landscape', items: r.items });
          } catch (e) { if (i === defs.length - 1 && !out.length) throw e; }
        }
        return { items: out, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) { return loadCategories(ctx); },
      async list(params, ctx) {
        const id = (params && params.categoryId) || 'p:/label/hot/by/time/';
        const cur = params && params.cursor;
        if (cur) {
          if (cur.charAt(0) !== '/') fail('INVALID_ARGUMENT', '游标无效');
          return listPath(cur, ctx);
        }
        const path = pathOfCategory(id);
        if (!path) fail('INVALID_ARGUMENT', '未知分类');
        return listPath(path, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const cur = params && params.cursor;
        if (cur) {
          if (cur.charAt(0) !== '/') fail('INVALID_ARGUMENT', '游标无效');
          return listPath(cur, ctx);
        }
        // 全部搜索页只有第 1 页且无分页；改用「电影」频道（带分页），首页再补短剧频道结果
        const enc = encodeURIComponent(q);
        const movie = await listPath('/s/ch/movie/wd/' + enc + '/', ctx);
        let items = movie.items;
        try {
          const drama = await listPath('/s/ch/drama/wd/' + enc + '/', ctx);
          const seen = {};
          items.forEach(function (x) { seen[x.id] = 1; });
          items = items.concat(drama.items.filter(function (x) { return !seen[x.id]; }));
        } catch (e) { /* 短剧频道失败不影响 */ }
        return { items, next: movie.next };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '').match(/^\d+/);
        if (!id) fail('INVALID_ARGUMENT', '缺少作品 ID');
        const res = await fetchHtml('/voddetail/' + id[0] + '/', ctx, true);
        if (!res) fail('NOT_FOUND', '视频不存在或已删除');
        const html = res.data;
        const doc = hg.html.parse(html);
        const og = function (p) { const e = doc.first('meta[property="' + p + '"]'); return e ? e.attr('content') : ''; };
        const h1 = doc.first('h1');
        let title = clean(h1 ? h1.text() : '');
        if (!title) title = clean(og('og:title')).replace(/\s*-\s*18J\.TV\s*$/, '');
        if (!title) { const t = doc.first('title'); title = clean(t ? t.text() : '').replace(/\s*-\s*18J\.TV\s*$/, ''); }
        const detail = { id: id[0], title: title || ('18J ' + id[0]), type: 'movie', playlists: [] };
        const cover = og('og:image'); if (cover) detail.cover = absUrl(cover);
        const desc = clean(og('og:description')); if (desc) detail.description = desc;
        // 多集（短剧）：.eps-group[data-sid] 下的 a.ep[href=/v/ID-sid-nid/]
        const groups = doc.select('.eps-group');
        for (let g = 0; g < groups.length; g++) {
          const eps = groups[g].select('a.ep');
          const list = [];
          for (let i = 0; i < eps.length; i++) {
            const m = String(eps[i].attr('href') || '').match(/\/v\/(\d+-\d+-\d+)\//);
            if (!m) continue;
            list.push({ id: m[1], index: list.length + 1, episodeNumber: list.length + 1, label: clean(eps[i].text()) || String(list.length + 1) });
          }
          if (list.length) detail.playlists.push({ id: 's' + (groups[g].attr('data-sid') || (g + 1)), label: '线路 ' + (g + 1), episodes: list });
        }
        if (!detail.playlists.length) {
          // 301 到 /v/ID-1-1/ 的单集内容
          const fm = String(res.url || '').match(/\/v\/(\d+-\d+-\d+)\//);
          const epId = fm ? fm[1] : id[0] + '-1-1';
          detail.playlists.push({ id: 'main', label: '默认', episodes: [{ id: epId, index: 1, episodeNumber: 1, label: '播放' }] });
        } else if (detail.playlists[0].episodes.length > 1) {
          detail.type = 'short';
          detail.episodeCount = detail.playlists[0].episodes.length;
        }
        const tags = doc.select('a[href^="/s/wd/"]').map(function (a) { return clean(a.text()); }).filter(function (t) { return t && t.length < 16; });
        if (tags.length) detail.tags = tags.slice(0, 12);
        return detail;
      },

      async resolvePlayback(params, ctx) {
        let ep = String((params && (params.episodeId || params.mediaId)) || '');
        if (/^\d+$/.test(ep)) ep += '-1-1';
        if (!/^\d+-\d+-\d+$/.test(ep)) fail('INVALID_ARGUMENT', '分集 ID 无效');
        const res = await fetchHtml('/v/' + ep + '/', ctx, true);
        if (!res) fail('NOT_FOUND', '视频不存在或已删除');
        const url = mediaUrlFrom(res.data);
        if (!url) fail('UPSTREAM_CHANGED', '未解析到播放地址');
        return {
          streams: [{ url, kind: 'media', format: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'progressive', headers: headers(), label: '默认' }],
        };
      },
    },
  };
}
