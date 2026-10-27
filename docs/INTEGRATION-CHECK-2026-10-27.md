# 2026-10-27 接口与资料核查

范围：少量中转接口请求、官方资料和源码核查；不是 Pi SDK、APK 或机器人实机验收。

## 中转请求

按用户指定使用 `https://apichat.jiazhuangai.com` 与四个模型。本次参考 Agnes 技能的请求脚本，但在进程内覆盖其默认主机和模型；没有向技能默认主机发送用户凭据。测试 Key 仅在测试进程环境/内存中使用，未写入仓库、APK、环境文件或本文。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `GET /v1/models` | HTTP 成功，返回 87 个模型；四个指定模型均可见 | 模型列表不能证明每种端点和输入格式已支持 |
| `agnes-3.0-flash` 文字请求 | `/v1/chat/completions` 返回 `MYYAYA_OK` | 一次简短文字，不代表多工具/图片编辑/视频任务通过 |
| 模型名包含 tts/realtime/synthesis/cosyvoice/kokoro 的候选 | 未找到 | 仅名称筛选，不能证明服务绝无 TTS；需实际服务资料或供应商确认 |
| 初次默认客户端请求 | HTTP 403、错误 1010；使用与既有记录相符的 User-Agent 后通过 | 正式 Node/手机环境仍需实测网络兼容；未关闭 TLS 校验 |

本次未发起图生图、视频生成、图生视频或 TTS 合成，没有重复此前的 ASR/生图测试。历史小样本见 [2026-10-26 记录](MODEL-PROBE-2026-10-26.md)。待验证的媒体接口不从 Agnes 其他主机/旧模型版本直接复制为此中转的正式协议。

## 官方资料影响

- Pi 继续固定 v1.4.0，首版显式串行工具。长媒体/Hermes任务交由独立持久 JobWorker，避免长期占会话；详见 [修订架构](ARCHITECTURE.md)。
- Azure 官方音色表将 `zh-CN-XiaoyouNeural` 标为普通话儿童女声；本次未试听/合成，实际接入需要独立服务配置。[音色表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)
- 用户后续确认 Hermes `v0.21.6+199.g1744a19` / systemd 用户服务及官方 Runs API 接法；本次进一步核对 [对应提交 API 文档](https://github.com/NousResearch/hermes-agent/blob/1744a19/website/docs/user-guide/features/api-server.md)。尚无经过验证的访问地址，未连接其服务；文件回传和浏览器画面继续单独验收，见 [接入契约](HERMES-INTEGRATION.md)。
- Google 官方清单列有 Xiaomi 12 Pro 的 ARCore Depth 支持；前摄/VIO、底座传感、房间地图与声源方向均有具体限制，见 [导航研究](NAVIGATION-RESEARCH.md)。

## 当前实现边界

本轮代码修复范围是上游强制 Key/模型/权限的 App 入口门槛，以及默认本地模式与旧 Realtime 的隔离。新版需求、Viewer、Pi/中转、中文唤醒、童声、异步媒体、Hermes 与导航需要按 [产品需求](PRODUCT-REQUIREMENTS.md)和架构阶段继续实现；没有因本次文字请求成功就标记为已集成。
