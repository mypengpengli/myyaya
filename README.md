# myyaya

使用自己的小米 12 Pro 和已下单的 LOOI 底座，构建可以自定义模型、调用手机功能、执行服务器任务的桌面 AI 机器人。

**当前状态：已导入社区 Android 应用基线，开始二次开发。** `mobile/` 来自 My LOOI，包含 BLE、语音、记忆和 APK 更新模块；已配置 myyaya 应用身份与自己的更新源入口。尚未构建并在本机手机上验证 myyaya APK，NewAPI / Hermes / 录像播放等定制需求仍待实现。

代码来源、固定版本和开发方法见[社区代码来源](docs/UPSTREAM.md)；以后免 USB 更新应用的流程见[APK 在线更新](docs/UPDATES.md)。

## 当前方案

根据[最新需求讨论](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)，2026-10-26 将主线明确为 **小米 12 Pro + LOOI + 自定义 Android APK**。用户表示手机已升级澎湃 OS 3，保留现有系统；底层 Android 版本和设备能力仍以 ADB / 实机检查为准。K50 是早期候选，不再是当前开发目标。

手机承担屏幕、摄像头、麦克风、扬声器及应用运行；LOOI 作为机器人身体，计划通过 BLE 接入。第一代以现有手机与 LOOI 跑通软件为主，新增传感器和更换底盘放到后续评估。

```text
小米 12 Pro / 澎湃 OS 3 / myyaya Android App（待开发）
    ├─ 表情、语音、摄像头、录像与视频播放
    ├─ 本地工具调用与任务结果展示
    ├─ NewAPI → 用户选择的模型
    ├─ Hermes → 搜索、任务执行与文件返回（可选）
    └─ BLE → LOOI 底座（待实机验证）
```

新增要求、分期与尚未确定的扩展方案见[最新方案整理](docs/PLAN.md)。

原来的 ESP32-S3 + 两个 HD1910 舵机方案已作为[历史方案](docs/archive/2026-10-25-esp32-plan.md)保留，不再作为当前主线的接线与采购要求。

LOOI 社区已有 BLE SDK 和 Android 项目可以研究，但社区接口不等于厂商官方支持。本项目还没有对自己的 LOOI 做连接和动作验证；具体兼容性见 [LOOI 接入调查](docs/LOOI.md)。

## 要实现的能力

| 方向 | 目标 |
| --- | --- |
| 自定义模型 | 配置自己的 NewAPI 地址、模型名和密钥，切换对话模型与角色提示词 |
| 语音对话 | 录音、语音识别、语音合成；优先验证本地昵称唤醒、本地 VAD 和简单离线命令 |
| 手机功能 | 智能体调用相机录像、查找录像、播放视频及播放控制 |
| 机器人动作 | 先实现手动连接、停止和小范围动作，再加入与对话联动的动作 |
| 服务器智能体 | 调用用户已部署的 Hermes 执行任务，并显示执行状态与返回结果 |
| 内容展示 | 显示图片、网页、PDF 和视频；Word 文件按格式选择合适的预览方式 |
| 人物与记忆 | 分阶段实现人脸检测、跟踪、登记身份与人物记忆，评估声纹和人物档案绑定 |
| 看向与靠近 | 目标是“喊昵称后看向我”“叫它过来”；先实现看人，再验证定位、避障与自主靠近 |
| APK 在线更新 | 手机内检查、下载并确认安装自己发布的新版，日常升级无需连接电脑 |
| Hermes Screen | 有服务端画面或事件接口时，在手机上展示 Agent 工作过程；接入能力待核对 |

这些是项目目标，不代表现有 LOOI 官方 App 已提供上述自定义能力。现以社区 My LOOI 的 React Native / Expo + 原生 Android 模块为基础，BLE 与语音行为需要在自己的设备上验证。

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

- 普通问答可以由应用调用 NewAPI，具体接口能力需与所选模型核对。
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

1. 确认小米 12 Pro 的 ADB、Android 版本、蓝牙和相机可用性；LOOI 到货后记录型号与固件版本。
2. 使用官方 App 做硬件基线检查，再验证自定义应用的 BLE 连接、状态读取和停止指令。
3. 完成自定义 Android App 的手动控制与表情页面，实测受控的小范围动作。
4. 接入 NewAPI，先跑通文字问答，再加入语音。
5. 跑通手机录像、查找与播放闭环。
6. 接入 Hermes 任务状态及文件、网页展示。
7. 按实测结果加入昵称唤醒、看人、人物档案和记忆；将自主靠近作为独立的后续验收。

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
docs/LOOI.md                         LOOI 接入资料与验证计划
docs/UPSTREAM.md                     社区代码来源与改造说明
docs/UPDATES.md                      APK 在线升级与发布方法
docs/archive/                        2026-10-25 旧方案及进度快照
scripts/check-devices.ps1             Windows / ADB 连接检查
scripts/create-update-feed.py         生成 APK 更新 manifest 与 SHA-256
mobile/                              导入并定制的社区 Android 应用源码
```

本地 `.tools/` 中的下载工具不随仓库上传。当前已包含社区运动控制源码，但尚无构建验收通过的 myyaya APK。

## 参考资料

- [最新需求讨论（小米 12 Pro + LOOI）](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)
- [早期需求讨论（历史参考）](https://chatgpt.com/share/6add821d-da34-83ea-96aa-66e60eb30247)
- [LOOI 官方产品页](https://looirobot.com/products/looi-robot)
- [Super LOOI 社区项目](https://github.com/GrinZero/super-looi)
- [社区 LOOI SDK](https://github.com/GrinZero/super-looi/tree/main/packages/looi-sdk)
- [My LOOI 社区 Android 项目](https://github.com/razor79/my-looi)
- [Android ADB 文档](https://developer.android.com/tools/adb)
