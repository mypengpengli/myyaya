# 社区基线导入验证

验证日期：2026-10-26。

## 2026-10-27 公开发布与更新入口

- 已发布 [v2.1.152](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.152)，先创建草稿、上传全部文件并校验，再公开为最新正式版。tag 对应 APK 构建源码 `f6d59e38cc3568e28e0f806804c12616ace98c23`。
- 发布包含 `myyaya-2.1.152-arm64.apk`、对应 `.apk.sha256` 与 `.apk.build.json`。GitHub 计算的 APK digest 为 `sha256:5198523a5f0086442830b9a952814b7102c9de7dc67bbb41e829cb301059c0ef`，大小 172142329 字节，均与本地签名包匹配。
- 无鉴权读取实际 `/releases/latest` 成功。直接运行当前 `github-release-updater.ts` 的检查逻辑，模拟已安装 2.1.151 时发现更新，模拟 2.1.152 时不提示重复更新；核对实际客户端返回的当前版本，未用另写的解析器替代。
- 匿名下载校验文件 HTTP 200，内容与本地 SHA256/文件名匹配；APK 下载地址跟随重定向后的 HEAD 为 HTTP 200，长度匹配。该检查未调用手机原生安装器，也未宣称完成手机端覆盖安装。
- README 已重写为正常项目介绍、下载入口、功能与使用说明；手机升级仍要求 Android 系统确认。今后发布继续沿用永久签名、递增 versionCode，并在全部资产上传后发布正式版。

## 2026-10-27 第二轮：中文底座与离线语音

- 复用社区 BLE SDK、扫描/重连、有限运动、头部动作、跳舞、灯光、传感器保护和人脸注视；新增中文入口，不另写底座协议。当前仍没有手机/LOOI 真机记录。
- 中文命令行为检查通过：唤醒和 15 秒会话、只接受完整动作短语、否定/引用/复合句不移动、partial STOP 无需唤醒；听写不执行动作，过期原生 session、权限拒绝、加载中取消和后台事件不启动采音/动作；关闭语音和朗读取消本机动作。
- 新增模型打包回归通过：复现只有 manifest 的空模型目录并确认构建拒绝；中文路径逐文件复制、内容一致性和损坏模型检查通过。本机 Node 24 原生递归 cp 曾漏拷中文路径文件，已改成显式遍历、逐文件复制和 SHA256 校验。先前只代码编译成功的中间包不作为交付。
- Vosk 官方中文归档实际下载并核对项目固定 SHA256；准备后的模型、来源清单和 Apache 许可证共 16 个文件，约 68.3 MB。Expo prebuild 及最终 APK 内的模型文件逐项核对大小/SHA256，确认新中文采音/TTS 类已打包。
- TypeScript 通过；46 项跨平台源码/行为检查通过。完整 `pnpm test` 在 Windows 遇到原有 bash/zip 工具测试限制，两项交给 Ubuntu CI，不将未执行项写为通过。
- 另行通过 BLE 前后台重连、Vosk 急停、方向悬崖保护、运动 deadman、Realtime PCM 类型与应用身份检查；新增 STOP 等待传感器阶段测试确保不会晚写驱动帧。
- 最终 Gradle `assembleRelease` 完整通过：1180 项任务，50 项执行、1130 项复用，用时 2 分 8 秒；包含中文采音/TTS Kotlin 编译、原生模块、Metro/Hermes 字节码和 release 打包。
- 交付 `mobile/output/android/myyaya-2.1.152-arm64.apk`：172142329 字节，约 164.2 MiB；包名 `io.github.mypengpengli.myyaya`，versionCode 152，minSdk 24 / targetSdk 36，仅 ARM64。
- APK SHA256：`5198523a5f0086442830b9a952814b7102c9de7dc67bbb41e829cb301059c0ef`。APK v2 签名与 16 KiB ZIP 对齐通过；证书 SHA256 与第一版相同：`9cbd68acd1dce6768a9f5be3756dbfc24444e1222980e51e26f57608521addce`。
- ZIP 完整性、独立 JS bundle、包内 Hermes Token/签名密码/独立 API Key/私钥文件缺失检查通过。包在本地输出目录，未发布 Release；旧 2.1.151 包另以版本名保留。
- 手机麦克风、唤醒准确率、中文离线音色、前后台、覆盖安装、底座角度与固件兼容性仍待用户测试，不把上述编译和模拟行为测试当作真机通过。

后续功能范围和使用顺序见[社区能力审查](COMMUNITY-CAPABILITIES.md)。下面保留首轮与历史验证记录。

## 2026-10-27 首轮 APK 开发

- 新增实际任务客户端与 SQLite 任务仓库、全局前台监视器、横屏任务页面；TypeScript 通过。
- 任务专项行为测试通过：以 node:sqlite 驱动真实仓库 SQL，验证提交前持久化、崩溃/重开恢复、响应丢失后的相同幂等键和请求体、凭据/地址绑定、停止非终态、终态竞争、公开事件过滤和分块 UTF-8 SSE。
- 真实 HTTPS 联调通过：同一份 TypeScript 客户端提交只读 pwd，获得 completed 和结果，重复提交返回同一 run_id，收到工具开始/完成/任务完成事件。Token 仅经进程 stdin 传递，不进入源码或输出。
- 本轮 51 项跨平台源码/行为检查全部通过，包括新增任务检查；两项原有 Linux bash/zip 测试仍由 Ubuntu CI 执行。公开仓库审计曾发现联调脚本写死本机目录，已改成通用目录结果检查并重跑通过。
- 对应开发提交 `56726c54f8776c802e9f3ecd47b8675846ed7cba` 的 [Ubuntu 完整 CI](https://github.com/mypengpengli/myyaya/actions/runs/40473991754) 已通过，包含上述两项 Linux 工具回归；此 CI 仍只验证源码，不代表 APK 或真机通过。
- JDK 17.0.21.0.2 与 Android 命令行工具下载均核对官方 SHA256；SDK/build-tools 36、NDK 27.1.12297006、CMake 3.22.1 已安装。Sherpa 原生二进制 postinstall 已完成。
- 原中文目录 Expo prebuild 失败；独立短 ASCII 目录使用 SDK 56 固定模板 56.0.38、hoisted 依赖预构建通过，最终 Gradle release 完整构建通过：1180 项任务，首次完整成功构建用时 18 分 47 秒。
- Android Metro 导出通过，生成约 6.2 MB 的 Hermes 字节码 bundle。补充监视器行为测试通过：后台释放流与暂停查询、前台恢复只查询、不重复派单、迟到事件与凭据切换隔离。
- 实际构建发现并处理额外 NDK/build-tools 默认版本和 Windows pnpm/CMake 长路径问题；生成插件统一工具链，Windows 构建改为短路径及 hoisted 依赖。React Native AAR 的官方地址下载超时，替代下载已与 Maven 官方 SHA256 核对一致后缓存，未关闭 TLS 校验。
- 本地安装包 `mobile/output/android/myyaya-hermes-arm64.apk`：128217986 字节；SHA256 `09c7b1d80bdbf729ac209894bef1fcc447eec2e14c9dde459a9eccb1a6e7782f`。已校验包名 io.github.mypengpengli.myyaya、应用名称 myyaya、versionCode 151、minSdk 24 / targetSdk 36、唯一 ABI arm64-v8a、独立运行所需 JS bundle 与 ZIP 完整性。
- `apksigner verify --verbose --print-certs` 通过 APK v2 签名；证书 CN=myyaya Android，RSA 3072。证书 SHA256 为 `9cbd68acd1dce6768a9f5be3756dbfc24444e1222980e51e26f57608521addce`；`zipalign -c -P 16 4` 通过。
- 包内逐文件检查通过：没有本机 Hermes Token、签名密码、独立 API Key 格式或私钥/环境配置文件。签名文件和密码都不进入 Git；原件与密码继续保存在本机独立目录及 Windows 凭据管理器。
- ADB 列表为空，手机端网络、原生安全存储、界面、恢复、安装和 BLE 尚未验证。
- 用户明确选择先交付 APK、稍后自行安装测试；本轮没有将电脑端联调或静态检查当作真机通过，也没有发布 GitHub Release。

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
