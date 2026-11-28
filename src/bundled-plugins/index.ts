import { pluginCommand } from "../plugins/client";

// 预置插件：Vite ?raw 将源文件以字符串打进包，安装后无需再手动导入
// 列表生成：57 个 HPP 源（leohenshuai 28 + poisonhs 25 + Beihaisir Yandex 1 + 自研 3，2026-11-28 上游同步）
import p_4kav from "./4kav.js?raw";
import p_91porn from "./91porn.js?raw";
import p_apple from "./apple.js?raw";
import p_auete_source from "./auete.source.js?raw";
import p_av321_source from "./av321.source.js?raw";
import p_av591_source from "./av591.source.js?raw";
import p_avjb from "./avjb.js?raw";
import p_avtoday from "./avtoday.js?raw";
import p_bfzy_source from "./bfzy.source.js?raw";
import p_bl911 from "./bl911.js?raw";
import p_cg91_source from "./cg91.source.js?raw";
import p_chengguo_source from "./chengguo.source.js?raw";
import p_dbku_source from "./dbku.source.js?raw";
import p_dhvideo_source from "./dhvideo.source.js?raw";
import p_dpw_source from "./dpw.source.js?raw";
import p_duanju55_source from "./duanju55.source.js?raw";
import p_duobo from "./duobo.js?raw";
import p_haijiao from "./haijiao.js?raw";
import p_hanime from "./hanime.js?raw";
import p_hanime16_source from "./hanime16.source.js?raw";
import p_haose from "./haose.js?raw";
import p_hdmoli from "./hdmoli.js?raw";
import p_heiliao_source from "./heiliao.source.js?raw";
import p_hhkan_source from "./hhkan.source.js?raw";
import p_hkdoll from "./hkdoll.js?raw";
import p_hl365_source from "./hl365.source.js?raw";
import p_hlws_source from "./hlws.source.js?raw";
import p_hongguo from "./hongguo.js?raw";
import p_huangguo from "./huangguo.js?raw";
import p_huangguo_source from "./huangguo.source.js?raw";
import p_iptv from "./iptv.js?raw";
import p_j18 from "./j18.js?raw";
import p_jisu_source from "./jisu.source.js?raw";
import p_jpyy from "./jpyy.js?raw";
import p_juzong_source from "./juzong.source.js?raw";
import p_kxyy_source from "./kxyy.source.js?raw";
import p_lovebox_source from "./lovebox.source.js?raw";
import p_madou from "./madou.js?raw";
import p_mfdmgw_source from "./mfdmgw.source.js?raw";
import p_mrds from "./mrds.js?raw";
import p_mwxk62 from "./mwxk62.js?raw";
import p_netflixgc_source from "./netflixgc.source.js?raw";
import p_pianku_source from "./pianku.source.js?raw";
import p_porna91 from "./porna91.js?raw";
import p_pornhub from "./pornhub.js?raw";
import p_pornlulu from "./pornlulu.js?raw";
import p_porny from "./porny.js?raw";
import p_rou from "./rou.js?raw";
import p_tangxin from "./tangxin.js?raw";
import p_tangxin_vlog from "./tangxin.vlog.js?raw";
import p_tvbox from "./tvbox.js?raw";
import p_wwgz from "./wwgz.js?raw";
import p_xhamster from "./xhamster.js?raw";
import p_xingya from "./xingya.js?raw";
import p_xx9 from "./xx9.js?raw";
import p_yandex from "./yandex.js?raw";
import p_yingxi_source from "./yingxi.source.js?raw";

const BUNDLED: Record<string, string> = {
  "4kav": p_4kav,
  "91porn": p_91porn,
  "apple": p_apple,
  "auete.source": p_auete_source,
  "av321.source": p_av321_source,
  "av591.source": p_av591_source,
  "avjb": p_avjb,
  "avtoday": p_avtoday,
  "bfzy.source": p_bfzy_source,
  "bl911": p_bl911,
  "cg91.source": p_cg91_source,
  "chengguo.source": p_chengguo_source,
  "dbku.source": p_dbku_source,
  "dhvideo.source": p_dhvideo_source,
  "dpw.source": p_dpw_source,
  "duanju55.source": p_duanju55_source,
  "duobo": p_duobo,
  "haijiao": p_haijiao,
  "hanime": p_hanime,
  "hanime16.source": p_hanime16_source,
  "haose": p_haose,
  "hdmoli": p_hdmoli,
  "heiliao.source": p_heiliao_source,
  "hhkan.source": p_hhkan_source,
  "hkdoll": p_hkdoll,
  "hl365.source": p_hl365_source,
  "hlws.source": p_hlws_source,
  "hongguo": p_hongguo,
  "huangguo": p_huangguo,
  "huangguo.source": p_huangguo_source,
  "iptv": p_iptv,
  "j18": p_j18,
  "jisu.source": p_jisu_source,
  "jpyy": p_jpyy,
  "juzong.source": p_juzong_source,
  "kxyy.source": p_kxyy_source,
  "lovebox.source": p_lovebox_source,
  "madou": p_madou,
  "mfdmgw.source": p_mfdmgw_source,
  "mrds": p_mrds,
  "mwxk62": p_mwxk62,
  "netflixgc.source": p_netflixgc_source,
  "pianku.source": p_pianku_source,
  "porna91": p_porna91,
  "pornhub": p_pornhub,
  "pornlulu": p_pornlulu,
  "porny": p_porny,
  "rou": p_rou,
  "tangxin": p_tangxin,
  "tangxin.vlog": p_tangxin_vlog,
  "tvbox": p_tvbox,
  "wwgz": p_wwgz,
  "xhamster": p_xhamster,
  "xingya": p_xingya,
  "xx9": p_xx9,
  "yandex": p_yandex,
  "yingxi.source": p_yingxi_source,
};
// 每个源按应用版本单独记导入标记：已成功的跳过，失败的下次启动单独重试；
// 应用升级（__APP_VERSION__ 变化）后全部重新导入，随包更新预置源。
// 同 ID 已装新版时宿主拒绝降级，不影响用户自行更新的插件。
const flagKey = (name: string) => `hpp.bundled.imported.${__APP_VERSION__}.${name}`;

export async function installBundledPlugins(): Promise<number> {
  const entries = Object.entries(BUNDLED);
  let ok = 0;
  for (const [name, code] of entries) {
    try {
      if (localStorage.getItem(flagKey(name))) continue;
    } catch {
      return ok; // localStorage 不可用则放弃，插件中心仍可手动导入
    }
    try {
      await pluginCommand("import", { code, source: `bundled:${name}` });
      ok += 1;
      try {
        localStorage.setItem(flagKey(name), "1");
      } catch {
        /* 标记失败无妨，下次启动重新导入 */
      }
    } catch {
      // 单个预置源导入失败不阻断其余，下次启动重试
    }
  }
  return ok;
}
