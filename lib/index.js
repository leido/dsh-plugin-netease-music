/**
 * Host half of the plugin.
 *
 * It owns two surfaces over one `ncm-cli` adapter:
 * - an HTTP prefix the browser half calls (settings, search, transport),
 * - a small set of Agent tools that project the same adapter for the model.
 *
 * No credential, token or request signature is handled here; `ncm-cli` keeps
 * them, which is the whole reason this plugin depends on it.
 * @module dsh-plugin-netease-music
 */
import { createCli } from './ncm-cli.js'
import { createStatusReader, registerRoutes } from './routes.js'
import { registerTools } from './tools.js'

/** Stable Loader identity, equal to the package name and the browser module id. */
export const name = 'netease-music'

/** The HTTP surface is mandatory; Agent tools attach only when a tools service exists. */
export const inject = ['webServer']

/**
 * @param {any} ctx plugin context.
 * @param {{ cliPath?: string, timeoutMs?: number, mpvPath?: string }} [config] row config.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const cliPath = typeof config.cliPath === 'string' && config.cliPath.trim() !== '' ? config.cliPath.trim() : 'ncm-cli'
  const mpvPath = typeof config.mpvPath === 'string' && config.mpvPath.trim() !== '' ? config.mpvPath.trim() : 'mpv'
  const cli = createCli(cliPath, { timeoutMs: config.timeoutMs })
  /** Observable activation state, surfaced through the status endpoint. */
  const runtime = { toolsRegistered: false }
  const status = createStatusReader(cli, { mpvPath, runtime })

  registerRoutes(ctx, cli, { mpvPath, runtime })

  runtime.toolsAvailable = false
  if (config.toolsEnabled === false) {
    runtime.toolsError = '已通过配置关闭（toolsEnabled: false）'
    return
  }
  ctx.inject(['tools'], (toolCtx) => {
    runtime.toolsAvailable = true
    try {
      registerTools(toolCtx, cli, status)
      runtime.toolsRegistered = true
    } catch (error) {
      runtime.toolsError = error instanceof Error ? error.message : String(error)
    }
  })
  setTimeout(() => {
    if (!runtime.toolsRegistered && runtime.toolsError === undefined) {
      runtime.toolsError = runtime.toolsAvailable ? '工具注册回调未触发' : 'Host 没有暴露 tools 服务'
    }
  }, 4000).unref?.()
}
