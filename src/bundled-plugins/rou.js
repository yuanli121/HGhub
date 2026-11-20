export const meta = {
  id: 'rou',
  name: 'Rou Video',
  version: '1.0.0',
  protocol: 1,
  description: 'Rou Video（肉視頻 rou.video）：分类（主分类/题材）、排序、搜索、首页与详情播放。播放清单与 TS 分片被包在 PNG 自定义块 roUd 里，由插件 transformResource 解包（bit0=1 时 zlib 解压，纯 JS inflate；实测分片均为未压缩直接截取）。',
  author: 'community',
  kind: 'source',
  mature: true,
  features: ['transform.segment'],
  linkDomains: ['rou.video', 'www.rou.video'],
  defaultHeaders: {
    Referer: 'https://rou.video/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  },
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://rou.video';
const UA = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ID_RE = /^[A-Za-z0-9_-]+$/;
const SORTS = [
  { id: 'createdAt', label: '最新' },
  { id: 'viewCount', label: '最多觀看' },
  { id: 'likeCount', label: '最多讚' },
];
const FALLBACK_CATS = [
  { id: '自拍流出', label: '自拍流出' }, { id: '國產AV', label: '國產AV' }, { id: '探花', label: '探花' },
  { id: '日本', label: '日本' }, { id: '麻豆傳媒', label: '麻豆傳媒' }, { id: 'OnlyFans', label: 'OnlyFans' },
];

export default function (hg) {
  function fail(code, message, extra) { throw new hg.PluginError(code, message, extra); }

  async function fetchHtml(path, ctx, referer) {
    const res = await hg.http.fetch({
      url: SITE + path,
      headers: { Referer: referer || SITE + '/', 'User-Agent': UA },
      responseType: 'text',
      timeoutMs: 20000,
      retry: 1,
      credentials: 'omit',
      maxBytes: 8 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (res.status === 404) fail('NOT_FOUND', '页面不存在');
    if (!res.ok) fail('UPSTREAM_ERROR', '页面暂时不可用（HTTP ' + res.status + '）');
    return res.data;
  }

  function pageOf(cursor) {
    const n = parseInt(cursor || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function secondsOf(t) {
    const m = String(t || '').match(/(?:(\d+)小時)?(?:(\d+)分)?(\d+)秒/);
    if (!m) return undefined;
    return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3], 10);
  }
  function countOf(t) {
    const m = String(t || '').match(/([0-9][0-9,.]*)\s*(萬)?\s*次觀看/);
    if (!m) return undefined;
    const n = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(m[2] ? n * 10000 : n) : undefined;
  }
  function absImg(u) {
    if (!u) return undefined;
    u = String(u).replace(/&amp;/g, '&');
    if (u.indexOf('//') === 0) return 'https:' + u;
    if (u.charAt(0) === '/') return SITE + u;
    return u;
  }

  // 解析列表/分区里的视频卡片（a[href^="/v/"]）；同页按 id 去重
  function parseCards(root, seen) {
    const out = [];
    const links = root.select('a[href^="/v/"]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      const id = String(a.attr('href') || '').slice(3).split(/[/?#]/)[0];
      if (!id || !ID_RE.test(id) || seen[id]) continue;
      const imgs = a.select('img');
      if (!imgs.length) continue;
      const h3 = a.first('h3');
      const title = clean(h3 ? h3.text() : imgs[0].attr('alt'));
      if (!title) continue;
      seen[id] = true;
      const text = clean(a.text());
      const item = { id: id, title: title, type: 'movie', entryEpisodeId: '0' };
      const cover = absImg(imgs[imgs.length - 1].attr('src'));
      if (cover) item.cover = cover;
      const dur = secondsOf(text);
      if (dur) item.durationSec = dur;
      const views = countOf(text);
      if (views != null) item.stats = { plays: views };
      const q = text.match(/(\d{3,4})\s*P/);
      if (q) item.badge = q[1] + 'P';
      out.push(item);
    }
    return out;
  }

  function hasPage(html, n) {
    return html.indexOf('page=' + n + '"') >= 0 || html.indexOf('page=' + n + '&') >= 0;
  }

  async function listPath(path, params, ctx) {
    const page = pageOf(params && params.cursor);
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const html = await fetchHtml(page > 1 ? path + sep + 'page=' + page : path, ctx);
    const doc = hg.html.parse(html);
    const items = parseCards(doc, {});
    const more = items.length > 0 && hasPage(html, page + 1);
    return { items: items, next: more ? String(page + 1) : null };
  }

  // ---------- PNG roUd 解包 ----------
  // ---- 纯 JS zlib inflate（RFC1950/1951），仅用于 PNG 块 bit0=1 的压缩情形 ----
  const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  function huff(lens) {
    const count = new Uint16Array(16), offs = new Uint16Array(16);
    for (let i = 0; i < lens.length; i++) count[lens[i]]++;
    count[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    const sym = new Uint16Array(lens.length);
    for (let i = 0; i < lens.length; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
    return { count: count, sym: sym };
  }
  function inflateRaw(src, pos, sizeHint) {
    let out = new Uint8Array(Math.max(sizeHint || 0, src.length * 4, 65536));
    let op = 0, bitBuf = 0, bitCnt = 0;
    function need(n) {
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error('inflate: 数据截断');
        bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
      }
    }
    function bits(n) {
      if (n === 0) return 0;
      need(n);
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n; bitCnt -= n;
      return v;
    }
    function decode(h) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - c < first) return h.sym[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('inflate: 非法码');
    }
    function grow(n) {
      if (op + n <= out.length) return;
      let cap = out.length * 2;
      while (cap < op + n) cap *= 2;
      const o2 = new Uint8Array(cap); o2.set(out.subarray(0, op)); out = o2;
    }
    let fixedL = null, fixedD = null;
    let last = 0;
    while (!last) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('inflate: 数据截断');
        grow(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
        continue;
      }
      let hl, hd;
      if (type === 1) {
        if (!fixedL) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedL = huff(l);
          const d = new Uint8Array(30).fill(5);
          fixedD = huff(d);
        }
        hl = fixedL; hd = fixedD;
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CLORD[i]] = bits(3);
        const ch = huff(cl);
        const lens = new Uint8Array(nlen + ndist);
        let i = 0;
        while (i < nlen + ndist) {
          const s = decode(ch);
          if (s < 16) lens[i++] = s;
          else {
            let prev = 0, rep;
            if (s === 16) { prev = lens[i - 1]; rep = 3 + bits(2); }
            else if (s === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep--) lens[i++] = prev;
          }
        }
        hl = huff(lens.subarray(0, nlen)); hd = huff(lens.subarray(nlen));
      } else throw new Error('inflate: 非法块类型');
      for (;;) {
        const s = decode(hl);
        if (s < 256) { if (op >= out.length) grow(1); out[op++] = s; }
        else if (s === 256) break;
        else {
          const si = s - 257;
          const len = LBASE[si] + bits(LEXT[si]);
          const ds = decode(hd);
          const dist = DBASE[ds] + bits(DEXT[ds]);
          if (dist > op) throw new Error('inflate: 距离越界');
          grow(len);
          for (let k = 0; k < len; k++) { out[op] = out[op - dist]; op++; }
        }
      }
    }
    return out.subarray(0, op);
  }
  function zlibInflate(src) {
    if (src.length < 6 || (src[0] & 15) !== 8) throw new Error('不是 zlib 数据');
    return inflateRaw(src, 2, 0);
  }

  // PNG 自定义块 roUd：首字节为标志位，bit0=1 表示 zlib 压缩；其余为载荷
  function unwrapPng(d) {
    if (!d || d.length < 16 || d[0] !== 0x89 || d[1] !== 0x50 || d[2] !== 0x4e || d[3] !== 0x47) return d;  // 不是 PNG：原样返回
    let i = 8;
    while (i + 8 <= d.length) {
      const n = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
      const start = i + 8;
      if (start + n > d.length) break;
      if (d[i + 4] === 0x72 && d[i + 5] === 0x6f && d[i + 6] === 0x55 && d[i + 7] === 0x64) {
        if (n < 1) break;
        const body = d.subarray(start + 1, start + n);
        return (d[start] & 1) === 0 ? body : zlibInflate(body);
      }
      i = start + n + 4;
    }
    throw new Error('PNG 中没有 roUd 数据块');
  }

  async function playUrl(id, ctx) {
    if (!ID_RE.test(id)) fail('INVALID_ARGUMENT', '视频标识无效');
    const html = await fetchHtml('/v/' + id, ctx);
    const at = html.indexOf('ev:$R[');
    if (at < 0) fail('UPSTREAM_CHANGED', '详情页缺少播放数据（站点可能改版或需要登录）');
    const block = html.slice(at, at + 6000);
    const dm = block.match(/d:"([^"]+)"/), km = block.match(/k:(-?\d+)/);
    if (!dm || !km) fail('UPSTREAM_CHANGED', '播放数据格式无效');
    const k = parseInt(km[1], 10);
    const raw = hg.codec.base64Decode(dm[1]);
    const dec = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) dec[i] = (raw[i] - k) & 255;
    let o;
    try { o = JSON.parse(hg.codec.utf8Decode(dec)); } catch (_) { fail('UPSTREAM_CHANGED', '播放数据解密失败'); }
    if (!o || !o.videoUrl) fail('UPSTREAM_CHANGED', '播放数据里没有 videoUrl');
    return { url: /^https?:/.test(o.videoUrl) ? o.videoUrl : SITE + o.videoUrl, html: html };
  }

  function metaOf(html, id) {
    const doc = hg.html.parse(html);
    const og = function (p) { const e = doc.first('meta[property="' + p + '"]'); return e ? e.attr('content') : ''; };
    const item = { id: id, title: clean(og('og:title').split(' - ')[0]) || id, type: 'movie' };
    const img = absImg(og('og:image'));
    if (img) { item.cover = img; item.backdrop = img; }
    const jm = html.match(/duration:(\d+(?:\.\d+)?),archived/);
    if (jm) item.durationSec = Math.round(parseFloat(jm[1]));
    const tm = html.match(/tags:\$R\[\d+\]=\[([^\]]*)\],published/);
    if (tm) {
      const tags = [];
      tm[1].replace(/"([^"]+)"/g, function (_, t) { tags.push(t); return ''; });
      if (tags.length) item.tags = tags;
    }
    const vm = html.match(/published:!0,publisher:[^,]*,createdAt:"([^"]+)",updatedAt:[^,]*,viewCount:(\d+),likeCount:(\d+)/);
    if (vm) {
      const t = Date.parse(vm[1]);
      if (Number.isFinite(t)) { item.publishedAt = t; item.year = new Date(t).getFullYear(); }
      item.stats = { plays: parseInt(vm[2], 10), likes: parseInt(vm[3], 10) };
    }
    return item;
  }

  return {
    home: {
      async getSections(params, ctx) {
        const html = await fetchHtml('/home', ctx);
        const doc = hg.html.parse(html);
        const secs = doc.select('section');
        const out = [];
        const seen = {};
        for (let i = 0; i < secs.length; i++) {
          const h = secs[i].first('h2');
          const title = h ? clean(h.text()) : '';
          const items = parseCards(secs[i], seen);
          if (!title || items.length < 2) continue;
          out.push({ id: 's' + i, title: title, layout: 'row', imageAspect: 'landscape', items: items });
        }
        if (!out.length) fail('UPSTREAM_CHANGED', '首页没有可识别的视频列表');
        return { items: out, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const cached = await hg.storage.get('cats');
        if (cached) return cached;
        const tree = [];
        try {
          const html = await fetchHtml('/cat', ctx);
          const doc = hg.html.parse(html);
          const secs = doc.select('section');
          const want = { '主分類': 1, '題材 / 屬性': 1 };
          for (let i = 0; i < secs.length; i++) {
            const h = secs[i].first('h2');
            const title = h ? clean(h.text()) : '';
            if (!want[title]) continue;
            const kids = [], seen = {};
            const as = secs[i].select('a[href^="/t/"]');
            for (let j = 0; j < as.length; j++) {
              let tag;
              try { tag = decodeURIComponent(String(as[j].attr('href')).slice(3).split('?')[0]); } catch (_) { continue; }
              if (!tag || seen[tag]) continue;
              seen[tag] = true;
              kids.push({ id: tag, label: tag, sorts: SORTS });
            }
            if (kids.length) tree.push({ id: 'g' + i, label: title, children: kids });
          }
        } catch (_) {}
        if (!tree.some(function (g) { return g.label === '主分類'; })) tree.unshift({ id: 'main', label: '主分類', children: FALLBACK_CATS.map(function (c) { return { id: c.id, label: c.label, sorts: SORTS }; }) });
        await hg.storage.set('cats', tree, { ttlSec: 12 * 3600 });
        return tree;
      },
      async list(params, ctx) {
        const tag = String((params && params.categoryId) || '');
        if (!tag) fail('INVALID_ARGUMENT', '缺少分类');
        const sort = params && params.sort && /^(createdAt|viewCount|likeCount)$/.test(params.sort) ? params.sort : 'createdAt';
        return listPath('/t/' + encodeURIComponent(tag) + '?order=' + sort, params, ctx);
      },
    },

    search: {
      async search(params, ctx) {
        const q = params && params.query ? String(params.query).trim() : '';
        if (!q) return { items: [], next: null };
        return listPath('/search?q=' + encodeURIComponent(q), params, ctx);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '');
        if (!ID_RE.test(id)) fail('INVALID_ARGUMENT', '视频标识无效');
        const html = await fetchHtml('/v/' + id, ctx);
        const item = metaOf(html, id);
        const ep = { id: '0', index: 1, episodeNumber: 1, label: '1' };
        if (item.durationSec) ep.durationSec = item.durationSec;
        item.playlists = [{ id: 'main', label: '默认', episodes: [ep] }];
        return item;
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && params.mediaId) || '');
        const p = await playUrl(id, ctx);
        const st = {
          url: p.url,
          kind: 'media',
          format: 'hls',
          label: '默认',
          headers: { Referer: SITE + '/v/' + id, 'User-Agent': UA },
          transforms: {
            playlist: { type: 'plugin', name: 'roupng' },
            segment: { type: 'plugin', name: 'roupng' },
          },
        };
        const jm = p.html.match(/duration:(\d+(?:\.\d+)?),archived/);
        const res = { streams: [st], expiresAt: Date.now() + 3 * 3600 * 1000 };
        if (jm) res.durationSec = Math.round(parseFloat(jm[1]));
        return res;
      },

      matchUrl(params) {
        const m = String((params && params.url) || '').match(/rou\.video\/v\/([A-Za-z0-9_-]+)/);
        return m ? { mediaId: m[1] } : null;
      },
    },

    transformResource(params) {
      if (params.name !== 'roupng') return { data: params.data };
      const out = unwrapPng(params.data);
      if (params.kind === 'playlist') {
        if (!(out[0] === 0x23 && out[1] === 0x45 && out[2] === 0x58)) throw new hg.PluginError('UPSTREAM_CHANGED', '清单解包后不是 m3u8');
        return { data: out, contentType: 'application/vnd.apple.mpegurl' };
      }
      return { data: out, contentType: 'video/mp2t' };
    },
  };
}
