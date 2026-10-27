# 当前进度

更新日期：2026-10-27（Asia/Shanghai）。

## 当前路线

根据最新分享，主线为用户自有小米 12 Pro（澎湃 OS 3）+ 已下单 LOOI + 自定义 Android APK。K50 为早期方案，ESP32-S3 + 两个 HD1910 的资料保留在 archive。延续 NewAPI、Hermes、文件展示和手机录像/播放需求。

仓库 2026-10-26 的整理记录已读取[新的分享链接](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)，其中包含手机更换、LOOI 下单、昵称唤醒、认人、看人、自主靠近以及 USB 外设 / 第二代底盘讨论。原先“分享中没有 LOOI 更新内容”的说明仅针对旧链接，现已据新链接更新。

2026-10-27 用户再次确认：LOOI 即将到货，小米 12 Pro 已更新澎湃 OS 3。本次将 GitHub main 下载到当前工作区，审查既有文档、手机源码与 Pi 固定版本资料，新增 [APK 开发方案补充](APK-DEVELOPMENT-PLAN.md)。本次分享原文因大小限制及浏览器连接失败未能重新完整读取，不把仓库旧整理当作本次原文复核。

同日用户直接补充使用流程和草图，现以 [产品需求](PRODUCT-REQUIREMENTS.md)和 [修订架构](ARCHITECTURE.md)为最新基线：小丫小丫唤醒、童声候选、多轮媒体、可固定 Viewer、Hermes 执行框与持续对话、人物跟随/房间导航和未来微信邮件扩展。

## 已完成

- 创建并运行 `scripts/check-devices.ps1`，PowerShell 语法检查及无 Android 设备场景执行通过。
- 已补充手机功能调用需求：智能体可以调用录像、查找录像、播放录像及播放控制。“取出录像”按用户补充理解为找到并播放视频；这些能力尚待实现。
- 建立 myyaya 仓库并保留旧方案快照；已将 README 主线从 K50 + LOOI 纠正为小米 12 Pro + LOOI。
- 查阅 LOOI 官方产品资料、Super LOOI / SDK 和 My LOOI 社区项目，选择并导入 My LOOI v2.1.151 到 mobile/。
- 在 PLAN.md 中补充人物记忆、昵称唤醒后看人、自主靠近、Hermes Screen，以及候选 USB 传感器和 WAVE ROVER 扩展的分期。
- 配置 myyaya 独立包名和自己的 HTTPS 更新源入口，保留社区 APK 校验与安装模块；添加更新 manifest 生成脚本。
- 本地 TypeScript、48 项源码/行为检查、实际 Expo 应用配置检查通过；验证范围与未完成项见 [VALIDATION.md](VALIDATION.md)。
- GitHub Actions 已在 Ubuntu / Node 22 上完成并通过完整检查，包括两项需要 Linux 工具的测试。
- 用户确定采用 Pi；已编写 [Pi 实施方案](PI-AGENT-PLAN.md)，首版选择自有服务器运行 Pi，手机执行本地工具，手机内嵌单独验证。
- 使用用户授权的测试 Key 完成少量 NewAPI HTTPS 预验证：agnes-3.0-flash 文字、原生工具调用及结果续答、SSE、简单看图；TeleSpeechASR 合成中文转写；agnes-image-2.5-flash 生图及产物下载。Key 未进入仓库，结果与边界见 [测试记录](MODEL-PROBE-2026-10-26.md)。
- 2026-10-27 完成本地方案审查，补充中文语言缺口、相机/采音所有权、后台 5 秒退出约束、V1 工具桥及取消/恢复、媒体持久化和分批验收；已核对 Pi v1.4.0 默认并行工具及取消语义，建议首版显式串行执行。

上述 10 月 26 日的完整源码检查和模型接口测试属于此前记录。本轮后续已修改入口/模式隔离代码并验证、少量重测模型列表与文字请求，见下；仍未构建 APK、发布 Release 或做实机验收。

## 2026-10-27 后续实现与核查

- 已实现持久运行模式 local（默认）与 legacy_realtime（主动选择）；旧设置无模式字段时迁移为 local，保留原设置和 Key，不自动开启旧云端语音。
- local 不要求或检查云端 Key、旧语音模型和录音权限，可进入表情、本地记忆与设备设置。切回 local 释放旧语音，启动/触摸/导航/前台恢复与底层采音入口均受模式门槛控制。
- 新增设置/引导页运行模式入口和真实状态说明；Pi/NewAPI 尚未完成 APK 集成，不提供假可用入口。
- 新增本地初始化/旧语音隔离行为测试，已加入 `pnpm test`；验证详情更新在 [VALIDATION.md](VALIDATION.md)。
- 独立复核后补齐冷加载/停止、及时取消、WebRTC/PCM 旧会话网络结果与音频路由恢复隔离，以及引导页 readiness 和错误面板的模式切换；专项行为验证通过。
- 使用用户授权的 Key 通过其指定中转核验模型列表（87 个、四个指定模型均可见）及一次短文字请求；未测试图生图、视频生成或 TTS，未保存 Key。[本次接口记录](INTEGRATION-CHECK-2026-10-27.md)
- 已选择候选童声并完成一手导航研究，均未实机/试听验收；相关能力保持待实现。
- 用户后续已同意另配 Azure Speech，首发音色确定为晓悠 `zh-CN-XiaoyouNeural`；尚未配置资源、合成或试听，按可替换 TtsProvider 实现，私有凭据不进入 APK。
- 用户已提供现有 Ubuntu Hermes 的项目、`v0.21.6+199.g1744a19` 版本、systemd 用户服务及官方 Runs/REST/SSE/Bearer 接法，已对照其提交资料写好 [接入契约](HERMES-INTEGRATION.md)。实际 API 地址和能力仍未验证，未连接或修改服务器。

## Hermes 地址与手机连接设置（同日后续）

- 用户提供正式 HTTPS 服务地址 `https://hermes.jiazhuangai.com`，并报告真实 Runs 任务与 SSE 工具事件通过。本机已独立核验 health 200、无 Token 模型 401、带 Token 模型 200、capabilities 200 和四项 Runs 能力；未提交新任务。
- 独立调试 Token 保存在当前 Windows 用户凭据管理器，后续由 `scripts/check-hermes.py` 读取；公开源码、文档与 APK 安装包不包含该值。
- 用户选择手机首次填写 Token。已新增设置页连接卡片、SecureStore 保存/读取/替换/删除与只读测试，不要求旧 OpenAI Key。电脑与手机存储不自动同步，首次输入只需独立 Token，不粘贴整个服务端 .env。
- 已记录 run_id 恢复、同任务幂等键复用，以及当前 SSE 类型来自 data JSON event 字段；派单、进度 UI、手机网络与文件返回仍待后续实现/实机验收。

## 历史准备记录（不作为当前依赖）

- 早期 K50 + BLE + ESP32-S3 + Bus Servo Adapter (A) + 两个 HD1910 的方案，以及更早的名校堂 G3 / Tab5 候选，均已退出当前主线。
- 旧环境曾下载 Google Platform Tools、实测 ADB 37.0.1 并启动服务；工具未入库，本次新下载工作区没有 `.tools/platform-tools/adb.exe`，PATH 也未发现 adb 或 Java。当前构建环境与设备连接仍需准备、核验。
- 早期微雪转接板接线/供电调查仅见 archive，不是 LOOI 开发的接线要求。

## 当前实测结果

- 上次 ADB 实测（2026-10-25）没有检测到 Android 设备，当前连接状态未重新确认。
- 小米 12 Pro 的底层 Android 版本、LOOI 型号、固件版本及 BLE 兼容性尚未确认；澎湃 OS 3 目前来自用户说明。
- 尚未验证 LOOI 状态读取、停止、运动、传感器或手机固定与供电。
- 已导入社区 Android / BLE / 语音 / 更新源码，尚未构建自己的签名 APK，未做手机或 LOOI 实机验收；NewAPI 与 Hermes 未接入。
- 用户已选择将 myyaya 仓库公开，现已改为公开；默认使用其 GitHub Releases 作为更新源。首个签名 APK、永久发布签名和首轮覆盖安装验收尚未完成。
- 上述模型测试是在 Windows 上直接请求接口，尚未验证 Pi SDK 集成、Android 端运行和整机闭环；agnes-video-2.5 仅确认模型列表可见，未发起生成任务。中文 TTS、真实手机语音和录像资源协调仍待验证。

## 下一步

1. 按 Pi 方案 P1 实现最小 Node 服务，用固定版本的 Pi SDK 验证工具循环、中文输入、事件和取消。
2. 手机连接本机后运行检测，记录 Android 版本和 CPU ABI，准备永久签名 APK 与手机工具桥。
3. 尽早验收录像/播放和录制期间语音停止，再接中文 ASR→Pi→TTS；完成手机内覆盖更新测试。
4. LOOI 到货后确认型号、固件与官方 App 基础功能，再验证 BLE、停止和受限动作。
5. 后续按 Pi 方案完成 Hermes、内容展示、人物记忆与扩展，不把导航当作现有能力。

小米 12 Pro 保留现有 Android 系统。当前步骤无需 root、解锁 bootloader、恢复出厂设置或读取个人文件。
