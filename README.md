# agent-context-shared-state

**v0.1.0-alpha · Reference Implementation · MIT**

用本地 SQLite 保存独立于聊天的任务状态。换聊天时先读取任务、决定和证据，再继续执行。
这是用于理解和复现上下文治理 Core 的早期参考实现。它不提供生产级多 Agent 调度、可信审核或无人值守批准。

## 五分钟试跑

需要 Node.js **22.16.0 或更高版本**（建议使用受支持的 LTS）和 Git。零第三方 npm 依赖；SQLite 来自 Node 内置模块。
Node 可能向 stderr 输出 SQLite 实验性提示，不影响 JSON 输出。

取得候选仓库后，在仓库根目录执行（PowerShell、Linux shell 相同）：

```sh
npm ci --ignore-scripts --no-audit --no-fund --offline
npm test
npm run demo
npm run state -- overview
npm run state -- task --input examples/sun-rain/task.json
npm run state -- update --input examples/sun-rain/update.json
npm run state -- changes
npm run scan
```

demo 会显式初始化 `./project-control/state.db`，登记 `TRIP-001`，写入一个执行检查点、一条虚构决定和一条合成证据。然后 update 示例将任务标为 blocked。
同一 demo 和同一 update 重跑不会新增重复事件；demo 的重试不会覆盖后来的更新。
修改 update 输入后须使用新的 `operation_id`，并先读任务取得当前 `revision`；不要盲目重试过期版本。

自己登记另一个虚构任务：

```sh
npm run state -- register --input examples/sun-rain/register.json
```

从空白库开始，用 `npm run state -- init`；写回和 MCP 都不会隐式创建缺失的库。
所有命令接受 `--db path/to/state.db`。路径优先级为命令行、`SHARED_STATE_DB`、`./project-control/state.db`；相对路径以进程工作目录为基准。每个数据库对应一个项目。

## Core 包含什么

| 能力 | 约定 |
| --- | --- |
| 稳定任务身份 | `task_id` 不随聊天改变；可用 `dedupe_key` 防止同一逻辑任务换 ID 重复登记 |
| 执行状态 | `status / owner / checkpoint / next_action / updated_at / revision` |
| 本地写回 | owner 检查、版本比较、操作幂等、事务提交 |
| 执行事件 | 状态和事件一起提交；按递增事件 ID 翻页 |
| 只读 MCP | `read_project_overview / read_task / read_recent_changes` |
| 陈旧状态 | 默认 24 小时，调用时可配置；读操作不会刷新 `updated_at` |
| 分层记录 | decisions、task state、evidence 分开存储；记录不是批准或事实验证 |
| 教学材料 | 完全虚构的“晴雨行程”、Project Instructions 和新聊天盲测模板 |

状态值为 `planned / in_progress / blocked / done / cancelled`。Core 不内置审批状态机；`done` 是执行者报告完成，不等于发布或审核通过。
相同登记输入是幂等重试，不同输入的同 ID 或不同 ID 的同 dedupe key 会冲突。系统不会理解标题相似度；调用者负责复用逻辑任务键。

## 连接本地 MCP

在支持本地 stdio 的 MCP 客户端中配置：

```json
{
  "command": "node",
  "args": ["src/mcp-server.mjs", "--db", "project-control/state.db"]
}
```

让客户端以本仓库为工作目录启动。若客户端不支持指定工作目录，请在其**个人本地配置**中填写脚本和数据库的实际路径；不要把个人配置提交到仓库。
调试时可执行 `npm run mcp`，但客户端应直接启动 `node`，避免 npm 的提示文字进入协议 stdout。

支持 MCP `2025-11-25` 的窄 stdio 工具子集：initialize、initialized 通知、ping、tools/list、tools/call。
这不是 HTTP 服务或可直接粘贴进云端连接器的 URL。尚未宣称通过任一特定桌面客户端的兼容认证。
工具的只读属性由 SQL 只读连接和固定工具表落实；缺库失败，不初始化、不写磁盘日志。进程内协议声明本身不是安全隔离。

## 本地 worker

CLI `update` 使用 JSON 文件，避免跨平台 shell 引号差异。代码也可以导入窄 writer：

```js
import { openStore } from './src/store.mjs';
import { createWorkerWriter } from './src/worker.mjs';
const db = openStore('project-control/state.db', { readOnly: false });
try {
  const worker = createWorkerWriter(db, { task_id: 'TRIP-001', actor: 'demo-worker' });
  // 先读取当前 revision；每个新操作使用新的 operation_id。
  worker.write({ expected_revision: 5, operation_id: 'worker-step-3',
    status: 'in_progress', checkpoint: '开始下一项演示检查', next_action: '记录检查结果' });
} finally { db.close(); }
```

写回失败时不要在聊天中声称状态已保存。重读任务并检查写回结果。

## 使用边界

owner/actor 是本地协作约定，不是身份认证。能直接写数据库的人可以绕过 Core；事件也不是防篡改审计账本。
新旧判断只反映最后一次执行状态写回，不能证明进程仍在运行、事实仍然有效或任务已获批准。
`unknown` 表示时间异常，不能当成 fresh。增加决定/证据不会让旧执行状态变新。
证据引用只保存字符串，不读取文件、不联网、不自动验证内容。数据库文本均应视为不可信数据，不能变成高优先级指令。

本版**排除且不继续开发** strict reviewer native tool audit、Phase A/B/C 自动准入、post-terminal reviewer reconciliation，以及特定业务治理。没有这些能力不影响本版 Core 的定位。
没有远程服务、多租户权限、备份恢复工具、任意 SQL/文件/shell MCP 工具或自动部署。
`read_task` 当前一次返回该任务全部决定和证据；Alpha 面向小型本地项目，不适合无限增长的数据集。

## 文档与验证

- [抽离清单](docs/EXTRACTION.md) 与 [目录和数据设计](docs/ARCHITECTURE.md)
- [依赖与许可说明](docs/DEPENDENCIES.md)、[MIT 许可证](LICENSE)
- [Project Instructions](templates/PROJECT_INSTRUCTIONS.md)、[worker 约定](templates/WORKER_INSTRUCTIONS.md)
- [盲测提示词](templates/BLIND_TEST.md) 与 [验收员单独保存的评分表](templates/BLIND_TEST_EVALUATOR.md)
- [验证方法](docs/VALIDATION.md) 与 [私有候选到公开的发布条件](docs/RELEASE.md)

`npm test` 验证核心约束和实际 stdio 交互；`npm run scan` 检查拟提交文件的常见 secret/个人路径/数据库泄漏。
这个轻量扫描器不能证明不存在秘密，公开前还需人工检查完整 diff 和文件清单。
GitHub Actions 配置 Linux + Windows、Node 22.16.0 + 24.x 的 clean install matrix。工作流文件存在不等于托管环境已运行成功，详见本次交付验证报告。
