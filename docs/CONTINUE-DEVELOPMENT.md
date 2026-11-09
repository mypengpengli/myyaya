# 换电脑继续开发

## 最新：用户确认185仍未到最低；186原生头部短时速度诊断构建中

用户明确：下降后“仍明显抬着，没有到最低”。不要把185明显下降当作最低，仍禁止直接建立10cm参考面或开始导航履带标定。此后尚未发新的实体动作。

继续在手机官方2.9.2可读DEX中核对到TrackMotionOffer/BaseVisionTrackingAdapter确实发angle_speed，停止发零速度；其FED1编码为两字节[0,int(-speed*127)]。186只在DUMP保护的head_probe新增mode=velocity，up/down候选方向、100～500ms、固定有符号幅值40；语音/普通头部角度控制仍00/87/FF，不新增AI任意字节能力。**方向/效果尚未在本机速度模式验收**。

新增head-pulse原生模块直接复用既有BlePlx连接，只允许FED1，原生Handler负责零速度截止，后台/STOP打断；起始写入若挂起，停止时取消其事务后提交零速度。原生generation防止STOP/后台后迟到的queued pulse开始。停止未确认锁存并拦其他电机写入，显式恢复停止ACK后只读检查可解除；不自动重试运动。蓝牙ACK仍不是机械到位或限位反馈。耦合锁定react-native-ble-plx3.5.1，升级需复核。

186 Android构建中；7项新原生脉冲控制测试+139项导航原生测试通过，新JS行为/TypeScript/导航/相机回归通过，尚未导出安装发布186。JS测试后来仅修改了测试文件，导出前同步镜像并核验源码。下一步安装、请用户手动连接，再先读取状态。速度候选down=0028、up=00D8，零速0000；**只试一次350ms，若方向相反或不明显，先记录结果，不连发、不循环撞限位**。用户一直未用手触碰脖子，不需要再问“手已松开”。

以下185验收段保留历史，最低位置已经被本段纠正。

## 最新：185头部明显下降已获用户确认，停稳76秒无额外头部写入；最低位置尚待确认

用户已手动连接并确认底座静止。只读`bd3cc61864b74e539689f6bbb5a22d6a`：电量FED8=4600（首字节70）、信息2A27=01020C、2A28=000003、FED1=00。不要擅自格式化信息字节为固件版本字符串。

已先发head_probe down/response=true（`2b941cf9ffb84034936d2278f4c28e63`）：手机倾角峰值2.232°，用户仍看不出下降。用户明确要求“再执行多一些”。已先说明绝对目标FF不能累加，然后只发一次三步对照：回中87（`ff2c1c497e6d4823a6a5e445c10f7e41`）→抬头00（`b3f9134ac8be46aabd41e790f4ff36a3`）→低头FF（`e8f8d413ecf24a8ba80e93ea902fa612`），均with-response，每步停稳再继续。用户明确“看到了明显下降了”。这是本轮物理低头通过，**不要误写成电机从未动过，也不要因为成功就认定写入方式为原因**。

随后两次只读`8ae6cf3169cf4c5d956e8d26e9c3c79d`、`ab95d2b2a43d4258876ef530eebfce00`：最后低头倾角峰值5.166°/末态5.146°，两个稳定快照相隔76.10秒，倾角差0.0438°；没有额外头部写入，FED1仍FF，无头部通知。仅证明手机倾角稳定，不证明机械编码器或最低高度。汇总`.tools/185-head-trial-summary.json`。全程无履带命令，无angle_speed帧。

已异步询问：当前是否接近之前手动压到的最低、并保持，或仍明显抬着/不确定。收到前不把“下降了”当作“已最低”，不重建10cm参考面、不发导航履带动作。当前控制页hold持续，头保持最后低头目标；用户不必把手放上去或松手（他明确一直没碰）。下一步确认最低后再恢复原先导航位姿标定，先检查后摄视野/实际地面，必要时核对镜头高度，不重复要求用户量细小角度。

以下185安装等待段为此前过程。

## 最新：185已安装/CI通过，等待用户手动连接后读取电量与固件

185已完成第二次增量构建，包含FED8/2A27/2A28只读。源码`e89dcf3db03ccfd94206a7aec31e8c540e5a2302`已推送，139原生测试、新head行为/导航/相机回归、TypeScript和[完整CI42570713849](https://github.com/mypengpengli/myyaya/actions/runs/42570713849)成功。原签名APK174496130字节，SHA256 `77d4cbb6a1d463f1785845871a9ee3db8c9f60035587c009332d58e4dc85be9e`，快照`905caeec0fa13450fbb8dddcb15224c353f0276a6870a5253587ac6e74e71b12`；签名/对齐/中文模型/密钥排除通过。已install -r覆盖且手机base.apk摘要一致，保留设置，未发布185。

安装后手机仍解锁，已进入myyaya://robot。只读请求`2f940d0dd3564b2ba262ee9ec3604291`返回connected=false，重力模块正常，尚未读取电量/固件。已异步请用户手动连接并保持当前脖子位置；未自行反复重连，未发185实体动作。连接后先robot_head_status读电量/FED1/信息，安排相反端点的单次明显目标动作并说明预期，必要时用ADB-only head_probe对照response=true/false，不改变常用默认。

`.tools/phone-command.py`现支持head_probe up/down/center --args中response布尔值；原生DUMP保护和15秒过期仍生效。不要在用户连接前排队动作，不要发angle_speed速度帧。`.tools/185-power-setting.json`已经恢复原USB亮屏设置，restored=true；控制页自身聚焦保持亮屏仍有效。以下为本次开发过程。

用户确认184单次抬头变化太小不能辨认，不要叫用户量角度。184 head_up编号e9ea8d928cda4edf85e3b0f6fdba9b7c，峰值1.8645°、末态1.7160°；随后52f51cec1f4d438d9ee2bf2f073d3c10读FED1=00，之前FF。回读随命令改变但无位置证明。本轮未发低头、回正或履带。头部物理位置不明，最后命令up00；底座仍静止。

已私下读取手机官方LOOI 2.9.2 APK并检查TangibleBody：角度公式(1-angle)*255一致；另有FED1两字节angle_speed模式，尚未发送。官方BluetoothChannel未显式设置writeType；查AOSP确认支持NO_RESPONSE的特征默认可能就是无响应，不能宣称官方默认有响应或写入模式就是原因。FED9该客户端02是evade、0E是TOF，没有看到头部角度字段。详见[头部核查](LOOI-HEAD-FEEDBACK-RESEARCH.md)。第三方APK/代码只在忽略的.tools内。

185保留生产默认参数，新增ADB-only head_probe，up/down/center白名单+response布尔值，经原有控制器/STOP/导航租约；带15秒队列过期。head记录实际with/without response；手机观测保留前后向量。head_status补只读FED8/2A27/2A28数据，均原始字节，不编造机械位置。新行为/导航/相机回归与TypeScript正在复核，Android第二次增量构建包含新增设备信息读取（不要误导出第一次较早的185构建）。尚未导出、安装或发布185。

安装期间曾临时USB保持亮屏0改2，现已恢复，详情见最新状态。新版安装若断蓝牙直接请用户手动连接，不自动反复尝试。下一次动作先告知起始状态和目标，只单次明显头部对照，履带不动；不要连发微动作让用户猜。

以下184段为此前结果。

## 最新开发：184本机FED1只读与手机倾角已通过，等待单次抬头起始状态确认

用户已解锁并手动连接。robot_head_status 两次成功（`820636466c2541eab7f45f4abcc2bf45`、`9ac7f4398e7a47a4a7cd505f22e07a03`）：FED1 read/writeWithResponse/writeWithoutResponse/notify 均 true，indicate=false；回读均FF，无FED1通知记录；重力模块可用/active、accuracy3且稳定，向量约[8.8775,.4616,4.1410]。原始FF不代表机械最低。未发头部/履带指令。已异步询问当前最低/稍抬/较高且手松开；待确认后只发一次head_up，期望明显抬高而底座不行驶，再立即只读对比FED1和lastCommandObservation，并让用户确认实际效果。严禁确认前连发上下或测试履带。控制页聚焦keep-awake已经正常显示。

下面安装时的“等待解锁”等为过程记录，已被以上最新状态取代。

184 加入独立 robot-observation 重力模块，控制页参考倾角、聚焦保持亮屏，robot_head_status 只读 FED1 属性/回读/通知及最近观测。头部命令前后观察手机倾角，所有结果机械位置仍 unknown，未修改00/87/FF参数。联调请求15秒过期，STOP可阻止准备期后的头部写入。新行为测试（含回读超时/不写电机/倾角返回）和导航STOP准备期取消、TypeScript、139项原生测试通过。源码`e3021b2cd994a5eb7820f7b7e62ef44f7488a958`已推送，[完整Linux CI42552212733](https://github.com/mypengpengli/myyaya/actions/runs/42552212733)成功，含本机缺zip的122测试。

原签名包`mobile/output/android/myyaya-2.1.184-arm64.apk`，174493214字节，SHA256 `48daf18f8be4064a53a21cd9add473fcac572bf351d7bb15a5fde37c75497d80`，快照`3818dfa18112f3e7fe2126b0b436ec7bf96b0b666c746871651f38cdf0f181ae`。APK完整性、签名、16KB对齐、中文模型、密钥排除通过。已install -r保留数据覆盖，手机base.apk摘要一致；安装后showing=true、mScreenOn=false，异步请用户解锁并手动连接底座。尚未读取本机FED1/手机倾角，也没有184实体动作结果，未发布184。解锁后先进入myyaya://robot，只读调用robot_head_status；不要直接发送实体动作。

本机全量JS矩阵在旧Linux依赖测试处遇到环境差异；已通过Git Bash跑过120，其他已运行项目通过，122在完整Linux CI通过。临时USB保持亮屏已恢复；184控制页keep-awake仅在页面聚焦期间生效，不修改全局设置。以下183段落为此前证据。

## 最新：183头部上抬通过，低头未动，已查询社区反馈方案

用户确认 head_up 明显抬高、底座静止。第一次 head_down 在锁屏断连时没有执行，待处理项已用只读状态替换。重新确认“稍微抬起，手已松开”后，第二次 head_down（`3e4ff6075a3f4d1b8532a3ed9dd8bf4e`）虽返回指令结束，用户明确“没动”；**低头没有通过，不要声称已最低**。所有后续实体动作暂停，先核查位置反馈与协议。

用户要求再次上网查。已读 ulooi 原始探测实录：FED1 在作者设备标有读/写/通知能力，FF 曾低头后自动回中；读能力不能证明实际位置反馈，也不能解释本机本次没动。andrey-tut 明确无已确认头部位置反馈，FED9 02/0E 不能当精确头部角度；razor79/my-looi SDK 仍是00/87/FF，未实现回读。本机 head 分支没有直接自动回中；本次只读 phone_status 确认 connected=true，但尚未取到本机 FED1 属性/回读数据。详见 [头部核查](LOOI-HEAD-FEEDBACK-RESEARCH.md)。下一步先暴露只读 GATT/验证回读语义，再用手机相对倾角辅助观测，修正“执行结束”暗示机械到位。不是已开发完毕。

`.tools/183-debug-awake.json` 记录的本轮临时 USB 保持亮屏设置已恢复原值，restored=true。此轮未再发任何头部/履带动作。

以下为此前过程记录，涉及“等待抬头”等状态已经被以上最新状态取代。

## 此前：183已安装；单独头部大幅测试进行中

用户要求以后每轮先说明起始状态/动作方向/幅度，并由其确认实际状态；细小动作不易察觉，移动需要更明显，头部升降要单独大幅测试。用户刚确认“底座静止，头稍抬起，手已松开”。已切到`myyaya://robot`（普通自主/注视动作在此页被周期hold），通过`.tools/head183-action.py up`只发一次`robot_action:head_up`，返回connected=true/指令结束，**尚待用户确认是否实际明显抬高**。异步问题已经发出：明显抬高且底座静止/没有明显变化/反向或底座动了。没有发低头，没有再发车轮动作。确认高位后再单独head_down并观察最低位置是否保持；不要自行连发上下。

本轮182在真实地面先完成7.0/5.0厘米保存与重开验证，新建Floor182的独立设置实例也读回+.07/+.05。用户移罐到侧边、手动压头到底后重新10厘米设面/固定，执行过**一次back200ms**。用户确认挪动并停下、脖子没变；软件以PRECONDITION_CHANGED拒绝（samples5、旧失败记录位移写0）。原始位姿Y/相对参考面高度约跳5.44cm，不能当成机械脖子变动或没移动。`.tools/182-pulse-back-093104*`、`182-post-failure*`和12016610字节`.tools/182-calibration-motion.mp4`已保存。记录源手机文件dataset-ca036baf-27eb-4599-a649-2034cfb3717a.mp4。

发现并修复跨帧缓存裸AR世界origin的问题：183为无参照新地图使用逐帧更新的会话原点Anchor，人工平面共用地图锚点，缓存origin不再用于定位；加入高度/倾斜差诊断、具体失败原因、失败保留位移和轨迹。阈值仍2.5cm/.12rad。来源见[修订记录](ARCORE-ANCHOR-FRAME-FIX.md)，这是已确认代码问题，但尚未证明是本次全部误差来源。

183源码`ddfaee54f796dc997b9f8daea38582db7a364672`，139原生测试/tsc/导航行为/CI42547315134成功。原签名APK174469274字节，SHA256 `5478ccc4eb64abcb0d9e038cb091c930984dc4bd369abd3fa42dd873653fba7f`，快照`f5832fa2053c7fb380283b0999a2289f9201b8a0fc92a1975faf9d685a6976ff`。已覆盖安装/手机摘要一致，并从DEX确认包含新锚点/诊断字段。133是182测试数，不要混用。182/183均尚未发布Release，公开预览181，稳定177。

183用刚才动作录像完成90秒无电机回放：247完整快照严格确认datasetPlayback=true/routeControlAvailable=false/autonomousMotionEnabled=false；164原生日志、155锚点TRACKING报告。高度范围0.09536～0.16264米，波动6.73cm，**启动阶段定位仍有明显波动，不能宣布VIO已修好**。`.tools/183-anchor-{samples,native}.ndjson`和183-anchor-summary.json。此前临时USB保持亮屏的设置已恢复（.tools/183-power-setting.json restored=true）。退出两层回放到Robot页后用户已手动重新连接，驱动就绪。

下一步按用户反馈分步完成头部高位/最低测试，核对用户手压最低后为什么会稍回升（可能仍在保持以前的伺服目标，未证实）。如果head_down确实到最低且保持，可用该目标进入导航，而不是反复手压。头部测试结束后再进入RN房间地图的“打开教路线与复走”MainActivity内Dialog，新建Floor183，等待实时锚点下位置稳定，按最低实测高度10cm重建参考面，固定当前姿态，复测单次车轮短动作。不要在普通无电机Activity里调BLE；不要把原来录像的初始参考面当成当前实物参考。

所有后续运动都要先清楚告诉用户起始状态/方向/幅度，等待其现场确认；不要趁其可能手按脖子时发动作。移动可以按短段停止后逐次增大以便看清，但没有标定前不宣称毫秒等于厘米，不循环盲走。用户原始摆放：地板、手机装稳、四周约30cm空位、罐子已侧移、USB留余量。必要时直接请用户手动连底座，不反复代理重试。

## 当前：182安装完成，手机锁屏待解锁，7/5偏移尚未填入

用户已答复：主镜头到底座中心向后摄画面右侧7厘米、沿观察方向向前5厘米（米制+.07/+.05），最低头部。已摆在地板，四周约30cm留空、罐子移旁、USB留余量，同意短动作标定；安装前要求先别连BLE。182安装后系统锁屏，已异步请求解锁，当前`showing=true`，**未填手机偏移，未执行任何实际短动作，尚未请用户连接BLE**。

182源码`2ea7579b24177eef7de08e480b963e779cf12ea4`；133原生测试/tsc/导航行为/CI42543296246通过。原签名APK174469250字节，SHA256 `fd61f341360734203615379869c14b5d944b7c9487bb201a132691c706ee0f56`，快照`e01b6270fcdb653f37be30d0d903d7c8adc08d72f3d47e934084bf4704fe28dc`。已保留数据覆盖安装，手机base.apk摘要一致。包在`mobile/output/android/myyaya-2.1.182-arm64.apk`；未发布182，公开预览仍181、稳定177。

新增NavigationMountSettings共享持久参数；所有地图和教路线共用，默认未配置，不把用户硬件值打包成公共默认。RouteMount从相机到车身中心随yaw旋转，新增实测7/5和原地转向相机圆弧的回归。旧路线不覆盖当前实测安装。TerrainView分开蓝镜头和白车身圆。

PulseMeasurementTrial纯Kotlin记录一次原有back200ms/left/right120ms动作，回执后等400ms并收集跨250ms的稳定新位姿；姿态变化/间隔>400ms/失联/跳变拒绝。TaughtRoutePanel新增单轮空地确认入口：实际地面+固定头部+安装已测+连接，不能覆盖已观测障碍；允许在Raw未知时使用用户确认的30cm空地做一次标定，不生成地图自由区或自主许可。高度人工参考现在只需有效VIO、不需Raw初始化；深度拟合/点选仍需Raw。未验收完整停车边界，回执后余移不能称物理停止距离。

解锁后运行`.tools/fill182-mount.py`：从myyaya://room-map打开无电机地图，点“安装偏移”填7.0/5.0保存重开验证。这个脚本目前首次填写假设空字段；若部分成功后重跑，先清空对应字段，避免追加。需要再退出原生地图回主界面后请用户手动连接，别先连接再打开无电机Activity导致再次断开。

然后从RN房间地图页点“打开教路线与复走”（MainActivity内Dialog，复用BLE），新建真实地面地图、开始扫描。长按点选平面填镜头高度10.0/实际地面，不必再盲扫；“教路线与复走·操作”里固定最低导航姿态选“保持当前位置”。定位/头部固定、连接/实测安装有效后，点一次短动作校验并核对采集报告。用户已经确认本轮空地和允许短动作，可以代点该单次确认；回放/台面不能驱动。不要给center或自动抬头。需保存原生latest.json/log里的taughtRoute.lastPulseMeasurement；最新结果也保存在本机navigation-pulse-measurements SharedPreferences。

`.tools/182-mount-audit.py`对74份同记录实际Kotlin离线把中心改为+.07/+.05：32缺观测/3障碍/2落差/37缺新鲜Raw，起步缺115～121格；仅离线几何，不是真机动作。细节[本轮实测](PHONE-CHECK-2026-11-09.md)和[标定说明](MOUNT-AND-PULSE-CALIBRATION.md)。

## 当前：181分层地图/矩形扫掠/局部规划预览已安装验证

2026-11-09继续。源码`097d2adb31538ef1fa9e389bce7241854ff21521`，127原生测试、tsc/导航行为及CI42540379323通过。手机ADB仍a788eea，100%电量/USB/24.2°C起始。181原签名保留设置覆盖，手机base.apk摘要与APK一致：174452838字节，SHA256 `d303355d97d182aaa3499b4c04d7ae3dfeceb8a4e9ffb637b0cafb885f884e24`，源快照`e9a34b5c6f0df2fc03cf71176b57c08e42afff792c11113717ceb21f5bf2ad48`。

新增纯Kotlin LocalNavigationMap / LocalTrajectory / LocalPlanner，以及原生LocalNavigationView。5cm逻辑格分4个2.5cm支持小格，两个不同Raw建支持，静态支持不随3秒忘记；2秒近期空地与保留地面分离，旧障碍不超时变空地，实际高度射线3帧清障。带朝向矩形连续采样+误差扩张，包含停车延伸。A*最多400状态、每边扫掠，返回已知路线或可达已知空地边界；独立线程丢弃过时结果。只做诊断预览，没有接到BLE，不把任意毫秒标成厘米。

74份实际Kotlin离线重算，保留地面峰值485/近期333小格，2cm检查36未知/1障碍/37缺新鲜Raw；36份未知均含起步足迹116～121格缺口。当前直接阻点包含近处盲区/未标定中心，不能再只说覆盖候选0。没有种入未知起步区，没有降低原5cm余量。

手机最终90秒回放：203个完整快照明确无电机能力，原生日志166行（不含常量能力字段，不能用缺失字段判断无电机）；88行有实际点选目标，已拍紫色目标和中文UNOBSERVED_SWEEP等待，后续Raw旧则FRESH_RAW_REQUIRED。峰值地面保留530/近期空地381；新Raw更新时FPS中位28.60，融合77报告，旧诊断最高9地面/0覆盖。38行CAMERA_HEIGHT_INVALID仍需实物固定姿态/高度参考核对，不能当成精度已解决。`.tools/181-phone-goal-{log,samples}.ndjson`、`181-phone-goal-summary.json`、phone/nav181-goal-evidence.png/json保留本机。

动态页面uiautomator不能idle时不要复用旧XML；本轮用新截图和停止滚动后的点击完成目标验收。录制播完须重新“选择录制回放”，只点“开始扫描”会立即结束。已退出两层原生回放并回主页面，离线中文唤醒监听恢复，系统相机Active Clients为空。无履带/头部动作，没有自动连接BLE。

接下来仍需P3水平安装偏移、脉冲位移/转角与停车延伸标定，以及明确人工起步区和逐段执行/无进展退出。已向用户异步询问后摄主镜头到底座中心的左右/前后偏移，尚待答复。不要猜0就是已校准；需要底座时直接让用户手动连接。脖子保持手调最下，不发center。实现说明[LOCAL-NAVIGATION-LAYERS](LOCAL-NAVIGATION-LAYERS.md)，本轮[实测记录](PHONE-CHECK-2026-11-09.md)，稳定latest177。

## 当前：180已安装并通过感知回放，下一步P1

用户充电后接回手机，要求需要底座时由用户手动连接；本轮没有人工触发底座连接或动作。初始68%电量、USB充电、28.4°C；安装后用户已配合解锁。180源码`c38aac963a447eeac195e6874085855c1b5331f3`，112项原生测试、tsc/导航行为及CI42151651339成功。

新增DepthTimeAlignment：Raw不允许未来/年龄>250ms，完整深度领先最多5ms、两路时间差≤250ms；不改写时间戳，保留数值一致性、锚点和空间邻近/障碍排除。RoutePerception.assess新增六区最低地面取样及1cm空间去重，高处或区外点不再CLEAR；普通地图和回放也报告localObservation，UI把“候选”改为“整车覆盖中心”并给出车前缺观测/障碍状态。六区只是人工已教平整走廊最低取样，不是完整轨迹/转向扫掠证明，不能宣布P1/P2完成。

同74份已保存双深度以180真实Kotlin复算：53帧融合/9锚点不足/12不一致、累计补点14691、地面峰值10/覆盖中心0；原39 OBSTACLE+35 CLEAR变为39 OBSTACLE+35 UNKNOWN，旧局部无观测CLEAR修复。`.tools/180-candidate-audit`有数据。

APK174436434字节，SHA256 `a7f0acd6b73f8e5d40dae29ce2e6ccb325dfcb31f87de0c5f7831d9971fb3fbd`，源快照`84998e1e424623c5e329b11d9c89e8a021509d7d4dbde8695ef862e93b89ba02`。正式签名/16KB/ARM64/中文模型/凭据排除通过，已保留数据覆盖且手机base.apk摘要一致。

180手机用dataset-9a9e1473-d2f7-4d21-a665-c00904e1907c.mp4无电机回放90秒结束；192采样报告全部无电机，106报告融合、114报告有界领先（非独立帧计数），采样补点最高1199，接受领先最大2.075693ms。车前175 UNKNOWN/17 OBSTACLE，无CLEAR。原生日志地面峰值9、覆盖中心0，不与桌面10格混为同一轨迹。`.tools/180-phone-replay.ndjson`、`180-phone-logFile.ndjson`、`180-phone-replay-summary.json`和截图nav180-replay-evidence.png保留本机。退出后无活动相机客户端，手机表情“休息中”，保留用户休眠设置，未做声学验收。更多见[180实测](PHONE-CHECK-2026-11-06-P0.md)。

下一步按[增量方案](INCREMENTAL-NAVIGATION-PLAN.md)做P1分层地图和实际矩形/轨迹扫掠，再P2可达边界/小步规划；不要把本次Unknown多或覆盖中心0当作原地无法迈小步的充分原因，也不要放松阈值盲走。实物需要时再请用户手动连底座，脖子保持手调最下，不发center。稳定latest仍177。

## 最新任务：查明候选0，改为分步探索/局部绕障

用户正在给手机充电，要求先离线查清候选0，并参考扫地机器人边探索边走/靠近后绕行制定方案；质疑是否必须有候选。**无需再让用户平移或操作手机，本轮未碰ADB。** 蓝牙以后直接让用户手动连接，最低脖子保持用户手调位置，不发center。

已完成[原因审计](NAVIGATION-CANDIDATE-AUDIT-2026-11-06.md)和[选定方案](INCREMENTAL-NAVIGATION-PLAN.md)，新增`mobile/scripts/navigation`复现工具。用D:/mya中179实际Kotlin类（关键源码与工作区逐字节相同）读74份已保存双深度，投影199662点，最高11格地面且4连通，候选0，最佳3×3为8地面+1障碍；阻挡格(0,-6)在0.266秒前有一个离地8.8cm点，未确证RGB罐子关联。永不过期地面并集14格仍最多8/9，不是只改TTL即可。

74/74完整深度时间戳比Frame晚1.337～2.055ms（中位1.670），HybridDepth原门槛全部RAW_ONLY_STALE_PAIR。隔离的5ms融合检查时刻对照：53帧补全、9锚点不足、12跨路不一致，补点累计14691，但地面峰值10、候选仍0。此对照没有改原记录、地面时间戳、APK或生产阈值，不能直接当修复上线。`.tools/candidate-audit`与`candidate-audit-slack5`有全部结果。

候选是诊断，不是实际教路线复走的许可门槛；当前也没有自主探索、局部绕障及物体到目标点的接口，因此不能再只用“候选0”解释不能到罐子后面。规划取分层静态地面/动态占据/观测覆盖、带朝向矩形扫掠、短动作闭环和可达边界；Nav2 RPP、Costmap/Obstacle Layer、Explore Lite FrontierSearch、TangentBug原作者资料已查。复算RoutePerception 39 OBSTACLE/35 CLEAR，其中一帧局部扫掠低高度带0点仍CLEAR，P0必须修局部覆盖，不能直接绕开严格诊断盲走。矩形几何反事实在相同5cm余量下有静止摆放解，2cm扫掠无解；缩余量3cm有局部几何解，但未标定不能用，也不证明从当前车位可达。

本轮交付研究/诊断，不生成新APK。后续按P0时间域/局部覆盖与状态分离→P1分层局部地图及扫掠→P2局部规划/边界子目标→充电后实车脉冲/停车标定→语义目标推进。不要为制造绿色候选直接放松原地面门槛。179仍为已安装预览，稳定latest177。

## 当前：179已安装，最低脖子姿态与真实地面回放

最新用户要求：**以后蓝牙直接让用户手动连接，不要反复自动重试，用户认为太慢。** 用户已手动连接成功。最低脖子位置也由用户手调并确认；不要再发center/回正命令。178曾执行一次center导致抬起，179已修为默认保持当前位置，不写头部指令；可选head_down才写ff。新增NavigationPoseLock稳定及估计相机高度/倾斜变化失效检查，定位漂移或手托整机变化也可能触发，不可直接归因机械动作。

179源码`531c7e6441143bf17fb1785ac35986f5e4c6bf06`，101原生测试、行为测试/tsc和完整CI42139632138通过。APK174436406字节，SHA256 `4e7c10819fac74c9cfad7eab10371a2509a414d755839ade33c6660da8aec11a`，源快照`687c0dd19bfe3ddd3156a5366e4f389e41fc73f8427f60b06686e94628810ec2`。原签名、中文模型、凭据排除通过，已覆盖安装且手机摘要一致。179已发布prerelease（Release id435947869），四附件摘要核对通过；latest保持177。

手机Floor179B真实地面，用户完成平移，已确认最低镜头高仍约10cm。第一次等待回复时过早暂停采集导致用户反馈画面不动；重开后确认帧数/时间戳增长，这次直到用户回复“好了”都保持相机运行。第二份90秒录制含有效移动段，raw峰值8167、回复时实时3014且新鲜。已设MEASURED_HEIGHT实际地面，但之后停稳深度变旧，分类尚未完成；不再要求用户重复盲扫，正在用第二份MP4独立回放。

`.tools/179-floor-native.ndjson`为原会话日志，`.tools/179-floor-repeat-current.json`有实时3014点，`.tools/179-floor-reference.json`有10cm参考面；`.tools/179-floor-repeat-dataset.mp4`为10,503,771字节原片，手机文件名dataset-9a9e1473-d2f7-4d21-a665-c00904e1907c.mp4。该回放独立Activity没有电机，进入后按生命周期释放蓝牙，后续真要动作再让用户手动连接。尚未发履带命令，地面障碍、停车距离和复走闭环未验收；最低姿态改变后需重新确认锁定及方向。更多见[当日实测](PHONE-CHECK-2026-11-06.md)。

最新停点：同片两轮回放已结束，`.tools/179-floor-replay-first.ndjson`与`.tools/179-floor-replay.ndjson`分别地面峰值12/10、障碍49/51、落差19/14，候选始终0；峰值不同帧。截图`.tools/phone/nav179-replay-ground-2.png`红点主要在上方家具，不能声称可乐罐逐点验收已过。优先修RoutePerception局部扫掠区观测覆盖（现在全局32点+人工走廊先验，区外/高处点可能导致无局部证据仍CLEAR），配合本批深度回放验证，不靠放松地面网格阈值制造绿格。`.tools/179-floor-depth-replay.ndjson`已拉取5,761,955字节，后续不要再让用户重复盲扫。

手机1%电量、USB充电、32.9°C，已退出回放和路线页、关闭相机并熄屏，相机无活动客户端。本轮无履带动作，后续充电后再做实物方向/停车/复走验收，连接直接让用户手动完成。此后没有重新构建APK；179仍531c7e6及其已验证附件。

## 2026-11-06：178手机联调已推进到真实地面

178已通过保留数据覆盖安装，手机APK SHA256与发布包一致。MainActivity内Dialog、红色停止按钮、实际相机/IMU MP4录制、独立无电机回放结束自动暂停（694帧）、二次回放中途退出、退出后相机释放及普通中文监听恢复均通过。约24秒录制已保留本机，可用于后续诊断，不要再将178写成“尚未安装”。完整[当日记录](PHONE-CHECK-2026-11-06.md)。发布APK仍原81cae42构建，未改业务或重建。

手机原先robotSleeping为true，已点醒；不要把休眠时普通语音off误记成路线退出缺陷。动态表情使uiautomator有时无法idle，本地`.tools/phone-ui.py`已用唯一XML路径避免读旧文件；读取失败请看当次截图。

当前用户已将装机LOOI放到桌下地板，前面放可乐罐。新地图Floor178Nov06的后摄确认为真实地板，尺寸仍15×10×11cm，未设实际地面和安装偏移。路线菜单“连接保存的底座”出现4.5秒回执超时；已请用户长按到黄灯，等待回复，尚未执行头部或履带动作。下一步连接→固定头部→记录一次真实地面扫描→选实际地面→检查障碍与短动作方向，满足条件后才人工教短路线并复走。尚未完成实车闭环，178继续prerelease，latest仍177。下文11月5日未安装状态为历史记录。

## 2.1.178预览版：教路线与复走，等待手机重连

用户已授权按简化方案动手，并要求研究扫地机器人。新增[路线说明](TAUGHT-ROUTES.md)：Nav2分层思路、OpenBot手机/车体分工、Valetudo边界；没有把ROS2或OpenBot整套代码塞进APK，也未验证LOOI轮编码器。采用已教平整走廊先验+实时原始深度障碍停车，不再以实时完整绿格作为路线控制前提。普通地形诊断阈值保留。

新增TaughtRoute/RouteTeacher/RouteFollower/Codec、RoutePerception、TaughtRoutePanel与RouteMotorGateway。重构原NavigationProbeActivity：共享渲染/相机逻辑在NavigationProbeScreen，独立Activity仍无motor；路线用宿主MainActivity内Dialog保持AppState active，复用既有BLE，暂停普通语音/表情动作，启用单独中文停止监听。导航独占令牌阻止普通动作抢占，STOP仍可用。Native动作有序号/回执，JS优先STOP并等待STOP完成后才发新动作。

路线需固定安装、实际地面、后退/左转短动作校验，从起点8cm内及原朝向开始；每次90～180ms动作，偏离中心线8cm、定位跳变/丢失、断连/后台/姿态改变停车。深度短暂变旧等待新观测；障碍需手动继续。无参照图只可同Session，跨重启需同地图+参照图坐标指纹。社区SDK固定动作码，不假装具备可调连续车速。

相机与IMU采用官方ARCore Recording/Playback，每份90秒/约100MB、保留3份；回放独立无电机。模型工具list_taught_routes/open_taught_route仅查真实路线、打开所属地图流程，首次仍需手机校验与启动。相机和普通语音由route-robot-session统一持有并释放，停止词不经过网络模型。

96原生测试、navigation-robot与route-session行为测试、tsc已通过；主体源码6109d2f完整Linux CI成功，最终源码81cae42的[CI](https://github.com/mypengpengli/myyaya/actions/runs/42005572673)见链接。Windows旧测试v2.1.122固定调用python3缺命令，Linux已验证，不要为此改无关业务。最终`.tools/build178-final.py`成功；导出脚本`.tools/export-task178-apk.py`已执行，源码无未提交mobile变动。

最终178源码`81cae42fb10db62fe6df72467a1262c074fce90f`，APK174420002字节，SHA256 `c211d656dc164678f272d433c0441ff0b5ca311189a1b3b4a74d1046ec1b1b6f`，源快照`0d68c8fa0168942a21abd99916d79ad19975d3a960998f737ac6ef59d6abb714`。原签名/16KB/ARM64/中文模型/独立JS/凭据排除通过。安装时ADB设备消失，尚未安装178；已询问用户重接USB并解锁，不能记为真机通过。178作为预览版，latest保持177。

[178 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.178)已公开为prerelease，Release id435018618，四附件大小和GitHub SHA256摘要逐一核对通过；最终源码81cae42完整CI成功。latest已再次确认仍为v2.1.177，不要将178预览版改为稳定版，除非后续完成相应真机验收。

恢复手机后先用安装助手覆盖（不要卸载）并核对base.apk摘要，进入“教路线与复走”检查主Activity/Dialog、BLE所有权和停止按钮；先做静止相机/IMU录制及独立无电机回放，不能把已有NDJSON回放当作这项验收。本轮未发送履带或头部动作；实际地面、装稳/USB余量安排前不要在桌上点击方向校验或复走。真实地面闭环、停车距离、障碍实物对应尚未验收。新头部姿态需重新固定和方向校验。

## 最新：2026-11-05，2.1.177已发布

最终构建源码 `1bcfad60268b9cda01523f381b6b080064df845a`，84项原生测试与[CI](https://github.com/mypengpengli/myyaya/actions/runs/41986082518)成功。APK `mobile/output/android/myyaya-2.1.177-arm64.apk`，174361650字节，SHA256 `eb1c144ac192354c1fbbfd00a054127fe7d29ef8e9c0157b2cc999e79e79d721`，源快照 `8eda5cdd3ffcd6afb7ef17846aa3b0266b26837ccc073cff243d3eeef69c811d`。原签名/16KB/ARM64/中文模型/独立JS/凭据排除通过，最终覆盖安装且手机base.apk摘要一致。[177 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.177)已公开设为最新，四附件摘要已核对，Release id434896495；不要继续发布176草稿，已由177替代。

独立官方hello_ar_java v1.48.0做了SDK1.48/1.57、FIXED/AUTO、CPU640/1280/1920对照，原生rectifier错误也复现。1.57/FIXED/640在用户平移后出现0.455～0.930m近处深度、raw最多1653点，但仍52行rectifier错误，不是完整修复；没有严格同轨迹A/B或独立距离真值。[排查记录](ARCORE-RUNTIME-DIAGNOSIS.md)与 `scripts/arcore-reference-diagnostics.patch` 可复现。临时HelloAR测试App已移除；Google AR服务未改动或清数据。

177的LocalDepthReadiness要求3个不同新鲜raw帧、跨度300ms、每帧32个0.2～4m高置信度点，才融合地图或新标定。最终版将初始化锁存在同一跟踪会话，停稳后深度过期仍允许选面；nearEvidenceFresh单独报告，TerrainAnalysis的3秒观测时效照常生效。首版错误地在3秒后撤销初始化，已在最终包修掉，不要恢复该行为。跟踪丢失/暂停/新Session/时钟回退重新准备。

手机最终新图Final177，确认台面ARCORE_PLANE而非实际地板；手持扫描所选平面估算相机高16～20cm，未强套此前装机10cm。初始化和停稳后选面已通过；后续短扫描手机586报告内接受65新深度帧，确认平面最高5格、障碍76、落差26、候选0，单帧平面点最高553、补全263，各峰值非同帧。高度冲突单元最高47，部分区域缺独立帧和分区覆盖，未验证每个红/橙点是否对应实物。

`.tools/177-final-session.ndjson`手机报告、`.tools/177-final-capture.ndjson`56份双深度回放（约4.36MB）已保存，用户无需继续移动。`.tools/177-replay.bin`和`.tools/177-replay-comparison.txt`为同批四组合：raw旧/当前基准都0格；融合旧基准2格/10正记录，融合当前基准6格/8正记录，候选全0，累计补全1907次不是独立体素。离线子集与手机采样轨迹不等价，不能写成手机6格。先继续利用该数据查残差/覆盖，别重复要求用户盲扫，也不要靠放松阈值制造绿色区域。

Final177已经保存并暂停相机，本阶段未发送任何电机命令。真实地板、独立精度、底座外参、物理头部补偿和自主规划仍未验收。ARCore Recording/Playback可作为减少下一轮反复手动扫描的后续选项，当前未接入；不要将已有深度NDJSON误称为完整相机/IMU数据集。

## 最新：2026-11-05，2.1.176

用户要求继续解决，不接受归因白色桌面即停止。176已做同会话AUTOMATIC原始/完整深度交叉验证与补全，修正小幅平面修正时混用旧高度基准，增加彩色深度叠加、青色AR平面边界、检测平面与已测网格分开显示、本地深度回放；最后补DepthPoint邻域拟合、镜头高度标定与会话Anchor。头部可上下滑动/俯仰，10cm只初始化参考面，之后由实时相机/Anchor位姿补偿，不每帧强制当前镜头高度不变。77项原生测试、[最终源码CI](https://github.com/mypengpengli/myyaya/actions/runs/41968264628)与原签名安装检查通过。源码 `9a856fdecba8e1f0d9ad8c2d9ac96047188236c6`；APK SHA256 `e512782074b1fd6f03f7be29608deb7b982ed5eace58d3c4fd1c27a1e81849dc`，174378086字节，源快照 `b1402836e0655691e654af3956db44391e019ab636c383e2e02b14e6b34b111b`。

初版Hybrid176（UUID `3a71e5fb-2e06-4bc6-a26f-14b4ae9fd31d`）已观察到融合点、3个实测平面网格，手机约30FPS/热状态0；两路重合中位差4～6mm。`.tools/176-capture.ndjson`为105份有效本地回放数据，`.tools/176-first-session.ndjson`手机原始日志。离线同批数据重建旧/当前基准、原始/融合4组合：原始最多1格，融合最多4格；所有候选0。基准修正有回归测试支持，但回放不支持将它单独认定为本场景提升主因。`.tools/176-replay-comparison.txt`保留结果，`.tools/ReplayComparison.java`和二进制为本地诊断。

White176对照已完成：用户拿开彩色券，SDK检测出多个水平候选，但部分轮廓明显不贴合桌面，不能记桌面准确识别通过。用户确认镜头中心距平面约10cm；与早先SDK给约6cm不同，但姿态不是严格真值对照，不能宣称独立4cm误差。用户提醒头部上下运动，已将未发布的固定高度逐帧重建策略改为会话Anchor固定参考面，允许当前cameraHeight变化。用户后来重新平铺彩纸，现用它核对投影，不当作产品必须贴纸。

最终Height176已新建并运行，长按点选平面填写10cm并选台面：读回MEASURED_HEIGHT/0.1m/Anchor TRACKING。用户已完成20cm/10秒平移，数据`.tools/176-height-live.ndjson`500份：当前镜头高约4.05～14.10cm，平面/障碍/候选0，落差最多2格，未与实物核对。双深度回放`.tools/176-height-capture.ndjson`120份已拉回。raw缺测/稀疏、dense反复十几米；不能记为融合/测距成功。已保存并暂停，不需要用户继续平移。

关键新线索：`.tools/176-arcore-internal.log`原生334行rectifier错误、138行相机/IMU时间差错误，14.62～27.39ms，未见FATAL EXCEPTION/VIO_RESET。`python scripts/analyze-arcore-log.py <本地日志>`可重算；[排查记录](ARCORE-RUNTIME-DIAGNOSIS.md)有范围和官方资料。不能只归因白桌面，也不能直接认定其他机型issue等于本机已证实根因。主摄Camera2零畸变仅是输出记录。手机global低电量模式和MIUI省电均0，电量约6%、USB慢充。

独立官方示例在 `D:/myyaya-toolchain/arcore-reference`，v1.48.0（commit b73725b586bb18b622d6e1c6aee9650176d4679d），hello_ar_java加500ms深度统计，默认FIXED，对比AUTO、可选CPU图像宽度。AGP改为本机缓存8.13.1、SDK36/build-tools36；本机Gradle9.3.1构建通过。首次因锁屏安装被MIUI取消。已通过异步问题请求解锁，`.tools/compare-arcore-phone.py`可等解锁后安装、采35秒并停止；没有收到解锁时不能写成示例已经复现。这个示例不含个人数据或电机代码；临时包名 `com.google.ar.core.examples.java.helloar`。此阶段没有发送任何头部或履带命令。

176草稿Release id `434766819`。最终APK已上传并改为正式文件名，asset id `712062868`、SHA e512…；旧的70测试APK资产已删除。三个小附件已换成当前最终包，需结束现场验收、核对四附件摘要及target后再发布，不能把草稿说成已公开。详见[联合校验](HYBRID-DEPTH.md)。

## 最新：2026-11-05，2.1.175续修

本轮修正深度500ms采样可能错过250ms新鲜窗口的问题：地图模式最多10Hz采样，界面/日志2Hz，原始时间戳去重和3秒时效保留。增加 `depthEvidence` 点数/高度/待确认单元/阻断原因，界面显示对应提示；独立探针仍2Hz。58项原生测试、最终CI、原签名安装与手机APK哈希核对通过。[175 Release](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.175)已发布为最新，四附件摘要核对通过。源码 `aec5f1af5a0a47cc921538a6251d4167692d34df`；现场表现见[11月5日记录](PHONE-CHECK-2026-11-05.md)。

手机新图Bench1105（UUID `8221a64e-6b42-47f2-8515-6962cbcc56fe`，session `871a9708-bf69-4b60-8b64-2f70a10bc248`），约30FPS/热状态0、100ms采样/500ms报告、尺寸15/10/11cm+5cm恢复。首轮同步快照累计接受90新帧，确认平面与候选一直0。彩色券平铺对照也完成：手机日志614报告中接受计数最大58、单帧平面点最多186，但高度冲突与覆盖不足仍存在，未查清根因；不是简单“有纹理就通过”。`.tools/nov5-terrain-live.ndjson`保留首轮，`.tools/nov5-session.ndjson`保留手机完整日志，对照电脑文件多数为等待期，不要误记未采到移动数据。

已暂停扫描并导出 `.tools/Bench1105.yayamap`（手机Download同名），49845字节、2825体素/280轨迹、CRC32正确。手机在暂停页，用户不用继续拿着移动。下一步补逐点投影到后摄画面及可回放残差，核对实际券面/桌面/罐体各自高度，再决定修改参照面还是观测融合；不要靠放松阈值宣称通过。该图无固定参照，新Session不能直接续旧坐标。此阶段未驱动电机。

## 2026-10-30，2.1.175初版记录

用户明确把Gemini Live / Robotics ER接入放到以后，当前继续手机本地地面、障碍和候选通行区域。175代码及APK已完成：新增DepthProjection共享投影、TerrainAnalysis纯Kotlin分类/时效/包络、TerrainView局部可视化，地图页人工点选并确认实际地面。新地面判断仅在本次会话有效，不改已有地图文件格式，不含电机API。详见[TERRAIN-ANALYSIS](TERRAIN-ANALYSIS.md)。

47项原生测试（新增20）、TypeScript、[最终源码CI](https://github.com/mypengpengli/myyaya/actions/runs/41030664743)通过。最终源码 `22ba390b3eb7c15235b0ed339855c2f1e0b0ee96`；APK SHA256 `4b705a374e522154e1f57ff05001911aaba6bb6a348c9e43c909dbe8883db88b`。原签名覆盖安装及尺寸设置通过，用户确认宽15cm、长10cm、装机总高11cm，已在手机填写，余量5cm。实际半径0.14013879m；数据不硬编码进APK。

用户明确选择台面试验，随后新建Bench175（UUID `8c92090e-421a-4dad-9fe5-d0a7e7d9b697`，无固定参照图，session `1374eca5-d84d-40d9-92e4-d870db29c994`）。检测到两个水平面、点选并选择台面，约14cm相机离平面高度；`surfaceRole=bench-test`、实际地面标志false。同步移动采样出现最高32个障碍/18个落差单元，但平面及候选0；未证实其与实物对应。静止后过期数据清除。证据见忽略的`.tools/175-bench-live.ndjson`及截图，不能记为地板或自主导航验收。

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
