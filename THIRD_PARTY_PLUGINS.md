# 第三方预置插件来源

本仓库 `src/bundled-plugins/` 内的 46 个 HPP 内容源插件来自以下社区仓库（2026-11-20 快照），随应用首次启动自动导入：

| 来源仓库 | 插件数 | 说明 |
| --- | --- | --- |
| [leohenshuai/hghub-plugins](https://github.com/leohenshuai/hghub-plugins) | 28 | 修复版片源，2026-11 全量体检（原作 [CoderL98/hghub-plugins](https://github.com/CoderL98/hghub-plugins)） |
| [poisonhs/HGhub-Plugin](https://github.com/poisonhs/HGhub-Plugin) | 17 | 插件集 |
| [Beihaisir/HGhub-plugins](https://github.com/Beihaisir/HGhub-plugins) | 1 | Yandex 视频源 |

- 插件文件保持原仓库内容未修改，版权归原作者所有；本仓库仅随应用打包分发。
- 预置插件均可随时卸载，用户也可自行导入其他插件；已装新版本不会被预置旧版本降级覆盖。
- 部分插件 `meta.mature = true`（成人内容），宿主默认隐藏，需在设置中打开"成人内容"后可见。

## 与上游的关系

本项目是 [Minireel/HGhub](https://github.com/Minireel/HGhub) 的非官方整合版（fork），仅做了以下改动：

1. 预置 46 个社区插件并首启自动导入（`src/bundled-plugins/`）
2. 应用名"黄果整合版"，identifier `com.hghub.integrated`
3. CI 简化为 Android 按 ABI 分包出包，支持手动触发

许可证沿用上游 [PolyForm Noncommercial 1.0.0](LICENSE)，禁止商业用途。
