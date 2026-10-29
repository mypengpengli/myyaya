# 小丫 · myyaya

小丫是运行在 Android 手机上的 LOOI 陪伴机器人应用。手机负责表情、中文对话、摄像头和作品展示，通过蓝牙控制底座；办公、浏览器等任务可以交给自己的 Hermes Agent。

基于 [My LOOI](https://github.com/razor79/my-looi) 开发，复用社区底座协议、动作与表情。手机端使用 TypeScript / React Native，硬件、相机和文件功能使用 Kotlin。

## 下载

**[下载最新 APK](https://github.com/mypengpengli/myyaya/releases/latest)**

支持 Android 7.0 及以上 ARM64 手机，横屏使用。本轮在小米 12 Pro / HyperOS 3 和 LOOI 上验证；具体版本、安装包与校验文件以 Release 页面为准。当前版本为 **2.1.165**，验证边界见[手机验收](docs/PHONE-CHECK-2026-10-29.md)与[功能完成度](docs/FEATURE-COMPLETION-2026-10-28.md)。

## 开始使用

1. 安装后按引导允许蓝牙、麦克风和相机权限。
2. 给 LOOI 通电，按语音提示长按触控区约 3 秒，黄灯呼吸后松手。连接页持续搜索 90 秒，也可点 **已变黄，开始搜索** 立即重搜。保存过的底座自动匹配；发现多个新底座时选择自己的那台。看到“LOOI 已连接”后再测试动作。
3. 填写自己的模型中转站、Key 和模型名称。默认采用 Agnes 对话与媒体模型；本地中文唤醒和底座控制不需要 OpenAI Key。
4. 回到表情页，说 **“小丫小丫”** 唤醒。从右向左滑动打开菜单，可修改模型、Tavily 搜索及其他设置。

模型、搜索和 Hermes 的密钥分别填写，保存在手机安全存储中，不预置在源码或安装包里。当前使用系统中文声音，不要求另配 Azure。

## 主要功能

| 功能 | 使用方式 |
| --- | --- |
| 中文陪伴对话 | 本地唤醒后，由手机内的 Pi Agent 调用模型与手机工具，表情显示当前状态 |
| 底座动作 | 前后移动、左右转、抬头、低头、回正、点头、灯光等；短动作自动停止，“停止”无需唤醒 |
| 拍照与观察 | “拍张照片”显示确认、重拍和取消；“看看眼前是什么”后台实拍并分析，默认不弹图 |
| 录像与作品 | 录像手动停止并保存；图片、视频和文档可重开、固定、关闭，视频支持暂停、重播与跳转 |
| 图片与视频生成 | 后台生成、改图和图生视频，保留版本与输入来源；接口可用性取决于自己的模型服务 |
| 联网搜索 | 设置 Tavily Key 后调用搜索，回答依据实际返回的来源 |
| Hermes 办公任务 | 显示真实进度、取回文件、完成通知、查询旧任务和沿原会话续办 |
| Word / PPT 原文件 | 保留 DOCX / PPTX，可保存到手机或交给 WPS 打开编辑；不自动转 PDF |
| 应用内更新 | 从自己的 GitHub Releases 检查、下载并校验新版，再由 Android 确认安装 |

图片默认显示 10 秒，可固定；视频正常播放结束后再倒计时 10 秒。多个结果依次展示，右下角显示“第 3/5 项 · 10 秒后展示下一项”，全部放完才回主表情；固定时暂停切换，右侧小表情保留。关闭或放完不会删除作品，之后仍能主动调出。App 内 Office 预览以内容为主，完整排版和编辑交给 WPS 等应用，编辑后可另存并重新导入。

前后移动与左右转、抬头、回正已有用户现场确认；WPS Word 编辑另存、两页 PPT 显示、拍照重拍确认、后台视觉问答及录像播放已完成首轮真机验证。手机生图、三轮连续改图、修改版图生视频、播放结束后倒计时和重开后查询旧任务已通过；手机 AI 连续搜索并派单，取回 DOCX/PPTX 原文件也已通过。164 修复了 AI 打开图片后尚未固定就被倒计时关闭的问题，并让改图先保存结果地址再独立下载。模型和网络仍可能间歇失败，旧的未知请求不会自动重新提交。GitHub 附件下载需要可用网络，用户将配置手机代理后再验证应用内下载与安装。

## 连接 Hermes

在设置中填写自己的 HTTPS 服务地址与独立 API Token。服务器使用 Runs API 和 SSE；APK 保存 run_id 和幂等键，恢复前台后继续查询，不重复提交同一次请求。

服务器返回办公文件需要配置[文件桥](server/README.md)，APK 校验后存入作品库。旧任务和会话可以查询，用户明确要求继续处理时才创建续办记录。详见 [Hermes 接入](docs/HERMES-INTEGRATION.md)。

## 更新与后续开发

菜单 → 设置 → 更新 → 检查更新，发现新版后下载并确认安装。首次可能需要允许小丫“安装未知应用”。相同包名和签名可覆盖升级，通常保留配置、任务和作品；不提供静默安装。

目前尚未完成全部原始需求。认人、身形身份、声源定位、跟随、房间导航及指定微信联系人或邮箱自动发送仍属于后续开发；现有的人脸检测和注视不代表具备这些能力。当前不以更换音色为开发重点。

## 开发文档

- [继续开发与交接](docs/CONTINUE-DEVELOPMENT.md) · [构建方法](mobile/BUILDING.md)
- [功能完成度](docs/FEATURE-COMPLETION-2026-10-28.md) · [本轮计划](docs/NEXT-DEVELOPMENT-2026-10-28.md)
- [最新续测](docs/PHONE-CHECK-2026-10-29.md) · [手机验收](docs/PHONE-CHECK-2026-10-28.md) · [当前进度](docs/STATUS.md)
- [产品需求](docs/PRODUCT-REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md)
- [社区能力](docs/COMMUNITY-CAPABILITIES.md) · [代码来源](docs/UPSTREAM.md) · [更新说明](docs/UPDATES.md)

感谢 [razor79/my-looi](https://github.com/razor79/my-looi) 与 [GrinZero/super-looi](https://github.com/GrinZero/super-looi) 的开源工作。MIT 许可保留于 [mobile/LICENSE](mobile/LICENSE)，模型与依赖见[第三方声明](mobile/THIRD_PARTY_NOTICES.md)。
