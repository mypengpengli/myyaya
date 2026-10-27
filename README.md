# myyaya

使用自己的小米 12 Pro 和已下单的 LOOI 底座，构建可以自定义模型、调用手机功能、执行服务器任务的桌面 AI 机器人。

**当前状态：已导入社区 Android 基线，采用 Pi；已解除上游强制 OpenAI Key 的 App 入口门槛，新增默认本地模式。** `mobile/` 来自 My LOOI，包含表情、BLE、语音、记忆和 APK 更新模块；已配置 myyaya 应用身份与自己的更新源。无 Key、无旧语音模型、未授权麦克风时也能进入本地界面，旧 Realtime 仅在主动选择并配置后使用。尚未构建并在本机手机上验证 myyaya APK，Pi / NewAPI / Hermes / 新 Viewer / 录像播放等定制需求仍待集成。

最新入口：[小丫产品需求](docs/PRODUCT-REQUIREMENTS.md)、[修订架构与开发顺序](docs/ARCHITECTURE.md)、[Hermes 接入契约](docs/HERMES-INTEGRATION.md)、[认人/跟随/房间导航研究](docs/NAVIGATION-RESEARCH.md)、[本次接口核查](docs/INTEGRATION-CHECK-2026-10-27.md)。构建与协议细节继续参考 [APK 开发补充](docs/APK-DEVELOPMENT-PLAN.md)和 [Pi 智能体方案](docs/PI-AGENT-PLAN.md)。首版服务器运行 Pi，手机执行本地工具；完整 Pi 功能需要服务在线，手机内嵌单独验证。

2026-10-27 用户确认：LOOI 即将到货，小米 12 Pro 已升级澎湃 OS 3。新需求固定唤醒词“小丫小丫”，补充童声、拍照后多轮改图/图生视频、10 秒可固定 Viewer、右下小表情与 Hermes 执行框、跟随和去客厅，以及微信/邮件扩展。代码本轮先修复入口和旧语音模式隔离，其余按修订架构分期实现。

Hermes 服务地址已提供并完成电脑端只读鉴权/能力复核。App 设置中已新增 Hermes 连接入口：首次填写独立 Token，之后保存在 SecureStore，可直接测试连接。任务派单与手机网络仍待 APK 实机验证；调试凭据不随源码或安装包发布，详见 [接入契约](docs/HERMES-INTEGRATION.md)。

代码来源、固定版本和开发方法见[社区代码来源](docs/UPSTREAM.md)；以后免 USB 更新应用的流程见[APK 在线更新](docs/UPDATES.md)。

## 当前方案

2026-10-27 已完成方案并生成首个永久签名 ARM64 联调 APK。已接入 Hermes 文字派单、SQLite 任务恢复、SSE 进度和右下角表情，同一份客户端已通过真实 HTTPS 任务/幂等/SSE 联调；Android release 构建与签名/包内校验通过，手机端尚待验收。使用步骤与后续范围见[首轮 APK](docs/APK-ITERATION-1.md)。

根据[最新需求讨论](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)，2026-10-26 将主线明确为 **小米 12 Pro + LOOI + 自定义 Android APK**。用户表示手机已升级澎湃 OS 3，保留现有系统；底层 Android 版本和设备能力仍以 ADB / 实机检查为准。K50 是早期候选，不再是当前开发目标。

手机承担屏幕、摄像头、麦克风、扬声器及应用运行；LOOI 作为机器人身体，计划通过 BLE 接入。第一代以现有手机与 LOOI 跑通软件为主，新增传感器和更换底盘放到后续评估。

```text
小米 12 Pro / 澎湃 OS 3 / myyaya Android App（待开发）
    ├─ 表情、语音、摄像头、录像与视频播放
    ├─ 本地工具调用与任务结果展示
    ├─ Pi 服务 → NewAPI → 用户选择的模型
    ├─ Hermes → 搜索、任务执行与文件返回（可选）
    └─ BLE → LOOI 底座（待实机验证）
```

新增要求与扩展方向见[最新方案整理](docs/PLAN.md)；采用 Pi 后的执行顺序、模型分工、手机工具与验收条件以 [Pi 实施方案](docs/PI-AGENT-PLAN.md)为准。

原来的 ESP32-S3 + 两个 HD1910 舵机方案已作为[历史方案](docs/archive/2026-10-25-esp32-plan.md)保留，不再作为当前主线的接线与采购要求。

LOOI 社区已有 BLE SDK 和 Android 项目可以研究，但社区接口不等于厂商官方支持。本项目还没有对自己的 LOOI 做连接和动作验证；具体兼容性见 [LOOI 接入调查](docs/LOOI.md)。

## 要实现的能力

| 方向 | 目标 |
| --- | --- |
| 自定义模型与智能体 | 采用 Pi 核心库，配置自己的 NewAPI 地址、模型与角色；首个主模型候选为 agnes-3.0-flash |
| 语音对话 | 录音、语音识别、语音合成；优先验证本地昵称唤醒、本地 VAD 和简单离线命令 |
| 手机功能 | 智能体调用相机录像、查找录像、播放视频及播放控制 |
| 机器人动作 | 先实现手动连接、停止和小范围动作，再加入与对话联动的动作 |
| 服务器智能体 | 调用用户已部署的 Hermes 执行任务，并显示执行状态与返回结果 |
| 内容展示 | 显示图片、网页、PDF 和视频；Word 文件按格式选择合适的预览方式 |
| 人物与记忆 | 分阶段实现人脸检测、跟踪、登记身份与人物记忆，评估声纹和人物档案绑定 |
| 看向与靠近 | 目标是“喊昵称后看向我”“叫它过来”；先实现看人，再验证定位、避障与自主靠近 |
| APK 在线更新 | 手机内检查、下载并确认安装自己发布的新版，日常升级无需连接电脑 |
| Hermes Screen | 有服务端画面或事件接口时，在手机上展示 Agent 工作过程；接入能力待核对 |

这些是项目目标，不代表现有 LOOI 官方 App 已提供上述自定义能力。现以社区 My LOOI 的 React Native / Expo + 原生 Android 模块为手机基础，新增 Pi 任务核心；BLE 与语音行为需要在自己的设备上验证。

### 手机录像与播放

Android 应用需要把手机功能提供为智能体可调用的工具。智能体理解指令后，由应用实际执行，并返回结果和界面状态。“取出录像”具体指找到并播放视频。

| 能力 | 预期行为 | 指令示例 |
| --- | --- | --- |
| 录制视频 | 开始录像、停止并保存，返回录制状态及视频引用 | “开始录像”“停止录像” |
| 查找录像 | 按最近一次或录制时间选择；有歧义时让用户选择 | “找到刚才录的视频” |
| 播放录像 | 在手机屏幕上播放选中的视频及其声音 | “播放刚才录的视频” |
| 控制播放 | 暂停、继续、停止当前视频 | “暂停”“继续播放” |

首先覆盖本应用录制的视频；手机已有视频经用户选择或授予访问权限后纳入播放范围。具体权限和前后台行为依据小米 12 Pro 实际系统版本实现。

验收闭环：录制并保存一段视频 → 找到视频 → 根据指令在手机上播放 → 暂停和继续。权限不足、文件不存在或播放失败时，需要返回实际原因。

### NewAPI 与 Hermes

- 首版普通问答由 Pi 服务调用 NewAPI；手机直连 NewAPI 作为纯问答降级候选，完整 Pi 工具任务依赖 Pi 服务在线。
- `agnes-3.0-flash` 的文字、SSE、工具结果续答和简单看图测试已通过；中文 ASR 与生图也完成小样本接口验证，详见[实测记录](docs/MODEL-PROBE-2026-10-26.md)。这不等于已经接入 APK。
- 搜索、文件处理等任务交给 Hermes 或后续工具服务；接入前先核对服务器现有的 API 和认证方式。
- Hermes 为可选任务后端，普通问答不应依赖它必须在线。
- 模型服务和语音服务分别配置；接入对话模型不代表自动具备语音识别、语音合成或联网搜索。
- 密钥和服务器私有配置不提交到仓库。

## 第一次连接小米 12 Pro

1. 手机开启开发者选项中的 USB 调试，用数据线连接电脑。
2. 保持解锁，允许这台电脑调试。
3. 安装 [Google 官方 Platform Tools](https://developer.android.com/tools/releases/platform-tools)，放入 `.tools/platform-tools/` 或将 `adb` 加入 `PATH`。
4. 在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-devices.ps1
```

需要 JSON 输出时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-devices.ps1 -AsJson
```

脚本读取连接状态、手机型号和系统版本，以及候选 USB/串口设备。它不会刷写固件、发送机器人动作或读取手机个人文件。脚本中的 ESP32/串口匹配来自早期方案，不是当前 LOOI 开发的硬件依赖，也不代表能通过 ADB 检测 LOOI 的 BLE 连接。

## 实施顺序

1. 用 Pi 核心库实现最小服务，接 NewAPI，验证中文文本、工具循环、流式进度和取消。
2. 确认小米 12 Pro 的 ADB、Android 版本、蓝牙和相机，准备首个永久签名 APK、手机工具桥与在线升级验收。
3. 优先验证录像、查找、播放，以及有声录像时语音停止所需的麦克风/相机协调。
4. 加入中文 ASR、TTS、打断和昵称唤醒，通过语音调用同一套手机工具。
5. LOOI 到货后记录型号与固件，验证官方基础功能、BLE、停止和受限动作，再开放相应智能体工具。
6. 接入 Hermes、文件展示及独立图片/视频生成工具。
7. 加入人物档案和记忆；将自主靠近作为独立的后续验收。详细条件见 [Pi 方案](docs/PI-AGENT-PLAN.md)。

## 扩展方向

- **LOOI + 手机 USB-C OTG**：评估接入 2D 激光雷达、深度相机；驱动、带宽、供电、安装和 Android 兼容性逐项验证。
- **WAVE ROVER 第二代身体**：作为候选，通过统一身体接口复用上层应用；尚未确认采购。
- **Linux 导航协处理器**：仅在 Android 直接接入或导航实现无法满足需求时再评估，不是第一代必需硬件。

这些方向来自方案讨论，不代表相关硬件已经购买，也不代表 LOOI 已具备 SLAM、导航或稳定的自主靠近能力。

## 仓库内容

```text
README.md                            项目目标与当前主线
docs/STATUS.md                       已完成事项与待验证项
docs/PLAN.md                         最新需求、分期与扩展方案
docs/PRODUCT-REQUIREMENTS.md          本次用户流程、Viewer 规则与验收需求
docs/ARCHITECTURE.md                  语言选择、模块边界、异步作业与修订顺序
docs/HERMES-INTEGRATION.md            现有 Ubuntu Hermes 版本、Runs/SSE 与文件回传契约
docs/NAVIGATION-RESEARCH.md           认人、声源、跟随与房间导航的一手调研
docs/INTEGRATION-CHECK-2026-10-27.md   本次中转请求与资料核查范围
docs/APK-DEVELOPMENT-PLAN.md          APK 开工范围、工具桥协议与真机验收补充
docs/PI-AGENT-PLAN.md                 Pi 架构、手机工具与阶段验收
docs/MODEL-PROBE-2026-10-26.md         NewAPI 小样本实测结果与边界
docs/LOOI.md                         LOOI 接入资料与验证计划
docs/UPSTREAM.md                     社区代码来源与改造说明
docs/UPDATES.md                      APK 在线升级与发布方法
docs/archive/                        2026-10-25 旧方案及进度快照
scripts/check-devices.ps1             Windows / ADB 连接检查
scripts/create-update-feed.py         生成 APK 更新 manifest 与 SHA-256
mobile/                              导入并定制的社区 Android 应用源码
```

本地 `.tools/` 中的下载工具与 `mobile/output/` 安装包不随源码上传。首个 ARM64 联调 APK 已通过 release 构建和静态校验；运动控制仍需 LOOI 真机验收。

## 参考资料

- [最新需求讨论（小米 12 Pro + LOOI）](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)
- [早期需求讨论（历史参考）](https://chatgpt.com/share/6add821d-da34-83ea-96aa-66e60eb30247)
- [LOOI 官方产品页](https://looirobot.com/products/looi-robot)
- [Super LOOI 社区项目](https://github.com/GrinZero/super-looi)
- [社区 LOOI SDK](https://github.com/GrinZero/super-looi/tree/main/packages/looi-sdk)
- [My LOOI 社区 Android 项目](https://github.com/razor79/my-looi)
- [Android ADB 文档](https://developer.android.com/tools/adb)
