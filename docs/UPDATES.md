# myyaya APK 在线更新

## 手机上的使用方式

采用完整 APK 在线更新。首次安装自己的签名 APK 后，后续版本可以在应用设置中检查、下载、验证并打开 Android 安装界面，用户在手机上确认更新即可。正常升级不要求重新连接电脑，保留相同应用包名与签名时可覆盖安装并保留应用数据。

普通 Android 应用的更新安装可能需要“允许此来源安装应用”以及系统确认。具体界面在小米 12 Pro / 澎湃 OS 3 上实测；本项目当前不承诺静默安装。

当前已继承社区的下载、校验与安装器调用代码，并配置自己的应用身份与更新源入口。尚未构建首个签名 myyaya APK，也未在手机上完成从旧版到新版的安装验收。

## 更新包放在哪里

按用户选择，`mypengpengli/myyaya` 已改为公开仓库。默认更新源为它的 GitHub Releases，手机可以匿名读取发布信息和安装包，无需单独搭建服务器。当前尚未发布首个 myyaya APK。

日常使用默认 GitHub 更新源即可，不需要设置额外环境变量。如果以后改用自己的 HTTPS 服务器，再在构建时设置：

```powershell
$env:MYYAYA_UPDATE_FEED_URL = 'https://updates.example.com/myyaya/latest.json'
```

该地址会进入 Expo 的最终应用配置，App 以后从这里检查版本。它是更新入口地址，不是服务器管理凭据。不要把 GitHub 管理令牌放进 APK。

当前直接使用已有 myyaya 仓库，没有另建下载仓库。可配置 manifest 的格式与现有 GitHub Release 解析兼容。

## 每次发布的步骤

1. 修改功能，并运行类型检查、相关测试及上游要求的回归检查。
2. 增加版本号及 Android versionCode；后者必须高于手机已安装版本。
3. 通过上游构建流程使用自己的永久发布签名生成 APK。首次安装与后续更新必须使用同一套签名；签名文件和密码只保存在私有构建环境。
4. 将签名 APK 和它的 `.sha256` 文件作为同一 GitHub Release 的资产发布，tag 使用 `v<版本号>`。只有公开的稳定 release 才进入默认检查通道。
5. 手机应用中检查更新、下载并确认安装。下一次新增功能重复此流程即可。

如果选择自有 HTTPS 服务，可用下面的脚本生成发布目录：

```powershell
python .\scripts\create-update-feed.py .\mobile\output\android\my-looi-v2.1.151.apk --version 2.1.151 --base-url https://updates.example.com/myyaya
```

将输出目录 `artifacts/updates/` 中的版本 APK 和校验文件上传到服务器，最后更新 `latest.json`。

`create-update-feed.py` 负责复制 APK、生成 SHA-256 与 manifest；它不负责构建、签名或自动上传。示例域名需要替换为实际服务器地址。

## 更新验证

- manifest 及下载 URL 使用 HTTPS。
- 下载后验证 SHA-256。
- 原生安装模块验证 APK 包名等于已安装的 myyaya 包名。
- 原生安装模块验证 Android versionCode 增加，签名证书与已安装版本一致。
- 上述验证通过后，才调用系统安装器。

首轮实机验收需要安装一个签名基线，再发布一个更高版本，确认应用数据保留并成功升级。当前没有执行这个验收，不能把源码测试通过等同于已经在线升级成功。

参考：[Android 应用签名](https://developer.android.com/studio/publish/app-signing)、[PackageInstaller 用户确认机制](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int))。
