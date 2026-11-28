export const meta = {
  id: 'duanju55.source',
  name: '五五短剧',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description:
    '五五短剧（duanju55.com）：苹果CMS + shoutu39 模板。首页轮播与三个推荐栏、六个剧情分类加四十余个题材标签分页、关键词搜索、详情与直连 HLS。每部片子只有一个整片片源，播放地址写在播放页的 player_aaaa 里，m3u8 与切片都是明文，不需要额外请求头。',
  mature: false,
  linkDomains: [
    'duanju55.com',
    'www.duanju55.com',
    'tyyszywvod2.com',
    'lzv34.com',
    'v.lzcdn31.com',
    'tyyswimg3.com',
    'p.lzp261118.com',
  ],
  defaultHeaders: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  timeouts: { read: 20, playback: 25 },
};

const BASE = 'https://www.duanju55.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 站点的剧情分类走 /vod/type/id/{6..11}，题材标签走 /vod/show/class/{名字}/id/1。
// 两边有六个重名项，实测内容一致（女频恋爱 24/24 完全重合），标签那侧取 type，
// 因为「反转爽剧」的标签页是空的而 type/7 有内容。
const TYPE_CATS = [
  { id: '6', label: '女频恋爱' },
  { id: '7', label: '反转爽剧' },
  { id: '8', label: '古装仙侠' },
  { id: '9', label: '年代穿越' },
  { id: '10', label: '脑洞悬疑' },
  { id: '11', label: '现代都市' },
];

// 标签列表取自分类页筛选栏，去掉上面六个重名的，再去掉「电视节目」「网剧」两个空页。
const CLASSES = [
  '都市', '赘婿', '战神', '古代言情', '现代言情', '历史', '脑洞', '玄幻', '搞笑',
  '喜剧', '萌宝', '神豪', '致富', '奇幻脑洞', '超能', '强者回归', '甜宠', '励志',
  '豪门恩怨', '复仇', '长生', '神医', '马甲', '亲情', '小人物', '奇幻', '无敌',
  '现实', '重生', '闪婚', '职场商战', '穿越', '年代', '权谋', '高手下山', '悬疑',
  '家国情仇', '虐恋', '古装', '时空之旅', '玄幻仙侠', '欢喜冤家', '传承觉醒',
  '情感', '逆袭', '家庭',
];

const TYPE_IDS = new Set(['1', ...TYPE_CATS.map(c => c.id)]);
const CLASS_SET = new Set(CLASSES);

const DETAIL_RE = /^https?:\/\/(?:www\.)?duanju55\.com\/index\.php\/vod\/detail\/id\/(\d+)\.html/i;
const DETAIL_HREF_RE = /\/index\.php\/vod\/detail\/id\/(\d+)\.html/;
const PLAY_PATH_RE = /\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html/;

// 同一批卡片在三种页面用了三套类名，字段名只差前缀。
const CARD_SELECTORS = ['.SecondList_secondListItem', '.BrowseList_itemBox', '.TagBookList_tagItem'];

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
  if (url.startsWith('/template/') || url.startsWith('/static')) return '';
  if (url.startsWith('/')) return `${BASE}${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 播放页把整份配置内联成 `var player_aaaa={...}`，vod_data 里还套着一层对象，
// 用正则截到行尾会被内层的右括号骗到，所以按括号配对扫。
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

function playUrlOf(html) {
  const cfg = playerConfig(html);
  if (!cfg) return '';
  const url = trim(norm(cfg.url).replace(/\\\//g, '/').replace(/&amp;/g, '&'));
  return /^https?:\/\//i.test(url) ? url : '';
}

function categoryIdOf(raw) {
  const text = trim(raw);
  if (!text) return '';
  const m = text.match(/^(type|class):([^:]+)$/);
  if (!m) return '';
  return m[1] === 'type'
    ? TYPE_IDS.has(m[2]) ? `type:${m[2]}` : ''
    : CLASS_SET.has(m[2]) ? `class:${m[2]}` : '';
}

// 第一页站点自己就不带 page 段，跟着来少一次重定向。
function listPath(categoryId, page) {
  const [kind, value] = categoryId.split(':');
  const tail = page > 1 ? `/page/${page}.html` : '.html';
  if (kind === 'type') return `/index.php/vod/type/id/${value}${tail}`;
  return `/index.php/vod/show/class/${encodeURIComponent(value)}/id/1${tail}`;
}

export default function (hg) {
  let catCache = null;

  async function fetchText(path, ctx, ttl) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: `${BASE}/` },
      retry: 0,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '内容不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    return hg.html.parse(await fetchText(path, ctx, ttl));
  }

  function cardOf(node) {
    let href = '';
    for (const anchor of node.select('a')) {
      const h = norm(anchor.attr('href'));
      if (DETAIL_HREF_RE.test(h)) {
        href = h;
        break;
      }
    }
    const m = href.match(DETAIL_HREF_RE);
    if (!m) return null;

    const nameNode = node.first('[class*="bookName"]');
    let title = nameNode ? trim(nameNode.text()) : '';
    if (!title) {
      const img = node.first('img');
      title = trim(img && img.attr('alt'));
    }
    if (!title) return null;

    const item = { id: m[1], title: title.slice(0, 200), type: 'short', entryEpisodeId: '1' };

    const img = node.first('img');
    const cover = imageOf(img && (img.attr('src') || img.attr('data-src')));
    if (cover) item.cover = cover;

    const badge = node.first('[class*="totalChapterNum"]');
    if (badge) {
      const text = trim(badge.text());
      if (text) item.badge = text.slice(0, 20);
    }
    return item;
  }

  // 一页只会出现一套类名，试到有结果就停，省掉另外两次选择器往返。
  function cardsOf(root) {
    for (const selector of CARD_SELECTORS) {
      const nodes = root.select(selector);
      if (!nodes.length) continue;
      const out = [];
      const seen = new Set();
      for (const node of nodes) {
        const card = cardOf(node);
        if (!card || seen.has(card.id)) continue;
        seen.add(card.id);
        out.push(card);
      }
      if (out.length) return out;
    }
    // 兜底：结构变了的话至少还能按链接抓到。
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(DETAIL_HREF_RE);
      if (!m || seen.has(m[1])) continue;
      const title = trim(anchor.text());
      if (!title) continue;
      seen.add(m[1]);
      out.push({ id: m[1], title: title.slice(0, 200), type: 'short', entryEpisodeId: '1' });
    }
    return out;
  }

  function categoriesOf() {
    if (!catCache) {
      catCache = [
        {
          id: 'type:1',
          label: '全部短剧',
          children: [
            ...TYPE_CATS.map(c => ({ id: `type:${c.id}`, label: c.label })),
            ...CLASSES.map(name => ({ id: `class:${name}`, label: name })),
          ],
        },
      ];
    }
    return catCache;
  }

  function detailFields(doc) {
    const fields = {};
    const h1 = doc.first('.DramaDetail_bookName');
    if (h1) fields.title = trim(h1.text());

    const cover = doc.first('.DramaDetail_bookCover');
    if (cover) fields.cover = imageOf(cover.attr('src'));

    const intro = doc.first('.DramaDetail_intro');
    if (intro) fields.overview = trim(intro.text()).slice(0, 400);

    const tags = [];
    for (const anchor of doc.select('.DramaDetail_tagsBox a')) {
      const text = trim(anchor.text());
      if (text && text.length <= 20) tags.push(text);
    }
    if (tags.length) fields.tags = tags.slice(0, 8);

    const crumb = doc.first('.breadcrumb_lastTxt');
    if (crumb) fields.crumb = trim(crumb.text());

    const catalog = doc.select('.pcDrama_catalog a');
    fields.episodeCount = catalog.length;
    const status = doc.first('.pcDrama_titleText');
    if (status) fields.statusLine = trim(status.text()).slice(0, 40);

    return fields;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/', ctx, 600);
        const sections = [];

        // 顶部是轮播，`SwiperArea_content` 只有大图，标题和标签在旁边的左栏里。
        const banner = [];
        const seenBanner = new Set();
        for (const slide of doc.select('.swiperItem')) {
          const link = slide.first('.SwiperArea_content') || slide.first('a');
          const href = norm(link && link.attr('href'));
          const m = href.match(DETAIL_HREF_RE);
          if (!m || seenBanner.has(m[1])) continue;
          const nameNode = slide.first('.SwiperArea_bookName');
          const img = slide.first('.SwiperArea_contentImg') || slide.first('img');
          const title = trim(nameNode && nameNode.text()) || trim(img && img.attr('alt'));
          if (!title) continue;
          seenBanner.add(m[1]);
          const item = { id: m[1], title: title.slice(0, 200), type: 'short', entryEpisodeId: '1' };
          const cover = imageOf(img && img.attr('src'));
          if (cover) item.cover = cover;
          const tagNode = slide.first('.SwiperArea_tagsBox a');
          if (tagNode) {
            const t = trim(tagNode.text());
            if (t) item.badge = t.slice(0, 20);
          }
          banner.push(item);
        }
        if (banner.length) {
          sections.push({
            id: 'banner',
            title: '精选推荐',
            layout: 'banner',
            imageAspect: 'landscape',
            items: banner.slice(0, 10),
          });
        }

        for (const block of doc.select('.pcHome_bookColumn')) {
          const head = block.first('.pcHome_titleText');
          const items = cardsOf(block);
          if (!items.length) continue;
          sections.push({
            id: `c${sections.length}`,
            title: (trim(head && head.text()) || '推荐').slice(0, 20),
            layout: 'grid',
            items: items.slice(0, 24),
            more: true,
          });
        }

        if (sections.length) return { items: sections, next: null };

        const fallback = cardsOf(doc).slice(0, 30);
        if (!fallback.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: [{ id: 'latest', title: '最新短剧', layout: 'grid', items: fallback }], next: null };
      },
    },

    catalog: {
      async getCategories() {
        return categoriesOf();
      },

      async list(params, ctx) {
        const categoryId = categoryIdOf(params && params.categoryId);
        if (!categoryId) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params && params.cursor);
        const doc = await fetchDoc(listPath(categoryId, page), ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        // 分类页固定每页 24 条，末页会少；卡在 20 才不会给出一页空的游标。
        if (items.length >= 20) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params && params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params && params.cursor);
        const path = `/index.php/vod/search/page/${page}/wd/${encodeURIComponent(query)}.html`;
        const doc = await fetchDoc(path, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        // 搜索结果每页只有 10 条，阈值跟着站点实际密度走。
        if (items.length >= 10) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params && params.id);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const doc = await fetchDoc(`/index.php/vod/detail/id/${id}.html`, ctx, 0);
        const fields = detailFields(doc);

        let title = fields.title || '';
        if (!title) {
          const t = doc.first('title');
          title = trim(t && t.text()).split(/\s*[-–]\s*/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title: title.slice(0, 200), type: 'short', playlists: [] };
        if (fields.cover) detail.cover = fields.cover;
        if (fields.overview) detail.overview = fields.overview;
        if (fields.tags) detail.tags = fields.tags;
        if (fields.crumb) detail.genres = [fields.crumb].filter(Boolean);

        // 每部片子只有一个「全集」片源，站点自己的选集栏也只有这一项。
        const label = fields.episodeCount > 0 ? '全集' : '播放线路';
        detail.playlists = [
          {
            id: 'main',
            label,
            kind: 'main',
            episodes: [{ id: 'e1', index: 1, episodeNumber: 1, label }],
          },
        ];
        if (fields.statusLine && /更新|完结|集/.test(fields.statusLine)) detail.badge = fields.statusLine;

        const related = [];
        for (const node of doc.select('.SecondList_secondListItem')) {
          const card = cardOf(node);
          if (card && card.id !== id) related.push(card);
        }
        if (related.length) detail.related = related.slice(0, 12);

        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params && params.mediaId);
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');

        const html = await fetchText(`/index.php/vod/play/id/${id}/sid/1/nid/1.html`, ctx, 0);
        const cfg = playerConfig(html);
        if (!cfg) throw new hg.PluginError('UPSTREAM_CHANGED', '播放页没有播放器配置');
        if (Number(cfg.points) > 0) throw new hg.PluginError('CONTENT_LOCKED', '这一部需要付费观看');

        const url = playUrlOf(html);
        if (!url) throw new hg.PluginError('CONTENT_LOCKED', '这一部还没有片源');

        const stream = {
          url,
          kind: 'media',
          format: 'hls',
          headers: { 'User-Agent': UA, Referer: `${BASE}/` },
        };
        const from = trim(cfg.from);
        if (from) stream.label = from.slice(0, 40);
        return { streams: [stream] };
      },

      async matchUrl(params) {
        const raw = trim(params && params.url);
        if (!raw) return null;
        const play = raw.match(PLAY_PATH_RE);
        if (play) return { mediaId: play[1], episodeId: 'e1' };
        const detail = raw.match(DETAIL_RE);
        if (detail) return { mediaId: detail[1] };
        const type = raw.match(/\/index\.php\/vod\/type\/id\/(\d+)/i);
        if (type) {
          const id = `type:${type[1]}`;
          return categoryIdOf(id) ? { categoryId: id } : null;
        }
        const cls = raw.match(/\/index\.php\/vod\/show\/class\/([^/]+)\/id\/\d+/i);
        if (cls) {
          let name = '';
          try {
            name = decodeURIComponent(cls[1]);
          } catch {
            name = cls[1];
          }
          const id = `class:${name}`;
          return categoryIdOf(id) ? { categoryId: id } : null;
        }
        return null;
      },
    },
  };
}
