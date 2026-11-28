export const meta = {
  id: 'bfzy.source',
  name: '暴风资源',
  version: '1.0.4',
  protocol: 1,
  kind: 'source',
  description: '暴风资源采集接口单文件数据源：搜索、分类、详情与 m3u8 直连播放。',
  defaultHeaders: { Referer: 'https://bfzyapi.com/' },
  timeouts: { read: 20, playback: 25 },
};

const API = 'https://bfzyapi.com/api.php/provide/vod/';
const TYPE_BY_ID = { 20: 'movie', 30: 'series', 39: 'anime', 45: 'variety', 58: 'short', 28: 'documentary', 50: 'movie' };

function mediaType(row) {
  const byId = TYPE_BY_ID[Number(row.type_id)];
  // 采集站的「电影」栏目里混着大量连续剧，type_id 只说明挂在哪个栏目下。
  // 真正决定界面的是集数：标成 movie 宿主就按电影渲染，分集列表出不来，点播放只能干等。
  const serial = Number(row.vod_serial);
  if (byId === 'movie' && Number.isFinite(serial) && serial > 1) return 'series';
  if (byId) return byId;
  const id = Number(row.type_id);
  if (id >= 40 && id <= 44) return 'anime';
  if (id >= 31 && id <= 38) return 'series';
  if (id >= 46 && id <= 49) return 'variety';
  if (id >= 59 && id <= 68) return 'short';
  const name = norm(row.type_name);
  if (/动漫|动画/.test(name)) return 'anime';
  if (/综艺/.test(name)) return 'variety';
  if (/纪录/.test(name)) return 'documentary';
  if (/短剧/.test(name)) return 'short';
  if (/剧/.test(name)) return 'series';
  if (/电影|片/.test(name)) return 'movie';
  return 'other';
}
const HIDDEN_CATS = new Set(['51', '52', '53', '58']);

const HOME_ROWS = [
  { id: '20', title: '电影' },
  { id: '30', title: '连续剧' },
  { id: '39', title: '动漫' },
  { id: '45', title: '综艺' },
];

const norm = s => (typeof s === 'string' ? s : '');

function plainText(html) {
  return norm(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toItem(row) {
  const item = {
    id: String(row.vod_id),
    title: norm(row.vod_name),
    type: mediaType(row),
  };
  if (row.vod_pic) item.cover = norm(row.vod_pic);
  const desc = plainText(row.vod_blurb) || plainText(row.vod_content);
  if (desc) item.description = desc.slice(0, 400);
  const tags = [row.type_name, row.vod_area, row.vod_lang].map(norm).filter(Boolean);
  if (tags.length) item.tags = tags;
  const score = Number(row.vod_score);
  if (Number.isFinite(score) && score > 0) item.score = Math.min(10, score);
  const year = Number(row.vod_year);
  if (Number.isFinite(year) && year > 1900) item.year = year;
  if (row.vod_isend !== undefined) item.status = Number(row.vod_isend) === 1 ? 'finished' : 'ongoing';
  const serial = Number(row.vod_serial);
  if (Number.isFinite(serial) && serial > 0) item.episodeCount = serial;
  if (row.vod_remarks && !item.episodeCount) item.badge = norm(row.vod_remarks).slice(0, 8);
  return item;
}

// vod_play_from / vod_play_url 用 $$$ 分组，组内用 # 分集，分集写成「名称$地址」
function parsePlaylists(row) {
  const froms = norm(row.vod_play_from).split('$$$').filter(Boolean);
  const groups = norm(row.vod_play_url).split('$$$');
  const playlists = [];
  groups.forEach((group, gi) => {
    const episodes = group
      .split('#')
      .map(s => s.trim())
      .filter(Boolean)
      .map((entry, ei) => {
        const at = entry.indexOf('$');
        const label = at > 0 ? entry.slice(0, at) : String(ei + 1);
        const url = at > 0 ? entry.slice(at + 1) : entry;
        if (!/^https?:\/\//i.test(url)) return null;
        const ep = { id: `p${gi}e${ei}`, index: ei + 1, label: norm(label) || String(ei + 1) };
        const num = Number((label.match(/\d+(\.\d+)?/) || [])[0]);
        if (Number.isFinite(num)) ep.episodeNumber = num;
        return ep;
      })
      .filter(Boolean);
    if (!episodes.length) return;
    const flag = froms[gi] || `line${gi + 1}`;
    playlists.push({ id: `p${gi}`, label: flagLabel(flag), episodes });
  });
  return playlists;
}

function flagLabel(flag) {
  const f = flag.toLowerCase();
  if (f.includes('bfzy')) return '暴风';
  if (f.includes('lz')) return '量子';
  if (f.includes('ff')) return '非凡';
  return flag;
}

// 暴风的分发域名共用同一份 /video/{vod_en}/{段}/index.m3u8 目录结构，同一集常被复制到
// 好几个域名上，可以按 host 对换。但覆盖是逐个资源复制的，不保证通——
// 实测《牧神记》第 1–59 集里，v.fengbao8.com 有 59/59，c1.rrcdnbf6/5 各只有前 31 集，
// 其余域名一条都没有。所以这里不做「谁是谁的镜像」的假设，全量并列去试，谁出清单用谁。
const MIRROR_HOSTS = [
  'c1.rrcdnbf6.com',
  'c1.rrcdnbf5.com',
  'c1.rrcdnbf4.com',
  'c1.ddbbffcdn.com',
  'v.fengbao8.com',
  'v.fengbao14.com',
  'fengbao13.com',
  'v.baofeng9.com',
  'bfeng11.com',
  's3.bfllvip.com',
  'p.bvvvvvvv7f.com',
  'p.bvvvvvvvvv1f.com',
];

function mirrorsOf(url) {
  const m = norm(url).match(/^(https?:\/\/)([^/]+)(\/.*)$/i);
  if (!m) return [];
  const host = m[2].toLowerCase();
  if (!MIRROR_HOSTS.includes(host)) return [];
  return MIRROR_HOSTS.filter(h => h !== host)
    .slice(0, 6)
    .map(h => `${m[1]}${h}${m[3]}`);
}

async function probeStream(hg, url, ctx) {
  try {
    const res = await hg.http.fetch({
      url,
      responseType: 'text',
      headers: { Referer: 'https://bfzyapi.com/' },
      timeoutMs: 6000,
      maxBytes: 512 * 1024,
      retry: 0,
      signal: ctx.signal,
    });
    return res.ok && norm(res.data).trimStart().startsWith('#EXTM3U');
  } catch (error) {
    if (error && error.code === 'CANCELLED') throw error;
    return false;
  }
}

function streamUrlFrom(row, playlistId, episodeId) {  const groups = norm(row.vod_play_url).split('$$$');
  const gi = Number((String(playlistId).match(/^p(\d+)$/) || [])[1]);
  const groupIdx = Number.isInteger(gi) ? gi : 0;
  const group = groups[groupIdx] || '';
  const entries = group.split('#').map(s => s.trim()).filter(Boolean);
  let ei = Number((String(episodeId).match(/^p\d+e(\d+)$/) || [])[1]);
  if (!Number.isInteger(ei)) ei = 0;
  const entry = entries[ei];
  if (!entry) return null;
  const at = entry.indexOf('$');
  return at > 0 ? entry.slice(at + 1) : entry;
}

export default hg => {
  async function call(query, ctx) {
    const res = await hg.http.fetch({
      url: API,
      query,
      responseType: 'json',
      headers: { Accept: 'application/json' },
      signal: ctx.signal,
      retry: 1,
      cache: { ttlSec: 120, staleIfErrorSec: 600 },
    });
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `暴风资源返回 ${res.status}`);
    const data = res.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.list)) {
      throw new hg.PluginError('UPSTREAM_CHANGED', '暴风资源返回结构已变化');
    }
    if (Number(data.code) !== 1) throw new hg.PluginError('UPSTREAM_ERROR', norm(data.msg) || '暴风资源拒绝了请求');
    return data;
  }

  function pageOf(data, builder) {
    const page = Number(data.page) || 1;
    const pageCount = Number(data.pagecount) || 1;
    const out = { items: data.list.map(builder) };
    if (page < pageCount) out.next = String(page + 1);
    return out;
  }

  const cursorPage = cursor => {
    const n = Number(cursor);
    return Number.isInteger(n) && n > 0 ? n : 1;
  };

  return {
    home: {
      async getSections(params, ctx) {
        const data = await call({ ac: 'list', pg: 1 }, ctx);
        const latest = { id: 'latest', title: '最新更新', layout: 'row', items: data.list.map(toItem), more: true };
        const rows = await Promise.all(
          HOME_ROWS.slice(0, 3).map(async row => {
            const d = await call({ ac: 'list', t: row.id, pg: 1 }, ctx);
            return { id: `t${row.id}`, title: row.title, layout: 'row', items: d.list.map(toItem), more: true };
          }),
        );
        return { items: [latest, ...rows], next: null };
      },

      async listSection(params, ctx) {
        const id = String(params.sectionId || '');
        if (id === 'latest') {
          const data = await call({ ac: 'list', pg: cursorPage(params.cursor) }, ctx);
          return pageOf(data, toItem);
        }
        const m = id.match(/^t(\d+)$/);
        if (!m) throw new hg.PluginError('INVALID_ARGUMENT', '未知的首页分区');
        const data = await call({ ac: 'list', t: m[1], pg: cursorPage(params.cursor) }, ctx);
        return pageOf(data, toItem);
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const data = await call({ ac: 'list', pg: 1 }, ctx);
        if (!Array.isArray(data.class)) return HOME_ROWS.map(r => ({ id: r.id, label: r.title }));
        const top = data.class.filter(c => Number(c.type_pid) === 0 && !HIDDEN_CATS.has(String(c.type_id)));
        return top.map(c => {
          const kids = data.class.filter(k => Number(k.type_pid) === Number(c.type_id));
          const cat = { id: String(c.type_id), label: norm(c.type_name) };
          if (kids.length) cat.children = kids.map(k => ({ id: String(k.type_id), label: norm(k.type_name) }));
          return cat;
        });
      },

      async list(params, ctx) {
        const id = String(params.categoryId || '');
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        if (HIDDEN_CATS.has(id)) throw new hg.PluginError('INVALID_ARGUMENT', '这个分类已隐藏');
        const data = await call({ ac: 'list', t: id, pg: cursorPage(params.cursor) }, ctx);
        return pageOf(data, toItem);
      },
    },

    search: {
      async search(params, ctx) {
        const query = norm(params.query).trim();
        if (!query) return { items: [], next: null };
        const data = await call({ ac: 'list', wd: query, pg: cursorPage(params.cursor) }, ctx);
        return pageOf(data, toItem);
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String(params.id || params.mediaId || '');
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const data = await call({ ac: 'detail', ids: id }, ctx);
        const row = data.list.find(r => String(r.vod_id) === id) || data.list[0];
        if (!row) throw new hg.PluginError('NOT_FOUND', '作品不存在');
        const detail = toItem(row);
        const playlists = parsePlaylists(row);
        if (!playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '该作品暂无可用播放地址');
        detail.playlists = playlists;
        // 单集还是多集只看真正解析出来的集数；动漫别被硬掰成剧集，只把电影改判。
        const total = playlists[0].episodes.length;
        if (total > 1) {
          if (detail.type === 'movie') detail.type = 'series';
          detail.episodeCount = total;
          detail.totalEpisodes = total;
        }
        const people = [];
        if (norm(row.vod_director)) people.push({ name: norm(row.vod_director), role: '导演' });
        if (norm(row.vod_actor))
          for (const name of norm(row.vod_actor).split(/[,，\/]/).map(s => s.trim()).filter(Boolean).slice(0, 8))
            people.push({ name, role: '演员' });
        if (people.length) detail.people = people;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = String(params.mediaId || params.id || '');
        if (!/^\d+$/.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const data = await call({ ac: 'detail', ids: id }, ctx);
        const row = data.list.find(r => String(r.vod_id) === id) || data.list[0];
        if (!row) throw new hg.PluginError('NOT_FOUND', '作品不存在');
        const playlists = parsePlaylists(row);
        if (!playlists.length) throw new hg.PluginError('CONTENT_LOCKED', '该作品暂无可用播放地址');
        const playlist = playlists.find(p => p.id === params.playlistId) || playlists[0];

        // 采集源的播放列表随时会被改写，集数、组顺序都可能变，宿主持有的 episodeId
        // 未必还能精确命中。命中不了就退回按序号定位，再不行退第一集，
        // 总之别把「分集找不到」这种内部状态当播放失败甩给用户。
        const wanted = norm(params.episodeId);
        let pos = playlist.episodes.findIndex(e => e.id === wanted);
        if (pos < 0) {
          const tail = wanted.match(/(\d+)$/);
          const n = tail ? Number(tail[1]) : NaN;
          if (Number.isInteger(n)) {
            pos = playlist.episodes.findIndex(e => e.episodeNumber === n || e.index === n);
            if (pos < 0 && n >= 1 && n <= playlist.episodes.length) pos = n - 1;
          }
        }
        if (pos < 0) pos = 0;
        const episode = playlist.episodes[pos];

        const url = streamUrlFrom(row, playlist.id, episode.id);
        if (!url) throw new hg.PluginError('UPSTREAM_CHANGED', '分集地址已失效');
        const stream = {
          url,
          kind: 'media',
          format: /\.m3u8($|\?)/i.test(url) ? 'hls' : 'progressive',
          label: episode.label,
        };

        // 采集接口给的地址是硬编码在数据里的，站点会换 CDN，旧的就成了死链。
        // 但「我这台机器探不通」不等于「播不了」——线路、劫持、edge 回源差异都会让
        // 探测失败而播放器照样能播。所以探测只用来找镜像，绝不拿它拦播放。
        if (await probeStream(hg, url, ctx)) {
          return { streams: [stream] };
        }
        // 原地址探不通就并行试同组镜像，哪个能出清单用哪个。
        const alts = mirrorsOf(url);
        if (alts.length) {
          const hit = (
            await Promise.all(alts.map(alt => probeStream(hg, alt, ctx).then(ok => (ok ? alt : null))))
          ).find(Boolean);
          if (hit) return { streams: [{ ...stream, url: hit }] };
        }
        // 原地址和镜像都探不通，仍然原样交出去：宿主的播放器有自己的重试和 refresh，
        // 由它判死比插件替用户判死更靠谱。
        return { streams: [stream] };
      },
    },
  };
};
