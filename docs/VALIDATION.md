# 社区基线导入验证

验证日期：2026-10-26。

## 本地已通过

- `pnpm exec tsc --noEmit`。
- `pnpm run test:myyaya`：独立包名、自己的默认更新仓库、可选 HTTPS manifest，以及无效更新 URL 的拒绝。
- 48 项源码 / 行为检查通过，覆盖上游回归、更新安装器、蓝牙生命周期、运动超时、急停、桌沿方向限制和语音 PCM 类型。
- `expo config --type public` 实际输出应用名 `myyaya`、Android 包名 `io.github.mypengpengli.myyaya`、更新仓库 `mypengpengli/myyaya`。
- 更新 manifest 脚本的复制文件、版本、SHA-256 与 HTTPS 参数验证通过。
- 上游源码发布包的 SHA-256 已核对。原生源码补齐情况见 [UPSTREAM.md](UPSTREAM.md)。

本地使用 Node 24.12.0、pnpm 10.34.5；源码依赖验证安装跳过原生二进制 postinstall，不代表 Android 构建环境已准备好。上游建议的 Node 22 环境由 GitHub Actions 检查。

## 需要 Linux 工具的检查

- `v2.1.120-incremental-retired-module-prune-regression.test.mjs`：依赖 bash。
- `v2.1.122-apk-provenance-vosk-regression.test.mjs`：依赖 bash 和 zip。

Windows 本地未将这两项计为通过。已添加 `.github/workflows/source-checks.yml`，在 Ubuntu / Node 22 上执行完整上游测试和自己的更新测试。

GitHub Actions 的[完整检查](https://github.com/mypengpengli/myyaya/actions/runs/40328700906)已通过，对应源码提交 `e72aad1b12e3ebf99285742476dbe22e718939f6`，包括上述两项、TypeScript 检查、自己的更新测试与运动/BLE/急停检查。这仍是源码验证，不是 Android APK 构建或设备验收。

## 尚未验证

- JDK / Android SDK 下的 Gradle APK 构建与永久发布签名。
- 小米 12 Pro 上的安装、权限、音频与 LOOI BLE 实机行为。
- GitHub Releases 首个签名 myyaya APK，以及手机内下载、覆盖升级和保留数据。
- 后续要改造的 NewAPI、Hermes、录像与播放能力。

本次交付为可继续修改的社区源码基线和自己的更新配置，不是已经在手机上验收的成品 APK。
