export const meta = {
  id: 'bl911',
  name: '911爆料网',
  version: '1.0.1',
  protocol: 1,
  description: '911爆料网（吃瓜爆料、网红黑料）：图文文章列表与详情，以及帖子内嵌视频（DPlayer HLS）的分类、搜索、播放。封面按站点前端的 AES-CBC 图片协议解密。站点常换 CloudFront 地址，可在线路中切换或刷新。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['d1k1nd82ice0a7.cloudfront.net', 'd9altmxkp5q0i.cloudfront.net', 'blw66.com', '911bl.com', '911bla.com', '911bb3.com'],
  defaultHeaders: {
    Referer: 'https://d1k1nd82ice0a7.cloudfront.net/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://d1k1nd82ice0a7.cloudfront.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// 站点前端 decryptImage：CryptoJS.AES.decrypt(base64, Utf8('f5d965df75336270'), { iv: Utf8('97b60394abc2fbe1'), CBC, Pkcs7 })
const IMG_KEY_B64 = 'ZjVkOTY1ZGY3NTMzNjI3MA==';
const IMG_IV_B64 = 'OTdiNjAzOTRhYmMyZmJlMQ==';
const IMG_CDN = 'https://pic.nsxxlj.cn';       // 前端 window.CDN_XHOST：加密图一律改写到这个主机
const HOME_PAGE = 'https://911bla.com';        // 「永久回家地址」发布页（base64 document.write，内含亚马逊直连 CloudFront）
const STATIC_LINES = [
  { id: 'cf-main', label: 'CloudFront 主线', url: SITE },
  { id: 'cf-direct', label: '亚马逊直连', url: 'https://d9altmxkp5q0i.cloudfront.net' },
  { id: 'blw66', label: '永久网站 blw66.com', url: 'https://blw66.com' },
];
const LINES_KEY = 'endpoints:v1';
// sports-live 体育直播是站外直播入口；mjmsjb/zqbb（世界杯黑料/宝贝）301 到 shijiebei，算重复分类
const NAV_SKIP = { 'sports-live': true, mjmsjb: true, zqbb: true };
const FALLBACK_CATS = [
  ['jrgb', '今日大瓜'], ['ssdbl', '热点吃瓜'], ['mrds', '每日大赛'], ['blqw', '猎奇吃瓜'], ['hjsq', '海角社区'],
  ['whbl', '网红黑料'], ['mxhl', '明星吃瓜'], ['xyss', '校园吃瓜'], ['bgzq', '反差爆料'], ['rmgb', '911独家爆料'],
  ['fljq', '福利视频'], ['crfys', '午夜剧场'], ['thjx', '探花经典'], ['aidj', 'AI短剧'], ['sgpjs', '水果派解说'],
];

export default function (hg) {
  function origin() {
    const cur = hg.endpoint && hg.endpoint.current;
    if (cur && typeof cur.url === 'string' && cur.url) return cur.url.replace(/\/$/, '');
    return SITE;
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function headers() {
    return {
      'User-Agent': UA,
      Referer: origin() + '/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
  }

  function mediaHeaders() {
    return { 'User-Agent': UA, Referer: origin() + '/' };
  }

  async function fetchHtml(url, ctx, allow404) {
    let res;
    for (let i = 0; i < 2; i++) {
      res = await hg.http.fetch({
        url,
        headers: headers(),
        responseType: 'text',
        timeoutMs: 20000,
        retry: 1,
        maxBytes: 8 * 1024 * 1024,
        signal: ctx && ctx.signal,
      });
      if (res.status < 500) break;     // 搜索偶发 502，再试一次
    }
    if (res.status === 404) {
      if (allow404) return '';
      fail('NOT_FOUND', '页面不存在');
    }
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return typeof res.data === 'string' ? res.data : '';
  }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    return origin() + (href.charAt(0) === '/' ? href : '/' + href);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function isCdnImg(path) {
    return /\/(xiao|upload\/upload|upload_01|uploads|hc237|upload-images)\//.test(String(path || ''));
  }

  // 前端 cdnImageRequestUrl：加密图片的路径保持不变，主机换成 CDN_XHOST
  function imageRef(url) {
    if (!url) return undefined;
    let href = String(url).trim();
    if (!href || /home-cover-placeholder|zw\.png/.test(href)) return undefined;
    if (!isCdnImg(href)) return absUrl(href);
    const m = href.match(/^https?:\/\/[^/]+(\/.*)$/);
    href = IMG_CDN + (m ? m[1] : (href.charAt(0) === '/' ? href : '/' + href));
    return { url: href, transform: { type: 'aes-cbc', key: IMG_KEY_B64, iv: IMG_IV_B64, padding: 'pkcs7' } };
  }

  function parseTime(v) {
    if (!v) return undefined;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : undefined;
  }

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&amp;/g, '&');
  }

  function postIdOf(href) {
    const m = String(href || '').match(/\/archives\/(\d+)/);
    return m ? m[1] : '';
  }

  // ---------- 列表 ----------
  // 卡片：<article itemscope …BlogPosting> → <a href="/archives/{id}/"> + loadBannerDirect('封面', …) + h2.post-card-title
  // 广告卡片是 <article class="ad-item …">，不带 itemscope，直接跳过
  function parseCards(html) {
    const doc = hg.html.parse(html);
    const nodes = doc.select('article[itemscope]');
    const out = [];
    const seen = {};
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const a = n.first('a[href*="/archives/"]');
      const id = postIdOf(a && a.attr('href'));
      if (!id || seen[id]) continue;
      const h2 = n.first('.post-card-title');
      let title = '';
      if (h2) {
        title = h2.ownText().trim();
        if (!title) title = h2.text().replace(/热搜\s*HOT/g, '').trim();
      }
      if (!title) continue;
      seen[id] = true;
      const raw = n.outerHtml();
      const cm = raw.match(/loadBannerDirect\(\s*['"]([^'"]+)['"]/);
      const it = { id, title };
      const cover = imageRef(cm && cm[1]);
      if (cover) it.cover = cover;
      const pub = n.first('[itemprop="datePublished"]');
      const t = parseTime(pub && pub.attr('content'));
      if (t != null) it.publishedAt = t;
      const authorEl = n.first('meta[itemprop="name"]');
      const author = authorEl && authorEl.attr('content');
      if (author) it.author = { id: author, name: author };
      const spans = n.select('.post-card-info span');
      const last = spans.length ? spans[spans.length - 1] : null;
      if (last && !last.attr('itemprop')) {
        const tags = last.text().split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (tags.length) it.tags = tags.slice(0, 20);
      }
      if (/热搜\s*HOT/.test(h2 ? h2.text() : '')) it.hot = true;
      out.push(it);
    }
    const nextLink = doc.first('link[rel="next"]');
    return { items: out, nextHref: (nextLink && nextLink.attr('href')) || '' };
  }

  function toMedia(it) {
    const m = { id: it.id, title: it.title, type: 'short', entryEpisodeId: '1' };
    if (it.cover) { m.cover = it.cover; m.backdrop = it.cover; }
    if (it.tags) m.tags = it.tags;
    if (it.author) m.author = it.author;
    if (it.publishedAt != null) { m.publishedAt = it.publishedAt; m.year = new Date(it.publishedAt).getFullYear(); }
    if (it.hot) m.badge = '热搜';
    return m;
  }

  function toArticle(it) {
    const a = { id: it.id, title: it.title, mediaId: it.id };
    if (it.cover) a.cover = it.cover;
    if (it.tags) a.tags = it.tags;
    if (it.author) a.author = it.author;
    if (it.publishedAt != null) a.publishedAt = it.publishedAt;
    return a;
  }

  // path 为 '' → 首页；'/category/x' → 分类；'/search/<enc>' → 搜索。翻页统一是 {path}/{N}/（首页是 /page/N/）
  function pageUrl(path, page) {
    if (!path) return origin() + (page > 1 ? '/page/' + page + '/' : '/');
    return origin() + path + '/' + (page > 1 ? page + '/' : '');
  }

  // 游标优先用页面 <link rel="next"> 的路径（分类会 301 到别的 slug，自己拼 /N/ 会 404），回退为页码
  async function listCards(path, cursor, ctx) {
    const c = String(cursor || '');
    let url;
    if (c.charAt(0) === '/') url = origin() + c;
    else url = pageUrl(path, pageOf(c));
    const html = await fetchHtml(url, ctx, !!c && c !== '1');
    if (!html) return { items: [], next: null };
    const r = parseCards(html);
    let next = null;
    if (r.items.length && r.nextHref) {
      const m = r.nextHref.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
      if (m && m[1] !== '/') next = m[1];
    }
    return { items: r.items, next };
  }

  async function loadCats(ctx) {
    try {
      const html = await fetchHtml(origin() + '/', ctx);
      const doc = hg.html.parse(html);
      const links = doc.select('a[href^="/category/"]');
      const out = [];
      const seen = {};
      for (let i = 0; i < links.length; i++) {
        const m = (links[i].attr('href') || '').match(/^\/category\/([a-z0-9_-]+)\/?$/i);
        const label = links[i].text().trim();
        if (!m || !label || seen[m[1]] || NAV_SKIP[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ id: m[1], label });
      }
      if (out.length) return out;
    } catch (_) {}
    return FALLBACK_CATS.map(function (c) { return { id: c[0], label: c[1] }; });
  }

  // ---------- 详情 ----------
  function parseDplayers(html) {
    const out = [];
    const re = /<div[^>]*class="dplayer"[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const cm = tag.match(/data-config='([^']*)'/);
      if (!cm) continue;
      let cfg;
      try { cfg = JSON.parse(decodeEntities(cm[1])); } catch (_) { continue; }
      const v = cfg && cfg.video;
      if (!v || typeof v.url !== 'string' || !v.url) continue;
      const tm = tag.match(/data-video_title="([^"]*)"/);
      const vid = tag.match(/data-video_id="([^"]*)"/);
      out.push({
        url: v.url,
        type: String(v.type || ''),
        pic: v.pic || '',
        title: tm ? decodeEntities(tm[1]).trim() : '',
        videoId: vid ? vid[1] : '',
      });
    }
    return out;
  }

  async function loadPost(id, ctx) {
    const pid = String(id || '').match(/\d+/);
    if (!pid) fail('INVALID_ARGUMENT', '帖子 ID 无效');
    const html = await fetchHtml(origin() + '/archives/' + pid[0] + '/', ctx);
    return { id: pid[0], html, doc: hg.html.parse(html) };
  }

  function metaOf(doc, sel) {
    const n = doc.first(sel);
    const v = n && n.attr('content');
    return v ? v.trim() : '';
  }

  function postBasics(p) {
    const doc = p.doc;
    const h1 = doc.first('h1.post-title');
    const title = ((h1 && h1.text()) || metaOf(doc, 'meta[property="og:title"]') || ('帖子 ' + p.id)).trim();
    const info = { id: p.id, title };
    const desc = metaOf(doc, 'meta[name="description"]') || metaOf(doc, 'meta[property="og:description"]');
    if (desc) info.summary = desc;
    const kw = metaOf(doc, 'meta[name="keywords"]');
    if (kw) {
      const tags = kw.split(/[,，]/).map(function (x) { return x.trim(); }).filter(function (x) { return x && x.length <= 30; });
      if (tags.length) info.tags = tags.slice(0, 20);
    }
    const t = parseTime(metaOf(doc, 'meta[itemprop="datePublished"]') || metaOf(doc, 'meta[property="article:published_time"]'));
    const pub = doc.first('[itemprop="datePublished"]');
    const t2 = t != null ? t : parseTime(pub && (pub.attr('content') || pub.attr('datetime')));
    if (t2 != null) info.publishedAt = t2;
    return info;
  }

  function videoStream(v, i, n) {
    return {
      url: v.url,
      kind: 'media',
      format: /\.mp4(\?|$)/i.test(v.url) || v.type === 'mp4' ? 'progressive' : 'hls',
      label: n > 1 ? ('第' + (i + 1) + '段') : '视频',
      headers: mediaHeaders(),
    };
  }

  // 正文：.post-content 去掉广告位（pgx-slot / ssp / template）、播放器、发布页引用块、APP 下载按钮
  function cleanContent(doc) {
    const body = doc.first('.post-content[itemprop="articleBody"]') || doc.first('.post-content');
    if (!body) return { html: '', text: '', firstImg: '' };
    let html = body.html();
    html = html.replace(/<template[\s\S]*?<\/template>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<div[^>]*class="dplayer"[^>]*>[\s\S]*?<\/div>/gi, '<p>[视频]</p>')
      .replace(/<div[^>]*(?:pgx-slot|data-ssp-slot-id)[^>]*>(?:\s*<\/div>)?/gi, '')
      .replace(/<blockquote>[\s\S]*?(?:永久|回家|吃瓜地址)[\s\S]*?<\/blockquote>/i, '')
      .replace(/<div class="article-action-row"[\s\S]*$/i, '');
    let firstImg = '';
    let encImgs = 0;
    // 宿主声明 article.image 时，正文里的加密图可以交给宿主解密（<img data-hpp>），否则只能舍弃
    const richImages = !!(hg.env && Array.isArray(hg.env.features) && hg.env.features.indexOf('article.image') >= 0);
    html = html.replace(/(<a\b[^>]*\bhref=")(\/[^"]*)"/gi, function (_, pre, path) { return pre + origin() + path + '"'; });
    html = html.replace(/<img\b[^>]*>/gi, function (tag) {
      const enc = tag.match(/data-xkrkllgl="([^"]+)"/);
      const src = enc ? enc[1] : ((tag.match(/\bdata-src="([^"]+)"/) || tag.match(/\bsrc="([^"]+)"/) || [])[1] || '');
      if (!src || /zw\.png|placeholder/.test(src)) return '';
      if (!firstImg) firstImg = src;
      const alt = (tag.match(/\balt="([^"]*)"/) || [])[1] || '';
      if (enc || isCdnImg(src)) {
        encImgs++;
        if (!richImages) return '';
        const ref = imageRef(src);
        if (!ref || typeof ref === 'string') return '';
        return '<img src="' + ref.url + '" alt="' + alt + '" data-hpp=\''
          + JSON.stringify({ transform: ref.transform }) + '\'>';
      }
      return '<img src="' + absUrl(src) + '" alt="' + alt + '">';
    });
    // 广告位删除后会留下不成对的 div；正文只需 p/h2/img/a，直接去掉 div 与 span 锚点
    html = html.replace(/<\/?div\b[^>]*>/gi, '').replace(/<span[^>]*id="menu_index_\d+"[^>]*><\/span>/gi, '')
      .replace(/<p>\s*<\/p>/g, '').replace(/\n\s+/g, '\n').trim();
    const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|div|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
    return { html, text: decodeEntities(text), firstImg, encImgs };
  }

  async function fetchLinesFromHomePage(ctx) {
    const res = await hg.http.fetch({
      url: HOME_PAGE + '/', headers: { 'User-Agent': UA }, responseType: 'text', timeoutMs: 12000, signal: ctx && ctx.signal,
    });
    const m = String(res.data || '').match(/Base64\.decode\('([A-Za-z0-9+/=]+)'\)/);
    if (!m) return [];
    const page = hg.codec.utf8Decode(hg.codec.base64Decode(m[1]));
    const out = [];
    const re = /https:\\?\/\\?\/([a-z0-9]+\.cloudfront\.net)/gi;
    let x;
    while ((x = re.exec(page))) {
      const url = 'https://' + x[1].toLowerCase();
      if (!out.some(function (e) { return e.url === url; })) out.push({ id: 'cf-' + x[1].split('.')[0], label: '亚马逊直连 ' + x[1].split('.')[0], url });
    }
    return out;
  }

  return {
    endpoints: {
      async list(params, ctx) {
        let dyn = [];
        if (params && params.refresh) {
          try {
            dyn = await fetchLinesFromHomePage(ctx);
            if (dyn.length) await hg.storage.set(LINES_KEY, dyn);
          } catch (_) {}
        } else {
          try { dyn = (await hg.storage.get(LINES_KEY)) || []; } catch (_) {}
        }
        const out = STATIC_LINES.slice();
        for (let i = 0; i < dyn.length; i++) {
          if (!out.some(function (e) { return e.url === dyn[i].url || e.id === dyn[i].id; })) out.push(dyn[i]);
        }
        return out;
      },
    },

    home: {
      async getSections(params, ctx) {
        const latest = await listCards('', '1', ctx);
        const sections = [];
        const hot = latest.items.filter(function (x) { return x.hot; }).map(toMedia);
        if (hot.length) sections.push({ id: 'hot', title: '热搜', layout: 'banner', imageAspect: 'landscape', items: hot.slice(0, 8) });
        sections.push({ id: 'latest', title: '最新爆料', layout: 'grid', imageAspect: 'landscape', items: latest.items.map(toMedia), more: !!latest.next });
        const picks = ['jrgb', 'whbl', 'mrds'];
        for (let i = 0; i < picks.length; i++) {
          try {
            const r = await listCards('/category/' + picks[i], '1', ctx);
            if (r.items.length) {
              const cat = FALLBACK_CATS.find(function (c) { return c[0] === picks[i]; });
              sections.push({ id: 'cat:' + picks[i], title: cat ? cat[1] : picks[i], layout: 'row', imageAspect: 'landscape', items: r.items.map(toMedia), more: true });
            }
          } catch (_) {}
        }
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const id = String(params.sectionId || '');
        const path = id.indexOf('cat:') === 0 ? '/category/' + encodeURIComponent(id.slice(4)) : '';
        const r = await listCards(path, params.cursor, ctx);
        return { items: r.items.map(toMedia), next: r.next };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const cats = await loadCats(ctx);
        return [{ id: 'all', label: '最新' }].concat(cats);
      },
      async list(params, ctx) {
        const cid = String(params.categoryId || 'all');
        const path = cid === 'all' ? '' : '/category/' + encodeURIComponent(cid);
        const r = await listCards(path, params.cursor, ctx);
        return { items: r.items.map(toMedia), next: r.next };
      },
    },

    search: {
      async search(params, ctx) {
        const q = String((params && params.query) || '').trim();
        if (!q) return { items: [], next: null };
        const r = await listCards('/search/' + encodeURIComponent(q), params.cursor, ctx);
        return { items: r.items.map(toMedia), next: r.next };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const p = await loadPost(params.id, ctx);
        const info = postBasics(p);
        const vids = parseDplayers(p.html);
        if (!vids.length) fail('CONTENT_LOCKED', '该帖子是纯图文，没有可播放的视频');
        const detail = { id: p.id, title: info.title, type: 'short' };
        if (info.summary) detail.description = info.summary;
        if (info.tags) detail.tags = info.tags;
        if (info.publishedAt != null) detail.publishedAt = info.publishedAt;
        const content = cleanContent(p.doc);
        const cover = imageRef((vids[0] && vids[0].pic) || content.firstImg);
        if (cover) { detail.cover = cover; detail.backdrop = cover; }
        detail.episodeCount = vids.length;
        detail.playlists = [{
          id: 'main',
          label: '帖内视频',
          episodes: vids.map(function (v, i) {
            const e = { id: String(i + 1), index: i + 1, episodeNumber: i + 1, label: String(i + 1) };
            if (v.title) e.title = v.title;
            const th = imageRef(v.pic);
            if (th) e.thumbnail = th;
            return e;
          }),
        }];
        return detail;
      },

      async resolvePlayback(params, ctx) {
        // 播放地址带 auth_key 时效签名：每次重新取帖子页，不缓存
        const p = await loadPost(params.mediaId, ctx);
        const vids = parseDplayers(p.html);
        if (!vids.length) fail('CONTENT_LOCKED', '该帖子没有可播放的视频');
        let idx = parseInt(params.episodeId || '1', 10) - 1;
        if (!(idx >= 0 && idx < vids.length)) idx = 0;
        const v = vids[idx];
        const info = { streams: [videoStream(v, idx, vids.length)] };
        const am = v.url.match(/auth_key=(\d{10})/);
        if (am) info.expiresAt = parseInt(am[1], 10) * 1000 + 60 * 60 * 1000;
        return info;
      },

      matchUrl(params) {
        let u;
        try { u = new URL(String(params.url || '')); } catch (_) { return null; }
        if (meta.linkDomains.indexOf(u.hostname.toLowerCase()) < 0 && !/\.cloudfront\.net$/i.test(u.hostname)) return null;
        const id = postIdOf(u.pathname);
        return id ? { mediaId: id } : null;
      },
    },

    articles: {
      async list(params, ctx) {
        const r = await listCards('', params.cursor, ctx);
        return { items: r.items.map(toArticle), next: r.next };
      },

      async getDetail(params, ctx) {
        const p = await loadPost(params.id, ctx);
        const info = postBasics(p);
        const content = cleanContent(p.doc);
        const vids = parseDplayers(p.html);
        const d = { id: p.id, title: info.title };
        if (info.summary) d.summary = info.summary;
        if (info.tags) d.tags = info.tags;
        if (info.publishedAt != null) d.publishedAt = info.publishedAt;
        const cover = imageRef(content.firstImg || (vids[0] && vids[0].pic));
        if (cover) d.cover = cover;
        if (content.html) d.contentHtml = content.html;
        if (content.text) d.contentText = content.text;
        if (vids.length) {
          d.mediaId = p.id;
          d.streams = vids.slice(0, 16).map(function (v, i) { return videoStream(v, i, vids.length); });
        }
        return d;
      },
    },
  };
}
