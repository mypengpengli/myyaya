# 目前怎样安装 MCP

小丫当前有技能库和 Hermes 派单，但还没有手机原生 MCP 客户端或 MCP 设置页。现在把 MCP 接到服务器 Hermes，再让小丫把需要该能力的任务交给 Hermes。手机不用安装 Node / Python，也不会自动得到服务器的全部工具。

以下根据 [Hermes 官方 MCP 说明](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md)于 2026-10-29 核对；也已对照服务器此前提供版本的 [1744a19 文档](https://github.com/NousResearch/hermes-agent/blob/1744a19/website/docs/user-guide/features/mcp.md)，该版本已有目录安装命令。本轮未登录核对服务器当前状态，先用 `hermes mcp --help` 确认本机命令，不能假定旧版具备最新目录。

## 最方便的方式

在服务器上对 Hermes 说：

> 请按这个 MCP 项目的 README 部署：[具体项目地址]。先核对安装方法和账号授权要求，将配置合并进当前 Hermes 的 mcp_servers，保留原配置；列出工具并实际执行一次只读测试。需要我授权账号时告诉我。把安装位置和验证结果记下来。

对于需要浏览器登录的网盘、邮箱，仍需要用户完成账号授权。仅搜到“安装方法”不代表已经安装成功。

## 手工配置

1. 以运行 Hermes 的用户登录服务器，执行 `hermes mcp --help`。新版本可以用 `hermes mcp catalog` 查官方目录、`hermes mcp install <目录名称>` 安装；第三方项目以自己的 README 为准，不猜包名。
2. 远程 HTTP MCP 把以下片段**合并**到 `~/.hermes/config.yaml` 已有的 `mcp_servers` 中，替换示例地址：

```yaml
mcp_servers:
  my_service:
    url: "https://你的服务地址/mcp"
    headers:
      Authorization: "Bearer ${MY_MCP_TOKEN}"
```

Token 单独填入该服务器 `~/.hermes/.env` 的 `MY_MCP_TOKEN`。若项目使用 OAuth，按项目说明使用 `auth: oauth` 并完成授权，不混用 Bearer 示例。

3. 本地 stdio MCP 则配置 `command`、`args`、`env`，按该项目安装依赖；这里的“本地”指 Hermes 服务器，不是手机。
4. 执行 `hermes mcp test my_service`，确认能列出工具，再让 Hermes 执行一次实际只读调用。运行中的 Hermes 会话可用 `/reload-mcp`；后台网关需按实际服务部署重载，用户原有部署使用 `systemctl --user restart hermes-gateway`，应在任务结束后进行。
5. 之后告诉小丫“交给服务器，用刚配置的 MCP ……”。任务结果与文件沿现有 Hermes 回传链路返回。

百度网盘 MCP 有不同实现，没有一个通用安装命令。选定具体仓库后才能确定启动命令和授权方式；目前没有替用户安装任何未指定的 MCP。
