# 社区基线导入验证

验证日期：2026-10-26。

## 2026-10-27 首轮 APK 开发

- 新增实际任务客户端与 SQLite 任务仓库、全局前台监视器、横屏任务页面；TypeScript 通过。
- 任务专项行为测试通过：以 node:sqlite 驱动真实仓库 SQL，验证提交前持久化、崩溃/重开恢复、响应丢失后的相同幂等键和请求体、凭据/地址绑定、停止非终态、终态竞争、公开事件过滤和分块 UTF-8 SSE。
- 真实 HTTPS 联调通过：同一份 TypeScript 客户端提交只读 pwd，获得 completed 和结果，重复提交返回同一 run_id，收到工具开始/完成/任务完成事件。Token 仅经进程 stdin 传递，不进入源码或输出。
- 本轮 51 项跨平台源码/行为检查全部通过，包括新增任务检查；两项原有 Linux bash/zip 测试仍由 Ubuntu CI 执行。公开仓库审计曾发现联调脚本写死本机目录，已改成通用目录结果检查并重跑通过。
- JDK 17.0.21.0.2 与 Android 命令行工具下载均核对官方 SHA256；SDK/build-tools 36、NDK 27.1.12297006、CMake 3.22.1 已安装。Sherpa 原生二进制 postinstall 已完成。
- 原中文目录 Expo prebuild 失败；独立 ASCII 目录使用 SDK 56 固定模板 56.0.38 预构建通过。已创建永久发布签名材料，Gradle release 编译进行中，尚不算构建通过。
- ADB 列表为空，手机端网络、原生安全存储、界面、恢复、安装和 BLE 尚未验证。

下面旧验证记录保持原日期与范围，当前实现状态见[首轮 APK](APK-ITERATION-1.md)。

## 2026-10-27 Hermes 连接设置

- 新增 Hermes 设置卡片：首次手填独立 Token，SecureStore 保存/读取/替换/删除，以及只读 HTTPS 连接检查；不在源码或安装包预置 Token。
- 本机 `scripts/check-hermes.py` 使用 Windows 凭据管理器，实测 health 200、无 Token 模型 401、带 Token 模型 200、capabilities 200，四项 Runs 能力均通过；没有提交新任务。
- 新增连接校验/安全存储/跨站地址切换/只读请求行为测试，加入完整测试命令；TypeScript 通过。本轮 50 项跨平台源码/行为检查通过，两项原有 Linux 工具回归仍未在 Windows 运行。
- 手机网络、SecureStore 原生实际存储与任务派单需在生成 APK 后继续验证。

## 2026-10-27 本地模式与初始化门槛修复

- 本次按现有锁文件安装 644 个依赖，使用 pnpm 10.34.5、`--frozen-lockfile --ignore-scripts`；未修改依赖版本或锁文件。
- TypeScript `tsc --noEmit` 通过。
- 新增 `scripts/local-setup-behavior.test.mjs`，已纳入 `pnpm test`，也可单独 `pnpm run test:setup`。覆盖新装/旧设置默认 local、local 不读取 Key/模型/录音权限、legacy 按能力门槛、语音入口与前后台恢复、模式切换清理和异步启动迟到等。
- 独立复核发现并修复：冷加载与停止竞争、旧云端错误面板残留、readiness 倒序覆盖；进一步以真实 Realtime 类验证 WebRTC/PCM 旧凭据请求成功/失败和音频路由恢复的迟到结果，不污染或停止新会话。停止清理不等待长交互完成，新增对应行为场景。
- PCM 源码因本轮会话代次隔离有意变化，已更新对应固定 SHA 快照并保留严格匹配，未跳过该检查；原生 Kotlin 模块未因本轮门槛修复而改动。
- 本次执行 49 项源码/行为检查全部通过，包括新增初始化测试、上游跨平台回归、自有更新、运动时限、BLE 生命周期、语音急停、桌沿与 PCM 类型。
- 两项需要 Linux 工具的旧回归（v2.1.120、v2.1.122）本次 Windows 未运行，不计入通过；它们仍保留在完整 `pnpm test` / Ubuntu CI 中。
- `git diff --check` 通过。文档、架构和产品需求的修改不代表其中规划功能已实现。

本次没有 Gradle/JDK APK 构建、原生 postinstall 或真机验收。代码修复与新方案范围见 [STATUS.md](STATUS.md) 和 [ARCHITECTURE.md](ARCHITECTURE.md)。以下保留 10 月 26 日基线验证记录，不能将此前 Linux CI 结果当作本次修改后的 Linux 通过。

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
