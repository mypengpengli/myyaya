# 原始深度、平滑深度与平面联合校验

176接续175台面试验。白色低纹理区域的原始深度可能稀疏，不能只据此判断桌面无法识别。175的高度分类与覆盖验收未通过，不能把新增诊断当成问题已解决。

## 对照资料与取舍

- [ARCore DepthMode](https://developers.google.com/ar/reference/java/com/google/ar/core/Config.DepthMode)：AUTOMATIC中可以同时取得原始深度、置信度和平滑深度；无需在两个不同会话中猜测坐标是否相同。
- [Raw Depth指南](https://developers.google.com/ar/develop/java/depth/raw-depth)：原始深度更适合几何，但存在空洞；完整深度经过平滑和插值，覆盖更广，不能把每个像素都视为独立测量。
- [官方Java投影样例](https://github.com/google-ar/arcore-android-sdk/blob/main/samples/raw_depth_java/app/src/main/java/com/google/ar/core/examples/java/rawdepth/PointCloudHelper.java)：按GPU纹理内参缩放至深度尺寸，X向右、Y向上、Z朝相机后方。已逐项核对现有投影公式，并补纯Kotlin回归测试；尚不能靠公式相同宣称实机已对齐。
- [Google Depth Lab](https://github.com/googlesamples/arcore-depth-lab)提供稠密深度的交互、碰撞演示；它不是能直接放进履带底座的导航系统。此项目复用其组合几何信息的方向，不引入Unity运行时。

## 本项目实现

地图新建会话优先AUTOMATIC，同一ARCore Frame分别读取原始深度/置信度和完整深度，独立释放图像。设备无AUTOMATIC时保留原始模式。表面地图仍只融合原始数据，不用完整深度改写历史地图。

联合校验属于本项目算法：

1. 两路时间戳均需有效、非未来、距当前帧不超过250ms；尺寸、采样步长一致。
2. 至少8个有效重合像素；中位距离差与90分位差超限时拒绝平滑补全，明确报告来源不一致。
3. 需要至少6个原始点既贴近所选平面、又与完整深度相符，作为本帧平面锚点。
4. 只在原始缺测处补贴近平面的完整深度点；距原始平面锚点最多20cm，距原始高度异常点10cm内不补。原始障碍点不会被平滑值覆盖。
5. 补全点仍随同原始新时间戳接受重复帧、3秒时效、三帧/空间覆盖和整车包络检查。融合次数不当作额外独立帧数。

还修正了平面高度基准：每帧使用当前ARCore平面与当前相机位姿分类，避免保留旧平面到3cm阈值才更新而引入小幅偏差；累计平面变化超过阈值仍清空证据。

上述阈值是本项目待实测参数，不是Google对机器人通行的保证。尚无外参标定、规划或电机接入。

## 直接看对齐与离线复核

地图页可切换“叠加”。原始点为实心，经过交叉校验的补全点为空心；青为贴近平面、红为高处、橙为低处。2D坐标用ARCore从纹理转换到Android View，处理屏幕裁剪与旋转，方便看红点实际落在罐体还是桌面。

诊断 `terrain.hybridDepth` 记录两路一致性和补全数。`terrain.depthCapture` 给出本地回放文件名，位于应用外部私有目录 `navigation-probe/depth-evidence-*.ndjson`，最多120个新鲜采样、保留3个文件。包含两路压缩深度、内参、当前相机位姿和平面，不保存相机照片，也不上传服务器。文件属于个人环境数据，不加入仓库或Release附件。

可用 `python scripts/analyze-depth-evidence.py <文件> --frame 3 --csv points.csv` 重建逐点平面残差和3×3图像分区统计。应结合实际画面核对已知桌面、券面和罐体，不能只看总体中位数。手机验证结果继续记入[11月5日记录](PHONE-CHECK-2026-11-05.md)。
