# APK 开发方案补充：开工范围、协议与验收

日期：2026-10-27（Asia/Shanghai）。本文是早期开发草案；同日已完成 Hermes 首轮 APK 与社区 BLE/中文离线语音的后续接线，当前状态以 [STATUS](STATUS.md)、[VALIDATION](VALIDATION.md)及[社区能力审查](COMMUNITY-CAPABILITIES.md)为准。Pi 服务仍待部署。

用户本次确认：**LOOI 即将到货；小米 12 Pro 已升级澎湃 OS 3。** 底层 Android 版本、CPU ABI、相机和 BLE 能力仍需读取实机。本方案承接 [总体需求](PLAN.md) 与 [Pi 架构](PI-AGENT-PLAN.md)，不重新选择技术路线；具体参数和协议是本次提出的实现约定，后续按原型结果修订。

同日后续用户新增完整流程与草图，最新范围/开发顺序以 [产品需求](PRODUCT-REQUIREMENTS.md)和 [修订架构](ARCHITECTURE.md)为准；本文保留构建、资源原型和 V1 线协议细节。本轮已经实现默认本地模式、解除强制 Key 门槛及旧语音隔离，其他规划能力仍待实现。

## 1. 参考资料与证据边界

| 资料 | 本次核查情况 | 用途 |
| --- | --- | --- |
| [最新需求讨论：小米 12 Pro + LOOI](https://chatgpt.com/share/6adf4c3e-e364-83e9-a865-a9f99f4e4150) | 本次普通读取超出 4 MiB 限制，浏览器连接也未成功；未重新完整读取原文 | 沿用仓库 10 月 26 日的整理，不能把分享中其他助手的建议当成用户已确定需求 |
| PLAN / PI-AGENT-PLAN / LOOI / STATUS | 已读取，与当前 mobile 源码交叉核对 | 当前范围、架构和硬件验证边界 |
| [模型预验证记录](MODEL-PROBE-2026-10-26.md) | 已审查仓库记录；本次未重测或调用付费接口 | 历史 HTTP 小样本证据，不能替代 Pi SDK / APK 验收 |
| [My LOOI 来源](UPSTREAM.md)与 mobile 源码 | 已检查构建、语言、相机、音频、生命周期与更新链路 | 确定复用点和需要改造的代码 |
| [Pi v1.4.0 官方资料](https://github.com/earendil-works/pi/tree/v1.4.0) | 已核对包名、Node 要求、provider 接线、工具并发与取消语义 | 固定 SDK 实现基线，不追随 main 自动升级 |

当前仓库提交基线：`7b5ed1c`。此前检查见 [VALIDATION.md](VALIDATION.md)；本次为门槛代码修复已按锁文件安装依赖，跳过原生 postinstall，不代表 Android 构建就绪。本机 PATH 未发现 Java 或 adb，工作区也没有 `.tools/platform-tools/adb.exe`，不代表电脑其他位置一定没有安装。Windows 可找到 wsl/bash 入口，但尚未核验可用发行版与 Android 工具链。

## 2. 保留的架构与首批交付

继续使用 `mobile/` 的 React Native / Expo + 本地 Kotlin 模块；首版不升级框架、不重写原生 App。Pi 固定在自有服务器运行，开发时可在电脑运行；手机主动建立 HTTPS/WSS 连接，提供相机、媒体、记忆与 BLE 工具。Hermes 是可选任务后端。

将第一批交付分成三个可验收的包，分别记录真实能力；A/B/C 是验收名称，不是发布版本号。

| 交付 | 必须做到 | 暂未包含 |
| --- | --- | --- |
| A：手机基线包 | 自己的永久签名；安装和中文核心页面；权限/设备状态；本地操作；n→n+1 覆盖更新 | 不把导入的语音、BLE 源码标为自己真机已通过 |
| B：手机工具包 | 录像保存、查找、播放、暂停/继续；带声录像中识别“停止录像”；重启后找回媒体 | 录像时先暂停人脸相机，底座保持静止；不要求后台录像 |
| C：Pi 对话包 | 文字/按键中文语音→Pi→同一套手机工具→真实结果→中文朗读；任务取消和断线恢复 | 自动昵称唤醒逐项验收后开放；不等待 Hermes 或导航 |

LOOI 到货后可并行做独立的连接、状态、STOP 与受限动作验收，相关 Pi 工具只在本机验证后注册。认人、自动靠近、导航、雷达/深度相机和第二代底盘仍保留在后续阶段。网页/PDF/Word、Hermes Screen、生图/视频沿用 P6 范围，不挤入 A/B 的发布条件。

## 3. 源码审查发现与对应改造

| 发现 | 代码依据 | 开发处理 |
| --- | --- | --- |
| 界面、输入和回答语言只有 uk/en/ru | `mobile/src/i18n/ui-language.ts`、`src/language/listening-language.ts`、`response-language.ts` | 增加中文类型、规范化/持久化迁移、核心文案、ASR/TTS locale；不能只改提示词 |
| 原先首次启动要求 OpenAI Key 与原有语音模型就绪，否则停留在引导页 | `mobile/src/setup/setup-readiness.ts`、`mobile/app/onboarding.tsx`、`mobile/app/_layout.tsx` | 本轮已修复为默认 local 与主动选择的 legacy_realtime；local 可无 Key/模型/麦克风权限进入，并阻止旧语音自动启动。Pi 模式接入时再新增，不提供假可用入口 |
| 原有经典 TTS 已退休，调用会报错 | `mobile/src/voice/tts.ts` | 新建可打断的 Android 中文 TTS 适配；中文 voice 与离线能力在手机上测 |
| 停止 Realtime 后，前台会重新启动 wakeword / KWS 采音 | `mobile/src/voice/realtime-pcm-conversation.ts` 的 `performStop()` | 统一管理采音所有权；会话退出、watchdog、导航和唤醒恢复都必须受资源管理器约束 |
| 人脸 Camera2 模块只有检测/拍照接口，没有录像接口 | `mobile/modules/local-face-attention/index.ts`、`src/core/social-attention.ts` | 新录像模块先接相机仲裁，再执行录制；不同时打开独立相机会话 |
| 尚无录像库和视频播放器实现 | `mobile/package.json` 与当前源码 | 增加原生录像、持久媒体索引和播放器；选择库前验证与 Expo 56 的兼容性 |
| 后台会释放音频/相机/BLE，且 5 秒后硬退出 | `mobile/src/core/app-bootstrap.ts`、`background-process-exit.ts`、`mobile/app/_layout.tsx` | 先完成录像封装、结果落库，再退出；外部选择器/安装器复用 Activity lease；不能照搬固定倒计时 |
| 现有 CI 只有源码检查，安装跳过 postinstall | `.github/workflows/source-checks.yml` | 增加独立 Android 编译验证；有 Gradle 成功、签名与包信息证据才算构建通过 |

## 4. 第一项技术原型：共用相机和麦克风

这是 B 包的技术门槛，应与 A 包构建准备并行，先于完整 Pi 产品集成。

1. 增加统一资源管理器，管理相机占用、麦克风生产者及音频输出。采用占用令牌和会话代次，避免过期的 stop 回调重新启动旧监听。录像状态、对话状态和连接状态分别保存。
2. 进入录像前暂停 social-attention，等待相机真正关闭，再把相机交给录像；结束封装后按先前设置恢复。录像失败和取消同样释放资源。
3. 首选**一个原生 PCM 采集源，分别供停止命令识别与录像音轨编码**；视频编码与音轨封装需新增原生适配。现有 AEC/采音代码是复用基础，不代表已实现录像音轨。若改用 Recorder 自带采音，先在小米证明与识别通路都持续收到有效音频。
4. 录像期间保留本地停止按钮和停止命令通路。中文本地“停止录像”当前尚未实现，需单独验证；不能用暂停全部识别或静音视频通过验收。
5. TTS/视频输出接受统一音频焦点控制；真人打断后停止旧回答。每次回答带 generationId，旧模型事件和旧音频不得恢复播放。录像时先不播报长回答，操作反馈以界面为主。
6. 候选初始配置为 720p、30 fps、单段上限 120 秒，按手机能力回退；这些是原型参数，不是已支持性能。先证明有声音、音画可用、停止有效，再调画质。

Android [音频输入共享](https://developer.android.com/media/platform/sharing-audio-input)说明平台争用规则，不能据此保证同一 App 的多套录音库可共存。[CameraX 录像架构](https://developer.android.com/media/camera/camerax/video-capture)可作为编码/封装参考，但当前使用 Camera2，不预先承诺整体迁移到 CameraX。

录像独立经历 `recording → finalizing → saved / failed`。start 工具成功仅表示录制开始；stop 工具只有在视频完成封装、持久文件和 SQLite 索引就绪后才成功。媒体保存到应用持久目录，以 `mediaId` 引用；不将临时缓存路径当长期录像库。进程崩溃后的残留文件标记待恢复，验证可播放后才纳入索引。

## 5. 手机工具桥 V1 草案

以下接口属于 **myyaya 自建服务**，不代表 Hermes 已有同名接口。首版优先单用户单设备，但所有任务与结果仍校验所属设备。

- 配对：手机输入服务地址和短期一次性配对码，服务器签发可撤销的设备凭据；凭据存 SecureStore，模型 Key 仅留服务端。配对失败、撤销和证书错误明确显示，不接受忽略 TLS 校验的方案。
- 握手：`protocolVersion`、稳定 `deviceId`、每次连接新的 `deviceSessionId`、每次进程新的 `bootId`、APK versionCode、能力列表。服务器仅注册该设备已支持且验收通过的工具；未连接时不宣称可执行。
- 请求：`taskId / toolCallId / requestId / deviceId / deviceSessionId / deadline / action / args`。先认证并校验设备/任务归属，再查持久 requestId；已处理的请求返回原状态，即使其原 deadline 已过期或来自旧连接也不重做。首次执行才检查当前 session、deadline、权限与能力，落库后执行。`requestId` 在同一设备跨重连、跨重启去重；同 ID 的 action + args 不同返回冲突，参数摘要不包含会随连接变化的 session 字段。
- 结果：`accepted / running / succeeded / failed / cancelled / unknown`，附结果、结构化错误和录制/媒体引用。accepted 只证明收到，不能当作执行完成。
- 事件：服务端持久化递增 `seq`，客户端记住已接收序号；重连从 lastAckSeq 补事件，重复事件去重。工具结果在手机保留待确认记录，服务器确认前可重发结果，不重做动作。
- 超时和断线：过期请求不首次执行，但仍可查询已有执行记录。已发出的副作用工具超时后先查本地记录与实际设备状态；无法判定时返回 unknown，禁止自动重放。运动指令不因网络恢复重新执行。

示例仅表示字段约定，正式实现需提交匹配的 JSON Schema、错误码和握手/重连样例：

```json
{
  "protocolVersion": 1,
  "type": "tool_request",
  "deviceId": "device-1",
  "deviceSessionId": "connection-2",
  "taskId": "task-10",
  "toolCallId": "call-1",
  "requestId": "request-unique-1",
  "deadline": "2026-10-27T14:00:05+08:00",
  "action": "camera_start_recording",
  "args": { "cameraFacing": "back", "maxDurationMs": 120000 }
}
```

建议首批错误码：`PERMISSION_DENIED`、`CAPABILITY_UNAVAILABLE`、`RESOURCE_BUSY`、`REQUEST_EXPIRED`、`IDEMPOTENCY_CONFLICT`、`DEVICE_OFFLINE`、`STORAGE_FULL`、`MEDIA_NOT_FOUND`、`RESULT_UNKNOWN`。不允许任意手机路径、任意 BLE 原始写入或模型自定义 action。

Pi 使用 `createProvider()` + `openAICompletionsApi()` 注册 NewAPI，再通过 `createModels()/setProvider()` 接线；`Agent` 必须传入 `streamFn: models.streamSimple.bind(models)`。首版显式设置 `toolExecution: "sequential"`，因为默认会并行执行工具。详见 [Pi provider](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md#custom-providers) 与 [Agent 工具执行](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/README.md#tool-execution-flow)。手机资源仲裁和急停仍独立于 SDK 配置。

## 6. 取消、恢复与本地优先级

服务端任务从 queued 进入 running，正常终态为 succeeded / failed / cancelled；手机工具返回 unknown 时，任务进入非终态 reconciling，显示“结果待核实”、暂停后续调度，完成对账后再确认实际终态。模型循环达到时限即停止，待对账记录独立保留，不占用运行中的模型请求。取消请求另设 `cancel_requested` 标记，得到执行端确认后才标记 cancelled；连接是否在线作为独立字段。不把未知执行结果假报为失败，也不自动重新执行；终态不被迟到的 running 事件覆盖。

| 场景 | 约定行为 |
| --- | --- |
| 开始录像工具已成功，Pi 回答结束或达到 90 秒任务上限 | 录像按独立 recordingId 与本地时限运行；对话结束不等于停止录像 |
| 用户取消普通对话 | 取消模型请求、未执行工具和该回答音频；停止正在进行的启动操作并清理临时资源；已开始的独立录像需显式停止，不删除已保存视频 |
| Pi/网络中断 | 停止新增远程动作；录像可继续到本地时限，停止按钮/本地停止命令不依赖网络；重连查任务与录制真实状态 |
| Home、锁屏或系统要求退出 | 首版请求停止录像并等待封装保存后再正常退出；暂停采音、相机与动作。系统强杀无法保证保存，重启检查残留文件并如实反馈 |
| 外部文件选择器/安装器 | 使用外部 Activity lease；进入安装前先完成录像保存。更新后按持久记录恢复任务，不自动重播动作 |
| 结果已执行但确认前崩溃 | 按 requestId 和实际 recordingId/mediaId 对账；无法确认就 unknown，不能承诺执行端到端 exactly-once |
| 取消与成功同时到达 | 以执行端已落库事实为准；已保存文件保留，显示实际结果，取消不把成功倒写成“未执行” |
| 紧急停止运动 | 触屏直接本地执行，绕过模型、网络、工具队列；语音急停单独验收，录像停止与机器人急停明确区分 |

Pi 的 `abort()` 触发取消信号，工具适配器必须响应 signal 并下发对应手机取消/清理；`steer()` 会等待当前工具批次，不能作为急停。[官方取消与 steering 语义](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/README.md#steering-and-follow-up)

LOOI 的手动控制、社交跟随与 Pi 动作共用一个运动仲裁器。BLE 已断开时手机无法保证再发送 STOP；需实测底座自身的超时/断连行为。停止机制未经验证时不开放自动运动，仅安排受控短时测试，不宣称“断连必停”。

## 7. 数据、界面和配置

手机继续使用原 SQLite 作为记忆事实来源，新增媒体索引、录像会话与工具执行日志；服务端保存任务、事件、工具请求与产物元数据。迁移有版本号，覆盖安装保留设置、记忆与媒体；服务器不能另存一套可独立修改的人物事实而不定义同步规则。

中文检索沿用 Pi 方案的至少 80 条记忆要求，新增固定 20 个改写问法及预期记录；建议候选门槛为 Top-5 命中至少 18/20。另测更新后旧事实失效、删除不再命中、重启/升级保留和人物隔离；阈值属于待执行的验收草案。embedding 暂不作为前置依赖。

核心界面：机器人首页展示监听/思考/说话/录像及连接状态；中文对话页支持文字、按键录音与取消；录像库支持查找、播放与删除；任务页展示真实事件/结果；设置页提供服务配对、权限、声音、昵称、更新与脱敏诊断。首版采用按键说话入口，中文昵称自动唤醒在专项通过后开放。无服务时本地录像/播放按钮可用，不以动画伪装任务正在执行。

## 8. 构建与发布约定

- 固定现有锁文件；手机工具链按上游基线准备 Node 22、pnpm 10、JDK 17、SDK/build-tools 36，并在真实构建中记录实际 NDK/Gradle 版本。Pi 服务 Node 不低于 22.19.0。
- 优先使用同一套 Linux/WSL2 构建环境运行现有 bash 脚本；可用性先核验。运行包含自定义原生模块的应用需要自己的原生构建，不能把 Expo Go 当作完整验收环境。[Expo 自定义原生代码](https://docs.expo.dev/workflow/customizing/)
- 保持 `io.github.mypengpengli.myyaya`；生成的 android/ios 工程不提交，改动落在 Expo 配置、插件或本地模块。原生模块增改后重新构建 APK。
- 永久签名只在私有环境保存并备份，代码库不存密钥。首个可持续安装的基线包与后续包使用同一签名。
- 目前上游 versionCode 为 151；自己的后续测试包必须严格递增，并同步 package/app 版本与相关快照。记录提交、versionCode、ABI、APK SHA-256、证书指纹和构建日志。
- 先本地验证更新包和 n→n+1 保留数据，再按 [UPDATES.md](UPDATES.md) 发布 APK 与校验文件。本次未发布 Release。实际小米网络若无法读取 GitHub，再验证已有 HTTPS manifest 备用入口；不把电脑能下载等同于手机可更新。

## 9. 可执行的开工顺序与通过条件

| 顺序 | 工作与证据 | 通过条件 |
| --- | --- | --- |
| 1 | 核验手机与构建环境，建立永久签名基线 | 记录 Android/API/ABI、权限、相机/音频/TTS；Gradle 成功、签名包安装；没有 OpenAI Key、服务离线也能进入本地界面 |
| 2（并行） | Pi 最小服务 + V1 协议假工具 | 固定 SDK 完成两步工具任务、流式事件、取消、超时；同 requestId 重发不重复执行；服务重启后可查状态 |
| 3（尽早） | 共用音频/相机录像原型 | 有声视频可播放；录制时中文停止指令可用；停止后封装完成，资源归还；不依赖 Pi 在线 |
| 4 | 手机媒体与生命周期 | 录制→保存→查找→播放→暂停/继续；权限拒绝、空间不足、文件丢失、Home/锁屏、进程重启有明确结果 |
| 5 | 中文 Pi + ASR/TTS + 本地记忆 | 通过同一工具桥执行上述流程；打断不续播旧回答；中文记忆固定题库与迁移通过 |
| 6（到货后） | LOOI 型号/固件与本地 STOP、受限动作 | 记录官方 App 基线；逐项测连接占用、传感器、断连、超时与急停，再开放对应工具 |
| 7 | 正式发布前更新闭环 | 同签名 n→n+1 手机内下载确认安装，设置、记忆与录像索引保留；核心流程重新通过 |

语音原型至少分别记录安静近场、约 2 米、TTS/视频有声播放三组场景，每组 20 次；保存停止成功率、误触发次数、指令结束到执行的 P50/P95。建议进入日常使用前“停止录像”每组至少 19/20，失败保留本地按钮且原因可查；该样本只作开发门槛，不作为安全保证。昵称唤醒另测昵称/同音别名、误唤醒和远场，不用按键 ASR 成功替代。

仍需后续提供或实测：正式 Pi 部署位置/域名与运维方式、Hermes 实际 API/认证/取消语义、机器人昵称和偏好音色、LOOI 固件和手机 Android 底层版本。这些不阻塞当前协议、构建基线和本地录像原型；服务部署及实际集成时再补相应配置。
