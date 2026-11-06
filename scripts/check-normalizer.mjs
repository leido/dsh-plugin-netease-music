/**
 * Normalizer fixture check.
 *
 * The CLI payload names the encrypted song id `id` (32 hex) and the numeric one
 * `originalId`. Mapping that wrong is silent: search still renders, but every
 * click sends `play --song` without `--encrypted-id`, so the command fails and
 * the UI looks unresponsive. This fixture pins the mapping.
 *
 * Run with `npm run check`.
 */
import { normalizeSongs } from '../lib/ncm-cli.js'

const HEX = '5D490A1717DAC086FFF08E9E0A4A749A'

/** Current CLI shape. */
const current = {
  code: 200,
  data: {
    records: [
      {
        id: HEX,
        originalId: 509781655,
        name: '想你就写信 (Live)',
        duration: 238698,
        visible: true,
        coverImgUrl: 'http://example.test/cover.jpg',
        artists: [{ name: '周杰伦' }, { name: '李硕' }],
        album: { name: '中国新歌声第二季 第13期' },
      },
      {
        id: 'CEEA677DB9B467D5674129966D38E42B',
        originalId: 5257138,
        name: '屋顶',
        duration: 319039,
        visible: false,
        artists: [{ name: '周杰伦' }],
        album: { name: '男女情歌对唱冠军全记录' },
      },
    ],
  },
}

/** Legacy shape that named the encrypted id explicitly. */
const legacy = {
  success: true,
  data: [{ encryptedId: HEX, originalId: 42, name: '旧结构', visible: true, artists: [{ name: 'A' }], album: { name: 'B' } }],
}

const problems = []

const songs = normalizeSongs(current)
if (songs.length !== 2) problems.push(`当前结构：应有 2 条结果，实际 ${songs.length}`)
if (songs[0]?.encryptedId !== HEX) problems.push(`当前结构：encryptedId 应为 ${HEX}，实际 ${String(songs[0]?.encryptedId)}`)
if (songs[0]?.originalId !== 509781655) problems.push(`当前结构：originalId 解析错误（${String(songs[0]?.originalId)}）`)
if (songs[0]?.playable !== true) problems.push('当前结构：visible=true 应判定为可播放')
if (songs[1]?.playable !== false) problems.push('当前结构：visible=false 应判定为不可播放')
if (songs[0]?.link !== 'https://music.163.com/#/song?id=509781655') problems.push(`当前结构：链接应使用明文 ID，实际 ${String(songs[0]?.link)}`)
if (songs[0]?.artists.join('/') !== '周杰伦/李硕') problems.push('当前结构：歌手解析错误')

const legacySongs = normalizeSongs(legacy)
if (legacySongs[0]?.encryptedId !== HEX) problems.push('旧结构：encryptedId 未回退兼容')

if (problems.length > 0) {
  console.error(`normalizer 检查失败（${problems.length} 个问题）`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(`normalizer 检查通过：当前结构与旧结构均能解析出歌曲 ID`)
}
