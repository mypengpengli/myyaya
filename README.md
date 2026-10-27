# 小丫 · myyaya

运行在 Android 手机上的 LOOI 机器人应用。手机提供表情、麦克风、扬声器和摄像头，LOOI 底座通过蓝牙连接；需要处理服务器任务时，可以接入自己的 Hermes Agent。

基于 [My LOOI](https://github.com/razor79/my-looi) 开发，保留社区的底座协议、动作控制和表情能力，增加中文离线语音、中文控制界面与 Hermes 任务面板。

## 下载安装

**[下载最新版本](https://github.com/mypengpengli/myyaya/releases/latest)**

当前版本：[v2.1.152 · ARM64 APK](https://github.com/mypengpengli/myyaya/releases/download/v2.1.152/myyaya-2.1.152-arm64.apk)，约 164 MB。支持 Android 7.0 及以上的 ARM64 设备，横屏使用；主要适配目标为小米 12 Pro + LOOI。

下载 APK 后在手机上打开安装。首次安装可能需要允许浏览器或文件管理器“安装未知应用”。本地表情、底座控制和中文识别不需要 OpenAI Key。

## 当前功能

| 功能 | 说明 |
| --- | --- |
| 机器人表情 | 全屏表情、触摸互动，任务面板中保留小表情 |
| 蓝牙底座控制 | 扫描连接、保存选择、前台重连、断开连接 |
| 动作与灯光 | 前进、后退、转向、抬头、低头、回正、点头、跳舞、开关灯 |
| 中文离线口令 | 内置中文模型；开启后用“小丫小丫”唤醒，短口令控制动作 |
| 中文听写与朗读 | 听写后检查文字，发送给 Hermes；可使用系统中文离线音色朗读结果 |
| Hermes 任务 | 提交文字任务、显示执行进度和结果、请求停止、重开后查询已保存的任务 |
| 人脸注视 | 可开启本地人脸检测与头部、身体朝向修正 |
| 应用内更新 | 检查 GitHub Releases、下载校验、确认安装新版 |

当前为早期测试版。构建、签名和源码回归检查已通过；手机与底座的识别效果、动作角度和固件兼容性仍需真机测试。转向采用社区的时间估算，动作保留传感器保护与超时停止机制。

## 开始使用

### 连接底座

首页 → **底座控制** → **扫描附近 LOOI**，选择底座连接。连接后可测试头部动作、灯光和短时移动。红色“立即停止”按钮随时可用。

如果无法连接，请检查蓝牙、附近设备权限和底座电源，并退出其他占用底座连接的应用。

### 中文语音

点击 **开启中文口令**，允许麦克风权限，等待中文模型加载完成。例如：

- “小丫小丫，前进。”
- “后退”“左转”“右转”“抬头”“点头”“跳舞”“开灯”。
- “停止”无需唤醒。

唤醒后 15 秒内可以继续说动作口令。语音识别在手机本地运行，退出页面或进入后台会关闭监听。点击“听写一句话”只生成文字，不自动执行动作；在任务页点击“采用这句话”后可以编辑再发送。

朗读需要手机已安装中文离线音色。Azure 晓悠童声是后续可选接入，当前版本不依赖 Azure。

### 连接 Hermes

设置 → **Hermes 服务器连接**，填写服务地址和独立 API Token，点击 **保存并测试连接**。之后从首页进入 **执行任务**。

服务器需要提供兼容的 Runs API 与 SSE 进度接口，详见 [Hermes 接入说明](docs/HERMES-INTEGRATION.md)。Token 保存在手机安全存储中，安装包不预置用户密钥。

### 更新应用

设置 → **更新（Updates）** → **检查更新（Check for updates）**，发现新版后下载并确认安装。首次在 App 内更新时，按系统提示允许 myyaya 安装应用。

后续版本使用相同包名与签名发布，可覆盖升级，正常情况下保留设置和任务数据，无需 USB 连接。当前不提供静默安装；首次手机端覆盖升级仍待实测。详见 [更新说明](docs/UPDATES.md)。

## 后续开发

- 连续中文语音对话、NewAPI 模型接入和 Azure 晓悠。
- 拍照、生图、图生图、视频生成与统一媒体查看器。
- 手机工具与服务器智能体协作、文件返回和办公文档查看。
- 人物识别、跟随与房间导航。

以上功能尚未全部实现。当前的人脸注视不等同于跟随行走或自主导航。

## 开发与文档

手机端采用 React Native / Expo + TypeScript，硬件与音频使用 Kotlin 原生模块。源码位于 `mobile/`，构建方法见 [BUILDING](mobile/BUILDING.md)。

- [当前进度](docs/STATUS.md) · [构建与验证](docs/VALIDATION.md)
- [社区能力与测试顺序](docs/COMMUNITY-CAPABILITIES.md) · [代码来源](docs/UPSTREAM.md)
- [产品需求](docs/PRODUCT-REQUIREMENTS.md) · [架构设计](docs/ARCHITECTURE.md)
- [APK 在线更新](docs/UPDATES.md) · [导航研究](docs/NAVIGATION-RESEARCH.md)

## 致谢与许可

感谢 [razor79/my-looi](https://github.com/razor79/my-looi) 与 [GrinZero/super-looi](https://github.com/GrinZero/super-looi) 的开源工作。社区代码的 MIT 许可保留于 [mobile/LICENSE](mobile/LICENSE)，模型和依赖说明见 [第三方声明](mobile/THIRD_PARTY_NOTICES.md)。
