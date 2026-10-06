# 验证方法

## 第一环境：同机独立 clone

候选初始提交只包含新实现和虚构素材，不继承源项目历史。
在独立目录 `git clone --no-local` 此候选仓库，使用空白配置和新数据库；不复制 node_modules、数据库或任何旧状态。
`--no-local` 避免本地硬链接复用对象。运行 README 的离线 clean install、测试、demo、更新和扫描。
用 `npm run verify:clone` 可自动建立临时 clone，执行检查后清理该脚本创建的临时目录。
它仍共享本机操作系统和 Node 安装，因此只证明可移植目录与干净初始化，不能代替第二操作系统。

## 第二环境：GitHub hosted runners

`.github/workflows/ci.yml` 使用 ubuntu-latest 和 windows-latest、Node 22.16.0 和 24.x。
每个 job 单独 checkout、关闭凭据持久化、安装 Node、执行无依赖 clean install、测试、demo、读写示例和扫描。
权限为 contents:read，不需要 API key、业务秘密或数据库；不部署、不自动发布。
首次远端 private 仓库创建和 push 后，记录准确 commit 与四个 job 的实际结论。未运行必须写 NOT_RUN，不得用本机结果代替。

## 证据强度

测试需要检查：重复登记/逻辑键冲突、重试不增加事件、不同载荷冲突、owner/版本拒绝、事务回滚、读取的 SQL 只读属性、staleness、决定/证据不刷新执行时间、MCP 工具白名单、实际 stdio 交互和读取前后文件完整性。
轻量隐私扫描覆盖常见 token 格式、私人绝对路径、私钥、UUID 型聊天标识、数据库/日志/环境文件和符号链接；不保证识别任意秘密或敏感语义。
人工发布检查应审阅完整文件清单、初始提交和公开材料。依赖为空时 npm clean install 不证明所有平台均兼容。
真实客户端的新聊天盲测单独验收；自动测试和模型自行总结不能替代它。
