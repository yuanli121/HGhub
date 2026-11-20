// IPTV 直播插件（HPP）
// 设置里填任意 m3u 直播源（默认 fanmingming 央视+卫视频道），解析 #EXTINF group-title 分组，
// 提供 live 能力：分组、频道列表、播放。每次解析都重新拉取，签名的流地址自然保持新鲜。
export const meta = {
  id: 'iptv.generic',
  name: 'IPTV 直播',
  version: '1.0.0',
  protocol: 1,
  description: '通用 m3u 直播源插件：填写任意 m3u/直播源地址（默认内置央视+卫视源），即可看直播频道。',
  author: 'community',
  kind: 'source',
  allowInsecureHttp: true,
  timeouts: { read: 25 },
  defaultHeaders: { 'User-Agent': 'okhttp/3.15' },
  settings: [
    {
      key: 'm3u',
      type: 'text',
      label: 'm3u 直播源地址',
      description: '任意 m3u 列表地址，需包含 #EXTINF 分组信息（group-title）。',
      default: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/index.m3u',
    },
    { key: 'timeoutSec', type: 'number', label: '请求超时（秒）', default: 20, min: 5, max: 30 },
  ],
};

const UA = 'okhttp/3.15';
const PAGE_SIZE = 100;

export default function (hg) {
  let parsedCache = null; // { groups: [{id,label}], channels: [{id,name,logo,groupId,url}] }

  function fail(code, message, extra) {
    throw new hg.PluginError(code, message, extra);
  }

  function m3uUrl() {
    const v = hg.settings.get('m3u');
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) fail('UNSUPPORTED', '请先在插件设置里填写 m3u 直播源地址');
    return s;
  }

  function timeoutMs() {
    const n = Number(hg.settings.get('timeoutSec'));
    return Number.isFinite(n) && n >= 5 && n <= 30 ? Math.floor(n * 1000) : 20000;
  }

  // 解析 m3u：#EXTINF 行带属性（tvg-name/tvg-logo/group-title）与显示名，下一行是流地址。
  // 通道 id 用 "g<分组序号>|<通道序号>" 编码，重解析后稳定。
  function parseM3u(text) {
    const lines = String(text || '').split(/\r?\n/);
    const groupIdx = {};
    const groups = [];
    const channels = [];
    let pending = null;
    const attrRe = /([A-Za-z0-9-]+)="([^"]*)"/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const rest = line.slice('#EXTINF'.length);
        const comma = rest.indexOf(',');
        const attrText = comma >= 0 ? rest.slice(0, comma) : rest;
        let name = (comma >= 0 ? rest.slice(comma + 1) : '').trim();
        let group = '';
        let logo = '';
        let m;
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(attrText)) !== null) {
          if (m[1] === 'group-title') group = m[2].trim();
          else if (m[1] === 'tvg-logo') logo = m[2].trim();
          else if (m[1] === 'tvg-name' && !name) name = m[2].trim();
        }
        pending = { name, group, logo };
        continue;
      }
      if (line.startsWith('#')) continue; // 其他指令行（#EXTM3U 头等）
      if (!pending) continue;
      if (!/^(https?:|rtsp:|rtmp:)/i.test(line)) {
        pending = null;
        continue;
      }
      const group = pending.group || '未分组';
      let gi = groupIdx[group];
      if (gi === undefined) {
        gi = groups.length;
        groupIdx[group] = gi;
        groups.push({ id: 'g' + gi, label: group });
      }
      channels.push({
        id: 'g' + gi + '|' + channels.length,
        name: pending.name || '频道' + (channels.length + 1),
        logo: pending.logo || undefined,
        groupId: 'g' + gi,
        url: line,
      });
      pending = null;
    }
    return { groups, channels };
  }

  async function loadM3u(ctx) {
    if (parsedCache) return parsedCache;
    const res = await hg.http.fetch({
      url: m3uUrl(),
      headers: { 'User-Agent': UA },
      responseType: 'text',
      timeoutMs: timeoutMs(),
      maxBytes: 8 * 1024 * 1024,
      retry: 1,
      cache: { ttlSec: 300, staleIfErrorSec: 3600 }, // 宿主缓存，换源后 5 分钟内复用
      signal: ctx && ctx.signal,
    });
    if (!res.ok) fail('UPSTREAM_ERROR', '直播源无法访问（HTTP ' + res.status + '）');
    const parsed = parseM3u(res.data);
    if (!parsed.channels.length) fail('UPSTREAM_CHANGED', '直播源里没有解析出频道');
    parsedCache = parsed;
    return parsedCache;
  }

  function channelAt(id, parsed) {
    const k = String(id || '').indexOf('|');
    const g = k > 0 ? id.slice(0, k) : '';
    const n = parseInt(k > 0 ? id.slice(k + 1) : '', 10);
    if (!g || !Number.isFinite(n) || n < 0 || n >= parsed.channels.length) return null;
    const c = parsed.channels[n];
    if (c.groupId !== g) return null;
    return c;
  }

  return {
    live: {
      async getGroups(params, ctx) {
        const parsed = await loadM3u(ctx);
        return parsed.groups;
      },

      async listChannels(params, ctx) {
        const parsed = await loadM3u(ctx);
        const groupId = params.groupId;
        let rows = parsed.channels;
        if (groupId) rows = rows.filter(function (c) { return c.groupId === groupId; });
        const page = parseInt(params.cursor || '1', 10);
        const start = (Number.isFinite(page) && page > 0 ? page - 1 : 0) * PAGE_SIZE;
        const items = [];
        for (let i = start; i < rows.length && i < start + PAGE_SIZE; i++) {
          const c = rows[i];
          const ch = { id: c.id, name: c.name, groupId: c.groupId };
          if (c.logo) ch.logo = c.logo;
          items.push(ch);
        }
        const next = start + PAGE_SIZE < rows.length ? String(page + 1) : null;
        return { items, next, total: rows.length };
      },

      async resolve(params, ctx) {
        // 每次重新拉取：源里的签名地址（Authinfo 等）会过期，天然拿到新地址
        const parsed = await loadM3u(ctx);
        const c = channelAt(params.channelId, parsed);
        if (!c) fail('NOT_FOUND', '频道不存在');
        const u = c.url;
        const isM3u8 = /\.m3u8(\?|$)/i.test(u);
        if (/^rtsp:/i.test(u) || /^rtmp:/i.test(u)) {
          return { streams: [{ url: u, kind: 'external', external: { app: '外部播放器' } }] };
        }
        const format = isM3u8 ? 'hls' : 'progressive';
        return {
          streams: [{ url: u, kind: 'media', format, live: true }],
        };
      },
    },
  };
}
