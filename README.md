# HerdR dsh-TUI Status

将 dsh-TUI 的真实对话状态同步到 HerdR 左侧 **Agents** 栏。

## 状态规则

| DSH 事件 | HerdR 显示 |
| --- | --- |
| 模型思考、生成回答、执行工具 | `运行中`（转圈） |
| `ask_user_question` 问卷 | `等待输入` |
| 命令授权请求 | `等待输入` |
| 回合结束 | `空闲` |
| dsh-TUI 退出 | 自动移除状态 |

状态桥接只读取 DSH 的 `agent/status` 与 `session/event`，不解析终端输出，也不会向 DSH
会话日志写入数据。因此不会影响 `/resume`、上下文或原始对话记录。

## 使用方式

安装后有两种启动方式：

1. 在 HerdR Actions 中选择 **启动 dsh-TUI**；它会打开独立 Pane。
2. 在任意 HerdR 终端直接运行：

   ```sh
   dsh-tui
   ```

`dsh-tui` 已安装为用户级启动包装器，实际会运行 `dsh --profile dsh-tui`，从而加载本
插件。若某个已经打开的 zsh 终端此前运行过旧的全局 `dsh-tui`，请先执行一次 `rehash`，
再启动新的 dsh-TUI；HerdR Actions 的启动方式不受此影响。

HerdR 会向每个 Pane 注入 `HERDR_PANE_ID`。DSH 状态桥接插件只向这个 Pane 上报状态，
因此切换焦点或同时运行多个 dsh-TUI 不会相互覆盖。

## 开发目录

- `herdr-plugin.toml`：HerdR 动作与 Pane 声明。
- `dsh-plugin/`：通过 `dsh plugin --profile dsh-tui add` 安装的 Cordis 状态桥接插件。
