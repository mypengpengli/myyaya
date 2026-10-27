# 社区代码来源

## 当前基础

- 上游：[razor79/my-looi](https://github.com/razor79/my-looi)
- 导入路径：`mobile/`
- 固定提交：`c9d94cef4d4b0c47893c727cf97c83da67666a62`
- 上游发布版本：`v2.1.151`
- Git 快照的部分原生源码缺失或落后于该版本测试，已从同版本官方源码发布包补齐 5 个原生文件（诊断、人脸相机、照片选择模块与 Vosk），排除构建缓存。发布包 `my-looi-v2.1.151-public-release-source-2026-09-07.tgz` 的 SHA-256 已核对：`d24cdf0f95c5808a9bb36c6415cad3998cf60aa14be36bbfef8bd88a8dfb040c`。
- 许可：MIT，完整许可保存在 `mobile/LICENSE`；第三方资源说明保存在 `mobile/THIRD_PARTY_NOTICES.md` 与 `mobile/licenses/`。
- 本地 Git 参考远程：`looi-upstream`。最初通过 `git clone` 获取，然后将该提交的跟踪文件导入本项目；`mobile/` 不是子模块，自己的修改直接提交到 myyaya。

选择这个版本是因为它已有完整 Android 应用、LOOI BLE 控制、语音、本地记忆和 APK 在线更新模块，并提供源码与版本化 APK 发布。它仍是社区项目，手机和 LOOI 的实机表现需要我们自己验证。

My LOOI 最初基于 [GrinZero/super-looi](https://github.com/GrinZero/super-looi)，上游已保留相应致谢。本项目延续这些许可和归属，不修改上游仓库。

## 我们的改动

- `mobile/app.config.js`：Expo 构建时将名称、scheme 和应用包名覆盖为 myyaya；原 `app.json` 保留上游基线配置。
- 最终 Android 包名：`io.github.mypengpengli.myyaya`。它和上游 My LOOI 是两个应用。
- `mobile/src/updates/update-source.ts`：更新源改为自己的仓库或可配置 HTTPS manifest。
- `mobile/src/updates/github-release-updater.ts`：使用自己的更新来源，保留上游 APK 哈希、包名、版本和签名证书校验。
- `mobile/scripts/myyaya-update.test.mjs`：验证最终应用身份与更新源配置。
- 修正上游维护测试以支持自己的更新源，补上急停测试遗漏的性能统计 mock；不改变实际急停逻辑。
- 使用 LF 保存源码，确保上游源码哈希与跨平台测试一致。
- 根目录的项目文档、需求和连接检测脚本继续由 myyaya 维护。

自己的新版已递增为 `2.1.152` / Android versionCode `152`，社区导入基线仍是 `2.1.151`。版本同时更新 package/app 配置与快照检查。`mobile/` 内部部分旧页面仍保留上游文案；新增控制和中文语音入口见[社区能力审查](COMMUNITY-CAPABILITIES.md)。

## 后续开发

Hermes 文字任务已接入，底座中文控制和无需 OpenAI 的中文离线语音已另行接线。原有 Realtime 保留为兼容源码；NewAPI 连续对话、录像与视频生成仍待后续实现。自己的包名和在线更新配置通过 `app.config.js` 生效；永久签名与本机 Android 工具链已准备并完成第一版构建。

开发命令在 `mobile/` 目录执行：

```powershell
corepack.cmd pnpm install --frozen-lockfile
corepack.cmd pnpm exec tsc --noEmit
corepack.cmd pnpm run test:myyaya
corepack.cmd pnpm test
```

完整构建要求见 [mobile/BUILDING.md](../mobile/BUILDING.md)。上游部分测试与构建脚本使用 bash、zip 等 Linux 工具，Windows 上运行完整流程需要合适的工具链；任何未运行的检查都应单独记录。
