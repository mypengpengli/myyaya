# 换电脑继续开发

更新：2026-10-27。当前是 **2.1.153 开发源码**，不是已完成验收的新版 APK。公开下载仍是 2.1.152。

下一次可以直接告诉开发助手：**“先读 docs/CONTINUE-DEVELOPMENT.md 和 docs/PRODUCT-REQUIREMENTS.md，拉取 main 后继续现有实现，先完成 APK 构建和真机闭环，不要重新从方案开始。”**

## 已保存的实现

- 首次授权、扫描连接 LOOI、配置中转站和对话模型，再进入表情页。首页底部靠左只有 10sp 的一行公开执行进度，左滑打开菜单。
- 使用实际 `@earendil-works/pi-agent-core@1.4.0`；Metro 只把其 `pi-ai` 运行时入口映射到官方的通用工具函数，避免加载 Node 提供商发现代码。Pi 工具循环没有改写成自制循环。
- NewAPI SSE 流式适配、参数校验、工具结果回传、取消和错误处理。手机安全存储保存连接配置，Key 不进入代码或 APK。
- 中文 Vosk 唤醒 → 自然句子 → Pi/模型 → 系统中文 TTS → 15 秒追问窗口。普通对话时保留停止监听，包含自身朗读文本过滤和 Android AEC；声学效果仍需实机验证。
- 手机拍照、保存与重开作品、本地事实记忆、Hermes 任务提交/查询/停止已接入工具注册表。
- 录像采用用户最新确认的**手动停止**方案：录像前暂停中文采音并释放注视相机；点击停止、保存后恢复识别。录制有声音，画面有停止按钮。
- 图片/视频 Viewer、固定、结果排队、加载后倒计时、视频实际结束后倒计时；作品在手机 SQLite 和应用文件目录保留，关闭预览不删除。
- 媒体任务与会话分开；先持久化再提交，重启后查询已有视频任务，不自动重放结果不确定的生成请求。

主要入口：`mobile/src/agent/`、`mobile/src/artifacts/`、`mobile/src/voice/chinese-voice-session.ts`、`mobile/src/setup/RobotOnboarding.tsx`。

## 视频 404 的核查结果

已读取用户自己的 [ImageForge 网站](https://image.jiazhuangai.com/) 公开前端，以及 [Agnes Video 2.5 文档](https://wiki.agnes-ai.com/en/docs/agnes-video-25.md)。网站默认中转仍为 `https://apichat.jiazhuangai.com`，2.5 系列用 `POST /v1/videos`，不是旧版 `/v1/video/generations`。

最小请求使用 `mode: text`、`seconds` 字符串、`size: 720P`、`aspect_ratio`；单图视频改用 `mode: keyframe` 与 `first_frame`。中转任务 ID 与提供商 `video_id` 分开保存；先查 `/v1/videos/{id}`，必要时按网站逻辑查询同一中转主机的 `/agnesapi?video_id=…&model_name=…`，不把用户 Key 转发给 Agnes 官方主机。

- `agnes-video-2.5` 的真实 404 返回为 `fail_to_fetch_task` 包裹的 `AgnesAI_error/model_not_found`，内容说明模型不在当前分组可用范围。**不能据此断言中转不支持视频。**
- 同一个测试 Key、同一个中转，`agnes-video-2.5-flash` 提交返回 HTTP 200，排队后完成。通过 `/v1/videos/{id}/content` 下载得到 118620 字节 MP4，文件头和容器时长已验证（约 4.48 秒）；SHA256 为 `75576cc62d8ac6397bb7bb2494c3925c597b50615749606ebdd74cdf2d0dd708`。这是电脑端 API 验证，手机播放器仍需验收。
- 默认视频模型改为已接受任务的 Flash，设置页保留模型名编辑。没有对失败的标准版静默重新提交，也不自动更换模型重复计费。
- 图像修改按 [Agnes Image 2.5 文档](https://wiki.agnes-ai.com/en/docs/agnes-image-25-flash.md) 使用 `/v1/images/generations` 的 `extra_body.image`，不沿用其他模型的 multipart 编辑协议。新版改图请求仍需实测。

任务 ID 属于测试记录，不是凭据：`task_T9p2xjOluXT7Xlj1d6Tq6mZMeqaNv18e`，已完成。需要复核时只查询或下载，不重新生成；查询需要在本机安全输入测试 Key。下载优先走中转站内容代理，外部 CDN 地址仅作回退，不携带中转 Key。

## 验证和待完成事项

- TypeScript 和新增 Pi、对话、作品/手动录像、媒体任务、Agnes 协议行为测试已通过。实际 Pi + 中转模型完成过一次工具调用和结果复述。
- `a86ee2e` 的 [Ubuntu CI](https://github.com/mypengpengli/myyaya/actions/runs/40522819338) 全部通过：54 项默认检查，以及更新客户端、运动安全、BLE 生命周期/重试、STOP 和 PCM 检查。Windows 上不能运行的 Bash/zip 检查也在该流程通过。后续小修以最新提交的 CI 为准。
- Android Metro/Hermes 导出已通过，包含 Pi 和媒体代码；这不能代替原生 APK 构建与真机验收。
- 本机正在首次准备原生构建，已安装 JDK/SDK/NDK，构建缓存留本机；**还不能标记为新 APK 构建成功或已安装**。
- 本次 ADB 曾识别到 Xiaomi 12 Pro、Android 15/API 35、ARM64，旧包 152 的相机/麦克风/蓝牙权限已允许。兼容目标仍包含 Redmi K50，不绑定型号。
- 首先完成：原生编译 → 开发包安装 → 授权/真实 BLE 连接 → 中文对话与打断 → 有声录像手动停止/保存/回放/恢复对话 → 生图、改图、视频成片落盘。
- PDF/Word/PPT 完整预览、浏览器画面/服务器文件取回、Azure 晓悠童声、人物身份与跟随、房间导航仍未完成。普通文本展示和本地注视不能冒充这些能力。

## 新电脑准备

```powershell
git clone https://github.com/mypengpengli/myyaya.git
cd myyaya
git pull --ff-only
cd mobile
corepack enable
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec tsc --noEmit
node scripts/pi-companion-behavior.test.mjs
node scripts/companion-dialogue-behavior.test.mjs
node scripts/companion-artifacts-behavior.test.mjs
node scripts/media-jobs-behavior.test.mjs
node scripts/agnes-protocol-behavior.test.mjs
```

Node 建议 24.12 或兼容的新版本，pnpm 由 `packageManager` 固定。原生构建另外需要 JDK 17、Android SDK/build-tools 36、NDK 27.1.12297006、CMake 3.22.1。设置 `JAVA_HOME`、`ANDROID_HOME`，在手机打开 USB 调试并允许电脑授权。

Windows 从源码构建并存的开发包：

```powershell
.\scripts\build-hermes-apk.ps1 -Development
```

脚本会建立短的 ASCII 构建目录，开发包名为 `io.github.mypengpengli.myyaya.dev`，显示 `myyaya dev`。它不覆盖正式版，不是正式 OTA 包。输出是 `mobile/output/android/myyaya-companion-dev-arm64.apk`。

若代理导致 Node 的 Sherpa/中文模型下载超时，可用浏览器下载官方归档，并给脚本传入绝对路径：

- Sherpa：`https://github.com/deeeed/audiolab/releases/download/sherpa-onnx-prebuilt-v1.13.0/sherpa-onnx-binaries-1.13.0.zip`，使用 `-SherpaArchive`；脚本验证固定 SHA256 和归档路径。
- 中文模型：`https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip`，使用 `-ChineseModelArchive`；脚本继续验证原有 SHA256。

这些归档、SDK、构建缓存都没有提交仓库，新电脑需要重新准备或安全复制。

## 正式签名与配置

用户确认 **152 的正式签名在之前的电脑/执行环境**，当前电脑未找到。必须取回同一个 `.jks/.keystore` 和原密码，才能覆盖原包、保留用户数据并继续 OTA。不能新建另一把正式密钥冒充原签名，也不能为解决签名问题卸载用户现有应用。

正式构建沿用 `build-hermes-apk.ps1` 不带 `-Development`，要求原有 `MY_LOOI_RELEASE_*` 私有环境变量。Key、Hermes Token、签名和密码只通过安全方式迁移；仓库、交接文档及测试报告都不包含它们。手机上的安全存储也不会随 Git 自动迁移。
