/**
 * The only module that talks to `ncm-cli`.
 *
 * Everything the plugin knows about NetEase Cloud Music goes through the
 * official CLI, so credentials, request signing, token refresh and rate
 * limiting stay owned by NetEase's own tooling instead of being reimplemented
 * here. Nothing in this file parses or stores a token.
 *
 * CLI output contract we rely on:
 * - `--output json` is a root option and the default; every JSON response
 *   carries a `success` boolean.
 * - `config get <key>` prints `key: value` text even under `--output json`,
 *   and `(未配置)` for an unset key.
 * @module dsh-plugin-netease-music/ncm-cli
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Failure classes the HTTP layer and the Agent tools map to user-visible hints. */
export class NcmError extends Error {
  /**
   * @param {string} kind stable failure class.
   * @param {string} message human-readable, already actionable.
   * @param {Record<string, unknown>} [detail] extra context for diagnostics.
   */
  constructor(kind, message, detail = {}) {
    super(message)
    this.name = 'NcmError'
    this.kind = kind
    this.detail = detail
  }
}

const UNCONFIGURED = '(未配置)'
const SEARCH_TYPES = new Set(['song', 'album', 'playlist', 'artist', 'all'])

/**
 * Keys whose values must never reach a log line, an HTTP response or a model.
 * @param {string} key config key.
 * @returns {boolean} whether the value is a secret.
 */
function isSecretKey(key) {
  return /private|secret|token|key/i.test(key)
}

/**
 * @param {string} name candidate config key.
 * @returns {boolean} whether the key name is safe to print.
 */
export { isSecretKey }

/**
 * @param {string} binPath CLI executable.
 * @returns {ReturnType<typeof createCli>} adapter bound to one executable.
 */
export function createCli(initialBinPath = 'ncm-cli', defaults = {}) {
  /** Mutable so a successful one-click install can adopt the resolved path. */
  let binPath = initialBinPath
  const defaultTimeout = Number.isFinite(defaults.timeoutMs) ? defaults.timeoutMs : 20000
  /** In-memory ring buffer of recent invocations, exposed for self-diagnosis. */
  const records = []

  /**
   * @param {Record<string, unknown>} entry one finished invocation.
   * @returns {void}
   */
  function record(entry) {
    records.push({ ...entry, at: new Date().toISOString() })
    if (records.length > 40) records.shift()
  }

  /**
   * Hide secret command-line values before they are recorded or returned.
   * @param {string[]} args raw argv.
   * @returns {string[]} masked copy.
   */
  function maskArgs(args) {
    const masked = [...args]
    for (let index = 0; index < masked.length - 1; index += 1) {
      if (masked[index] === 'config' && masked[index + 1] === 'set' && isSecretKey(masked[index + 2] ?? '')) {
        masked[index + 3] = '***'
      }
    }
    return masked
  }

  /**
   * Run one CLI command and return its raw text.
   * @param {string[]} args argv without the output flag.
   * @param {{ timeout?: number, json?: boolean }} [options] invocation options.
   * @returns {Promise<string>} stdout.
   */
  async function exec(args, options = {}) {
    const timeout = options.timeout ?? defaultTimeout
    const argv = options.json === false ? [...args] : [...args, '--output', 'json']
    const startedAt = Date.now()
    try {
      const { stdout, stderr } = await execFileAsync(binPath, argv, {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      })
      record({ args: maskArgs(args), ok: true, ms: Date.now() - startedAt })
      if (String(stderr ?? '').trim() !== '') record({ args: maskArgs(args), stderr: String(stderr).trim().slice(0, 500) })
      return String(stdout ?? '')
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code
      const stdout = String(error?.stdout ?? '')
      const stderr = String(error?.stderr ?? '')
      if (code === 'ENOENT') {
        record({ args: maskArgs(args), ok: false, error: 'ENOENT', ms: Date.now() - startedAt })
        throw new NcmError('cli_missing', `找不到 ncm-cli（${binPath}）。请先安装：npm install -g @music163/ncm-cli`, { binPath })
      }
      const timedOut = error?.killed === true || error?.signal === 'SIGTERM'
      record({
        args: maskArgs(args),
        ok: false,
        error: timedOut ? 'timeout' : String(code ?? 'failed'),
        ms: Date.now() - startedAt,
        stderr: stderr.trim().slice(0, 500),
      })
      if (timedOut) {
        throw new NcmError('cli_timeout', `ncm-cli 超过 ${timeout}ms 未返回，已终止。`, { args: maskArgs(args) })
      }
      const message = (stderr || stdout || error?.message || 'ncm-cli 调用失败').trim()
      throw new NcmError('cli_failed', message, { exitCode: code, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) })
    }
  }

  /**
   * Run one command and decode its JSON envelope.
   * @param {string[]} args argv without the output flag.
   * @param {{ timeout?: number, tolerateFailure?: boolean }} [options] invocation options.
   * @returns {Promise<any>} decoded payload.
   */
  async function execJson(args, options = {}) {
    const stdout = await exec(args, options)
    const text = stdout.trim()
    if (text === '') throw new NcmError('cli_unparsable', 'ncm-cli 没有返回任何内容。', { args: maskArgs(args) })
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      record({ args: maskArgs(args), error: 'unparsable', sample: text.slice(0, 300) })
      throw new NcmError('cli_unparsable', 'ncm-cli 返回了非 JSON 内容，可能版本不兼容。', { sample: text.slice(0, 600) })
    }
    if (payload && payload.success === false && options.tolerateFailure !== true) {
      throw new NcmError('api_rejected', String(payload.message ?? '网易云拒绝了这次请求。'), { payload })
    }
    return payload
  }

  /**
   * `ncm-cli --version`
   * @returns {Promise<string>} installed version.
   */
  async function version() {
    const stdout = await exec(['--version'], { json: false, timeout: 10000 })
    return stdout.trim()
  }

  /**
   * `ncm-cli config get <key>` — text output, `(未配置)` means unset.
   * @param {string} key config key.
   * @returns {Promise<string | null>} the value, or null when unset.
   */
  async function configGet(key) {
    const stdout = await exec(['config', 'get', key], { json: false })
    const line = stdout.split('\n').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${key}:`))
    if (line === undefined) return null
    // The CLI appends a source annotation such as ` (凭证文件)`; it is not part
    // of the value.
    const value = line.slice(key.length + 1).trim().replace(/\s*\([^)]*\)\s*$/, '')
    if (value === '' || value === UNCONFIGURED) return null
    return value
  }

  /**
   * `ncm-cli config set <key> <value>`
   * @param {string} key config key.
   * @param {string} value new value.
   * @returns {Promise<void>} resolves once the CLI accepted it.
   */
  async function configSet(key, value) {
    await exec(['config', 'set', key, value], { json: false })
  }

  /**
   * Credential and player shape for the settings page.
   * `privateKey` is only ever reported as present/absent.
   * @returns {Promise<{ appId: string | null, hasPrivateKey: boolean, player: string | null }>} summary.
   */
  async function configSummary() {
    const [appId, privateKey, player] = await Promise.all([
      configGet('appId').catch(() => null),
      configGet('privateKey').catch(() => null),
      configGet('player').catch(() => null),
    ])
    return { appId, hasPrivateKey: privateKey !== null, player }
  }

  /**
   * `ncm-cli login --check` — reports state instead of throwing.
   * @returns {Promise<{ loggedIn: boolean, message: string }>} login state.
   */
  async function loginCheck() {
    const payload = await execJson(['login', '--check'], { tolerateFailure: true, timeout: 15000 })
    const loggedIn = payload?.success === true
    return { loggedIn, message: String(payload?.message ?? (loggedIn ? '已登录' : '未登录')) }
  }

  /**
   * `ncm-cli login --background` — starts the QR flow and returns immediately.
   * @returns {Promise<{ message: string, url: string | null, raw: unknown }>} login invitation.
   */
  async function loginStart() {
    const payload = await execJson(['login', '--background'], { tolerateFailure: true, timeout: 30000 })
    return {
      message: String(payload?.message ?? (payload?.success === true ? '请扫码登录' : '登录未开始')),
      url: findFirstUrl(payload),
      raw: payload,
    }
  }

  /**
   * `ncm-cli state`
   * @returns {Promise<any>} playback state.
   */
  async function state() {
    const payload = await execJson(['state'], { timeout: 10000 })
    return payload?.state ?? payload
  }

  /**
   * `ncm-cli search <type> --keyword <kw>`.
   * `search` is registered dynamically by the CLI at runtime, so an offline or
   * unauthenticated environment reports a missing command instead of results.
   * @param {string} type song | album | playlist | artist | all.
   * @param {string} keyword search text.
   * @returns {Promise<{ type: string, keyword: string, items: any[], raw: unknown }>} normalized results.
   */
  async function search(type, keyword) {
    const scope = SEARCH_TYPES.has(type) ? type : 'song'
    const args = ['search', scope, '--keyword', keyword]
    let payload
    try {
      payload = await execJson([...args, '--userInput', `搜索「${keyword}」`])
    } catch (error) {
      // Older or offline builds do not accept --userInput; retry once without it.
      if (error instanceof NcmError && /unknown option|未知选项/i.test(error.message)) {
        payload = await execJson(args)
      } else if (error instanceof NcmError && /unknown command/i.test(error.message)) {
        throw new NcmError(
          'command_unavailable',
          '当前 ncm-cli 没有注册 search 命令：它需要有效的 API Key 和网络才能加载。请先在设置里完成配置。',
          { detail: error.detail },
        )
      } else {
        throw error
      }
    }
    return { type: scope, keyword, items: normalizeSongs(payload), raw: payload }
  }

  /**
   * `ncm-cli play` — one song, or a whole playlist.
   * @param {{ encryptedId?: string, originalId?: string, playlist?: boolean }} request target ids.
   * @returns {Promise<any>} CLI payload.
   */
  async function play(request) {
    const args = ['play']
    if (request.playlist === true) args.push('--playlist')
    else args.push('--song')
    if (request.encryptedId) args.push('--encrypted-id', String(request.encryptedId))
    if (request.originalId) args.push('--original-id', String(request.originalId))
    if (args.length <= 2) throw new NcmError('bad_request', '缺少歌曲 ID，无法播放。')
    return execJson(args, { timeout: 30000, tolerateFailure: true })
  }

  /**
   * Playback transport controls.
   * @param {string} action pause | resume | stop | next | prev | seek | volume.
   * @param {number} [value] seconds for seek, 0-100 for volume.
   * @returns {Promise<any>} CLI payload.
   */
  async function control(action, value) {
    const allowed = new Set(['pause', 'resume', 'stop', 'next', 'prev', 'seek', 'volume'])
    if (!allowed.has(action)) throw new NcmError('bad_request', `不支持的播控指令：${action}`)
    if (action === 'seek' || action === 'volume') {
      if (!Number.isFinite(value)) throw new NcmError('bad_request', `${action} 需要一个数值参数。`)
      return execJson([action, String(Math.round(/** @type {number} */ (value)))], { timeout: 15000, tolerateFailure: true })
    }
    return execJson([action], { timeout: 15000, tolerateFailure: true })
  }

  /**
   * @returns {Array<Record<string, unknown>>} recent CLI invocations, secrets masked.
   */
  function history() {
    return records.slice(-20).reverse()
  }

  /**
   * Adopt a newly installed executable without recreating the adapter.
   * @param {string} next absolute path of the CLI.
   * @returns {void}
   */
  function setBinPath(next) {
    if (typeof next === 'string' && next.trim() !== '') binPath = next.trim()
  }

  return { version, configGet, configSet, configSummary, loginCheck, loginStart, state, search, play, control, history, setBinPath, get binPath() { return binPath } }
}

/**
 * @param {unknown} value any JSON value.
 * @returns {string | null} first http(s) URL found within it.
 */
function findFirstUrl(value) {
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item)
      if (found !== null) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findFirstUrl(item)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Find the result array inside an unknown search envelope.
 * The CLI's dynamic command family may nest results differently per version, so
 * the shape is discovered instead of assumed.
 * @param {unknown} node candidate subtree.
 * @param {number} [depth] recursion guard.
 * @returns {any[] | null} the most song-like array found.
 */
function findResultArray(node, depth = 0) {
  if (node === null || typeof node !== 'object' || depth > 6) return null
  if (Array.isArray(node)) {
    const objects = node.filter((item) => item && typeof item === 'object')
    if (objects.length > 0 && objects.some((item) => 'name' in item || 'songName' in item || 'title' in item)) return node
    for (const item of node) {
      const found = findResultArray(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  const preferred = ['songs', 'data', 'result', 'list', 'items', 'records', 'playlists', 'albums']
  for (const key of preferred) {
    if (key in node) {
      const found = findResultArray(node[key], depth + 1)
      if (found !== null) return found
    }
  }
  for (const item of Object.values(node)) {
    const found = findResultArray(item, depth + 1)
    if (found !== null) return found
  }
  return null
}

/**
 * Project a CLI record onto the fields the UI and the Agent tools share.
 * @param {any} item one raw record.
 * @returns {object} stable song shape.
 */
function toSong(item) {
  // The CLI names the encrypted id `id` (32 hex) and the numeric one
  // `originalId`; older payloads used `encryptedId`/`eid`. Accept both shapes.
  const rawId = item?.id
  const encryptedId = item?.encryptedId ?? item?.encrypted_id ?? item?.eid
    ?? (typeof rawId === 'string' && /^[0-9a-f]{32}$/i.test(rawId) ? rawId : null)
  const originalId = item?.originalId ?? item?.original_id ?? item?.songId
    ?? (typeof rawId === 'number' ? rawId : null)
  const artists = item?.artists ?? item?.ar ?? item?.singers ?? []
  const artistNames = Array.isArray(artists)
    ? artists.map((artist) => (typeof artist === 'string' ? artist : artist?.name)).filter((name) => typeof name === 'string' && name !== '')
    : []
  const album = item?.album ?? item?.al ?? null
  const duration = item?.duration ?? item?.dt ?? null
  return {
    encryptedId,
    originalId,
    name: String(item?.name ?? item?.songName ?? item?.title ?? ''),
    artists: artistNames,
    album: String(album?.name ?? item?.albumName ?? ''),
    durationMs: Number.isFinite(duration) ? duration : null,
    cover: album?.picUrl ?? item?.coverImgUrl ?? item?.picUrl ?? null,
    playable: item?.visible !== false && item?.noCopyright !== true,
    link: originalId === null
      ? null
      : `https://music.163.com/#/song?id=${originalId}`,
  }
}

/**
 * @param {unknown} payload raw CLI envelope.
 * @returns {object[]} normalized songs, capped for transport.
 */
export function normalizeSongs(payload) {
  const array = findResultArray(payload)
  if (array === null) return []
  return array.slice(0, 40).map(toSong).filter((song) => song.name !== '')
}
