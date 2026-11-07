/**
 * Host-side HTTP surface of the plugin.
 *
 * The browser half is served from the same origin as this route prefix, so a
 * same-origin `fetch` is enough: no RPC codegen, no token plumbing, and the
 * whole surface is inspectable with `curl` while developing.
 * @module dsh-plugin-netease-music/routes
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NcmError } from './ncm-cli.js'
import { currentJob, startInstall } from './installer.js'

const execFileAsync = promisify(execFile)

/** Route prefix owned by this plugin. Distinct from `/api` (the Host gateway). */
export const ROUTE_PREFIX = '/netease-music/api'

const MAX_BODY_BYTES = 64 * 1024

/**
 * A client mistake with an explicit status code.
 */
class HttpError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} message user-facing message.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * @param {import('node:http').ServerResponse} res response.
 * @param {number} status status code.
 * @param {unknown} payload JSON payload.
 * @returns {void}
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

/**
 * Read and decode a JSON request body.
 * @param {import('node:http').IncomingMessage} req request.
 * @returns {Promise<Record<string, unknown>>} decoded object.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON 对象')
  }
}

/**
 * Refuse cross-site requests.
 *
 * The Host web server may be reachable beyond loopback, so a state-changing
 * request must prove it came from the page this server rendered. A browser
 * cannot forge `Origin`, and the custom header forces a preflight for any
 * cross-origin attempt.
 * @param {import('node:http').IncomingMessage} req request.
 * @returns {void}
 */
function assertSameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let host
    try {
      host = new URL(origin).host
    } catch {
      throw new HttpError(403, '拒绝来自未知来源的请求')
    }
    if (host !== req.headers.host) throw new HttpError(403, '拒绝跨站请求')
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-ncm-request'] !== '1') {
    throw new HttpError(403, '缺少请求标记头')
  }
}

/**
 * @param {string} binPath executable.
 * @returns {Promise<{ installed: boolean, version: string | null }>} player probe.
 */
async function probeMpv(binPath) {
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 3000, windowsHide: true })
    const match = /mpv\s+v?([0-9][^\s]*)/i.exec(String(stdout))
    return { installed: true, version: match?.[1] ?? null }
  } catch {
    return { installed: false, version: null }
  }
}

/**
 * Build the composite status the settings page and the player both read.
 * @param {{ cli: any, mpvPath: string }} deps services.
 * @returns {Promise<Record<string, unknown>>} status snapshot.
 */
async function readStatus({ cli, mpvPath, runtime }) {
  const [cliInfo, credentials, login, mpv] = await Promise.all([
    cli.version()
      .then((version) => ({ installed: true, version, binPath: cli.binPath }))
      .catch((error) => {
        if (error instanceof NcmError && error.kind === 'cli_missing') return { installed: false, version: null, binPath: cli.binPath, message: error.message }
        return { installed: false, version: null, binPath: cli.binPath, message: error instanceof Error ? error.message : 'ncm-cli 不可用' }
      }),
    cli.configSummary(),
    cli.loginCheck().catch((error) => ({ loggedIn: false, message: error instanceof Error ? error.message : '登录状态未知' })),
    probeMpv(mpvPath),
  ])
  return {
    cli: cliInfo,
    credentials,
    login,
    player: credentials.player,
    mpv,
    tools: runtime?.toolsRegistered === true,
    toolsError: runtime?.toolsError ?? null,
    ready: cliInfo.installed && credentials.appId !== null && credentials.hasPrivateKey && login.loggedIn,
  }
}

/**
 * @param {any} cli adapter from `createCli`.
 * @param {{ mpvPath?: string }} [options] probe paths.
 * @returns {object} status reader shared by routes and tools.
 */
export function createStatusReader(cli, options = {}) {
  const mpvPath = options.mpvPath ?? 'mpv'
  const runtime = options.runtime
  return () => readStatus({ cli, mpvPath, runtime })
}

/**
 * Register every route on the Host web server.
 * @param {any} ctx plugin context carrying `webServer`.
 * @param {any} cli adapter.
 * @param {{ mpvPath?: string }} [options] probe paths.
 * @returns {void}
 */
export function registerRoutes(ctx, cli, options = {}) {
  const status = createStatusReader(cli, options)

  /**
   * @param {import('node:http').IncomingMessage} req request.
   * @param {import('node:http').ServerResponse} res response.
   * @returns {Promise<void>} resolves after the response is written.
   */
  async function handler(req, res) {
    try {
      assertSameOrigin(req)
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/, '') || '/'
      const method = req.method ?? 'GET'

      if (route === '/status' && method === 'GET') {
        sendJson(res, 200, { ok: true, data: await status() })
        return
      }

      if (route === '/config' && method === 'POST') {
        const body = await readJsonBody(req)
        const writes = []
        if (typeof body.appId === 'string') {
          const appId = body.appId.trim()
          if (appId === '' || appId.length > 200) throw new HttpError(400, 'appId 不合法')
          writes.push(['appId', appId])
        }
        if (typeof body.privateKey === 'string' && body.privateKey.trim() !== '') {
          if (body.privateKey.length > 4000) throw new HttpError(400, 'privateKey 不合法')
          writes.push(['privateKey', body.privateKey.trim()])
        }
        if (typeof body.player === 'string') {
          if (body.player !== 'mpv' && body.player !== 'orpheus') throw new HttpError(400, '播放器只能是 mpv 或 orpheus')
          writes.push(['player', body.player])
        }
        if (writes.length === 0) throw new HttpError(400, '没有需要写入的配置')
        for (const [key, value] of writes) await cli.configSet(key, value)
        sendJson(res, 200, { ok: true, data: await status() })
        return
      }

      if (route === '/login' && method === 'POST') {
        const result = await cli.loginStart()
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/search' && method === 'GET') {
        const keyword = (url.searchParams.get('keyword') ?? '').trim()
        const type = (url.searchParams.get('type') ?? 'song').trim()
        if (keyword === '') throw new HttpError(400, '请输入搜索关键词')
        if (keyword.length > 100) throw new HttpError(400, '搜索关键词过长')
        const result = await cli.search(type, keyword)
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/play' && method === 'POST') {
        const body = await readJsonBody(req)
        const result = await cli.play({
          encryptedId: typeof body.encryptedId === 'string' ? body.encryptedId : undefined,
          originalId: typeof body.originalId === 'string' || typeof body.originalId === 'number' ? String(body.originalId) : undefined,
          playlist: body.playlist === true,
        })
        if (result?.success === false) {
          throw new NcmError('api_rejected', String(result.message ?? '播放失败'))
        }
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/control' && method === 'POST') {
        const body = await readJsonBody(req)
        const action = String(body.action ?? '')
        const value = typeof body.value === 'number' ? body.value : undefined
        const result = await cli.control(action, value)
        if (result?.success === false) {
          throw new NcmError('api_rejected', String(result.message ?? '播控失败'))
        }
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/state' && method === 'GET') {
        sendJson(res, 200, { ok: true, data: await cli.state() })
        return
      }

      if (route === '/install' && method === 'POST') {
        sendJson(res, 200, { ok: true, data: startInstall() })
        return
      }

      if (route === '/install' && method === 'GET') {
        const job = currentJob()
        // A successful install resolves the real prefix; adopt it so later
        // calls work even when that bin directory is not on this process PATH.
        if (job?.state === 'success' && typeof job.binPath === 'string') cli.setBinPath(job.binPath)
        sendJson(res, 200, { ok: true, data: job })
        return
      }

      if (route === '/queue' && method === 'GET') {
        sendJson(res, 200, { ok: true, data: await cli.queueList() })
        return
      }

      if (route === '/queue/add' && method === 'POST') {
        const body = await readJsonBody(req)
        const result = await cli.queueAdd({
          encryptedId: typeof body.encryptedId === 'string' ? body.encryptedId : undefined,
          originalId: typeof body.originalId === 'string' || typeof body.originalId === 'number' ? String(body.originalId) : undefined,
          next: body.next === true,
        })
        if (result?.success === false) throw new NcmError('api_rejected', String(result.message ?? '加入队列失败'))
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/queue/clear' && method === 'POST') {
        const result = await cli.queueClear()
        if (result?.success === false) throw new NcmError('api_rejected', String(result.message ?? '清空队列失败'))
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      if (route === '/diagnostics' && method === 'GET') {
        sendJson(res, 200, { ok: true, data: { binPath: cli.binPath, calls: cli.history() } })
        return
      }

      throw new HttpError(404, '接口不存在')
    } catch (error) {
      sendError(res, error)
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'netease-music: routes')
}

/**
 * @param {import('node:http').ServerResponse} res response.
 * @param {unknown} error thrown value.
 * @returns {void}
 */
function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { ok: false, error: { kind: 'request', message: error.message } })
    return
  }
  if (error instanceof NcmError) {
    const status = error.kind === 'cli_missing' ? 503 : error.kind === 'cli_timeout' ? 504 : 502
    sendJson(res, status, { ok: false, error: { kind: error.kind, message: error.message } })
    return
  }
  sendJson(res, 500, { ok: false, error: { kind: 'internal', message: error instanceof Error ? error.message : '未知错误' } })
}
