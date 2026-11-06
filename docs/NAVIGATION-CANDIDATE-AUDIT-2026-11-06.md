# 连续通行候选为0：离线原因审计

日期：2026-11-06。结论：**候选为0是当前严格地面诊断的结果，不是对物理空间不可通行的证明，也不应是分步导航的总开关。** 179尚未实现自主探索、局部绕障和物体目标定位。此前将“不能去罐子后面”主要归因于候选为0，解释不完整。

本轮未操作手机或电机。使用已保存在电脑的74份双深度记录，调用179实际编译的Kotlin `TerrainAnalysis`、`HybridDepth`、`DepthProjection`和`RoutePerception`，补充空间分析和单变量对照。原始环境数据不上传仓库。

## 1. 候选实际检查什么

`TerrainAnalysis`是短时诊断，报告明确`motorControl=false`、`motionAuthorized=false`。当前机器人宽15cm、长10cm，默认每侧余量5cm，外接圆半径约14.014cm；10cm栅格下，中心及周围8格全部为GROUND，才出现一个候选。只枚举栅格中心，不枚举连续位置或动作方向。

GROUND又要求最近3秒内至少3个独立深度时间戳、格内至少3个象限有平面支持，并且同格没有有效的障碍、落差或不确定证据。新深度接入另要求不超过250ms；250ms接入门槛和3秒保留期是两个条件。

这不是已实现的“连通路径”或“可迈出一小步”检测。圆盘是任意转向的保守外形，短直行应检查带朝向矩形的扫掠体积；到目标是否可达还需要规划。当前`TaughtRoutePanel`没有读取候选计数作为复走门槛，实际检查的是已教路线、坐标绑定、定位、固定姿态、动作校验和`RoutePerception`。

## 2. 原版生产算法复算

输入`.tools/179-floor-depth-replay.ndjson`，74份、跨50.242秒，SHA256 `ca85f9220a4a5d8eee8e4daf230dd0df423fca8a6a88eb17a6a68423075f9586`。实际Kotlin类来自179构建，四份关键源码已与D:/mya构建镜像逐字节核对一致。

| 项目 | 结果 |
| --- | --- |
| 投影点累计 | 199662，含跨帧重复点，不是独立地图点数 |
| 地面格最高 | 11，全部位于同一个4连通分量 |
| 候选最高 | 0 |
| 最接近的9格模板 | 8格GROUND、1格OBSTACLE |
| 忽略时效并合并所有曾为GROUND的格子 | 共14格，最好模板仍只有8格；这仅是诊断上界，不能用于开车 |

最佳帧为零起始第21份记录。中心在格坐标(1,-7)，其3×3邻域如下，每格10cm：

| z / x | 0 | 1 | 2 |
| --- | --- | --- | --- |
| -8 | 地面 | 地面 | 地面 |
| -7 | 地面 | 地面 | 地面 |
| -6 | **障碍** | 地面 | 地面 |

阻挡格(0,-6)在此前0.266秒收到过一个离地约8.8cm的点。算法以该点刷新障碍证据，保留3秒，因此即使当前帧该格没有点，也仍会阻止圆盘候选。该空间位置可能包含物体，但**尚未完成与RGB罐子轮廓的可靠关联，不能认定就是罐子，也不能直接删除该点**。

这批数据里“有11格地面”和“出现一个整车圆盘”并不等价。也不是地面完全散开、完全没识别出来；更不是只把TTL改长就一定能走。

这里的11格是74份子集的离线复算。手机两次完整相机/IMU重放曾得到12/10格，采样、会话和轨迹不等价，不将11格记成手机新实测。

## 3. 两路深度融合被时间检查全部挡住

这74份记录的完整深度时间戳**全部**比对应Frame时间戳晚1.337～2.055ms，中位1.670ms。`HybridDepth.fuse`遇到`denseNs > frameNs`就立即拒绝，所以74份全部为`RAW_ONLY_STALE_PAIR`，实际补全0点。

[ARCore文档](https://developers.google.com/ar/reference/java/com/google/ar/core/Frame.html)说明稀疏Raw Depth不是每个Frame都有新测量，要比较深度时间戳识别重投影；[Depth概览](https://developers.google.com/ar/develop/depth)说明完整深度对应当前相机帧。本机记录的毫秒级偏差需要作为时间域/流同步适配问题核对，不能伪造时间戳或无限放宽新鲜度。

做了一次**纯离线**5ms融合门槛对照：只改变交给融合函数的检查时刻，地面分析仍使用原始Frame/Raw时间戳，不修改记录、不改变APK、不发电机命令。

| 项目 | 原版 | 离线5ms对照 |
| --- | --- | --- |
| 成功进行交叉校验及补全 | 0/74 | 53/74 |
| Raw平面锚点不足 | 0 | 9/74 |
| Raw/完整深度不一致 | 0 | 12/74 |
| 补点累计 | 0 | 14691（不是独立体素） |
| 地面点累计 | 22929 | 37620 |
| 确认地面格最高 | 11 | 10 |
| 候选最高 | 0 | 0 |

因此已找到“一路融合未生效”的具体拦截点，但**单改时间检查不能解决候选为0**。补进的平面点还会与同格高度冲突及空间覆盖门槛相互作用。该5ms数值仅是本批数据的实验参数，未作为生产修复发布。

## 4. 圆盘候选和小步动作确实不同

在最佳帧已确认的地面格内，做了带朝向矩形与格子的精确相交实验，保留相同5cm余量，搜索2.5cm位置采样和15°朝向采样。只看已知地面，不将未知当空地。

- 原圆盘、格心采样：0个位置。
- 矩形、连续位置采样：6个静止摆放姿态可容纳。
- 同余量、直行2cm扫掠矩形：此次采样中0个可容纳。
- 仅作敏感性分析将余量改为3cm：出现8个2cm短段样本；**不能据此直接降低APK余量**，因为位姿误差、镜头到底座偏移和停车距离尚未标定。

例如矩形静止姿态中心(0.125,-0.700)m只覆盖其中6个地面格，圆盘会额外碰到那个阻挡格。这证明“圆盘候选0”和“任何矩形姿态都放不下”不是一回事。但这块地面在当帧相机前方约0.68m；存在远处摆放姿态不代表机器人能跨过中间未知区域过去，也不代表存在实际运动路径。

## 5. 不能把另一条路线控制通道当作替代答案

当前`RoutePerception`采用人工已教平整走廊先验，主要检查新障碍。用这74份Raw数据单独复算：39次OBSTACLE、35次CLEAR；其中一次CLEAR在局部扫掠区内没有任何落在地板/车身高度带的点，只是在区外或高处有足够全局点数。

所以两个现象可以同时存在：严格地面圆盘一直0；较宽松的路线通道却能CLEAR。后者不是“已经能自主探索”的证据。后续必须增加局部观测覆盖，不能让高处/区外点数证明车前为空。

此外，当前路线控制器只跟踪人工教过的路点，遇障暂停；没有生成局部绕行路线或探索目标。也没有把“罐子后面”从图像物体转成带距离、方向及容差的地图目标。这些缺失独立于候选数字。

## 6. 查阅后的方案选择

| 直接资料 | 支持的做法 | 对本项目的采用方式 |
| --- | --- | --- |
| [Nav2 Costmap](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/core_servers/costmap_2d/) | 区分未知空间，局部地图可随机器人滚动，车体可使用多边形 | 把地面支持、障碍、观测覆盖分开；实际车体矩形参与局部动作检查 |
| [Nav2 Obstacle Layer](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/core_servers/costmap_2d/costmap_plugins/obstacle/) | 传感器标记、射线清除、按高度处理障碍 | 维护障碍证据及真实清除依据，不把高表面或旧数据当作整段无障碍 |
| [Regulated Pure Pursuit](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/controller_plugins/configuring_regulated_pp/) | 检查局部前视目标/时间范围内的投影车体，遇预计碰撞停车 | 只验证下一段动作及停车余量，执行后重新观察；不要求整屋先完成 |
| [Explore Lite的实际FrontierSearch实现](https://github.com/robo-friends/m-explore-ros2/blob/main/explore/src/frontier_search.cpp) | 未知边界邻接已知自由格，从可达自由区域寻找边界 | 向可达探索边界分步推进；不是直接将未观测空间设为空地 |
| [TangentBug作者资料](https://csaws.cs.technion.ac.il/~ehudr/publications/tangentbug-rangesensorbased-navigation-algorithm/) | 未知环境下，利用测距在趋向目标及绕障模式间切换 | 借鉴“朝目标→遇障→沿可观测一侧绕行→重新朝目标”；手机视野有限，不能直接照搬理想全向测距假设 |

这些资料支持用户提出的“边观察、边小步探索、再从旁边绕过去”。当前选择是**轻量局部地图＋短段轨迹检查＋可达边界子目标**，继续用Kotlin与现有BLE/VIO，不把ROS2整套装进APK。具体改造及验收顺序见[增量导航方案](INCREMENTAL-NAVIGATION-PLAN.md)。

## 复现

代码在`mobile/scripts/navigation/`。先构建navigation-probe Kotlin类，再用JDK运行真正的生产算法：

```powershell
python mobile/scripts/navigation/audit_replay.py .tools/179-floor-depth-replay.ndjson --classes D:/mya/modules/navigation-probe/android/build/tmp/kotlin-classes/release --stdlib <kotlin-stdlib.jar路径> --jdk D:/myyaya-toolchain/jdk17 --output .tools/candidate-audit
python mobile/scripts/navigation/explain_candidates.py .tools/candidate-audit/frames.json --recording .tools/179-floor-depth-replay.ndjson --output .tools/candidate-audit/summary.json
python mobile/scripts/navigation/footprint_counterfactual.py .tools/candidate-audit/frames.json --output .tools/candidate-audit/footprints.json
```

审计输出保存在本机`.tools/candidate-audit/`与`.tools/candidate-audit-slack5/`。`--fusion-slack-ms 5`是隔离的实验开关，默认0，不能将对照产物直接用于运动。此轮没有修改产品感知门槛、APK或电机控制。
