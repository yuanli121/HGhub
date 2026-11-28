export const meta = {
  id: 'chengguo.source',
  name: '橙果短剧',
  version: '1.0.2',
  protocol: 1,
  kind: 'source',
  description: '橙果短剧（chengguodj.com）：首页分区、五个频道分页、搜索、详情与 HLS 直连；接口走 AES+签名，插件内自解。',
  mature: true,
  linkDomains: ['chengguodj.com', 'www.chengguodj.com', 'api2.chengguodj.com', 'hls.ohjzmm.cn', 'pic.gyezbp.cn', 'pic.mmgbaa.cn', 'imgpublic.ycomesc.live'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://chengguodj.com';
const API = 'https://api2.chengguodj.com';
const PLAIN_PIC_HOST = 'imgpublic.ycomesc.live';

// 站点运行时下发的默认值（bundle 内的 fallback）
const CRYPT_KEY = '2acf7e91e9864673';
const CRYPT_IV = '1c29882d3ddfcfd6';
const SIGN_KEY = '5589d41f92a597d016b037ac37db243d';
const CRYPT_VER = 'v0';

const CHANNELS = [
  { code: 'yuanchuang', name: '橙果原创' },
  { code: 'aiduanju', name: 'AI短剧' },
  { code: 'zhenren', name: '真人短剧' },
  { code: 'mogai', name: 'AI魔改' },
  { code: 'manju', name: 'AI漫剧' },
];

const HOME_SECTIONS = [
  { title: '热播榜', path: '/api/v1/dramas?page=1' },
  { title: '橙果原创', path: '/api/v1/channels/yuanchuang?page=1' },
  { title: 'AI短剧', path: '/api/v1/channels/aiduanju?page=1' },
  { title: '真人短剧', path: '/api/v1/channels/zhenren?page=1' },
  { title: 'AI魔改', path: '/api/v1/channels/mogai?page=1' },
  { title: 'AI漫剧', path: '/api/v1/channels/manju?page=1' },
];

const DRAMA_RE = /^https?:\/\/(?:www\.)?chengguodj\.com\/(?:drama|play)\/([A-Za-z0-9\-_]+)/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

const CRYPT_PIC_HOSTS = /(?:gyezbp\.cn|mmgbaa\.cn|chengguopic\.|cglive\.)/i;

function plainPic(url) {
  const raw = norm(url);
  if (!/^https?:\/\//i.test(raw)) return '';
  // 加密图床只吐 AES 密文，换成同路径的明文图床
  return CRYPT_PIC_HOSTS.test(raw) ? raw.replace(/^https?:\/\/[^/]+/i, `https://${PLAIN_PIC_HOST}`) : raw;
}

export default hg => {
  const utf8 = text => hg.codec.utf8Encode(text);

  function hexOf(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      out += b < 16 ? `0${b.toString(16)}` : b.toString(16);
    }
    return out;
  }

  function aesEncode(obj) {
    const cipher = hg.crypto.aesEncrypt(
      { mode: 'cbc', key: utf8(CRYPT_KEY), iv: utf8(CRYPT_IV), padding: 'pkcs7' },
      utf8(JSON.stringify(obj)),
    );
    return hg.codec.base64Encode(cipher);
  }

  function aesDecode(text) {
    const data = hg.codec.base64Decode(norm(text).replace(/ /g, '+'));
    return hg.codec.utf8Decode(
      hg.crypto.aesDecrypt({ mode: 'cbc', key: utf8(CRYPT_KEY), iv: utf8(CRYPT_IV), padding: 'pkcs7' }, data),
    );
  }

  // sign = md5(sha256(sorted("k=v"&...) + sign_key))，sha256 取 hex
  function signature(fields) {
    const parts = Object.keys(fields)
      .filter(k => k !== 'sign' && k !== '_ver' && fields[k] !== null && fields[k] !== undefined)
      .sort()
      .map(k => `${k}=${k === 'data' ? String(fields[k]).replace(/ /g, '+') : fields[k]}`);
    const sha = hexOf(hg.crypto.digest('sha256', parts.join('&') + SIGN_KEY));
    return hexOf(hg.crypto.digest('md5', sha));
  }

  async function apiCall(path, body, ctx, jsonBody) {
    const headers = { Accept: 'application/json', Origin: SITE };
    let payload;
    if (jsonBody) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body || {});
    } else {
      const fields = {
        _ver: CRYPT_VER,
        data: aesEncode(body || {}),
        timestamp: Math.floor(Date.now() / 1000),
        client: 'ios',
      };
      fields.sign = signature(fields);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = ['_ver', 'client', 'data', 'sign', 'timestamp']
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`)
        .join('&');
    }

    const res = await hg.http.fetch({
      url: `${API}${path}`,
      method: 'POST',
      headers,
      body: payload,
      signal: ctx.signal,
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `接口返回 ${res.status}`);
    let envelope;
    try {
      envelope = JSON.parse(res.data);
    } catch {
      throw new hg.PluginError('UPSTREAM_CHANGED', '接口返回格式已变化');
    }
    if (!envelope || typeof envelope.data !== 'string') {
      throw new hg.PluginError('UPSTREAM_CHANGED', '接口返回格式已变化');
    }
    let parsed;
    try {
      parsed = JSON.parse(aesDecode(envelope.data));
    } catch {
      throw new hg.PluginError('UPSTREAM_CHANGED', '接口数据解密失败');
    }
    return parsed;
  }

  async function apiData(path, body, ctx, jsonBody) {
    const parsed = await apiCall(path, body, ctx, jsonBody);
    if (!parsed || parsed.success === false) {
      const message = (parsed && parsed.error && parsed.error.message) || '接口请求失败';
      throw new hg.PluginError('UPSTREAM_ERROR', message);
    }
    return parsed.data || {};
  }

  function coverOf(row) {
    const cover = row && row.cover;
    const url = typeof cover === 'string' ? cover : (cover && cover.url) || '';
    const fallback = typeof cover === 'string' ? row.cover_fallback_url : cover && cover.fallback_url;
    const plain = plainPic(url);
    if (plain) return plain;
    const fb = norm(fallback);
    if (!fb) return '';
    return /^https?:\/\//i.test(fb) ? fb : `${SITE}${fb.charAt(0) === '/' ? '' : '/'}${fb}`;
  }

  function itemOf(row) {
    if (!row || !row.slug) return null;
    const item = { id: trim(row.slug), title: trim(row.title), type: 'short' };
    if (!item.title) return null;
    const cover = coverOf(row);
    if (cover) item.cover = cover;
    const intro = trim(row.intro);
    if (intro) item.description = intro.slice(0, 2000);
    const channel = row.channel || row.line;
    if (channel && channel.name) item.badge = trim(channel.name).slice(0, 8);
    const total = Number(row.total_episode_count);
    if (Number.isInteger(total) && total > 0) item.totalEpisodes = total;
    const published = Number(row.published_episode_count);
    if (Number.isInteger(published) && published > 0) item.episodeCount = published;
    const tags = [];
    if (Array.isArray(row.tags)) {
      for (const t of row.tags) {
        const name = trim(typeof t === 'string' ? t : t && t.name);
        if (name && name.length <= 30 && tags.indexOf(name) < 0) tags.push(name);
      }
    }
    if (tags.length) item.tags = tags.slice(0, 20);
    return item;
  }

  function itemsOf(data) {
    const rows = Array.isArray(data.items) ? data.items : Array.isArray(data.dramas) ? data.dramas : [];
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      const item = itemOf(row);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  async function probeMedia(url, ctx) {
    try {
      let res = await hg.http.fetch({ url, method: 'HEAD', signal: ctx.signal });
      if (!res.ok) {
        res = await hg.http.fetch({ url, headers: { Range: 'bytes=0-1' }, signal: ctx.signal });
      }
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        for (const sec of HOME_SECTIONS) {
          const data = await apiData(sec.path, {}, ctx, false);
          const items = itemsOf(data);
          if (!items.length) continue;
          sections.push({ id: `s${sections.length}`, title: sec.title, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页没有取到内容');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return [{ id: 'all', label: '全部' }].concat(CHANNELS.map(c => ({ id: c.code, label: c.name })));
      },

      async list(params, ctx) {
        const id = trim(params.categoryId) || 'all';
        if (id !== 'all' && !CHANNELS.some(c => c.code === id)) {
          throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        }
        const want = pageNo(params.cursor);
        const path = id === 'all'
          ? `/api/v1/dramas?page=${want}`
          : `/api/v1/channels/${id}?page=${want}`;
        let data;
        try {
          data = await apiData(path, {}, ctx, false);
        } catch (error) {
          // 频道只有一页时翻过头会 404，按没有更多处理
          if (want > 1) return { items: [], next: null };
          throw error;
        }
        const items = itemsOf(data);
        const out = { items };
        const page = data.pagination || {};
        const totalPages = Number(page.total_pages);
        if (items.length && Number.isFinite(totalPages) && totalPages > want) out.next = String(want + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const want = pageNo(params.cursor);
        const path = `/api/v1/search?q=${encodeURIComponent(query)}&page=${want}`;
        let data;
        try {
          data = await apiData(path, {}, ctx, false);
        } catch (error) {
          if (want > 1) return { items: [], next: null };
          throw error;
        }
        const items = itemsOf(data);
        const out = { items };
        const page = data.pagination || {};
        if (items.length && page.dramas_has_more) out.next = String(want + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!/^[A-Za-z0-9\-_]+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const data = await apiData(`/api/v1/dramas/${encodeURIComponent(id)}`, {}, ctx, false);
        if (!data.slug && !data.title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = itemOf({ ...data, slug: data.slug || id }) || { id, title: id, type: 'short' };
        detail.type = 'short';

        const tags = [];
        if (Array.isArray(data.tags)) {
          for (const t of data.tags) {
            const name = trim(typeof t === 'string' ? t : t && t.name);
            if (name && name.length <= 30 && tags.indexOf(name) < 0) tags.push(name);
          }
        }
        const channelName = trim(data.channel && data.channel.name);
        if (channelName && tags.indexOf(channelName) < 0) tags.unshift(channelName);
        if (tags.length) detail.tags = tags.slice(0, 20);
        if (data.serial_status === 'completed' || data.status === 'completed') detail.status = 'finished';
        else if (data.serial_status === 'ongoing' || data.status === 'ongoing') detail.status = 'ongoing';

        const rows = Array.isArray(data.episodes) ? data.episodes : [];
        const episodes = [];
        for (const row of rows) {
          const number = Number(row.number);
          if (!Number.isFinite(number) || number < 0) continue;
          const index = episodes.length + 1;
          const ep = { id: String(number), index, label: trim(row.title) || String(number) };
          const dur = Number(row.duration_seconds);
          if (Number.isFinite(dur) && dur > 0) ep.durationSec = dur;
          episodes.push(ep);
        }
        if (!episodes.length) throw new hg.PluginError('CONTENT_LOCKED', '这部剧还没有可播放的分集');
        detail.playlists = [{ id: 'main', label: '正片', kind: 'main', episodes }];
        if (Number.isInteger(Number(data.total_episode_count))) detail.totalEpisodes = Number(data.total_episode_count);
        detail.episodeCount = episodes.length;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.mediaId);
        if (!/^[A-Za-z0-9\-_]+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const episode = trim(params.episodeId);
        if (!/^\d+$/.test(episode)) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        // 取播放地址的接口偶发 503，重试一次再判失败
        const path = `/api/v1/dramas/${encodeURIComponent(id)}/episodes/${episode}`;
        let data;
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            data = await apiData(path, {}, ctx, true);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) {
          hg.log.warn(`取流失败：${lastError && lastError.message}`);
          if (lastError instanceof hg.PluginError) {
            throw new hg.PluginError('CONTENT_LOCKED', '这一集暂时取不到地址，换一集试试');
          }
          throw lastError;
        }

        const media = data.media || {};
        const url = trim(media.source_url);
        if (!/^https?:\/\//i.test(url)) throw new hg.PluginError('CONTENT_LOCKED', '这一集没有播放地址');

        const probe = await probeMedia(url, ctx);
        if (probe.res && !probe.res.ok) {
          throw new hg.PluginError('CONTENT_LOCKED', `取流地址不可用（${probe.res.status}）`);
        }
        if (!probe.res) hg.log.warn('取流地址探测失败，直接返回上游地址');

        const headers = (probe.res && probe.res.headers) || {};
        const finalUrl = (probe.res && probe.res.url) || url;
        const contentType = norm(headers['content-type']).toLowerCase();
        const isHls = norm(media.format) === 'hls'
          || /\.m3u8(\?|$)/i.test(finalUrl)
          || /mpegurl/.test(contentType);

        return { streams: [{ url: finalUrl, kind: 'media', format: isHls ? 'hls' : 'progressive' }] };
      },

      async matchUrl(params) {
        const m = norm(params.url).match(DRAMA_RE);
        if (!m) return null;
        const play = norm(params.url).match(/\/play\/[A-Za-z0-9\-_]+\/(\d+)/i);
        return play ? { mediaId: m[1], episodeId: play[1] } : { mediaId: m[1] };
      },
    },
  };
};
