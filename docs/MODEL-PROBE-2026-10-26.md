# NewAPI 模型接口预验证

日期：2026-10-26。环境：本机 Windows / Python 3.11 的 HTTPS 请求；非 Android、非 Pi SDK 集成测试。

目的：为 [Pi 方案](PI-AGENT-PLAN.md) 确认模型与端点能否支撑基本工具调用和多模态分工。测试使用用户授权的测试 Key，Key 仅在测试进程内存中使用，不记录在本文件或仓库。仅提交下面的人工整理结果；临时脚本和机器记录保留在 Git 忽略的 `.tools/`、`artifacts/`。

## 测试范围与结果

接口服务：`https://apichat.jiazhuangai.com`。模型 API 前缀：`/v1`。

| 测试 | 模型 / 端点 | 实际结果 | 请求总耗时 |
| --- | --- | --- | --- |
| 模型列表 | `GET /v1/models` | HTTP 200，可见 87 个模型 ID，包含用户推荐的三个模型及 TeleSpeechASR | 约 0.9 秒 |
| 文字问答 | `agnes-3.0-flash`，`POST /v1/chat/completions` | HTTP 200，按要求返回 `MYYAYA_OK` | 3.27 秒 |
| 原生工具选择 | 同上，带 `tools`，`tool_choice: auto` | HTTP 200，返回 `get_robot_status`、参数 `{}`、`finish_reason: tool_calls` | 1.67 秒 |
| 工具结果续答 | 同上，回传匹配 `tool_call_id` 的模拟状态 | HTTP 200，准确回答模拟机器人已连接；没有控制真实设备 | 3.56 秒 |
| 流式输出 | 同上，`stream: true` | HTTP 200、`text/event-stream`，收到 8 条 data 事件，完整回复与 `[DONE]` | 2.50 秒 |
| 图片理解 | 同上，`image_url` data URI | 自制 16×16 纯红 PNG，返回 `Red` | 1.17 秒 |
| 转写路由 | `TeleAI/TeleSpeechASR`，`POST /v1/audio/transcriptions` | multipart WAV 静音输入成功，文本为空；仅验证请求协议 | 1.70 秒 |
| 合成中文转写 | 同上 | 指令主要内容正确，昵称出现同音字，见下文 | 3.36 秒 |
| 图片生成 | `agnes-image-2.5-flash`，`POST /v1/images/generations` | HTTP 200，返回一个图片项；下载 HTTP 200、PNG 文件头有效，591,894 字节 | 11.47 秒，含产物下载 |
| 视频生成 | `agnes-video-2.5` | 模型列表可见；未发起视频生成任务，生命周期协议尚未验证 | 未测 |

这里只测了一次小型工具闭环、一次简单视觉输入和一张生成图。耗时为本次环境的观测值，不能作为手机实时体验、稳定性或未来服务性能承诺。图片理解结果不代表已经验证人脸身份或复杂环境理解。

### 中文语音样本

使用 Windows 本机 `Microsoft Huihui Desktop` 合成以下无个人信息的短句，生成 WAV 后提交；没有上传用户、儿童或家庭录音。

```text
输入：你好，芽芽，开始录像，然后播放刚才的录像。
输出：你好牙牙开始录像，然后播放刚才的录像。
```

本次识别支持把 TeleSpeechASR 作为中文 ASR 候选。昵称需要别名和上下文纠正；远场、儿童语音、噪声、唤醒准确率、语音分段和打断仍需手机专项测试。Windows 合成语音也不能证明小米手机已经具备可用中文 TTS。

## 影响接入的发现

1. 主模型确实返回结构化 `tool_calls`，并能读取工具结果继续回答；接入 Pi 的基本协议条件成立。仍需验证 Pi 自己构造的 schema、流式工具参数、多轮任务与取消。
2. 第一次流式客户端请求收到 HTTP 403；显式使用与成功请求一致的 User-Agent 后重测通过。403 的具体来源未定位，不据此判断模型不支持流式；实现中应记录脱敏状态码并验证实际运行环境。
3. 把图片模型送入聊天端点时，接口返回 HTTP 400，并明确要求 `/v1/images/generations`。按该端点重测成功。因此图片生成需要独立 adapter。
4. 生图请求使用 `model`、`prompt`、`n: 1`，未强制分辨率。响应包含 `data`、`created`、`task_id`；首个图片项包含 `url`、`b64_json`、`revised_prompt` 字段，本次从 URL 下载到 PNG。未在仓库保存产物 URL 或图片内容。
5. 定价元数据把相关模型标为 `openai` 类型，这个标签不足以确定每个模型使用相同端点。尤其视频的提交、查询、取消、超时和结果格式需要独立核对。
6. 模型列表中未发现名称直接包含 `tts`、`realtime` 或 `speech synthesis` 的项目；名称不是完整能力说明，当前没有据此确认可用的语音合成或 Realtime 模型。首版另行验证系统中文 TTS。

## 推荐用于下一步

- `agnes-3.0-flash`：Pi 主对话、工具选择与单张图片理解的首选测试模型。
- `TeleAI/TeleSpeechASR`：首个中文 ASR 候选，与主模型分开配置。
- `agnes-image-2.5-flash`：生图工具候选，已完成最小生成与产物下载。
- `agnes-video-2.5`：保留为视频候选，协议验收前不标成已支持。

## 尚未验证

- Pi v1.4.0 SDK 对这个服务的实际集成、流式工具调用、多工具任务和取消行为。
- Android 网络、中文 ASR/TTS、相机、录像、播放、蓝牙与前后台生命周期。
- 任何真实机器人移动、人脸身份、自动靠近、Hermes 服务或 APK 安装更新。
- 视频生成协议、长任务恢复、内容复杂度、并发限流、服务端数据保留策略和实际费用统计。

本记录不把模型名称映射为未经证实的底层厂商模型，也不把公开定价页面截图当作实测账单。
