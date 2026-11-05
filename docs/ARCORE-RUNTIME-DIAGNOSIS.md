# 小米 12 Pro 深度异常排查

2026-11-05。设备 2201122C、Android 15 / 澎湃 OS 3，Google Play Services for AR 1.57.262640093，小丫客户端 ARCore SDK 1.48.0。仅扫描台面，不驱动底座。

## 已取得的证据

用户确认镜头中心离台面约 10cm。在对应姿态建立会话参考面，随后完成约 20cm 的左右平移。参考面锚点保持 TRACKING，但平滑深度反复为十几米，原始深度缺测或有效点极少；不能将这轮记为测距或通行验收通过。

12:44～12:52 的应用进程原生日志包含：

- 334 行 `Only kUnrectifiedOriginal is supported for ComputeDisparity`，伴随 `kUnrectifiedPinhole vs. kUnrectifiedOriginal`。同一失败可能产生多行调用栈，次数不是独立失败帧数。
- 138 行 `FEATURE_DSP_CAM_IMU_DESYNC`，相机至 IMU 时间偏移约 14.62～27.39ms；日志所列阈值为 5ms。
- 该段没有 `FATAL EXCEPTION` 或 `VIO_RESET`；没有崩溃不代表测量准确。

Camera2 主摄特征报告 `timestampSource=REALTIME`，畸变系数为零。这只能作为设备输出记录，不能单凭零值认定驱动错误：ISP 也可能已校正图像。

这证明 ARCore 内部在报错，发生在网格分类之前。它不能单独证明所有异常均由设备配置导致，也不能排除应用相机配置影响。白桌面低纹理会影响深度覆盖，但不足以解释全部上述原生错误。

## 对照与处理顺序

1. 使用 Google 官方 `hello_ar_java` 示例，同一 SDK、手机、场景和 AR 服务做独立对照。仅增加每 500ms 的深度统计，不接入小丫融合、网格或电机代码。
2. 对比默认对焦和 AUTO，以及设备实际提供的 CPU 图像配置。Google [FocusMode 文档](https://developers.google.com/ar/reference/java/com/google/ar/core/Config.FocusMode)建议 AR 跟踪使用默认配置，拍照/录像时使用 AUTO。当前小丫探针显式使用 AUTO，尚需对照，不能提前宣称改为固定对焦即可修好。
3. 如独立示例也复现，继续隔离客户端 SDK、AR 服务和设备配置；不通过缩放十几米结果或放松阈值伪造可通行区域。
4. 若原生深度确实不能稳定使用，再接独立的视觉深度来源，沿用现有时效、置信度与包络判断。仅通过已知高度计算射线与平面的交点，只能得到假设平面，不能证明瓶子或桌沿不存在。

本轮没有清除 Google AR 服务数据、卸载或降级服务，也没有修改手机系统标定。原始日志、Camera2 特征和个人环境回放均放在本地忽略目录，不进入仓库或 Release。

## 参考报告的适用范围

Google ARCore 仓库 [issue 1793](https://github.com/google-ar/arcore-android-sdk/issues/1793)记录了其他机型在同一 AR 服务版本上的相同 rectifier 错误和相机/IMU 时间问题。型号、系统和症状并非完全相同，报告者的设备配置解释仍是排查线索，不是 Google 已确认的小米根因。

分析本地日志可运行：

```text
python scripts/analyze-arcore-log.py .tools/arcore-local.log
```

输出只包含计数、偏移范围和对照示例的深度统计；脚本不会联网或上传日志。
