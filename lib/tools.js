/**
 * Agent-facing tools.
 *
 * They are a thin projection of the same adapter the UI uses, so a request from
 * the model and a click in the panel produce exactly the same CLI call.
 *
 * Schema policy — learned the hard way: the model provider validates tool
 * `input_schema` strictly. Keep every parameter required, keep property names
 * away from JSON Schema keywords (`type`, `enum`, `const`, `items`, …), and
 * prefer `enum` over free-form strings. One rejected property breaks the whole
 * conversation, not just the tool.
 * @module dsh-plugin-netease-music/tools
 */
import { NcmError } from './ncm-cli.js'

/**
 * Drop `undefined` fields.
 *
 * Tool results are validated as lossless JSON: an `undefined` property is not
 * JSON at all, so an optional field that has no value must be absent rather
 * than present-and-undefined.
 * @template T
 * @param {T} value candidate object.
 * @returns {T} the same object without undefined-valued keys.
 */
function compact(value) {
  const result = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    // `null` is dropped too: every declared output field is non-nullable, and
    // the CLI reports "no value" as null rather than as an absent key.
    if (item !== undefined && item !== null) result[key] = item
  }
  return result
}

/** Transport actions that take no numeric argument. */
const TRANSPORT_ACTIONS = ['pause', 'resume', 'stop', 'next', 'prev']

/**
 * @param {any} ctx tool-capable context.
 * @param {any} cli adapter.
 * @param {() => Promise<Record<string, unknown>>} status status reader.
 * @returns {void}
 */
export function registerTools(ctx, cli, status) {
  const disposers = []

  /**
   * @param {string} keyword search text.
   * @returns {Promise<object[]>} normalized songs.
   */
  async function searchSongs(keyword) {
    const result = await cli.search('song', keyword)
    return result.items
  }

  disposers.push(ctx.tools.register({
    name: 'netease_search',
    description: '用网易云音乐搜索歌曲，返回歌名、歌手、专辑、时长、可播放性与可点击链接。当用户想找歌、想听某个主题时使用。依赖已配置的 ncm-cli API Key 与登录态。',
    parameters: {
      keyword: { type: 'string', required: true, description: '搜索关键词，例如歌手名、歌名或场景词。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'count', 'songs'],
        properties: {
          keyword: { type: 'string' },
          count: { type: 'integer' },
          songs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'artists', 'playable'],
              properties: {
                name: { type: 'string' },
                artists: { type: 'array', items: { type: 'string' } },
                album: { type: 'string' },
                durationMs: { type: 'integer' },
                playable: { type: 'boolean' },
                link: { type: 'string' },
                encryptedId: { type: 'string' },
                originalId: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? `没有找到「${value.keyword}」的结果。`
          : value.songs.slice(0, 10).map((song, index) => {
            const artists = song.artists.join(' / ')
            const flag = song.playable ? '' : '（不可播放）'
            return `${index + 1}. ${song.name} - ${artists}${flag}${song.link ? ` ${song.link}` : ''}`
          }).join('\n'),
      }],
    },
    async execute(args) {
      const keyword = String(args?.keyword ?? '').trim()
      if (keyword === '') throw new Error('keyword 不能为空')
      const result = await cli.search('song', keyword)
      return {
        keyword,
        count: result.items.length,
        songs: result.items.map((song) => compact({
          name: song.name,
          artists: song.artists,
          album: song.album,
          durationMs: song.durationMs ?? undefined,
          playable: song.playable,
          link: song.link ?? undefined,
          encryptedId: song.encryptedId ?? undefined,
          originalId: song.originalId ? String(song.originalId) : undefined,
        })),
      }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'netease_play',
    description: '点一首歌：先按关键词搜索，再播放第一首可播放的结果。出声由 Host 上的 mpv 完成。',
    parameters: {
      query: { type: 'string', required: true, description: '歌曲关键词，例如「晴天 周杰伦」。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['played'],
        properties: {
          played: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message ?? `开始播放：${value.played}` }],
    },
    async execute(args) {
      const query = String(args?.query ?? '').trim()
      if (query === '') throw new Error('query 不能为空')
      const songs = await searchSongs(query)
      const first = songs.find((song) => song.playable && (song.encryptedId || song.originalId))
      if (first === undefined) throw new Error(`没有找到可播放的「${query}」`)
      const label = `${first.name} - ${first.artists.join(' / ')}`
      const result = await cli.play({
        encryptedId: first.encryptedId ?? undefined,
        originalId: first.originalId ? String(first.originalId) : undefined,
      })
      if (result?.success === false) throw new Error(String(result.message ?? '播放失败'))
      return compact({ played: label, message: String(result?.message ?? `开始播放：${label}`) })
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'netease_control',
    description: '控制网易云音乐播放：暂停、继续、停止、上一首、下一首。调整音量用 netease_set_volume，跳转进度用 netease_seek。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: TRANSPORT_ACTIONS,
        description: '要执行的播控动作。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'message'],
        properties: {
          action: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const action = String(args?.action ?? '')
      const result = await cli.control(action)
      return { action, message: String(result?.message ?? `已执行 ${action}`) }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'netease_set_volume',
    description: '设置网易云音乐播放音量，0 到 100。',
    parameters: {
      level: { type: 'integer', required: true, description: '目标音量，0 到 100。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'message'],
        properties: {
          level: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const level = Math.max(0, Math.min(100, Math.round(Number(args?.level ?? 0))))
      const result = await cli.control('volume', level)
      return { level, message: String(result?.message ?? `音量已设为 ${level}`) }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'netease_seek',
    description: '把网易云音乐当前播放进度跳转到指定秒数。',
    parameters: {
      seconds: { type: 'integer', required: true, description: '目标进度，单位秒。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'message'],
        properties: {
          seconds: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const seconds = Math.max(0, Math.round(Number(args?.seconds ?? 0)))
      const result = await cli.control('seek', seconds)
      return { seconds, message: String(result?.message ?? `已跳转到 ${seconds}s`) }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'netease_status',
    description: '查看网易云音乐插件的就绪状态（CLI 是否安装、凭证是否齐全、是否已登录、播放器是否可用）与当前播放状态。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ready', 'configured', 'loggedIn'],
        properties: {
          ready: { type: 'boolean' },
          cliVersion: { type: 'string' },
          configured: { type: 'boolean' },
          loggedIn: { type: 'boolean' },
          player: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `就绪：${value.ready ? '是' : '否'}`,
          value.cliVersion === undefined ? 'ncm-cli：未安装' : `ncm-cli：v${value.cliVersion}`,
          `凭证：${value.configured ? '已配置' : '未配置'}`,
          `登录：${value.loggedIn ? '已登录' : '未登录'}`,
          value.player === undefined ? '播放器：未设置' : `播放器：${value.player}`,
        ].join('\n'),
      }],
    },
    async execute() {
      const snapshot = await status()
      const cliInfo = /** @type {any} */ (snapshot.cli)
      const credentials = /** @type {any} */ (snapshot.credentials)
      const login = /** @type {any} */ (snapshot.login)
      return compact({
        ready: Boolean(snapshot.ready),
        cliVersion: cliInfo?.version ?? undefined,
        configured: Boolean(credentials?.appId && credentials?.hasPrivateKey),
        loggedIn: Boolean(login?.loggedIn),
        player: /** @type {string} */ (snapshot.player) ?? undefined,
      })
    },
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'netease-music: tools')
}

export { NcmError }
