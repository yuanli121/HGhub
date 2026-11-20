import { pluginCommand } from "../plugins/client";

// 预置插件：Vite ?raw 将源文件以字符串打进包，安装后无需再手动导入
// 列表生成：46 个社区 HPP 源（leohenshuai 修复版 28 + poisonhs 17 + Beihaisir Yandex 1）
import p_4kav from "./4kav.js?raw";
import p_91porn from "./91porn.js?raw";
import p_apple from "./apple.js?raw";
import p_appmovie_source from "./appmovie.source.js?raw";
import p_auete_source from "./auete.source.js?raw";
import p_av321_source from "./av321.source.js?raw";
import p_av591_source from "./av591.source.js?raw";
import p_avjb from "./avjb.js?raw";
import p_avtoday from "./avtoday.js?raw";
import p_bfzy_source from "./bfzy.source.js?raw";
import p_bl911 from "./bl911.js?raw";
import p_cg91_source from "./cg91.source.js?raw";
import p_chengguo_source from "./chengguo.source.js?raw";
import p_ck69_source from "./ck69.source.js?raw";
import p_dhvideo_source from "./dhvideo.source.js?raw";
import p_duobo from "./duobo.js?raw";
import p_haijiao from "./haijiao.js?raw";
import p_hanime from "./hanime.js?raw";
import p_hanime16_source from "./hanime16.source.js?raw";
import p_haose from "./haose.js?raw";
import p_hdmoli from "./hdmoli.js?raw";
import p_hkdoll from "./hkdoll.js?raw";
import p_hlws_source from "./hlws.source.js?raw";
import p_huangguo from "./huangguo.js?raw";
import p_j18 from "./j18.js?raw";
import p_jisu_source from "./jisu.source.js?raw";
import p_jpyy from "./jpyy.js?raw";
import p_juzong_source from "./juzong.source.js?raw";
import p_kxyy_source from "./kxyy.source.js?raw";
import p_madou from "./madou.js?raw";
import p_mrds from "./mrds.js?raw";
import p_mwxk62 from "./mwxk62.js?raw";
import p_netflixgc_source from "./netflixgc.source.js?raw";
import p_porna91 from "./porna91.js?raw";
import p_pornhub from "./pornhub.js?raw";
import p_pornlulu from "./pornlulu.js?raw";
import p_porny from "./porny.js?raw";
import p_rou from "./rou.js?raw";
import p_tangxin from "./tangxin.js?raw";
import p_tangxin_vlog from "./tangxin.vlog.js?raw";
import p_wwgz from "./wwgz.js?raw";
import p_xhamster from "./xhamster.js?raw";
import p_xingya from "./xingya.js?raw";
import p_xx9 from "./xx9.js?raw";
import p_yandex from "./yandex.js?raw";
import p_zhuiying_source from "./zhuiying.source.js?raw";

const BUNDLED: Record<string, string> = {
  "4kav": p_4kav,
  "91porn": p_91porn,
  "apple": p_apple,
  "appmovie.source": p_appmovie_source,
  "auete.source": p_auete_source,
  "av321.source": p_av321_source,
  "av591.source": p_av591_source,
  "avjb": p_avjb,
  "avtoday": p_avtoday,
  "bfzy.source": p_bfzy_source,
  "bl911": p_bl911,
  "cg91.source": p_cg91_source,
  "chengguo.source": p_chengguo_source,
  "ck69.source": p_ck69_source,
  "dhvideo.source": p_dhvideo_source,
  "duobo": p_duobo,
  "haijiao": p_haijiao,
  "hanime": p_hanime,
  "hanime16.source": p_hanime16_source,
  "haose": p_haose,
  "hdmoli": p_hdmoli,
  "hkdoll": p_hkdoll,
  "hlws.source": p_hlws_source,
  "huangguo": p_huangguo,
  "j18": p_j18,
  "jisu.source": p_jisu_source,
  "jpyy": p_jpyy,
  "juzong.source": p_juzong_source,
  "kxyy.source": p_kxyy_source,
  "madou": p_madou,
  "mrds": p_mrds,
  "mwxk62": p_mwxk62,
  "netflixgc.source": p_netflixgc_source,
  "porna91": p_porna91,
  "pornhub": p_pornhub,
  "pornlulu": p_pornlulu,
  "porny": p_porny,
  "rou": p_rou,
  "tangxin": p_tangxin,
  "tangxin.vlog": p_tangxin_vlog,
  "wwgz": p_wwgz,
  "xhamster": p_xhamster,
  "xingya": p_xingya,
  "xx9": p_xx9,
  "yandex": p_yandex,
  "zhuiying.source": p_zhuiying_source,
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
