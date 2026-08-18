/**
 * dsh-TUI 与 HerdR 的状态桥接。
 *
 * 仅消费 DSH 已公开的 Agent 和会话事件，不写入会话日志，也不影响模型上下文。
 * 所有 HerdR 更新都绑定到当前进程继承的 HERDR_PANE_ID，避免跨 Pane 误上报。
 */

import { spawn } from 'node:child_process'

export const name = 'herdr-dsh-status'
export const inject = ['agents']

/** DSH 等待用户交互时使用的工具名称。 */
const USER_QUESTION_TOOL = 'ask_user_question'

/** HerdR 中用于标识本桥接插件状态写入来源的固定前缀。 */
const SOURCE_PREFIX = 'xichen.herdr-dsh-status'

/** HerdR 中 dsh-TUI 的稳定 Agent 类型；不随 Pane 重命名变化。 */
const HERDR_AGENT_KIND = 'dsh-tui'

/** 将 DSH 的会话事件中可能含换行的文本收敛为 HerdR 单行状态。 */
function oneLine(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized.length === 0 ? fallback : normalized.slice(0, 120)
}

/** 从 DSH Agent 或 Session 对象提取稳定的会话 ID。 */
function sessionIdOf(candidate) {
  const session = candidate?.session ?? candidate
  return typeof session?.id === 'string' && session.id.length > 0 ? session.id : undefined
}

/**
 * 将一次 HerdR CLI 调用置于后台执行。
 *
 * @param {string} herdrBin HerdR 可执行文件路径。
 * @param {string[]} commandArguments HerdR 子命令及参数。
 */
function runHerdr(herdrBin, commandArguments) {
  try {
    const child = spawn(herdrBin, commandArguments, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // HerdR 服务重启或 dsh-TUI 在普通终端启动时，静默降级为无状态显示。
  }
}

/**
 * 创建绑定单个 HerdR Pane 的状态上报器，并合并相同状态以避免流式输出产生大量 CLI 调用。
 *
 * @param {string} paneId HerdR Pane ID。
 * @param {string} source 本进程本次运行的状态来源 ID。
 * @returns {{ report: (state: string, message: string, sessionId?: string) => void, release: () => void }}
 */
function createReporter(paneId, source) {
  const herdrBin = process.env.HERDR_BIN_PATH || 'herdr'
  let lastSignature = ''
  let released = false

  /**
   * 将 DSH 状态同步到 HerdR 的 Agent 行与显示元数据。
   *
   * Agent 类型必须固定为 `dsh-tui`，就像 Codex 始终上报 `codex` 一样。用户通过
   * Ctrl-b a 或右键写入的是 Pane label，由 herdr-agent-renamer 的 `agent_label`
   * token 单独负责侧栏显示；绝不能把该显示名回写为真实 Agent 类型。
   */
  const report = (state, message, currentSessionId) => {
    if (released) return
    const displayMessage = oneLine(message, 'DSH 空闲')
    const signature = `${state}\u0000${displayMessage}\u0000${currentSessionId ?? ''}`
    if (signature === lastSignature) return
    lastSignature = signature

    const agentArguments = [
      'pane', 'report-agent', paneId,
      '--source', source,
      '--agent', HERDR_AGENT_KIND,
      '--state', state,
      '--message', displayMessage,
    ]
    if (currentSessionId !== undefined) {
      agentArguments.push('--agent-session-id', currentSessionId)
    }
    runHerdr(herdrBin, agentArguments)

    // 清理旧版本或改名插件遗留的 display-agent，统一由独立 agent_label token 显示名称。
    const title = `DSH TUI · ${displayMessage}`
    runHerdr(herdrBin, [
      'pane', 'report-metadata', paneId,
      '--source', source,
      '--title', title,
      '--clear-display-agent',
      '--state-label', 'working=运行中',
      '--state-label', 'blocked=等待输入',
      '--state-label', 'idle=空闲',
    ])
  }

  /** 仅清理本插件自己的 source，不影响同一 Pane 的其他 Agent 状态来源。 */
  const release = () => {
    if (released) return
    released = true
    runHerdr(herdrBin, [
      'pane', 'release-agent', paneId,
      '--source', source,
      '--agent', HERDR_AGENT_KIND,
    ])
    runHerdr(herdrBin, [
      'pane', 'report-metadata', paneId,
      '--source', source,
      '--clear-title',
      '--clear-state-labels',
    ])
  }

  return { report, release }
}

/**
 * 挂载 DSH 运行时事件监听。
 *
 * 主流程：启动时先显示空闲状态，确保未发起首轮对话的 dsh-TUI 也能出现在 HerdR
 * Agents 栏；`agent/status` 确定忙闲；会话事件补充工具、授权和问卷等待状态。
 * 桥接不创建新会话事件，因此不会改变 dsh-TUI 的 resume、上下文或持久化行为。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 运行时上下文。
 */
export function apply(ctx) {
  const paneId = process.env.HERDR_PANE_ID
  if (typeof paneId !== 'string' || paneId.length === 0) return

  const reporter = createReporter(paneId, `${SOURCE_PREFIX}.${process.pid}`)
  let activeSessionId

  // DSH 在初始空闲时未必触发 agent/status；主动报一次，保证界面上始终可见。
  reporter.report('idle', 'DSH 已启动')

  ctx.on('agent/status', ({ agent, status }) => {
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) activeSessionId = sessionId
    if (status === 'running') {
      reporter.report('working', 'DSH 正在处理', sessionId)
    } else {
      reporter.report('idle', 'DSH 空闲', sessionId)
    }
  })

  ctx.on('session/event', (session, event) => {
    const sessionId = sessionIdOf(session)
    // 多会话并存时只展示最后一次活动的会话，避免后台遗留会话覆盖前台状态。
    if (activeSessionId !== undefined && sessionId !== activeSessionId) return
    if (sessionId !== undefined) activeSessionId = sessionId

    switch (event.type) {
      case 'turn/start':
        reporter.report('working', 'DSH 正在思考', sessionId)
        break
      case 'assistant/chunk':
        reporter.report('working', 'DSH 正在生成回答', sessionId)
        break
      case 'tool/call': {
        const toolName = oneLine(event.data?.name, '工具')
        if (toolName === USER_QUESTION_TOOL) {
          reporter.report('blocked', '等待用户输入', sessionId)
        } else {
          reporter.report('working', `正在执行 ${toolName}`, sessionId)
        }
        break
      }
      case 'tool/result':
        reporter.report('working', 'DSH 正在继续处理', sessionId)
        break
      case 'approval/asked':
        reporter.report('blocked', '等待命令授权', sessionId)
        break
      case 'approval/decided':
        reporter.report('working', '授权已处理，正在继续', sessionId)
        break
      case 'turn/end':
        reporter.report('idle', 'DSH 空闲', sessionId)
        break
      default:
        break
    }
  })

  ctx.effect(() => () => reporter.release(), 'herdr-dsh-status release')
}
