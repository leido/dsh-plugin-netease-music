/**
 * One-click install of the official CLI.
 *
 * The plugin depends on `@music163/ncm-cli`, and asking a user to leave the UI
 * for a terminal is exactly the friction this plugin exists to remove. The
 * installer therefore runs one fixed command — the package name is a constant,
 * never user input — and exposes its progress as a job the settings page polls,
 * the same shape the plugin manager uses for third-party plugins.
 *
 * Only the CLI is installed. `mpv` needs a system package manager and sudo, so
 * the settings page explains it instead of pretending to automate it.
 * @module dsh-plugin-netease-music/installer
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

/** The one package this endpoint is allowed to install. */
const PACKAGE = '@music163/ncm-cli'

/** Give up after five minutes; a global install that takes longer is stuck. */
const TIMEOUT_MS = 5 * 60 * 1000

/** Keep enough context to diagnose a failure without unbounded memory. */
const MAX_LOG_LINES = 200

/** @type {{ id: string, state: 'running' | 'success' | 'failed', log: string[], startedAt: string, finishedAt?: string, code?: number | null, binPath?: string, message?: string } | null} */
let current = null
let sequence = 0

/**
 * Resolve the npm executable for this platform.
 * @returns {string} command name.
 */
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * @param {string} line one output line.
 * @returns {void}
 */
function append(line) {
  if (current === null) return
  current.log.push(line)
  if (current.log.length > MAX_LOG_LINES) current.log.splice(0, current.log.length - MAX_LOG_LINES)
}

/**
 * Locate the installed binary, so a prefix outside the server's PATH still works.
 * @returns {Promise<string | undefined>} absolute path when it can be resolved.
 */
function resolveInstalledBinary() {
  return new Promise((resolve) => {
    const child = spawn(npmCommand(), ['prefix', '-g'], { windowsHide: true })
    let stdout = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.on('error', () => resolve(undefined))
    child.on('close', () => {
      const prefix = stdout.trim()
      if (prefix === '') {
        resolve(undefined)
        return
      }
      resolve(process.platform === 'win32' ? join(prefix, 'ncm-cli.cmd') : join(prefix, 'bin', 'ncm-cli'))
    })
  })
}

/**
 * Start an install job. Concurrent requests join the running job instead of
 * stacking npm processes.
 * @param {{ binPath?: string }} [options] current CLI configuration.
 * @returns {object} the running job snapshot.
 */
export function startInstall(options = {}) {
  if (current !== null && current.state === 'running') return snapshot()
  sequence += 1
  current = {
    id: `install-${Date.now()}-${sequence}`,
    state: 'running',
    log: [],
    startedAt: new Date().toISOString(),
  }
  append(`$ npm install -g ${PACKAGE}`)

  let child
  try {
    child = spawn(npmCommand(), ['install', '-g', PACKAGE], {
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_fund: 'false', npm_config_audit: 'false' },
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return snapshot()
  }

  const timer = setTimeout(() => {
    append('安装超时，已终止。')
    child.kill('SIGTERM')
  }, TIMEOUT_MS)
  timer.unref?.()

  const collect = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const trimmed = line.trimEnd()
      if (trimmed !== '' && current !== null) append(trimmed)
    }
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  child.on('error', (error) => {
    clearTimeout(timer)
    fail(error.message)
  })

  child.on('close', (code) => {
    clearTimeout(timer)
    if (current === null) return
    if (code === 0) {
      void resolveInstalledBinary().then((binPath) => {
        if (current === null) return
        current.state = 'success'
        current.code = 0
        current.finishedAt = new Date().toISOString()
        if (binPath !== undefined) current.binPath = binPath
        append('安装完成。')
        void options
      })
    } else {
      current.code = code
      fail(`npm 退出码 ${code}`)
    }
  })

  return snapshot()
}

/**
 * @param {string} message short failure reason.
 * @returns {void}
 */
function fail(message) {
  if (current === null) return
  current.state = 'failed'
  current.message = message
  current.finishedAt = new Date().toISOString()
  append(`失败：${message}`)
}

/**
 * @returns {object | null} a copy safe to serialize.
 */
export function snapshot() {
  if (current === null) return null
  return { ...current, log: current.log.slice(-MAX_LOG_LINES) }
}

/**
 * @returns {object | null} the current job, whatever its state.
 */
export function currentJob() {
  return snapshot()
}
