# 现有 Ubuntu Hermes 接入契约

日期：2026-10-27。状态：手机连接设置、文字派单、SQLite 恢复、SSE 执行面板与停止请求已实现。同一份 TypeScript 客户端已通过真实 HTTPS 任务/幂等/SSE 联调，手机网络与安装后行为待真机验收。范围见[首轮 APK](APK-ITERATION-1.md)。

## 已确认的部署信息

| 项目 | 用户本次提供 |
| --- | --- |
| 项目 | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) |
| 版本 | `v0.21.6+199.g1744a19` |
| 部署 | Linux 主机直接安装，非 Docker |
| 启动 | systemd 用户服务 `hermes-gateway.service`；`systemctl --user status hermes-gateway` |
| 底层模型 | custom provider / `gpt-6.1-sol`；模型凭据保留服务器 |
| 对外集成 | 官方 API Server，HTTP REST + SSE，Bearer Token |
| 服务地址 | `https://hermes.jiazhuangai.com`；使用系统默认 HTTPS 证书校验 |
| 兼容 Base URL / 模型别名 | `https://hermes.jiazhuangai.com/v1` / `hermes-agent` |
| 手机可达性 | 仍需真机网络测试；3x-ui 管理地址不是 Hermes API |

本次已读取 [1744a19 对应 API 文档](https://github.com/NousResearch/hermes-agent/blob/1744a19/website/docs/user-guide/features/api-server.md)，用于对照用户版本；实际启用功能仍以运行中 `GET /v1/capabilities` 为准，不直接按 main 的新旧路由推断。

## 推荐网络拓扑

```text
手机 → myyaya Pi 服务的 HTTPS/WSS → Hermes API Server
                                 （同 Ubuntu 时优先 loopback）
```

优先把 Pi 服务放在现有 Ubuntu，与 Hermes 通过 loopback 通信；手机只访问 Pi，不需要直接持有 Hermes Token，也不要求把 Hermes 终端能力直接开放公网。Pi 部署位置未最终确认；若不在同机，按私网或经过验证的 HTTPS 接口连接。

`127.0.0.1:8642` 是官方默认配置参考，不代表该服务器内部监听地址已验证。正式 Pi 转接配置区分 `MYYAYA_SERVICE_URL`、`HERMES_API_BASE` 与服务端私有 Token。APK 安装包不预置 Token；用户本次选择手机联调时首次手动填写独立 Hermes API Token，运行时保存 SecureStore。Hermes 底层模型凭据始终保留服务器。

## 已保存的联调资料与手机设置

- 手机入口：设置 → Hermes 服务器连接；地址已预填，首次只需填写独立 Token，之后自动读取。可保存、替换、删除，或“保存并测试连接”；字段不会回显已保存 Token。
- 测试按钮只执行健康、无鉴权模型、带鉴权模型、能力发现四类 GET，不提交任务或执行终端命令；保存连接不要求启用旧 OpenAI Realtime，也不阻塞默认本地模式。
- 本机调试 Token 已保存至当前 Windows 用户的凭据管理器，目标名为 `myyaya/hermes/https://hermes.jiazhuangai.com`；源码、APK 安装包、公开文档和 `.env` 文件都没有该值。
- 后续电脑调试运行 `python scripts/check-hermes.py`；脚本自动读取上述凭据，不打印 Token，只作只读检查。手机上的 SecureStore 与电脑凭据管理器分别保存，不能自动互通。
- `python scripts/check-hermes.py --run-smoke` 额外用 APK 的实际客户端提交一个只读 `pwd` 任务，验证状态、SSE 和同键重试；目前已经通过。
- 首轮联调使用手机 → Hermes 直连，以尽早交付可安装闭环；Pi → Hermes 的正式拓扑仍是后续整合目标，尚无 Pi 服务可连接。

| 验证项 | 用户提供的实测 | 本机本次复核 |
| --- | --- | --- |
| HTTPS 健康 / 无 Token 模型 / 带 Token 模型 | 200 / 401 / 200 | 200 / 401 / 200 |
| capability 与四项 Runs 能力 | 建议先发现实际能力 | HTTP 200，run_submission/run_status/run_events_sse/run_stop 均为 true |
| 真实任务提交、状态、终端执行 | 202 → completed，`pwd` 返回实际工作目录 | 实际 TypeScript 客户端提交 pwd 并获得 completed/结果，同键重试返回同一 run_id |
| SSE 工具开始、完成、任务完成 | 收到 tool.started/tool.completed/run.completed | 实际收到这三类事件，支持 data JSON event 字段 |
| 实际模型 | custom / gpt-6.1-sol | 客户端联调未采集 runtime 字段；底层模型仍以服务器配置为准 |

## Runs API 映射

| myyaya adapter | Hermes 接口 | 约定 |
| --- | --- | --- |
| discover | `GET /v1/capabilities` | 检查 run_submission / run_status / run_events_sse / run_stop 与 auth；保存能力快照 |
| submit | `POST /v1/runs` | 先保存本地 Job 与固定请求体/幂等键，再提交并关联 run_id |
| status | `GET /v1/runs/{run_id}` | 获取真实状态、最终 output 与运行信息；手机恢复不重新提交任务 |
| events | `GET /v1/runs/{run_id}/events` | 首轮手机直连并保存公开进度；正式拓扑由 Pi 持久化事件后推送手机 |
| cancel | `POST /v1/runs/{run_id}/stop` | stopping 只表示已请求，等实际 cancelled/终态；不宣称请求返回就已停止 |

服务鉴权使用 `Authorization: Bearer <服务端私有 Token>`。myyaya 不覆盖 Hermes 的 custom provider 和 gpt-6.1-sol 模型设置，不把 NewAPI Key 当成 Hermes API Token。

初始提交以 `input` 表达明确目标、必要上下文和期望输出；`instructions/session_id` 等字段按实际能力使用。办公任务采用独立子会话，和小丫的日常 Pi 会话分开；需要后续修改同一文件时复用该任务关联的 Hermes 会话。

同一 Job 保持相同 `Idempotency-Key` 和 JSON 请求体；提交响应丢失时使用原键核对，不能随意生成新任务。对应版本文档描述 24 小时幂等保留，本项目仍自行保存长期 taskId/runId/结果；不能超出服务保留期承诺永久去重。

## 执行框与断线恢复

下面包含正式目标与已实现部分。首轮手机直接消费 SSE，只显示公开中间说明和工具/子任务生命周期，不渲染 message.delta；SQLite 保留收到的最近 100 条公开进度与最终文本。Pi 的 task_events/seq 补齐、文件展示队列和持续语音对话仍待实现。服务端终态记录有保留边界，手机离线跨过该边界时，不能承诺仅凭 run_id 找回未收到的最终结果；后续由 Pi 持久 Job 层补齐。

- 消费工具生命周期、公开中间说明与任务终态，映射为步骤、耗时、失败原因和文件结果。`tool.completed` 需检查 error，不能因收到 completed 就画成功。
- `message.delta` 和 `message.interim` 依据 already_streamed 去重；最终汇报以最终结果为准。中间说明和工具事实展示给用户，原始隐藏推理不作为界面内容。
- SSE 的 `: keepalive` 是保活注释，不显示为步骤。对应版本的未消费事件缓冲有五分钟过期边界；不假定 Hermes 提供无限历史或支持任意 Last-Event-ID 重放。
- 用户实测的事件类型位于 `data:` JSON 的 `event` 字段。解析器先按空行组装完整 SSE 帧、合并多行 data，再解析 JSON；优先读取 JSON event，并兼容 SSE event 字段，忽略冒号开头的注释。不能只依赖命名 SSE event 行。
- Pi 收到事件后写入自己的 task_events 和 seq，手机按 seq 补齐；Pi 与 Hermes 断线时先 status 对账，能补的公开状态补齐，不能重建的细节显示“这段执行过程未记录”。
- Hermes 服务重启可能使运行任务 interrupted，按真实状态返回，不自动重跑带文件修改/外发的任务；已保存产物继续保留。
- 生成视频或办公任务完成时仅入展示队列；用户固定媒体、正在说话时不抢占，右下小表情继续响应会话。

## 文件与浏览器画面

Runs 输出文本不自动等于可下载文件。需另外验证实际版本的上传、下载和浏览器接口；对应文档限制非图片文件输入，不能仅靠 /v1/chat/completions 上传 Word/PPT。

建议 Pi/Hermes 使用受限共享任务目录或窄文件接口，按 taskId 导入产物：校验路径归属、MIME、大小和 hash 后登记 artifactId，再签发手机可下载/预览的引用。原始 Word/PPT 和 PDF/图片预览版本分别保留。禁止让模型把任意 Ubuntu 路径直接当下载 URL。

浏览器工具的真实截图可作为独立产物或帧事件；有经验证的视频/屏幕流再提供实时画面。1744a19 文档仍描述部分 browser extension control 路由，当前 main 已发生变化，因此不预先写死它们，也不将旧浏览器控制通道等同完整远程桌面。

## 接通前需要的最小验证

1. 在服务器确认 Hermes gateway 与 API Server 已运行，记录实际监听地址/端口和 capability 响应，不输出 Token。
2. 确定 Pi 与 Hermes 是否同机：同机先测 loopback；跨机验证网络、鉴权与加密入口。之后单独验证手机到 Pi 的地址。
3. 提交一个无副作用的小任务，检查 run_id、SSE/轮询一致、最终结果、停止、服务重启与响应丢失后的幂等行为。
4. 生成一个测试文件并导入 ArtifactStore，手机可下载并预览；再验证真实浏览器截图来源。

当前服务地址、鉴权与 Runs 能力在电脑上已验证，手机设置和只读测试代码已实现；还需 APK 真机网络、实际任务/取消、SSE 恢复、文件和浏览器画面验收。本次没有部署、修改 systemd、开放端口或提交新 Hermes 任务。
