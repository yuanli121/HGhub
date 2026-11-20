export const meta = {
  id: 'mwxk62',
  name: 'KKAV',
  version: '1.0.3',
  protocol: 1,
  description: 'KKAV（入口 62mwxk.com 是跳板页，真实域名每天会变，插件自动解析）：点播源。站点根目录是 meta refresh → /index.htm 年龄确认页 → /home.htm 真实片库。分类、搜索、详情与 HLS 播放（AES-128 加密分片，由播放器按 m3u8 自行解密）。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['62mwxk.com', 'www.62mwxk.com', 'kkav.com', 'www.kkav.com', '78vsdc.com', 'www.78vsdc.com'],
  defaultHeaders: {
    Referer: 'https://62mwxk.com/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 20, playback: 25 },
};

const ENTRY = 'https://62mwxk.com';          // 入口（跳板页，不再是片库本身）
const FALLBACK_SITE = 'https://www.78vsdc.com';   // 解析失败时的兜底（2026-11-19 实测）
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
// /js/config.js（凯撒移位 3 加密）里解出的默认值；运行时会重新解析 config.js，失败才用这里
const FALLBACK_CFG = {
  tupath: 'https://ddd.aisheji8.com/data/',
  m3u8path1: 'https://h1.qhkjapp.com/data/',
  m3u8path2: 'https://h3.xinghun1.com/data/',
};
// /js/menu.js 的栏目（长片 / 视频），图文栏目不是视频，跳过
const FALLBACK_CATS = [
  { id: '26', label: '无码素人', group: '长片' }, { id: '84', label: '日本无码', group: '长片' },
  { id: '22', label: '无码破解', group: '长片' }, { id: '25', label: '日韩中字', group: '长片' },
  { id: '19', label: '欧美劲爆', group: '长片' }, { id: '28', label: '经典三级', group: '长片' },
  { id: '20', label: '3D动漫', group: '长片' },
  { id: '1', label: '国产自拍', group: '视频' }, { id: '4', label: '家庭乱伦', group: '视频' },
  { id: '3', label: '少女萝莉', group: '视频' }, { id: '5', label: '熟女少妇', group: '视频' },
  { id: '7', label: '酒店探花', group: '视频' }, { id: '8', label: '偷拍盗摄', group: '视频' },
  { id: '37', label: '醉酒迷奸', group: '视频' }, { id: '90', label: '综合强片', group: '视频' },
  { id: '38', label: '吃瓜黑料', group: '视频' }, { id: '2', label: '直播裸聊', group: '视频' },
  { id: '76', label: '巨乳诱惑', group: '视频' }, { id: '36', label: '户外野战', group: '视频' },
  { id: '23', label: 'AI换脸', group: '视频' }, { id: '73', label: '群P换妻', group: '视频' },
  { id: '57', label: '网黄博主', group: '视频' }, { id: '56', label: '黑人媚黑', group: '视频' },
];

export default function (hg) {
  let cfgMem = null;
  let SITE = FALLBACK_SITE;       // 当前真实站点，由 resolveSite() 解析
  let siteAt = 0;

  // 入口域名的任何页面都是同一段跳转脚本：eval(decodeURIComponent('url2.push("域名")')) 列出候选域名，
  // 再按「当天序号 % 数量」选一个、拼上 www. 跳转。这里照同样规则算出当前域名，并校验它真的是片库（有 video-listing）。
  async function resolveSite(ctx) {
    if (siteAt && Date.now() - siteAt < 30 * 60 * 1000) return SITE;
    const cached = await hg.storage.get('site');
    if (cached && cached.url && cached.at && Date.now() - cached.at < 30 * 60 * 1000) { SITE = cached.url; siteAt = cached.at; return SITE; }
    const cands = [];
    try {
      const res = await hg.http.fetch({ url: ENTRY + '/home.htm', headers: { 'User-Agent': UA }, responseType: 'text', timeoutMs: 12000, signal: ctx && ctx.signal });
      const html = typeof res.data === 'string' ? res.data : '';
      if (html.indexOf('video-listing') >= 0) cands.push(ENTRY);        // 入口自己就是片库
      const m = html.match(/eval\(decodeURIComponent\('([^']+)'\)\)/);
      if (m) {
        const decoded = safeDecode(m[1]);
        const doms = [];
        const re = /url2\.push\("([^"]+)"\)/g;
        let x;
        while ((x = re.exec(decoded))) doms.push(x[1]);
        const useDay = parseInt((html.match(/var UseDay=(\d+)/) || [])[1] || '1', 10) || 1;
        const offset = parseInt((html.match(/var OffsetHour=(-?\d+)/) || [])[1] || '0', 10) || 0;
        if (doms.length) {
          const day = Math.floor((Math.floor(Date.now() / 1000) * 1000 + 8 * 3600000 - offset * 3600000) / 86400000 / useDay);
          const pick = doms[day % doms.length].split(',');
          pick.forEach(function (d) { cands.push('https://www.' + d.trim()); });
          doms.forEach(function (g) { g.split(',').forEach(function (d) { cands.push('https://www.' + d.trim()); }); });
        }
      }
    } catch (_) {}
    cands.push(FALLBACK_SITE);
    const tried = {};
    for (let i = 0; i < cands.length; i++) {
      const base = cands[i];
      if (tried[base]) continue;
      tried[base] = 1;
      try {
        const r = await hg.http.fetch({ url: base + '/home.htm', headers: { 'User-Agent': UA }, responseType: 'text', timeoutMs: 10000, signal: ctx && ctx.signal });
        if (r.ok && typeof r.data === 'string' && r.data.indexOf('video-listing') >= 0) {
          SITE = base; siteAt = Date.now();
          try { await hg.storage.set('site', { url: base, at: siteAt }, { ttlSec: 3600 }); } catch (_) {}
          return SITE;
        }
      } catch (_) {}
    }
    fail('UNAVAILABLE', '无法解析 KKAV 当前可用域名（入口 ' + ENTRY + ' 的跳转目标都打不开）');
  }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function headers() {
    return { 'User-Agent': UA, Referer: SITE + '/' };
  }

  async function fetchText(url, ctx, opts) {
    const res = await hg.http.fetch({
      url: url,
      headers: headers(),
      responseType: 'text',
      timeoutMs: (opts && opts.timeoutMs) || 15000,
      retry: 1,
      maxBytes: 4 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res.ok) {
      if (opts && opts.allowFail) return null;
      fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    }
    return String(res.data || '');
  }

  function caesar(text, key) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      let k = key;
      const c = text.charCodeAt(i);
      if (c - k < 0) k = k - 256;
      out += String.fromCharCode(c - k);
    }
    return out;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, '%20')); } catch (_) { return String(s); }
  }

  async function config(ctx) {
    if (cfgMem) return cfgMem;
    const cached = await hg.storage.get('cfg');
    if (cached) { cfgMem = cached; return cfgMem; }
    const cfg = Object.assign({}, FALLBACK_CFG);
    try {
      await resolveSite(ctx);
      const js = await fetchText(SITE + '/js/config.js', ctx, { allowFail: true, timeoutMs: 10000 });
      const m = js && js.match(/caesarDecrypt\('((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\)/);
      if (m) {
        const plain = caesar(m[1].replace(/\\\\/g, '\\'), Number(m[2]));
        ['tupath', 'm3u8path1', 'm3u8path2'].forEach(function (k) {
          const r = plain.match(new RegExp('var ' + k + '="(https:\\/\\/[^"]+)"'));
          if (r) cfg[k] = r[1];
        });
      }
    } catch (_) {}
    cfgMem = cfg;
    await hg.storage.set('cfg', cfg, { ttlSec: 6 * 3600 });
    return cfg;
  }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    return SITE + (href.charAt(0) === '/' ? '' : '/') + href;
  }

  // 卡片：<a href="/htm/playX/ID.htm"><img id="smallpicN-ID">… 标题写在 document.write(decodeURIComponent("…"))
  // 封面列表：fetchMultipleCover(['smallpicN-ID|path', …]) → tupath + 'cover_64_2/' + path + '.txt'（内容为 data: URL）
  function parseCards(html, cfg, coverMap) {
    const covers = coverMap || {};
    if (!coverMap) {
      const re = /'smallpic\d+-(\d+)\|([^']+)'/g;
      let x;
      while ((x = re.exec(html))) covers[x[1]] = x[2];
    }
    const items = [];
    const seen = {};
    const blocks = html.split(/<div class="cell video-listing avdata/);
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      const hm = b.match(/href="(\/htm\/play(\d+)\/(\d+)\.htm)"/);
      if (!hm) continue;   // 广告位（showaaCoverAd）没有播放链接
      const id = hm[1];
      if (seen[id]) continue;
      const tm = b.match(/decodeURIComponent\("([^"]*)"/);
      const title = tm ? safeDecode(tm[1]).trim() : '';
      if (!title) continue;
      seen[id] = true;
      const item = { id: id, title: title, type: 'movie' };
      const path = covers[hm[3]];
      if (path) item.cover = { url: cfg.tupath + 'cover_64_2/' + encodeURI(path) + '.txt', transform: { type: 'plugin', name: 'datauri' } };
      const dm = b.match(/duration_format">(\d+):(\d+):(\d+)</);
      if (dm) item.durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
      const ym = b.match(/video-date">(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (ym) {
        item.year = Number(ym[1]);
        item.publishedAt = Date.UTC(Number(ym[1]), Number(ym[2]) - 1, Number(ym[3])) - 8 * 3600000;
      }
      const rm = b.match(/resolution_description[^"]*">([^<]+)</);
      if (rm) item.badge = rm[1].trim().slice(0, 8);
      items.push(item);
    }
    return items;
  }

  function hasNext(html) {
    return /<span class="info">[\s\S]{0,300}?>下页</.test(html);
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function loadCats(ctx) {
    const cached = await hg.storage.get('cats');
    if (cached) return cached;
    let cats = [];
    try {
      await resolveSite(ctx);
      const js = await fetchText(SITE + '/js/menu.js', ctx, { allowFail: true, timeoutMs: 10000 });
      if (js) {
        const dls = js.split('<dl>');
        for (let i = 1; i < dls.length; i++) {
          const gm = dls[i].match(/<dt>[\s\S]*?>([^<]+)<\/a><\/dt>/);
          const group = gm ? gm[1].trim() : '视频';
          const re = /href="\/htms\/list(\d+)\/1\.htm"[^>]*>([^<]+)</g;
          let x;
          while ((x = re.exec(dls[i]))) {
            const label = x[2].replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); }).trim();
            if (label && !cats.some(function (c) { return c.id === x[1]; })) cats.push({ id: x[1], label: label, group: group });
          }
        }
      }
    } catch (_) {}
    if (!cats.length) cats = FALLBACK_CATS;
    await hg.storage.set('cats', cats, { ttlSec: 12 * 3600 });
    return cats;
  }

  function stripPage(id) {
    return String(id || '').split('?')[0];
  }

  async function parsePlay(id, ctx) {
    const url = absUrl(stripPage(id));
    if (!/\/htm\/play\d+\/\d+\.htm$/.test(url)) fail('INVALID_ARGUMENT', '无效的视频地址');
    const html = await fetchText(url, ctx);
    const m = html.match(/setm3u8\('([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\)/);
    const tm = html.match(/<h1> '\+decodeURIComponent\("([^"]*)"/) || html.match(/document\.title=decodeURIComponent\("([^"]*)"/);
    return {
      html: html,
      title: tm ? safeDecode(tm[1]).trim() : '',
      av1: m ? m[1] : '',
      h264: m ? m[2] : '',
      h264hi: m ? m[3] : '',
    };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const cfg = await config(ctx);
        await resolveSite(ctx);
        const html = await fetchText(SITE + '/home.htm', ctx);
        // 封面数组可能不在分区内，先用整页建立「视频号 → 封面路径」映射
        const covers = {};
        const re = /'smallpic\d+-(\d+)\|([^']+)'/g;
        let x;
        while ((x = re.exec(html))) covers[x[1]] = x[2];
        const parts = html.split(/<div class="container-header clearfix">/);
        const sections = [];
        for (let i = 1; i < parts.length; i++) {
          const tm = parts[i].match(/<div class="t"[^>]*>([^<]+)</);
          const items = parseCards(parts[i], cfg, covers);
          if (items.length) sections.push({ id: 'sec' + i, title: tm ? tm[1].trim() : '最新', layout: 'grid', imageAspect: 'landscape', items: items });
        }
        if (!sections.length) fail('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const cats = await loadCats(ctx);
        const groups = [];
        const byName = {};
        for (let i = 0; i < cats.length; i++) {
          const g = cats[i].group || '视频';
          if (!byName[g]) {
            byName[g] = { id: 'grp:' + (groups.length + 1), label: g, children: [] };
            groups.push(byName[g]);
          }
          byName[g].children.push({ id: cats[i].id, label: cats[i].label });
        }
        return groups;
      },
      async list(params, ctx) {
        const cid = String((params && params.categoryId) || '').replace(/[^0-9]/g, '');
        if (!cid) fail('INVALID_ARGUMENT', '缺少分类');
        const cfg = await config(ctx);
        const page = pageOf(params && params.cursor);
        await resolveSite(ctx);
        const html = await fetchText(SITE + '/htms/list' + cid + '/' + page + '.htm', ctx);
        const items = parseCards(html, cfg);
        return { items: items, next: items.length && hasNext(html) ? String(page + 1) : null };
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        const cfg = await config(ctx);
        const page = pageOf(params && params.cursor);
        await resolveSite(ctx);
        const url = SITE + '/list.jsp?tagid=&tj=&s=' + encodeURIComponent(q) + '&page=' + page;
        const html = await fetchText(url, ctx, { timeoutMs: 20000 });
        const items = parseCards(html, cfg);
        return { items: items, next: items.length && hasNext(html) ? String(page + 1) : null };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = params && params.id;
        if (!id) fail('INVALID_ARGUMENT', '缺少视频 ID');
        const cfg = await config(ctx);
        const p = await parsePlay(id, ctx);
        if (!p.h264 && !p.av1) fail('UPSTREAM_CHANGED', '未找到播放地址');
        const detail = {
          id: stripPage(id),
          title: p.title || stripPage(id),
          type: 'movie',
          playlists: [{ id: 'main', label: '默认', episodes: [{ id: '1', index: 1, episodeNumber: 1, label: '播放' }] }],
        };
        // 播放页本身没有封面/时长/日期（这些只存在于列表页）：用标题在站内搜索，按视频编号找回同一条的信息。
        // 站点视频没有简介，标签/清晰度/时长/发布日期是能拿到的全部元数据。
        try {
          if (p.title) {
            await resolveSite(ctx);
            // 站点搜索只匹配标题里的「一个连续片段」，带空格/标点的长词搜不到：
            // 先取第一个空格或标点之前的部分，再从长到短试（20→12→8→6 字），找到同编号那条为止
            // 站点搜索是「子串匹配」：带编号开头的标题（FC2-4956890 …）用编号搜不中，短词会返回一堆无关结果。
            // 做法：把标题按空格/标点/英文编号切成片段，取最长的几段，各自从长到短（20→12→8→6 字）试，直到搜到同编号那条。
            const segs = p.title.split(/[\s,，。！!？?、:：;；\-—|｜【】\[\]()（）]+/).filter(function (x) { return x && !/^[A-Za-z0-9]+$/.test(x); });
            segs.sort(function (x, y) { return y.length - x.length; });
            const tries = [];
            segs.slice(0, 3).forEach(function (seg) {
              [20, 12, 8, 6].forEach(function (n) { const q = seg.slice(0, n); if (q.length >= 4 && tries.indexOf(q) < 0) tries.push(q); });
            });
            if (!tries.length) tries.push(p.title.slice(0, 8));
            let me = null;
            for (let i = 0; i < tries.length && !me; i++) {
              const sh = await fetchText(SITE + '/list.jsp?tagid=&tj=&s=' + encodeURIComponent(tries[i]) + '&page=1', ctx, { allowFail: true, timeoutMs: 12000 });
              if (sh) me = parseCards(sh, cfg).filter(function (x) { return x.id === detail.id; })[0] || null;
            }
            if (me) {
              if (me.cover) { detail.cover = me.cover; detail.backdrop = me.cover; }
              if (me.durationSec) detail.durationSec = me.durationSec;
              if (me.year) detail.year = me.year;
              if (me.publishedAt) detail.publishedAt = me.publishedAt;
              if (me.badge) detail.tags = [me.badge];
            }
          }
        } catch (_) {}
        const related = parseCards(p.html, cfg).filter(function (x) { return x.id !== detail.id; });
        if (related.length) {
          detail.related = related;
          // 详情页本身没有大图；同栏目里同一作品的封面不在本页，留空即可
        }
        if (!detail.description) {
          const bits = [];
          if (detail.durationSec) { const t = detail.durationSec; bits.push('时长 ' + (t >= 3600 ? Math.floor(t / 3600) + ':' : '') + String(Math.floor((t % 3600) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')); }
          if (detail.tags && detail.tags.length) bits.push('清晰度 ' + detail.tags[0]);
          if (detail.year) bits.push('发布于 ' + detail.year + ' 年');
          bits.push('该站点未提供视频简介');
          detail.description = bits.join(' · ');
        }
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = params && (params.mediaId || params.episodeId);
        if (!id) fail('INVALID_ARGUMENT', '缺少视频 ID');
        const cfg = await config(ctx);
        const p = await parsePlay(params.mediaId, ctx);
        if (!p.h264) fail('UPSTREAM_CHANGED', '未找到播放地址');
        const lines = [
          { id: 'l2', label: '极速', base: cfg.m3u8path2 },
          { id: 'l1', label: '普通', base: cfg.m3u8path1 },
        ].filter(function (l) { return !!l.base; });
        let line = lines[0];
        for (let i = 0; i < lines.length; i++) if (lines[i].id === params.serverId) line = lines[i];
        const streams = [{
          url: line.base + p.h264 + 'index.m3u8',
          kind: 'media',
          format: 'hls',
          codec: 'h264',
          label: '720P',
          height: 720,
          serverId: line.id,
          headers: headers(),
        }];
        if (p.h264hi) {
          streams.unshift({ url: line.base + p.h264hi + 'index.m3u8', kind: 'media', format: 'hls', codec: 'h264', label: '高码率', serverId: line.id, headers: headers() });
        }
        // 备用：另一条线路的同一视频（实测「极速」线路偶发 25 秒无响应，换另一条能通）
        lines.forEach(function (l) {
          if (l.id === line.id) return;
          streams.push({ url: l.base + p.h264 + 'index.m3u8', kind: 'media', format: 'hls', codec: 'h264', label: '720P · ' + l.label + '（备用）', height: 720, serverId: l.id, headers: headers() });
        });
        return { streams: streams, servers: lines.map(function (l) { return { id: l.id, label: l.label }; }) };
      },

      matchUrl(params) {
        const m = String((params && params.url) || '').match(/\/htm\/play\d+\/\d+\.htm/);
        return m ? { mediaId: m[0] } : null;
      },
    },

    // 封面 .txt 内容是 "data:image\jpg;base64,\9j\4AAQ…"（斜杠被写成反斜杠，含换行）
    transformResource(params) {
      if (params.name !== 'datauri') return { data: params.data };
      const text = hg.codec.utf8Decode(params.data).replace(/\\/g, '/').trim();
      const m = text.match(/^data:([^;,]+);base64,([\s\S]*)$/);
      if (!m) return { data: params.data };
      const b64 = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
      return { data: hg.codec.base64Decode(b64), contentType: m[1].replace('jpg', 'jpeg') };
    },
  };
}
