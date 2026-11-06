/**
 * Pre-flight checks for the Agent tools.
 *
 * Two failure modes here are invisible in a normal unit test and only surface
 * as a broken conversation or a failed tool call in front of the user:
 *
 * 1. `input_schema` — the model provider validates it far more strictly than a
 *    plain JSON Schema consumer. A property named `type` or an optional
 *    parameter can make every request in the conversation fail with 400.
 * 2. `output` — the executor requires the returned value to match the declared
 *    output schema, and it must be lossless JSON. The CLI reports "no value" as
 *    `null`, which a `type: "string"` field rejects; `undefined` is not JSON at
 *    all. `JSON.stringify` hides both, so this check executes every tool and
 *    validates the result against its own declaration.
 *
 * Run with `npm run check`.
 */
import { registerTools } from '../lib/tools.js'

/** Property names the provider treats as structural rather than data. */
const RESERVED = new Set([
  'type', 'enum', 'const', 'items', 'properties', 'required', 'default',
  'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'format',
  'additionalProperties', '$ref', '$schema', '$defs', 'definitions', 'title',
])

/** Scalar types the provider accepts on a property. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array'])

/**
 * @param {Record<string, any>} spec one tool's `parameters` map.
 * @param {string} tool tool name for messages.
 * @returns {string[]} human-readable problems.
 */
function lintParameters(spec, tool) {
  const problems = []
  for (const [name, property] of Object.entries(spec ?? {})) {
    if (RESERVED.has(name)) problems.push(`${tool}.${name}: 属性名与 JSON Schema 关键字冲突`)
    if (property?.required !== true) problems.push(`${tool}.${name}: 必须是必填参数（缺少 required: true）`)
    if (!SCALAR_TYPES.has(property?.type)) {
      problems.push(`${tool}.${name}: type 必须是 ${[...SCALAR_TYPES].join(' / ')} 之一`)
      continue
    }
    if (property.type === 'array' && property.items === undefined) problems.push(`${tool}.${name}: 数组参数必须声明 items`)
    if (property.enum !== undefined) {
      if (!Array.isArray(property.enum) || property.enum.length < 2) {
        problems.push(`${tool}.${name}: enum 至少要有两个取值`)
      } else {
        const expected = property.type === 'integer' || property.type === 'number' ? 'number' : property.type
        for (const value of property.enum) {
          if (typeof value !== expected) problems.push(`${tool}.${name}: enum 值 ${JSON.stringify(value)} 与 type=${property.type} 不匹配`)
        }
      }
    }
  }
  return problems
}

/**
 * Validate one tool result against its declared output schema.
 * Supports the subset the tools declare: object/array/scalars, `required`,
 * `additionalProperties: false`, `items`, and `enum`.
 * @param {unknown} value produced value.
 * @param {any} schema declared schema.
 * @param {string} path path for the message.
 * @returns {string[]} problems.
 */
function validateValue(value, schema, path) {
  if (schema === undefined) return []
  const problems = []
  const expected = schema.type
  if (value === undefined) return [`${path}: 字段为 undefined（不是合法 JSON）`]
  if (value === null) return [`${path}: 值为 null，但 schema 声明为 ${expected}`]

  if (expected === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: 应为 object，实际是 ${Array.isArray(value) ? 'array' : typeof value}`]
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${path}.${key}: 缺少必填字段`)
    }
    const properties = schema.properties ?? {}
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) problems.push(`${path}.${key}: 未在 schema 中声明`)
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) problems.push(...validateValue(item, properties[key], `${path}.${key}`))
    }
    return problems
  }
  if (expected === 'array') {
    if (!Array.isArray(value)) return [`${path}: 应为 array，实际是 ${typeof value}`]
    if (schema.items !== undefined) {
      value.forEach((item, index) => problems.push(...validateValue(item, schema.items, `${path}[${index}]`)))
    }
    return problems
  }
  if (expected === 'integer') {
    if (!Number.isInteger(value)) return [`${path}: 应为 integer，实际是 ${JSON.stringify(value)}`]
  } else if (expected === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: 应为 number，实际是 ${JSON.stringify(value)}`]
  } else if (expected === 'boolean') {
    if (typeof value !== 'boolean') return [`${path}: 应为 boolean，实际是 ${JSON.stringify(value)}`]
  } else if (expected === 'string') {
    if (typeof value !== 'string') return [`${path}: 应为 string，实际是 ${JSON.stringify(value)}`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} 不在枚举内`)
  return problems
}

/*
 * Execute every tool against a stub CLI whose data deliberately contains the
 * awkward cases: a missing version, no player, a song without album/link and a
 * null duration.
 */
const stubCli = {
  search: async () => ({
    items: [
      { name: '示例', artists: ['歌手'], album: '专辑', durationMs: 200000, playable: true, link: 'https://music.163.com/#/song?id=1', encryptedId: 'AA', originalId: 1 },
      { name: '字段缺失', artists: [], album: '', durationMs: null, playable: false, link: null, encryptedId: 'BB', originalId: 2 },
    ],
  }),
  play: async () => ({ success: true }),
  control: async (action) => ({ success: true, message: action }),
  state: async () => ({ status: 'paused' }),
}
const stubStatus = async () => ({
  ready: false,
  cli: { installed: false, version: null },
  credentials: { appId: null, hasPrivateKey: false, player: null },
  login: { loggedIn: false },
  player: null,
})

const executable = new Map()
registerTools({
  tools: { register: (definition) => { executable.set(definition.name, definition); return () => {} } },
  effect: (factory) => { factory(); return () => {} },
}, stubCli, stubStatus)

const sampleArgs = {
  netease_search: { keyword: '示例' },
  netease_play: { query: '示例' },
  netease_control: { action: 'pause' },
  netease_set_volume: { level: 40 },
  netease_seek: { seconds: 30 },
  netease_status: {},
}

const problems = []
for (const [tool, definition] of executable) {
  problems.push(...lintParameters(definition.parameters, tool))
  if (typeof definition.description !== 'string' || definition.description.trim() === '') {
    problems.push(`${tool}: 缺少 description`)
  }
  if (definition.output?.schema === undefined) {
    problems.push(`${tool}: 缺少 output.schema`)
    continue
  }
  const value = await definition.execute(sampleArgs[tool] ?? {})
  problems.push(...validateValue(value, definition.output.schema, `$(${tool})`))
}

if (problems.length > 0) {
  console.error(`工具检查失败（${problems.length} 个问题）`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log(`工具检查通过：${executable.size} 个工具（${[...executable.keys()].join(', ')}）schema 与返回值均合规`)
}
