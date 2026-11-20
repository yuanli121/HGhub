export const meta = {
  id: 'av591.source',
  name: '591AV',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '591AV / PPP.Porn（591av.ws）：首页五个分区、三十三个分类的 from 翻页、搜索、详情与 HLS 直链；取流带 Referer，并按地址里的时间戳声明有效期。',
  mature: true,
  linkDomains: ['591av.ws', 'www.591av.ws', 'simg-94.vcwinford.cc', 'player.centercdn.top'],
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://591av.ws';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;

const CATS = [
  { slug: 'china-av', label: '中国AV' },
  { slug: 'japan-producer', label: '日本片商' },
  { slug: 'amateur', label: '素人自拍' },
  { slug: 'china', label: '中国' },
  { slug: 'taiwan', label: '台湾' },
  { slug: 'japan', label: '日本' },
  { slug: 'se-asia', label: '东南亚' },
  { slug: 'korea', label: '韩国' },
  { slug: 'hongkong', label: '香港' },
  { slug: 'cosplay', label: 'Cosplay' },
  { slug: 'streamer', label: '主播' },
  { slug: 'first-person-pov', label: '主观视角' },
  { slug: 'bdsm', label: '凌辱' },
  { slug: 'drama', label: '剧情' },
  { slug: 'threesome', label: '多P' },
  { slug: '91-tanhua', label: '探花' },
  { slug: 'released', label: '流出' },
  { slug: 'uncensored', label: '无码' },
  { slug: 'lesbian', label: '百合' },
  { slug: 'exhibitionists', label: '野外露出' },
  { slug: 'office-lady', label: 'OL' },
  { slug: 'acg', label: '动漫' },
  { slug: 'costume', label: '古装' },
  { slug: 'maid', label: '女仆' },
  { slug: 'student', label: '学生' },
  { slug: 'cheongsam', label: '旗袍' },
  { slug: 'kemonomimi', label: '兽耳' },
  { slug: 'yoga-pants', label: '瑜伽裤' },
  { slug: 'dolfin-shorts', label: '真理裤' },
  { slug: 'flight-attendant', label: '空姐' },
  { slug: 'pantyhose', label: '丝袜' },
  { slug: 'nurse', label: '护士' },
  { slug: 'knee-socks', label: '过膝袜' },
];

// 首页解析不出分区时的保底分区
const FALLBACK_SECTIONS = [
  { title: '最新上架', path: '/new/' },
  { title: '近期热门', path: '/pp1/hot/' },
  { title: '中国AV', path: '/categories/china-av/' },
  { title: '日本', path: '/categories/japan/' },
];

const DETAIL_RE = /^https?:\/\/(?:www\.)?591av\.ws\/v\/([a-z0-9]+)\/?/i;
const HREF_DETAIL_RE = /\/v\/([a-z0-9]+)\/?/;
const PLAY_RE = /^(\d{9,13})$/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

export default hg => {
  async function fetchText(path, ctx, ttl, extraHeaders) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${SITE}/`,
        ...(extraHeaders || {}),
      },
      retry: 1,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '这个影片不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return {
      body: norm(res.data),
      url: res.url || url,
      headers: res.headers || {},
    };
  }

  async function fetchDoc(path, ctx, ttl) {
    const { body } = await fetchText(path, ctx, ttl);
    const doc = hg.html.parse(body);
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!/^https?:\/\//i.test(url)) return '';
    return url.replace(/^http:\/\//i, 'https://');
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const item of root.select('div.card-video')) {
      const anchor = item.first('a');
      if (!anchor) continue;
      const m = norm(anchor.attr('href')).match(HREF_DETAIL_RE);
      if (!m || seen.has(m[1])) continue;
      const img = item.first('img');
      const title = trim(img && img.attr('alt')) || trim(anchor.attr('title')) || trim(item.first('h3') && item.first('h3').text());
      if (!title) continue;
      seen.add(m[1]);
      const card = { id: m[1], title, type: 'movie' };
      const cover = coverOf(img && (img.attr('data-src') || img.attr('src')));
      if (cover && !/placeholder/i.test(cover)) card.cover = cover;
      out.push(card);
    }
    return out;
  }

  async function probeMedia(url, ctx) {
    try {
      const res = await hg.http.fetch({
        url,
        headers: { 'User-Agent': UA, Referer: `${SITE}/` },
        signal: ctx.signal,
        maxBytes: 1048576,
      });
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  // 取流地址形如 …/jmpres/…/stream/{sig}/{ts}/{id}/{vid}.m3u8，ts 是过期时间
  function expiryOf(url) {
    const parts = norm(url).split('/');
    for (const part of parts) {
      const n = Number(part);
      if (PLAY_RE.test(part) && Number.isFinite(n) && n > 1600000000) return n * 1000;
    }
    return 0;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        try {
          // 站点根路径 / 现在返回 500，真正能打开的是 /pp1/
          const doc = await fetchDoc('/pp1/', ctx, 900);
          const seen = new Set();
          for (const block of doc.select('section')) {
            const head = block.first('h2');
            const title = trim(head && head.text()).replace(/[✨\s]+$/, '').trim();
            if (!title || seen.has(title)) continue;
            const items = cardsOf(block);
            if (!items.length) continue;
            seen.add(title);
            sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
          }
        } catch (error) {
          if (error && (error.code === 'CANCELLED' || error.code === 'RATE_LIMITED')) throw error;
        }

        if (!sections.length) {
          for (const sec of FALLBACK_SECTIONS) {
            let doc;
            try {
              doc = await fetchDoc(sec.path, ctx, 600);
            } catch (error) {
              continue;
            }
            const items = cardsOf(doc);
            if (!items.length) continue;
            sections.push({ id: `s${sections.length}`, title: sec.title, layout: 'grid', items });
          }
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map((c, i) => ({ id: String(i + 1), label: c.label }));
      },

      async list(params, ctx) {
        const idx = Number(params.categoryId) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= CATS.length) {
          throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        }
        const cat = CATS[idx];
        const page = pageNo(params.cursor);
        const from = (page - 1) * PAGE_SIZE;
        const path = `/categories/${cat.slug}/${from ? `?from=${from}` : ''}`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= PAGE_SIZE) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params.cursor);
        const from = (page - 1) * PAGE_SIZE;
        const doc = await fetchDoc(
          `/search/?q=${encodeURIComponent(query)}${from ? `&from=${from}` : ''}`,
          ctx,
          120,
        );
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= PAGE_SIZE) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^[a-z0-9]+$/i.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '影片 ID 不合法');
        const doc = await fetchDoc(`/v/${id}/`, ctx, 120);

        const ogTitle = doc.first('meta[property="og:title"]');
        let title = trim(ogTitle && ogTitle.attr('content'));
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+\|\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'movie', playlists: [] };

        const ogImage = doc.first('meta[property="og:image"]');
        const cover = coverOf(ogImage && ogImage.attr('content'));
        if (cover) detail.cover = cover;

        const metaDesc = doc.first('meta[name="description"]');
        const description = trim(metaDesc && metaDesc.attr('content'));
        if (description && !/精心挑选亚洲素人AV/.test(description)) detail.description = description.slice(0, 5000);

        const durationMeta = doc.first('meta[property="video:duration"]');
        const duration = Number(durationMeta && durationMeta.attr('content'));
        if (Number.isFinite(duration) && duration > 0) detail.durationSec = duration;

        const tags = [];
        for (const anchor of doc.select('a')) {
          const href = norm(anchor.attr('href'));
          if (!/\/categories\/[a-z0-9-]+\/$/.test(href)) continue;
          const text = trim(anchor.text());
          if (text && text.length <= 12 && tags.indexOf(text) < 0) tags.push(text);
        }
        if (tags.length) detail.tags = tags.slice(0, 12);

        detail.playlists.push({
          id: 'main',
          label: '正片',
          kind: 'main',
          episodes: [{ id: id, index: 1, label: '正片' }],
        });
        detail.episodeCount = 1;
        detail.totalEpisodes = 1;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^[a-z0-9]+$/i.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '影片 ID 不合法');

        // 取流地址带时间戳签名，每次现取
        const { body: html } = await fetchText(`/v/${id}/`, ctx, 0);
        const m = html.match(/var\s+stream\s*=\s*'([^']+)'/);
        if (!m) throw new hg.PluginError('CONTENT_LOCKED', '这个影片没有取到播放地址');
        const streamUrl = m[1].replace(/\\\//g, '/');
        if (!/^https?:\/\//i.test(streamUrl)) {
          throw new hg.PluginError('CONTENT_LOCKED', '播放地址格式异常，稍后重试');
        }

        // 首跳是 302，且不带 Referer 会拿到「tip」占位清单，所以自己跟一次
        const probe = await probeMedia(streamUrl, ctx);
        if (!probe.res) {
          hg.log.warn('取流探测失败，直接返回上游地址');
          return { streams: [{ url: streamUrl, kind: 'media', format: 'hls', headers: { Referer: `${SITE}/` } }] };
        }
        if (!probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        const finalUrl = probe.res.url || streamUrl;
        const body = norm(probe.res.data);
        if (body.indexOf('#EXTM3U') !== 0) {
          throw new hg.PluginError('CONTENT_LOCKED', '取流返回的不是播放列表，稍后重试');
        }

        const info = {
          streams: [{
            url: finalUrl,
            kind: 'media',
            format: 'hls',
            headers: { Referer: `${SITE}/` },
          }],
        };
        const expiresAt = expiryOf(finalUrl) || expiryOf(streamUrl);
        if (expiresAt) info.expiresAt = expiresAt;
        return info;
      },

      async matchUrl(params) {
        const m = norm(params.url).match(DETAIL_RE);
        if (!m) return null;
        return { mediaId: m[1] };
      },
    },
  };
};
