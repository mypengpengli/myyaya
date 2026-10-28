# Hermes 文件回传桥

只提供任务产物清单和只读下载，不提供终端或任意路径读取。无第三方 Python 依赖。现有 Hermes Runs/SSE 接口不变；不要为了文件传输开启旧浏览器控制协议。

## 部署

1. 将 `file_bridge.py` 放到 `/home/agentdesk/myyaya-server/file_bridge.py`，使用 Python 3.10+。
2. 创建 `~/.local/share/myyaya-files` 和 `~/myyaya-output`，权限 700；把服务文件放到 `~/.config/systemd/user/myyaya-files.service`。
3. 服务从服务器现有 `~/.hermes/.env` 读取 `API_SERVER_KEY`。不要把该文件或 Key 放进仓库。执行 `systemctl --user daemon-reload`、`systemctl --user enable --now myyaya-files`。
4. 在现有 `hermes.jiazhuangai.com` HTTPS 站点增加反代：仅将 `/myyaya/v1/*` 原样转发到 `127.0.0.1:8651`。其他路径继续转发到原 Hermes，不能覆盖原规则。先验证反代配置，再 reload。
5. 手机带原 Hermes Token 请求 `GET /myyaya/v1/capabilities`，应返回 `protocol: myyaya-files-v1`。不带 Token 应返回 401。

例如 Caddy 在该站点块内增加：

```caddyfile
handle /myyaya/v1/* {
    reverse_proxy 127.0.0.1:8651
}
```

Nginx 则添加 `location /myyaya/v1/ { proxy_pass http://127.0.0.1:8651; }`。不带 URI 的 `proxy_pass` 保留完整路径。部署前先确认实际使用哪一种反代；本仓库不会自动改服务器配置。

## Hermes 生成文件

手机对需要文件的任务附带独立 task_id 和交付说明。Hermes 将文件生成到 `~/myyaya-output/<task_id>/`，再执行：

```sh
python3 ~/myyaya-server/file_bridge.py publish --task-id TASK_ID ~/myyaya-output/TASK_ID/report.docx ~/myyaya-output/TASK_ID/slides.pptx
```

按用户要求交付文件本体：Word 返回可编辑 DOCX，PPT 返回可编辑 PPTX，不自动转 PDF，也不以 PDF 或提取文字替代原文件。只有用户明确要求 PDF 时才生成 PDF。文件桥只复制原始字节，不安装或调用办公转换器。

手机可直接用 WPS 等已有应用打开原文件，或通过“保存原文件”将原始文件复制到用户选择的位置。APK 内的 DOCX/PPTX 内容预览用于快速查看文字，完整图片、动画和排版由外部办公应用显示。

`publish` 只读取对应任务目录，拒绝目录穿越和指向其他目录的符号链接；每任务最多 10 文件、单个 25 MiB、总计 60 MiB。产物复制到私有只读快照，返回稳定编号、类型、大小和 SHA256。发布失败不产生可见清单；同一任务不可覆盖已发布快照。

客户端下载固定同源路径，不使用模型回答中的任意 URL，不向其他主机转发 Token。下载可重复，不使用一次性浏览器附件接口。原文件或导出快照的清理由服务器管理员按保留政策处理；本服务不会自动删除原始产物。

当前运行：`python -m unittest discover -s server -p 'test_*.py'`。
