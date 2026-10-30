# 换电脑继续开发

## 最新：2026-10-30，2.1.175

用户明确把Gemini Live / Robotics ER接入放到以后，当前继续手机本地地面、障碍和候选通行区域。175代码及APK已完成：新增DepthProjection共享投影、TerrainAnalysis纯Kotlin分类/时效/包络、TerrainView局部可视化，地图页人工点选并确认实际地面。新地面判断仅在本次会话有效，不改已有地图文件格式，不含电机API。详见[TERRAIN-ANALYSIS](TERRAIN-ANALYSIS.md)。

45项原生测试（新增18）、TypeScript、[最终源码CI](https://github.com/mypengpengli/myyaya/actions/runs/41028519648)通过。最终源码 `3fd8d1aca5ea72d8ccffdfaca2c1440783db7c87`；APK SHA256 `e569bdbdef7eb123a10765d92ca2e94551f6d74b4253e06578810efa9e831670`。原签名覆盖安装及尺寸设置通过，用户确认宽15cm、长10cm、装机总高11cm，已在手机填写，余量5cm。实际半径0.14013879m；数据不硬编码进APK。

手机正在Floor175地图扫描（UUID `d55b0e99-c26a-4837-b56c-35e3c523da9d`，无固定参照图，session `cd546181-45d5-4286-b408-c579228f9028`）。目前约30FPS/热状态0，但后摄仍是鼠标、代金券旁桌面和红色可乐罐，尚未点选地面。已异步询问是否移到真正地板；若用户选择桌面，只能记平面/障碍试验，不能记地板或自主导航验收。

继续先读ADB latest.json与截图，再根据真实画面进行地面点选。新UI右侧：第一行新建/打开/参照图，第二行点选地面/底座尺寸/清除判断，判定图在上方，旧表面地图在下面需滚动。点击“点选地面”后再点左侧画面，SDK必须返回跟踪中的向上水平Plane且在多边形内，才有确认框；无平面时需缓慢扫实际地面。分析要求定位有效，3秒内3个新深度帧及每10cm单元3个分区有地面证据；稀疏数据下绿色为0是正常保守结果。未填完整尺寸也不计算绿色候选。

当前真实地面、可乐罐识别、候选绿色区域尚未通过实物验收；只能说明代码、测试、安装、尺寸和扫描链路通过。暂停/定位丢失/平面丢失/切换Session会清除判断，旧.yayamap不存绿色区域。没有相机到底座外参，也没有自主寻路入口，本轮未驱动底座。不要将当前点选桌面当成真实地面确认。

## 174 阶段记录（历史）

174 已原签名安装。新增“设置参照图 → 用后摄拍摄”，外部相机返回后校正登记；实际图库数量诊断已记录。27 项原生测试、TypeScript、[完整 CI](https://github.com/mypengpengli/myyaya/actions/runs/41017316703) 通过。最终源码 `2dbeae7a796e704df23f53f55ceb71f3491e533f`，APK SHA256 `261508c5ea4bb164e93ca19d708c576c35fe0f5fc0d7ae12dfba72c453a36992`。

已用原地固定的券新拍图片，登记Coupon174（UUID `26e96b4e-cef9-49a5-a073-08da710bf74d`）/ Desk174；首次识别与三次结束进程后的新会话均FULL_TRACKING、known/configured=1、referenceAligned/localized=true。其中第三次是用户左移约20cm后从新位置启动，198体素及原地点恢复。没有独立位置真值，不是精度/整房间验收。新图仍评分0，评分不能作为旧图失败的唯一根因。

当前手机停在Coupon174暂停页，用户已完成平移，已告知无需回到初始位置、可放稳手机，券暂不移动。最终导出 `Coupon174 (1).yayamap`，357710字节、198体素、42轨迹样本、Desk174，CRC32正确；本地证据在忽略的 `.tools/174-*`、`.tools/Coupon174-validated.yayamap`。新版原地图未覆盖：Coupon172（78体素）、RoomTest171（1534体素）保留。另有空的CaptureRecovery174测试图，取消拍摄返回通过；am kill没有实际结束进程，外部相机期间系统回收恢复不可记通过。

本轮未驱动底座。后续先做不同视角的重新定位、参照坐标下补采与地面观测/距离标定，再开发通行判断与规划闭环。不要凭表面点图让底座直接寻路。个人券面图片保存在忽略的 `.tools` 和设备，不进源码/APK/Release。

[174 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.174) 已发布为最新，四个附件远端大小及 SHA256 已验证。手机仍是原签名覆盖安装的174，地图已暂停，用户本轮无需再移动。文档提交不改变构建源码；以后构建继续保持版本/签名与来源清单一致。

## 173 阶段记录（历史）

173 已原签名覆盖安装，27 项原生测试、TypeScript 和[源码 CI](https://github.com/mypengpengli/myyaya/actions/runs/41012546507) 通过。左滑菜单新增房间地图，支持 `myyaya://room-map` 打开独立入口页，不用反复滚动设置；点击“打开房间地图”仍走原有相机/runtime lease。

参照图首次实物识别已取得 FULL_TRACKING，保存旧地图 Coupon172（UUID `b5e31a9c-b78b-4444-bbd5-5f3c3a8c565f`）和 RefDesk172 地点。冷启动后文件恢复通过，但新会话没有检测到目标；173 将 2 Hz 单帧变化查询换成 Session 全部已知图像后，knownReferenceImages 仍为 0，说明本次并非仅漏读状态。不要将这一风险修补写成确定解决了冷启动失败。

用户已被请求保持券固定、四角完整入镜，并缓慢左右平移 3～5cm、稍靠近后稳住。继续时先读最新报告，确认本次 sessionId、knownReferenceImages、FULL_TRACKING、referenceAligned 和 localized；savedReferenceTransform=true 仅表示有已保存关系，不能拿它冒充当前位置有效。需要实际完成至少一次新会话识别/对齐，再扩展不同起点、遮挡、精度与地面观测。当前没有自主行驶入口，本轮未发送电机命令。

最终源码 `ae485554b4fbbec1c0ed185a93c0b012d0ca9bc9`，APK SHA256 `8b2a1ebcf12684108c028e228d786c789025353afd9b7e46950b8a1ce6fdb0d1`，用户参照图未进入源码/APK。旧的 172 首次识别和冷启动失败记录已保存在忽略的 `.tools/reference172-*`，173 结果见 `.tools/reference173-*`，手机最新日志在外部应用目录 navigation-probe。

## 172 阶段记录（历史）

172 已增加实物参照图四角校正和 EXIF 方向：系统选图后进入原生编辑页，拖动 TL/TR/BR/BL 四角、填写宽高，确定性透视校正并预览登记。参数/四角验证 5 项，加此前 20 项共 25 项原生测试通过；[源码 CI](https://github.com/mypengpengli/myyaya/actions/runs/40995147223) 通过，源码 `93ce17f4ad7d1cc5ffaa9c5d766a205d93ecf75a`。

最终包已安装，手机新建 `Coupon172`，用用户相册里的代金券照片完成校正、预览与登记，输入宽15cm、高约27cm。用户把实物放在鼠标旁，必须保持位置不动；当前后摄仅部分看到券，ARCore NOT_SEEN，坐标无效、未写入地图。已请求用户手动将整张券置于后摄画面中并稳住，等待首次识别后再保存/结束进程/重定位。用户照片在忽略目录和手机内，未进入源码或 APK。

继续时先检查手机最新报告 `files/navigation-probe/latest.json` 的 roomMap.referenceTrackingState、referenceTrackingMethod、stableReferenceSamples、referenceAligned、localized。NOT_SEEN 或旧地图能显示都不代表重定位通过。首次识别尚待实物入镜，跨会话定位和精度不得提前标通过；当前没有任何自主导航工具或运动。

## 171 阶段记录（历史）

171 新增 Kotlin 本地房间表面建图、地图/地点文件、固定参照图辅助定位与地图管理页。设置 → 房间地图 → 打开房间地图，原视觉探针入口保留。数据在应用内部 `files/room-maps`，导出为 `.yayamap`，CRC32 与原子替换保护；单个地图有点数/地点数/文件长度上限。具体坐标、原始深度投影和参照图流程见 [ROOM-MAPS](ROOM-MAPS.md)。

20 项原生测试与最终源码完整 CI 通过，171 最终包已覆盖安装。真实平移采集后恢复 1534 个表面体素和 117 个轨迹点，导出地图 26583 字节、CRC32 正确；另一个测试地图中的 Desk171 地点在结束进程后冷启动恢复并成功导出。新 Session 无参照图旧地图位置保持无效，符合预期。最终补丁保留导出会话，避免暂停后旧 UI 回调误显示当前位置，并补自动保存失败提示。当前未接入 RTAB-Map、可通行地图或任何自主运动。

下一项需用户配合：固定照片原图先放到手机相册，测量实物图像宽度，在新地图首次扫描前登记。之后实测识别、保存地图、结束进程再定位、遮挡/失败与相似图片干扰。用户已表示有固定照片，尚未完成此项；不要把已通过的地图恢复当作实物跨会话定位通过。手机 USB offline 曾发生，重新开关 USB 调试并允许后恢复。

手机已安装 Google Play Services for AR 1.57.262640093；170 的 Raw Depth 已有用户平移后输出，平滑深度有可疑大值，171 建图只用 Raw Depth + confidence≥153/255。禁止用“旧地图能显示”代替“跨会话当前位置有效”，也不能因为原始点存在就把未知区域当成可走区域。后续优先继续地图与定位精度验收，然后做安装外参/近场视野、障碍判断与短程控制。

## 169 阶段记录（历史）

169 修补对话流结束与原生请求清理，并补全客户端编号、服务端请求号、响应头 / 首字节时间、接收字节数及结束帧记录。生成工具已返回有效任务回执后，最后一句模型回复失败也会如实说明任务已建立，不自动重发生成。

用户反馈 NewAPI 后台未发现超时。代码核对确认旧错误由手机等待计时器触发，不能据此归因中转或上游；旧请求缺少精确请求号，根因仍未证实。169 没有扩大等待时间，仍为空闲 60 秒、单次请求总计 180 秒。完整结束帧缺末尾换行、CR 行分隔和原生请求未释放等客户端风险已补测和修补，不声称它们就是旧故障的确定原因。

真实手机普通 Pi 回复、按主题找回并固定旧纸飞机、查询既有 2K 小猫任务三项通过，没有新增媒体任务；四次 HTTP 请求均为 200 且解析到完整结束帧，单次约 7.3～31.2 秒。当前未复现旧超时。手机留在旧纸飞机原图的固定展示页。此前纸飞机的 2K 改图仍保持 unknown，未重新生成；新的声学与手机 OTA 验收边界不变。

原签名 APK 已通过 USB 覆盖安装，源码 `6e26d49a4f5c3cad9b61f9540e338dac9b240962`，[完整 CI](https://github.com/mypengpengli/myyaya/actions/runs/40842244796) 通过。APK 173891280 字节，SHA256 `a1b1b7fe5d8da490a1257e8ff2e29ec73547cb22deff01c15beda675cd862357`；签名、16 KB 对齐、ARM64、内置中文模型及凭据排除检查通过。[169 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.169) 已公开设为最新，四个远端附件哈希与本地一致。

后续再出现错误时先导出 chat-http 记录，按同一 requestId 对账，不能只看手机的“超时”文案就归因服务器；不重提 unknown 媒体任务。细节见[连接排查说明](MODEL-CONNECTION-DIAGNOSTICS.md)及[手机验收](PHONE-CHECK-2026-10-29.md)。

## 168 阶段记录（历史）

168 已接通口头指定图片分辨率：生图 / 改图支持 1K、2K、3K、4K，默认仍为 1K，实际传入 size 并随任务持久化。真实手机 Pi 已提交 2K 竖版生图及一张 2K 改图，保存的 PNG 文件头确认均为 1472×2624；这些任务在覆盖安装和重开后仍保留。视频保持 720P。

后续文本模型连续三次回复超时，前两次无新任务，第三次其实已提交选定纸飞机原图的 2K 改图（06142c50-5da3-4c0f-bfe7-233c98048179），只是最后答复超时。十分钟内未取得有效回执，状态为 unknown（结果待核对），未自动重提，尚未取得该指定原图的成品。按主题自动寻找旧图的自然语言验收仍未通过，不能把参数或派单通过当成所有对话流程稳定。3K / 4K 仅协议验证，新的声学和手机 OTA 验收仍待用户方便 / 配置代理。

最终源码 `1350fde7c781cbab6897f4306d743b8592c58716`，[完整 Linux CI](https://github.com/mypengpengli/myyaya/actions/runs/40838273704) 通过；原签名 APK 已通过 ADB 覆盖安装。APK 173886784 字节，SHA256 `1d9c7f728804582e4162d4a33d9ad889d89e6ebdd3a176efa0d599dc38d41023`。签名、16 KB 对齐、ARM64、内置中文模型及凭据排除检查通过。[168 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.168) 已公开并设为最新，四个附件远端大小与 SHA256 均验证一致。

改图现要求显式 parentId，恢复资料包含原始图片描述；早期内部包误用最近图片的情况没有计为指定旧图通过。当前 MCP 可接在服务器 Hermes，手机原生 MCP 客户端未开发；见[MCP 安装](MCP-SETUP.md)、[媒体参数](MEDIA-OPTIONS.md)和[手机验收](PHONE-CHECK-2026-10-29.md)。

## 167 阶段记录（历史）

167 已实现技能学习与自动复用，源码 e6f7406，完整 CI 40832391938 通过。技能存储为独立私有 SQLite，不依赖 Node 或整个 coding-agent；完整 SKILL.md 内容按需进入真实 Pi。入口：左滑菜单 → 小丫的技能；工具：skill_list/read/save/manage。详细限制与扩展见[技能说明](SKILLS.md)。

手机已实际完成流程后保存经验技能 photo-review v1，强制重开 App，单说“照片回顾”自动查当前图片并固定，加载数从 0 变为 1。技能步骤没有写死文件编号。APK 按原签名覆盖安装，SHA256 `9991a6a4401fe5d2f09867294761dc1a6d4972d644187fbab6131cb086d325f4`；最终 UI 去掉重复导航栏并适配横屏菜单空间。通用 MCP 客户端/邮箱授权、技能附件/脚本执行及技能备份同步尚未接入，不能把技能库或 Hermes 派单说成已经完成 MCP。

最终包再次复用和管理页启停/恢复均已通过；测试技能当前启用 v3，恢复的是 v1 的原步骤。一次模型回复超时后重试成功。手机留在技能页，加载数并非执行成功数。下载：[167 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.167)。

## 166 阶段记录（历史）

166 新增媒体比例与图片模型设置，详见[媒体参数](MEDIA-OPTIONS.md)。四种生成路径均将 aspectRatio 持久化并映射到真实请求；模型连接可分别修改对话/图片/视频 ID，旧配置自动补齐，旧任务继续使用原模型。源码 475d53d，CI 40827010589 通过，原签名 APK 已覆盖安装。

手机设置修改/保存/重开/恢复、拒绝不支持的视频比例且不派单、9:16 竖版生图与 16:9 横版改图成品均已通过。9:16 图生视频交付时仍在生成，按[最新验收](PHONE-CHECK-2026-10-29.md)区分提交和完成。首个旧 Base64 生图因十分钟响应不完整保留 unknown；已改为生图/改图共同使用地址回执，不重提旧任务。最终 APK SHA256：`942083950120af958d11a5dd5bb68c96f1861f78b68d50c9461d517f4adb21e3`，下载：[166 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.166)。不要将 ADB 覆盖安装算成手机 OTA 通过。

## 165 阶段记录（历史）

用户已澄清：多个结果连续展示是需要的行为，全部放完才回表情，之后仍可主动调出；右侧小表情保留。165 新增“第 3/5 项 · 10 秒后展示下一项”，最后一项提示“10 秒后返回表情”。固定暂停轮播，视频播放结束后才开始额外十秒；新结果到达会更新本轮可展示总数。

手机已用四张现有图片和一段 5.184 秒视频完整验证 1/5→5/5、第三项固定/取消固定、视频结束后计时、最后自动回表情及重开已有作品。没有调用生成接口。已按原签名覆盖安装，构建源码 acd470a，完整 CI 40814170752 通过；SHA256 `62646dc09e8f245a2480e850f6eb7e9dee2d9898c939a36ddb9b2775651bff2b`。下载：[165 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.165)。最新规则已写入产品需求，不能再把自动连播视为偏离用户原意。手机 OTA 与其他阶段边界沿用既定安排。

## 164 阶段记录（历史）

164 已按原签名覆盖安装，源码 303c151，完整 Linux CI 40805231114 通过。手机已完成三轮连续改图成品检查：蓝杯改红杯→头顶加绿叶→左上角加紫星，每版父图和原图均保留；红杯修改版约 5.18 秒视频已取回，实际播放与暂停通过。

164 对媒体 JSON 做有界读取，收到完整对象即可结束，不等待连接关闭；失败仅记录 HTTP 状态、类型、字节数和请求编号。改图使用官方支持的结果地址格式，先保存小回执，再独立下载。本轮旧 Base64 测试约 8 分钟才收完整，地址模式约 53 秒返回 225 字节回执并成功下载；这是两次实测，不能当作普遍时延保证。旧的 unknown 请求保留原状态，不自动重提。

补测发现并修复：重开时任务未按新到旧排序；AI 两次工具调用之间可能超过 10 秒，导致图片先关闭再固定失败。现在用户指令处理期间持有独立倒计时租约，并可一次打开并固定。手机重开后 AI 找回紫星版并固定、自然指令取消固定后恢复十秒倒计时、自动回表情、一次调用再打开固定均通过。未新增普通文字聊天入口，本轮由受权限保护的 ADB 触发真实手机模型与工具，不能冒充声学验收。

下载：[164 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.164)。APK SHA256：`d24dbba3e710996c437ebbce661422a6a8b1c997444b8a3b6f32922aa5361b8d`。手机在线下载/安装仍按用户安排留待其配置代理后自测。声音、身份识别、声源定位、跟随、房间导航和自动发送的阶段边界不变。详细证据见[手机续测](PHONE-CHECK-2026-10-29.md)。

## 163 阶段记录（历史）

163 已按原签名覆盖安装到小米 12 Pro，构建源码提交 266420c，Linux CI 40797705553 全部通过。APK SHA256 为 f4dc8166183364f2c224672a2582b0d54eac84c4517707c23e74c804b6334647。修复流式 finish_reason 后仍等待 EOF / 原生取消确认、活跃回复被总时长一分钟截断的问题；改图具体尺寸、参考图提示词和 JSON 字段对齐用户 ImageForge，图片等待 10 分钟，结果未确认时不自动重提；视频优先带 video_id + model_name 查询。

已实测：手机生图；图生视频完成并保存，约 5.18 秒视频实际播放，结束后显示倒计时并恢复表情；39.89 秒录像播放/暂停/跳转/重播；Tavily 官方来源搜索→Hermes 中文 DOCX / 两页 PPTX 原文件回传，核对 SHA256、非空正文和来源网址，WPS 实际打开新 Word；重开 / 覆盖升级后仍可查询旧任务、服务器会话，手机模型正确返回原三个文件名，不重新派单。

163 首轮蓝杯改红杯真实成品已显示并保存，原图保留；固定原图时新作品正确入队，不抢占。AI 已实际调回蓝杯原图并固定；手机 AI 连续搜索→Hermes 派单→DOCX/PPTX 原文件接收与校验也通过，WPS 打开新 Word。第二轮“头顶加绿叶”HTTP 200 后响应无法解析，任务 56bb77d1-ef59-42b4-83b5-c86558ec5ca3 保留 unknown，已询问中转记录；不能据此宣布连续改图通过。红杯修改版视频任务 b534c5b7-b22d-4a02-94f5-8402c59ab0a0 已取得服务端任务仍在运行，应只查询、下载，勿重新 POST。

用户已明确：手机 GitHub 下载需要代理，目前下载超时正常，等其配好代理后自行验证。因此只记录“手机发现新版通过”，不宣称应用内下载 / 系统安装通过；当前通过 USB 覆盖安装，Key、任务和作品保留。Azure / 音色、身份识别仍暂缓。不要因重新开工重复要求用户测已确认的短动作。

详细证据见 [续测记录](PHONE-CHECK-2026-10-29.md)。下方为之前阶段记录，以本节为准。


## 最新：161 实测与 162 开发

162 正在构建，161 已用原签名覆盖安装。160–161 已实际完成 WPS Word 编辑另存及 PPT 两页显示（用户确认正常）、AI 拍照确认与重拍（用户确认布局正常）、后台实拍视觉问答，以及约 39.89 秒录像的保存、播放、暂停、跳转和重播。左转、右转、抬头、回正已由用户确认四个动作均实际完成。

连接流程按用户反馈增加：进入页面语音提示长按约 3 秒、90 秒连续搜索、明确“已变黄，开始搜索”按钮、剩余时间与握手状态。手机只能发现广播，不能检测黄灯颜色。161 已实际重新握手，修复联调脚本重复拉起 Activity 造成的连接中断后完成四个动作。162 还让连接面板按实际 BLE 状态显示成功，避免“已停止搜索”和已连接状态矛盾。

任务/作品焦点与图片版本关系已持久化；每轮为手机 Pi 恢复任务结果、文件编号和选中对象。服务器旧 Run / 会话 / 消息查询通过，手机调用 hermes_continue 已实际沿原会话续办并返回旧三份文件名，重开后 hermes_status 和 hermes_history 仍可读取。自然语言查询旧结果本次因模型接口超时尚未通过。媒体生成测试也发生结果未确认，不自动重提，完整多轮改图与图生视频尚未通过。

关键剩余：定位中转模型接口间歇超时，完成手机多轮改图/图生视频、搜索→办公组合、自然语言重启续聊及应用内升级。62 项 Windows 源码/行为检查、TypeScript、3 项 Python 文件桥测试通过；两项 Linux 检查须由 CI 运行。密钥只在手机 SecureStore / 本机凭据管理器，不写源码。

## 159 及之前的阶段记录


更新：2026-10-28。基线 `4140874` 加本地改动的 **2.1.159 正式签名 APK 已构建，并覆盖安装到小米 12 Pro**；公开下载仍是 2.1.152。本轮手机证据与未通过项见 [PHONE-CHECK-2026-10-28.md](PHONE-CHECK-2026-10-28.md)。

用户最新要求先整理再告知后续工作；已写入 [下一轮开发计划](NEXT-DEVELOPMENT-2026-10-28.md)。WPS 已安装，下一轮先测实际打开/编辑，再补媒体版本指代、作品语音控制和任务结果恢复。音色变化、认人/身形身份暂缓，任何人均可唤醒对话，不增加身份门槛。

**最新版本为 2.1.159，已安装。** 本轮已补媒体播放/暂停/跳转、文件导入与预览、Hermes 文件回传和完成汇报。通过服务器 Hermes 部署了 `~/myyaya-server/file_bridge.py`、用户级 `myyaya-files.service` 及 OpenResty `/myyaya/v1/` 精确路径；同源 Bearer 鉴权，原 Runs 接口保留。手机任务页已实际生成三种文档、接收并打开 PDF/DOCX/PPTX；PDF/PPT 两页切换、PDF 缩放、中文文档及导入等待超过 5 秒通过。159 新增系统另存原文件，手机实际导出 DOCX/PPTX 并核对 SHA256 一致；保存/导入流程都必须保留 `withExternalActivityLease`，否则后台 5 秒退出会中断操作。按用户补充，Word/PPT 保留可编辑原文件，用 WPS 等手机应用打开，不自动在服务器转 PDF；自动转换实验从未部署且已撤回，不要再作为必需方案。完整说明见 [TASK-FILES-MEDIA-2026-10-28.md](TASK-FILES-MEDIA-2026-10-28.md)。拍照/环境观察和媒体控制/完成汇报的实际语音验收仍待用户方便。源码未提交/推送，159 未公开 Release。

同日后续：2.1.154 已构建并覆盖安装，增加 Tavily 工具与首次引导/菜单/设置中的独立 Key 配置；手机保存并测试实际返回 5 条来源，重新进入仍显示已保存。修复 BLE 扫描销毁共享客户端的问题，修复后整机重连尚未重测。完整开发缺口和分期见 [FEATURE-COMPLETION-2026-10-28.md](FEATURE-COMPLETION-2026-10-28.md)。用户要求先补开发再集中测试；系统中文声音已接受，Azure 童声最低优先级、现在不接入。源码改动尚未推送，154 尚未发布。

下一次可以直接告诉开发助手：**“先读 docs/CONTINUE-DEVELOPMENT.md 和 docs/PRODUCT-REQUIREMENTS.md，拉取 main 后继续现有实现，先完成 APK 构建和真机闭环，不要重新从方案开始。”**

155 增加 AI `connect_robot` / `robot_action`、拍照确认/重拍与眼睛左移、无照片弹窗的 `observe_scene`；复用社区 BLE 与 Camera2。黄灯后 09:58 握手成功，09:59 又完成握手；控制页前进 0.45 秒，用户确认向前移动并停下，随后也确认自然句子要求后退时实际后退、停下并回答。相机界面仍待实机记录，不能据单次连接宣布长期重连已通过。实现入口与边界见 [ROBOT-CAMERA-2026-10-28.md](ROBOT-CAMERA-2026-10-28.md)。

**最新联调为 2.1.156，已经构建和覆盖安装。** 新增 `viewer_control` 固定/取消固定/关闭/状态查询，复用同一展示状态；显式关闭恢复表情，保留作品与排队结果。TypeScript、54 项 Windows 检查、正式签名、16 KB 对齐、中文模型和凭据扫描通过；手机正常启动，相机/麦克风/附近设备权限仍已允许。用户目前不方便说话，拍照、环境观察与展示控制的语音验收暂缓，不添加文字对话入口。源码尚未提交/推送，156 尚未公开发布。详见 [展示控制](VIEWER-CONTROL-2026-10-28.md)。

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
- 2026-10-28 已在原构建电脑完成 153 原生 release 构建及手机覆盖安装；JDK/SDK/NDK 和缓存仍仅留本机。通过项及未通过项以本轮手机记录为准。
- 本次 ADB 曾识别到 Xiaomi 12 Pro、Android 15/API 35、ARM64，旧包 152 的相机/麦克风/蓝牙权限已允许。兼容目标仍包含 Redmi K50，不绑定型号。
- 首先完成：原生编译 → 开发包安装 → 授权/真实 BLE 连接 → 中文对话与打断 → 有声录像手动停止/保存/回放/恢复对话 → 生图、改图、视频成片落盘。
- PDF/Word/PPT 完整预览、浏览器画面/服务器文件取回、人物身份与跟随、房间导航仍未完成。Azure 童声按用户最新要求列为最低优先级的未来可选项。普通文本展示和本地注视不能冒充上述能力。

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

2026-10-28 已在当前 Windows 构建电脑确认原正式签名可用，密码由 Windows 凭据管理器读取；已用同一签名构建 153 并覆盖 152，保留应用数据。此前“当前电脑未找到”是上一执行环境的记录，已不适用于这台电脑。迁移到其他电脑时仍必须取回同一密钥和原密码，不能换签名或卸载用户现有应用来绕过。

正式构建沿用 `build-hermes-apk.ps1` 不带 `-Development`，要求原有 `MY_LOOI_RELEASE_*` 私有环境变量。Key、Hermes Token、签名和密码只通过安全方式迁移；仓库、交接文档及测试报告都不包含它们。手机上的安全存储也不会随 Git 自动迁移。
