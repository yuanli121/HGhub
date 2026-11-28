export const meta = {
  id: 'lovebox.source',
  name: '18PORNY',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description:
    '18PORNY（lovebox.xm0108.lol / 18porny.cloud）：MacCMS + ys002 模板，九大分区与子分类分页、短剧集库、关键词搜索、单集详情与选集、HLS 直连。播放地址由播放页 player_aaaa 下发，m3u8、AES-128 密钥与切片都是绝对地址，不需要额外请求头。',
  mature: true,
  linkDomains: [
    'lovebox.xm0108.lol',
    'www.18porny.cloud',
    'play.zoyi0lzo.com',
    'aits1.vip',
    'jpts1.top',
    'pp2.xbp261111.top',
    '98jpg1.vip',
    'jpxjpg11.top',
  ],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 25 },
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 主站挂在 Cloudflare 上，两个域名渲染同一份模板，主域挂了可以直接换备用。
const BASES = ['https://lovebox.xm0108.lol', 'https://www.18porny.cloud'];
const SITE = BASES[0];

// 父分类就是 /vod/type/id/{slug}.html 的 slug，子分类同级同形，所以点击父项也能直接出列表。
const CATS = [
  {
    id: 'guochan',
    label: '国产专区',
    children: [
      ['zipaitoupai', '自拍偷拍'],
      ['guochanjingpin', '国产精品'],
      ['heiliaochigua', '黑料吃瓜'],
      ['jiudiantanhua', '酒店探花'],
      ['guochanchuanmei', '国产传媒'],
    ],
  },
  {
    id: 'rihan',
    label: '日韩专区',
    children: [
      ['rihanwuma', '日韩无码'],
      ['rihanjingpin', '日韩精品'],
      ['zhongwenzimu', '中文字幕'],
      ['avmingxing', 'AV明星'],
    ],
  },
  {
    id: 'oumeihaiwai',
    label: '欧美海外',
    children: [
      ['oumeijiqing', '欧美激情'],
      ['heirenticai', '黑人题材'],
    ],
  },
  {
    id: 'dongman',
    label: '动漫专区',
    children: [
      ['3ddongman', '3D动漫'],
      ['juqingdongman', '剧情动漫'],
      ['zhongzidongman', '中字动漫'],
      ['chengrendongman', '成人动漫'],
    ],
  },
  {
    id: 'ai',
    label: 'AI专区',
    children: [
      ['aiduanju', 'AI短剧'],
      ['aihuanlian', 'AI换脸'],
    ],
  },
  {
    id: 'zhuboxiezhen',
    label: '主播写真',
    children: [
      ['wanghongzhubo', '网红主播'],
      ['zhiboluoliao', '直播裸聊'],
      ['meinvxiezhen', '美女写真'],
    ],
  },
  {
    id: 'juqinglunli',
    label: '剧情伦理',
    children: [
      ['zhongwenjuqing', '中文剧情'],
      ['lunliyingpian', '伦理影片'],
      ['avjieshuo', 'AV解说'],
      ['lunlunjuqing', '乱伦剧情'],
      ['qiangzhiticai', '强制题材'],
      ['touqingjuqing', '偷情剧情'],
    ],
  },
  {
    id: 'renwupianhao',
    label: '人物偏好',
    children: [
      ['xueshengzhifu', '学生制服'],
      ['renqishunv', '人妻熟女'],
      ['jurumeiru', '巨乳美乳'],
      ['shaonvticai', '少女题材'],
      ['fanchaticai', '反差题材'],
    ],
  },
  {
    id: 'teseticai',
    label: '特色题材',
    children: [
      ['piaojishilu', '嫖妓实录'],
      ['renshouticai', '人兽题材'],
      ['nvtongticai', '女同题材'],
      ['smtiaojiao', 'SM调教'],
      ['yansheticai', '颜射题材'],
      ['koujiaoticai', '口交题材'],
      ['ziweiticai', '自慰题材'],
      ['duorenhuanqi', '多人换妻'],
      ['yezhanchezhen', '野战车震'],
      ['zhongkouwei', '重口味'],
    ],
  },
  // 短剧走另一套模板（/topic/index.html），列表是竖版剧集卡而不是单集卡。
  { id: 'series', label: '短剧集', children: [] },
];

const SLUGS = new Set();
for (const cat of CATS) {
  SLUGS.add(cat.id);
  for (const [slug] of cat.children) SLUGS.add(slug);
}

const SORTS = [
  { id: 'time', label: '最新发布' },
  { id: 'hits', label: '最多观看' },
  { id: 'score', label: '评分最高' },
];

const SITE_RE = /^https?:\/\/(?:lovebox\.xm0108\.lol|(?:www\.)?18porny\.cloud)\//i;
const ID_HREF_RE = /\/vod\/(?:play|detail)\/id\/(\d+)/;
const PLAY_PATH_RE = /\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

function imageOf(raw) {
  const url = trim(raw);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/template/') || url.startsWith('/static/')) return '';
  if (url.startsWith('/')) return `${SITE}${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanTitle(raw) {
  const t = trim(raw).replace(/^《/, '').replace(/》$/, '');
  return t.slice(0, 200);
}

// 播放页把整份播放器配置内联在 <script>var player_aaaa={...}</script>，里面带嵌套对象，
// 用正则截到行尾会被 vod_data 的右括号骗到，所以按括号配对扫一遍。
function playerConfig(html) {
  const at = html.indexOf('player_aaaa');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return safeJson(html.slice(start, i + 1));
    }
  }
  return null;
}

// player_aaaa.url 是 JSON 转义过的斜杠，偶尔再叠一层 &amp;。
function unescapeUrl(raw) {
  return trim(norm(raw).replace(/\\\//g, '/').replace(/&amp;/g, '&'));
}

function playUrlOf(html) {
  const cfg = playerConfig(html);
  if (!cfg) return '';
  const url = unescapeUrl(cfg.url);
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

export default function (hg) {
  let baseIndex = 0;
  let catCache = null;
  // getDetail 抓过的播放页直接给 resolvePlayback 复用，避免选集里点一下就重来一次。
  const pageCache = new Map();

  function rememberPage(key, html) {
    pageCache.set(key, { at: Date.now(), html });
    if (pageCache.size > 40) {
      const oldest = pageCache.keys().next().value;
      pageCache.delete(oldest);
    }
  }

  function recallPage(key) {
    const hit = pageCache.get(key);
    if (!hit) return '';
    if (Date.now() - hit.at > 120000) {
      pageCache.delete(key);
      return '';
    }
    return hit.html;
  }

  async function request(path, ctx, ttl) {
    const order = [baseIndex];
    for (let i = 0; i < BASES.length; i += 1) if (!order.includes(i)) order.push(i);
    let lastError = null;
    for (const index of order) {
      const url = /^https?:\/\//i.test(path) ? path : `${BASES[index]}${path}`;
      let res;
      try {
        res = await hg.http.fetch({
          url,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            Referer: `${BASES[index]}/`,
          },
          retry: 0,
          signal: ctx.signal,
          ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 600 } } : {}),
        });
      } catch (error) {
        if (error && error.code === 'CANCELLED') throw error;
        lastError = error;
        continue;
      }
      // 404/403 是内容层面的结论，换域名也一样，直接定案。
      if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
      if (!res.ok) {
        if (res.status >= 500) {
          lastError = new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
          continue;
        }
        throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
      }
      baseIndex = index;
      return { html: norm(res.data), url: norm(res.url) || url };
    }
    if (lastError && lastError.code) throw lastError;
    throw new hg.PluginError('NETWORK', '站点连不上，稍后再试');
  }

  async function fetchHtml(path, ctx, ttl) {
    const res = await request(path, ctx, ttl);
    return res.html;
  }

  // 单集卡（.ys2-card）与竖版剧集卡（.ys2-series-card）共用一份解析：
  // 两者都把 id 放在 /vod/play/id/N 或 /vod/detail/id/N 上，靠这个就能判断类型。
  function cardOf(node) {
    const kind = norm(node.attr('data-content-kind'));
    let href = '';
    let title = '';
    for (const anchor of node.select('a')) {
      const h = norm(anchor.attr('href'));
      if (!ID_HREF_RE.test(h)) continue;
      if (!href) href = h;
      const t = trim(anchor.attr('title'));
      if (t) {
        title = t;
        break;
      }
    }
    const m = href.match(ID_HREF_RE);
    if (!m) return null;
    const id = m[1];
    if (!title) {
      const head = node.first('h3') || node.first('h2');
      title = head ? trim(head.text()) : '';
    }
    if (!title) return null;

    const isSeries = kind === 'series' || href.includes('/vod/detail/');
    const item = {
      id,
      title: (isSeries ? cleanTitle(title) : title.slice(0, 200)) || id,
      type: isSeries ? 'series' : 'short',
    };

    const img = node.first('img');
    const cover = imageOf(img ? img.attr('src') || img.attr('data-src') : '');
    if (cover) item.cover = cover;

    const badge = node.first('.ys2-series-episodes');
    if (badge) {
      const b = trim(badge.text()).replace(/\s+/g, '');
      if (b) item.badge = b.slice(0, 20);
    } else {
      const dur = node.first('.ys2-card-duration');
      if (dur) {
        const d = trim(dur.text());
        if (d && /^\d/.test(d)) item.badge = d.slice(0, 20);
      }
    }
    return item;
  }

  function cardsOf(root, selector) {
    const out = [];
    const seen = new Set();
    for (const node of root.select(selector || 'article')) {
      const card = cardOf(node);
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
    }
    return out;
  }

  // 空结果页会顺手把「大家正在看」的推荐铺进来，直接对整页抓 article 会把这些当成命中，
  // 所以只在结果栅格里取卡片；剧集库用的是另一套栅格。
  function gridOf(doc) {
    return doc.first('.ys2-results-grid') || doc.first('.ys2-series-grid') || doc;
  }

  function categoriesOf() {
    if (!catCache) {
      catCache = CATS.map(cat => ({
        id: cat.id,
        label: cat.label,
        ...(cat.children.length
          ? { children: cat.children.map(([id, label]) => ({ id, label })) }
          : {}),
      }));
    }
    return catCache;
  }

  function sortQuery(sort) {
    const key = trim(sort);
    if (!key) return '';
    if (!SORTS.some(s => s.id === key)) return '';
    return `?by=${key}`;
  }

  // 详情页有两种：短剧停在 /vod/detail/id/N.html，body 带 ys2-series-detail-page；
  // 单集会被 302 到 /vod/play/id/N/sid/S/nid/E.html，body 换成 ys2-video-detail-page。
  // 跟着跳转走后看最终 URL 最稳，body class 只当兜底。
  async function openPage(id, ctx) {
    const res = await request(`/vod/detail/id/${id}.html`, ctx, 0);
    // 站内查不到这个 id 时不给 404，而是 302 回首页（带年龄门的那一版）。
    // 落错页会被解析成一条名叫「本站包含成人内容」的假条目，所以先核对落点。
    if (!new RegExp(`/vod/(?:detail|play)/id/${id}(?:[./])`).test(res.url)) {
      throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    }
    const play = res.url.match(PLAY_PATH_RE);
    const doc = hg.html.parse(res.html);
    const body = doc.first('body');
    const bodyClass = body ? norm(body.attr('class')) : '';
    const isSeries = /ys2-series-detail-page/.test(bodyClass)
      ? true
      : /ys2-video-detail-page/.test(bodyClass)
        ? false
        : !play;
    return { doc, html: res.html, url: res.url, play, isSeries };
  }

  function ldJson(doc) {
    for (const node of doc.select('script[type="application/ld+json"]')) {
      const cfg = safeJson(trim(node.text()));
      if (cfg && (cfg['@type'] === 'Movie' || cfg['@type'] === 'TVSeries')) return cfg;
    }
    return null;
  }

  function episodesOfSeries(doc) {
    const list = [];
    const seen = new Set();
    for (const anchor of doc.select('.ys2-series-episode-list a')) {
      const href = norm(anchor.attr('href'));
      const m = href.match(PLAY_PATH_RE);
      if (!m || seen.has(m[3])) continue;
      seen.add(m[3]);
      const nid = Number(m[3]);
      const label = trim(anchor.text()) || `第${nid}集`;
      list.push({ nid, sid: Number(m[2]) || 1, label: label.slice(0, 60) });
    }
    list.sort((a, b) => a.nid - b.nid);
    return list;
  }

  function metaFacts(doc) {
    const facts = {};
    for (const row of doc.select('.ys2-vod-metadata > div')) {
      const dt = row.first('dt');
      const dd = row.first('dd');
      if (!dt || !dd) continue;
      const key = trim(dt.text());
      const value = trim(dd.text());
      if (!key || !value || value === '暫無資料' || value === '暂无资料') continue;
      facts[key] = value;
    }
    return facts;
  }

  function overviewOf(doc) {
    const summary = doc.first('.ys2-series-summary') || doc.first('.ys2-detail-description');
    if (summary) {
      const t = trim(summary.text());
      if (t) return t.slice(0, 400);
    }
    const desc = doc.first('meta[name="description"]');
    return desc ? trim(desc.attr('content')).slice(0, 400) : '';
  }

  function coverOf(doc, ld) {
    const poster = doc.first('[data-poster]');
    const img = doc.first('.ys2-series-media img') || doc.first('img');
    return imageOf(
      (ld && ld.image) ||
        (poster && poster.attr('data-poster')) ||
        (img && img.attr('src')) ||
        ''
    );
  }

  return {
    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml('/', ctx, 600);
        const doc = hg.html.parse(html);
        const sections = [];
        for (const node of doc.select('section.ys2-home-video-section')) {
          const head = node.first('h2');
          const items = cardsOf(node, 'article');
          if (!items.length) continue;
          sections.push({
            id: `home-${sections.length + 1}`,
            title: head ? trim(head.text()).slice(0, 40) : '最新更新',
            layout: 'grid',
            items,
            more: true,
          });
        }
        if (sections.length) return { items: sections, next: null };
        const fallback = cardsOf(doc, 'article').slice(0, 30);
        if (!fallback.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: [{ id: 'latest', title: '最新更新', layout: 'grid', items: fallback }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return categoriesOf();
      },

      async list(params, ctx) {
        const slug = trim(params && params.categoryId).toLowerCase();
        if (!SLUGS.has(slug)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);

        let path;
        if (slug === 'series') {
          path = `/topic/index.html?by=time&page=${page}`;
        } else {
          const query = sortQuery(params && params.sort);
          path =
            page > 1
              ? `/vod/show/id/${slug}/page/${page}.html${query}`
              : `/vod/type/id/${slug}.html${query}`;
        }

        const doc = hg.html.parse(await fetchHtml(path, ctx, 120));
        const items = cardsOf(gridOf(doc), 'article');
        const out = { items };
        if (items.length >= 12) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params && params.cursor);
        const path = `/vod/search/by/time/page/${page}/wd/${encodeURIComponent(query)}.html`;
        const doc = hg.html.parse(await fetchHtml(path, ctx, 300));
        const items = cardsOf(gridOf(doc), 'article');
        const out = { items };
        if (items.length >= 12) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const page = await openPage(id, ctx);
        const { doc } = page;
        const ld = ldJson(doc);

        let title = '';
        const h1 = doc.first('h1');
        if (h1) title = trim(h1.text());
        if (!title && ld) title = trim(ld.name);
        if (!title) {
          const t = doc.first('title');
          title = trim(t && t.text()).split(/\s*[-–]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const isSeries = page.isSeries;
        const detail = {
          id,
          title: (isSeries ? cleanTitle(title) : title).slice(0, 200),
          type: isSeries ? 'series' : 'short',
          playlists: [],
        };

        const cover = coverOf(doc, ld);
        if (cover) detail.cover = cover;

        const overview = overviewOf(doc) || (ld ? trim(ld.description) : '');
        if (overview) detail.overview = overview;

        const facts = metaFacts(doc);
        if (facts['年份'] && /^\d{4}$/.test(facts['年份'])) detail.year = Number(facts['年份']);
        const region = facts['地區'] || facts['地区'];
        if (region) detail.country = region;
        const genre = facts['類型'] || facts['类型'];
        if (genre) detail.genres = genre.split(/[,，、/]/).map(s => trim(s)).filter(Boolean).slice(0, 6);

        const primary = doc.first('.ys2-detail-primary-type');
        if (primary) {
          const text = trim(primary.text()).replace(/^#\s*/, '');
          if (text) detail.category = text;
        }

        if (!isSeries) {
          // 单集：播放页本身就是它的详情页，唯一一集固定是 sid=1/nid=1。
          detail.playlists = [
            {
              id: 'main',
              label: '播放线路',
              kind: 'main',
              episodes: [{ id: 'e1', index: 1, episodeNumber: 1, label: detail.title }],
            },
          ];
          const raw = page.html;
          rememberPage(`${id}:1`, raw);
          return detail;
        }

        const episodes = episodesOfSeries(doc);
        if (!episodes.length) {
          // 有的短剧挂了但没放选集，退一步按单集处理，至少能点进去。
          detail.playlists = [
            {
              id: 'main',
              label: '播放线路',
              kind: 'main',
              episodes: [{ id: 'e1', index: 1, episodeNumber: 1, label: detail.title }],
            },
          ];
          return detail;
        }

        detail.playlists = [
          {
            id: 'main',
            label: '选集',
            kind: 'main',
            episodes: episodes.map((ep, i) => ({
              id: `e${ep.nid}`,
              index: i + 1,
              episodeNumber: i + 1,
              label: ep.label,
            })),
          },
        ];
        detail.episodeCount = episodes.length;
        detail.totalEpisodes = episodes.length;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const wanted = trim(params && params.episodeId).replace(/^e/, '');
        const nid = /^\d+$/.test(wanted) && Number(wanted) > 0 ? Number(wanted) : 1;

        let html = recallPage(`${id}:${nid}`);
        if (!html) {
          const res = await request(`/vod/play/id/${id}/sid/1/nid/${nid}.html`, ctx, 0);
          if (!new RegExp(`/vod/play/id/${id}/sid/\\d+/nid/${nid}\\.html`).test(res.url)) {
            throw new hg.PluginError('NOT_FOUND', '这一集不存在或已下架');
          }
          html = res.html;
          rememberPage(`${id}:${nid}`, html);
        }

        const url = playUrlOf(html);
        if (!url) {
          const cfg = playerConfig(html);
          if (!cfg) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页没有播放器配置');
          if (Number(cfg.points) > 0) throw new hg.PluginError('CONTENT_LOCKED', '这一集需要付费观看');
          throw new hg.PluginError('CONTENT_LOCKED', '这一集还没有片源');
        }

        const stream = {
          url,
          kind: 'media',
          format: 'hls',
          headers: { 'User-Agent': UA, Referer: `${SITE}/` },
        };
        if (nid > 1) stream.label = `第${nid}集`;
        return { streams: [stream] };
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        if (!raw) return null;
        const play = raw.match(PLAY_PATH_RE);
        if (play && SITE_RE.test(raw)) return { mediaId: play[1], episodeId: `e${play[3]}` };
        const detail = raw.match(/\/vod\/detail\/id\/(\d+)/);
        if (detail && SITE_RE.test(raw)) return { mediaId: detail[1] };
        const type = raw.match(/\/vod\/type\/id\/([a-z0-9_]+)\.html/i);
        if (type && SLUGS.has(type[1].toLowerCase())) return { categoryId: type[1].toLowerCase() };
        const show = raw.match(/\/vod\/show\/id\/([a-z0-9_]+)\//i);
        if (show && SLUGS.has(show[1].toLowerCase())) return { categoryId: show[1].toLowerCase() };
        return null;
      },
    },
  };
}
