# ChatGPT Desktop 本地插件盲测（v0.1-alpha）

这是 **local-only / Desktop-only / alpha** 包装层。它只用本机 `node` 启动现有 stdio MCP，暴露
`read_project_overview`、`read_task`、`read_recent_changes`。没有 HTTP 服务、tunnel、OAuth、写工具或自动初始化。
需要本机 Node.js 22.16.0 或更高版本；Desktop 启动的进程必须能从 PATH 找到 `node`。

## 从“添加插件市场”开始

1. 在 **ChatGPT Desktop → 插件 → 添加 → 添加插件市场** 打开市场入口。
2. 本次选择本地目录来源。目录必须是这份独立仓库的根目录（能直接看到 `package.json`、`src/` 和 `.agents/`）。
   不要选择 `.agents/plugins/`，也不要选“创建 MCP 应用”的服务器 URL 入口。
   若当前版本的这个对话框只接受 Git 仓库 URL、不提供本地目录，先取消；按下文的官方本地 CLI 入口登记同一目录。
3. **安装前准备数据**：使用一份专供虚构 demo 的干净 checkout，在仓库根目录运行：

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund --offline
   npm test
   npm run verify:plugin
   node examples/sun-rain/demo.mjs --db project-control/state.db
   node src/cli.mjs task --db project-control/state.db --input examples/sun-rain/task.json
   npm run scan
   ```

   这里的 demo 命令就是 `npm run demo` 对应脚本，并显式固定数据库位置。
   未设置 `SHARED_STATE_DB` 时，可直接用 **`npm run demo`** 替代该行。
   若设置过这个变量，普通 `npm run demo` 可能初始化别处；上述显式 `--db` 命令仍会准备插件所需的库。
   数据库不随 Git 提交。新 clone 必须先做这一步，MCP 缺库会退出而不会创建数据库。
   demo 重跑不会覆盖后来的 update，也不会刷新旧任务时间；需要初始条件时使用新的干净 checkout。
4. 添加本地仓库根目录后，选择市场 **Shared State Local Alpha**。
   若目录未出现，完全退出再重新启动 Desktop，然后重新进入插件页。
5. 打开 **Agent Context Shared State (Local Alpha)**，选择安装并启用。
   该插件没有外部账号连接；marketplace 的 `ON_USE` 是安装策略元数据，不是 OAuth 配置。
6. 在 Desktop 的 **本地 Work 或 Codex** 中开一个**全新聊天**，明确选择这个插件，粘贴 [盲测提示词](../templates/BLIND_TEST.md)。
   本次本地 marketplace 接入按这两个官方文档支持的入口验证；不要用普通云端 Chat 或 Web/手机会话代替。
   不附带 demo 输出、评分表、正确任务 ID 或历史聊天摘要。验收员在聊天外保留上述实际读取结果。
7. 核对工具来源和调用结果：只能有三个读取工具。若工具不可用，应报告不可用；不能凭说明文档复述答案并算作通过。
   记录 Desktop 版本、日期、工具响应及 [验收结果](../templates/BLIND_TEST_EVALUATOR.md)。

### 对话框未提供本地目录时

使用官方支持的本地 marketplace 登记命令。在**同一个专用 demo checkout 根目录**执行：

```sh
codex plugin marketplace add .
codex plugin marketplace list --json
```

然后完全重启 Desktop，从市场列表选择 **Shared State Local Alpha**，继续第 5 步。
这需要当前 Codex CLI 与 Desktop 使用同一本地配置目录。若没有 `codex` 命令或市场仍未出现，保留配置并记录当前客户端版本/实际错误，不能把它算作 Desktop 验证通过。
不要把本次本地目录换成 GitHub URL：Git clone 不携带被忽略的示例数据库。

## 安装缓存与更新

本地安装器会复制插件目录，从**缓存副本**运行，而不是实时读取原 checkout。
所以本次盲测读取的是安装时 `project-control/state.db` 的快照；原仓库之后的 CLI 写入不会自动传入已安装插件。
先准备或更新源数据库，再卸载并从该本地市场重新安装，重启 Desktop、开新聊天才能测试新快照。
保留源数据库；不要在插件启动阶段执行 demo，也不要手动修改缓存里的代码。

当前本机安装器接受 `source.path: "./"`，因此仓库根可直接作为插件根，无需额外目录、launcher 或维护源码副本。
它也会复制被 Git 忽略的文件和 Git 元数据；**`git status` 干净不代表目录里没有额外文件**。
请使用专用的新 checkout，只放本仓库、虚构 demo 数据及必要安装产物，不放个人配置、凭据、其他项目数据或工作材料。
这不是公开分发数据库的方案；不要把初始化后的目录或安装缓存打包发布。

`.mcp.json` 使用 `command: "node"`、`cwd: "."` 和相对路径；插件运行时将相对 cwd 解析到安装后的插件根。
`--db project-control/state.db` 的优先级高于 `SHARED_STATE_DB`，不依赖启动聊天的工作目录，也没有机器绝对路径。
只有 MCP 被声明，没有 skills、hooks、app 映射或新的工具实现。

## 验证与边界

`npm run verify:plugin` 检查三个 JSON 的约定、相对路径、迁移到含空格目录后的源码字节、缺库失败、三个实际读取调用、写工具拒绝及读取前后数据库字节不变。
该检查已加入原有 Linux/Windows × Node 22.16.0/24.x CI，原有 18 个测试保留。
本机 Codex 插件解析器/安装器的验证与 Desktop UI 接入、真实新聊天盲测是三种不同证据；不能互相代替。
尚未宣称通过 ChatGPT Desktop 兼容认证或人工盲测。

本地安装不依赖 Git Push。若要让 GitHub main 和 CI 覆盖这次改动，仍需 Push 此次新提交并等待新的四项 matrix 结果；旧提交的绿色结果不覆盖新提交。

## 撤销

在 Desktop 的已安装插件中卸载 **Agent Context Shared State (Local Alpha)**，再移除 **Shared State Local Alpha** 市场来源。
若使用 CLI 登记，可执行 `codex plugin marketplace remove shared-state-local-alpha`。
关闭旧聊天，重新开聊确认工具不再加载；源仓库及其 demo 数据库不受卸载影响。
代码层面可单独 revert 添加包装层的提交，恢复原 CLI/MCP 使用方式；不要通过删除数据库撤销插件。

## 官方依据（2026-10-07 核对）

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)：兼容 manifest、repo marketplace、相对 source.path、本地缓存安装与 CLI 登记。
- [Plugin configuration](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins)：插件 stdio 的相对 cwd 从插件根解析。
- [Plugins](https://learn.chatgpt.com/docs/plugins)：插件安装后用新聊天加载工具。
- [Plugin management](https://learn.chatgpt.com/docs/enterprise/plugin-management)：含 MCP 配置插件的 Desktop-only 边界。

本地目录的具体按钮和可见性随客户端版本/工作区而异；上文为条件分支，未把未经实测的 UI 当成已确认步骤。
