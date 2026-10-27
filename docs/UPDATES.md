# APK 在线更新

## 手机上更新

首次从 [GitHub Releases](https://github.com/mypengpengli/myyaya/releases/latest) 下载并安装 APK，后续可以在 App 的设置 → 更新（Updates）→ 检查更新（Check for updates）中下载新版，再按系统提示确认安装，无需连接电脑。

首次调用系统安装器时，可能需要允许 myyaya“安装未知应用”。当前更新由用户发起并确认，不是后台静默安装。需要手机网络能够访问 GitHub API 和 Release 安装包；手机端首次覆盖升级仍待实测。

默认更新源为公开仓库 `mypengpengli/myyaya` 的最新正式 Release，不需要配置 GitHub Token。草稿版和预发布版不会进入这个更新通道。

## 当前发布

- 版本：`v2.1.152`，Android versionCode `152`，ARM64。
- 安装包：`myyaya-2.1.152-arm64.apk`。
- 包名：`io.github.mypengpengli.myyaya`。
- APK SHA256：`5198523a5f0086442830b9a952814b7102c9de7dc67bbb41e829cb301059c0ef`。
- 签名证书 SHA256：`9cbd68acd1dce6768a9f5be3756dbfc24444e1222980e51e26f57608521addce`。

发布附带 `.apk.sha256` 校验文件与 `.apk.build.json` 构建记录。APK 不包含服务 Token、发布签名私钥或 GitHub 管理凭据。

## 后续版本的发布约定

1. 修改功能并完成类型、相关回归和 Android release 构建检查。
2. 同步递增 `mobile/package.json`、`mobile/app.json` 的版本，以及 Android `versionCode`；同版本不覆盖替换 APK。
3. 使用与已安装版本相同的永久签名。包名保持 `io.github.mypengpengli.myyaya`，签名私钥和密码继续留在私有构建环境。
4. 创建 `v<版本号>` 草稿 Release，将签名 APK 和对应的 `<APK 文件名>.sha256` 上传。一个 Release 保持一个明确的 ARM64 APK，文件名包含版本号。
5. 复核远端 APK 大小、SHA256、包名、版本与签名，全部上传完成后再发布为最新正式版。手机随后即可检查到它。

应用会核对 SHA256，原生安装模块还会校验包名、递增的 versionCode 和已安装应用的签名。通过后才打开 Android 安装界面。保持签名和包名不变时，正常覆盖安装会保留应用数据；不要卸载旧版再升级。

## 可选的自有更新源

如果以后需要通过自有 HTTPS 服务分发，可在构建时设置 `MYYAYA_UPDATE_FEED_URL`。它指定公开的更新清单地址，不能包含服务器凭据，也不需要改变 APK 的永久签名。

生成清单示例：

```powershell
python scripts/create-update-feed.py mobile/output/android/myyaya-2.1.152-arm64.apk --version 2.1.152 --base-url https://updates.example.com/myyaya
```

脚本生成 APK、SHA256 和兼容现有客户端的 `latest.json` 到 `artifacts/updates/`。将 APK 和校验文件先上传，最后更新清单。示例域名需要替换为实际地址；脚本不负责构建、签名或部署。
