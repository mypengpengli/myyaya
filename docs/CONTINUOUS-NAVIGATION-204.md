# 204：连续局部导航

目标：将 203 已实测成功的分段绕障，接为一个持续反馈的运动任务。用户确认一次后运行，不在每个小动作前重复倒计时。当前目标仍限定为距起点 15 厘米至 1 米的局部目标，不能据此宣称已完成跨房间自主导航。

## 参考方案与选取

- [Nav2 Controller Server](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/core_servers/controller_server/)：控制循环独立于路径规划，默认 20 Hz。小丫使用原生 Kotlin 20 Hz 循环，不在手机安装 ROS。
- [Nav2 Velocity Smoother](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/core_servers/configuring_velocity_smoother/)：连续插值并限制加减速。小丫对 FED0 速度和转向分别渐变，停车可立即归零。
- [Regulated Pure Pursuit](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/controller_plugins/configuring_regulated_pp/)：根据路径曲率及障碍调速，检查前向扫掠。小丫保留现有局部栅格 A*，以短前视目标修正方向，并在近障处降低速度。
- [Nav2 Collision Monitor](https://docs.nav2.org/rolling/configuration_and_development/configuration_guide/core_servers/collision_monitor/configuring_collision_monitor_node/)：感知超时也触发停车。小丫由原生循环检查实时相机、地板光流、神经视觉、JS 心跳和蓝牙写入；这些检查不等待 JS 下一次推理完成。
- [OpenBot firmware](https://github.com/ob-f/OpenBot/blob/main/firmware/README.md)：持续运动指令与心跳。LOOI 固件的断信号停车语义未获厂商保证，因此不能把社区观察当作硬件急停保证。
- [LOOI 社区协议 FED0](https://github.com/andrey-tut/LOOI-Robot/blob/main/docs/PROTOCOL.md)：两个有符号字节分别为 speed、turn。另用本地原版 APK 的 move/control 实现核对了 forward_speed、veer_speed 乘 127 的映射，未复制原版 APK 或私有文件到仓库。

## 204 的实现边界

原生控制 20 Hz，串行蓝牙写入约 10 Hz，与现有 ble-plx 共用连接。JS 神经视觉保留 ONNX 会话，连续取样时省去每帧显示叠加、导出和归档。每张图绑定拍摄时的局部位姿，推理完成后投到共同坐标，避免把旧画面误当当前画面。

后摄朝履带的后退方向，运动速度为负；路径向右转，对应 turn 为负。限制初始原始指令为低速范围，并对速度变化限幅。原始字节到米每秒、弧度每秒的换算属于暂定估计，仍须实车核对，不能称为已标定的速度控制。

保持 8 厘米镜头高度及既有安装偏移。使用地板光流累计平移和相机朝向反馈，不把 ARCore 漂移平移直接用于到达判断。光流中断后先停车，确认零速写入后才允许在当前任务坐标重新建立局部光流，增加位置不确定度；累计超过上限终止。相机/感知过期、无路线、传感器拦截均停车等待，用户停止或退后台则终止任务，后续图像不会重新发车。

原 203 分段模式保留，作为回归基线。新增“连续绕障到前方40厘米（试验）”。到达仍是视觉估计到达，包含履带打滑、尺度和地板区域假设的误差。

## 验证记录

原有 TypeScript 导航、方向、停止、绕障模拟及新任务编排测试已通过。新增 14 项原生反馈测试覆盖连续感知间隙、数据过期、停止后不重启、占地障碍、无路线、定位重建和到达；加原有测试共 214 项通过。[完整 CI](https://github.com/mypengpengli/myyaya/actions/runs/42990370699)通过。

2.1.204 已保留设置覆盖安装到小米 12 Pro，手机安装 APK 摘要与导出包相同，并自动恢复蓝牙连接。源码为 `162e97c73838734d3921a8c89303b409547ecb5d`，源文件快照 `1d7c08847dda79bb9287386808268ace84a3de94c580d02b37790c3b313bb269`；APK 198,894,876 字节，SHA256 `62913c9317a57df0e46b8e0fbc53388fa9a1e1278d95a06a6d2b00a5218fcf9f`。签名、43 个 ARM64 库的 16KB 对齐、中文模型完整性和无本地凭据检查通过。

初包静止扫描发现默认左下地板区域拟合未通过，中下区域通过；修订包先在静止时预热并选择通过校验的区域，再建立运动任务，行驶过程中保持该区域。原生不会把模型校验通过当作未知地面已安全。修订包已再次安装并核对摘要、自动恢复蓝牙；手机停在路线页，相机未开启，等待操作者确认最低姿态、空地及线缆后开始运动试验。实车连续运行结果将在完成后补充；目前不把 203 分段实测写成 204 连续实测。
