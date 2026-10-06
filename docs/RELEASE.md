# v0.1.0-alpha 发布条件

建议独立 GitHub 仓库名为 `agent-context-shared-state`，首次创建设为 private。
package.json 的 `private:true` 阻止意外 npm 发布，与 GitHub 可见性互相独立；即使将来 GitHub public，也可以保留该字段。

公开前逐项留下实际证据：

- 用户已选择 MIT，LICENSE 已提供；新候选不宣称任何原仓库自动变为 MIT。
- 人工审阅全部候选文件及初始 Git 历史；没有真实项目数据、路径、聊天 ID、数据库、日志或凭据。
- 同机 fresh clone 初始化和 README 流程通过。
- GitHub Actions Linux/Windows、Node 22.16/24 四个托管 job 均通过，并对应同一候选 commit。
- 在实际 MCP 客户端完成新聊天盲测，记录未验证项。
- README 正确保留 Alpha、信任边界、MCP 子集和未支持功能。

首次账户创建、组织选择、计费/条款等需要账户级决定时，应停在创建前确认。不要为通过 CI 自动改变组织策略或购买额度。
以上条件未满足前维持 private。不要把文档中的计划当成已完成的远端创建、CI 运行或公开发布。
本候选不依赖另一个项目继续开发，也不回写那个项目的控制状态。
