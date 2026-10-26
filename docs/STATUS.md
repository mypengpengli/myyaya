# 当前进度

更新日期：2026-10-26（Asia/Shanghai）。

## 当前路线

根据最新分享，主线为用户自有小米 12 Pro（澎湃 OS 3）+ 已下单 LOOI + 自定义 Android APK。K50 为早期方案，ESP32-S3 + 两个 HD1910 的资料保留在 archive。延续 NewAPI、Hermes、文件展示和手机录像/播放需求。

已读取[新的分享链接](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150)，其中明确包含手机更换、LOOI 下单、昵称唤醒、认人、看人、自主靠近以及 USB 外设 / 第二代底盘讨论。原先“分享中没有 LOOI 更新内容”的说明仅针对旧链接，现已据新链接更新。

## 已完成

- 读取用户新的分享方案：K50 + BLE + ESP32-S3 + Bus Servo Adapter (A) + 两个 HD1910。
- 将新方案保存到 README.md；原来的名校堂 G3 改造及 Tab5 选购方案不再作为当前实施路线。
- 下载 Google 官方 Android Platform Tools 到 `.tools/platform-tools/`。
- 实测 ADB 版本：37.0.1-15733141，Windows 上能够启动 ADB 服务。
- 创建并运行 `scripts/check-devices.ps1`，PowerShell 语法检查及无 Android 设备场景执行通过。
- 查阅微雪官方接线和 FAQ：UART 模式为 A 档，TX-TX / RX-RX；转接板不降压。
- 已补充手机功能调用需求：智能体可以调用录像、查找录像、播放录像及播放控制。“取出录像”按用户补充理解为找到并播放视频；这些能力尚待实现。
- 建立 myyaya 仓库并保留旧方案快照；已将 README 主线从 K50 + LOOI 纠正为小米 12 Pro + LOOI。
- 查阅 LOOI 官方产品资料、Super LOOI / SDK 和 My LOOI 社区项目，选择并导入 My LOOI v2.1.151 到 mobile/。
- 在 PLAN.md 中补充人物记忆、昵称唤醒后看人、自主靠近、Hermes Screen，以及候选 USB 传感器和 WAVE ROVER 扩展的分期。
- 配置 myyaya 独立包名和自己的 HTTPS 更新源入口，保留社区 APK 校验与安装模块；添加更新 manifest 生成脚本。
- 本地 TypeScript、48 项源码/行为检查、实际 Expo 应用配置检查通过；验证范围与未完成项见 [VALIDATION.md](VALIDATION.md)。

## 当前实测结果

- 上次 ADB 实测（2026-10-25）没有检测到 Android 设备，当前连接状态未重新确认。
- 小米 12 Pro 的底层 Android 版本、LOOI 型号、固件版本及 BLE 兼容性尚未确认；澎湃 OS 3 目前来自用户说明。
- 尚未验证 LOOI 状态读取、停止、运动、传感器或手机固定与供电。
- 已导入社区 Android / BLE / 语音 / 更新源码，尚未构建自己的签名 APK，未做手机或 LOOI 实机验收；NewAPI 与 Hermes 未接入。
- 用户已选择将 myyaya 仓库公开，现已改为公开；默认使用其 GitHub Releases 作为更新源。首个签名 APK、永久发布签名和首轮覆盖安装验收尚未完成。

## 下一步

1. 用户将小米 12 Pro 开启 USB 调试并通过数据线接到本机，手机上允许本机调试。
2. 运行连接检测，记录手机型号、Android 版本和 CPU ABI。
3. 确认 LOOI 型号、固件与官方 App 基础功能，再进入自定义 BLE 接入验证。
4. 在导入的社区应用基线上准备自己的永久发布签名与首个 APK，再接 NewAPI 和手机本地工具，并验收手机内覆盖更新。

小米 12 Pro 保留现有 Android 系统。当前步骤无需 root、解锁 bootloader、恢复出厂设置或读取个人文件。
