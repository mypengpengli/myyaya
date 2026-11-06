# 2026-11-06：178安装、录制与回放验证

## 已完成

- 小米12 Pro（Android 15 / HyperOS 3）已通过USB重新连接。以保留数据方式覆盖安装2.1.178，未卸载、未清数据；手机base.apk SHA256与预览版一致：`c211d656dc164678f272d433c0441ff0b5ca311189a1b3b4a74d1046ec1b1b6f`。
- “教路线与复走”在MainActivity内显示，红色停止按钮和操作菜单可见；独立录制回放打开NavigationProbeActivity，界面没有导航动作入口。
- 新建本轮测试地图Dataset178Nov06，启动后摄实时扫描，约28～30fps。点击录制和停止后，本机产生1,633,553字节MP4；视频轨道约23.872秒，含`application/arcore-video-0`、`application/arcore-gyro-0`、`application/arcore-accel-0`及自定义事件轨道。文件仅保存本地，未上传环境影像。
- 独立回放实际达到694帧并触发`playback-finished`，相机自动暂停。报告`datasetPlayback=true`、`routeControlAvailable=false`、`autonomousMotionEnabled=false`。再次打开同一录制，运行到379帧时主动退出也正常。
- 回放返回路线页、再退出到普通页面后，相机客户端已释放。普通语音由off/loading恢复为`listening / wake`；最后手机停在表情页“我在听”。这验证监听恢复，不替代新一轮真实声学唤醒和语音急停验收。
- 未选择实际地面时，“开始教路线”被阻止并说明原因；红色停止按钮显示“用户停止”。测试时底座未连接，因此不将这一项记为实车刹停通过。

## 排查中的一次误判

手机原先保存了休眠状态，退出后普通语音保持关闭；冷启动实时截图确认“休息中”，点击唤醒后普通监听恢复。另有uiautomator因动态表情未能进入idle状态，旧XML不能代表当前画面。本地检查工具现改为每次使用唯一XML路径，读取失败时只参考新截图，不复用旧树。未因此修改业务代码或另发APK。

## 真实地面试验进行中

用户已将手机与底座放到桌下地板，并放置可乐罐。新建Floor178Nov06，后摄已看到罐底和周围地板；底座重连尚未成功，已请用户恢复黄灯。此时没有发送履带或头部动作，未开始教路线或复走。

真实地板测距、障碍逐点对应、固定安装偏移、短动作方向校验、停车距离和路线闭环仍需实物验证。静止录制/回放成功不表示ARCore原生深度错误已解决，也不表示整屋导航已完成。178继续作为[预览版](https://github.com/mypengpengli/myyaya/releases/tag/v2.1.178)，稳定版仍为177。

## 本机证据

本轮实时截图位于`.tools/phone/nav178-*.png`；录制副本`.tools/178-dataset.mp4`的SHA256为`5271c08a79e12b9bf16080f09b3200b195f88142d480a7d934cdf9233d34d738`；回放报告为`.tools/178-playback-live.json`、`.tools/178-playback-watch.ndjson`和`.tools/178-awake-playback-live.json`。这些环境数据未提交公开仓库。
