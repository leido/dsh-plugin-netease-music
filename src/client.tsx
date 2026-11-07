/**
 * Browser half of the plugin.
 *
 * One main-area page, reached from the sidebar entry, hosts both faces through
 * a single store: search and playback, plus a settings pane for the CLI
 * install, credentials and login. Configuration deliberately lives next to the
 * player rather than in the settings dialog.
 *
 * Everything reaches the Host through same-origin `fetch` on the route prefix
 * `lib/routes.js` owns; no credential ever reaches this file.
 * @module dsh-plugin-netease-music/client
 */
import React, { useCallback, useEffect, useSyncExternalStore } from 'react'

/** Absolute API root: the route is registered on the origin root, not on the page path. */
const API_ROOT = '/netease-music/api/'

/** Sidebar panel id; the `main` page uses the same key so the row opens it. */
const PANEL_ID = 'netease-music'

type Song = {
  encryptedId: string | null
  originalId: string | number | null
  name: string
  artists: string[]
  album: string
  durationMs: number | null
  playable: boolean
  link: string | null
  cover: string | null
}

type Status = {
  cli: { installed: boolean; version: string | null; binPath: string; message?: string }
  credentials: { appId: string | null; hasPrivateKey: boolean; player: string | null }
  login: { loggedIn: boolean; message: string }
  player: string | null
  mpv: { installed: boolean; version: string | null }
  ready: boolean
}

type InstallJob = {
  id: string
  state: 'running' | 'success' | 'failed'
  log: string[]
  message?: string
  binPath?: string
}

type Snapshot = {
  status: Status | null
  statusLoading: boolean
  statusError: string | null
  keyword: string
  searching: boolean
  results: Song[]
  searchError: string | null
  searchedKeyword: string
  playback: any
  busy: string | null
  notice: string | null
  error: string | null
  loginUrl: string | null
  diagnostics: any
  install: InstallJob | null
}

const initial: Snapshot = {
  status: null,
  statusLoading: false,
  statusError: null,
  keyword: '',
  searching: false,
  results: [],
  searchError: null,
  searchedKeyword: '',
  playback: null,
  queue: { items: [], total: 0 },
  queueOpen: false,
  songIndex: {},
  busy: null,
  notice: null,
  error: null,
  loginUrl: null,
  diagnostics: null,
  install: null,
}

let snapshot: Snapshot = initial
const listeners = new Set<() => void>()

/**
 * Replace part of the snapshot and notify every mounted component.
 * @param patch partial snapshot.
 * @returns void
 */
function setState(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

/**
 * @param listener change callback.
 * @returns unsubscribe.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * @returns current snapshot.
 */
function getSnapshot(): Snapshot {
  return snapshot
}

/**
 * Call one Host endpoint.
 * @param path route suffix.
 * @param init fetch options.
 * @returns decoded `data` field.
 */
async function api(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(API_ROOT + path, {
    ...init,
    headers: {
      accept: 'application/json',
      'x-ncm-request': '1',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (payload?.ok !== true) {
    throw new Error(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload.data
}

/**
 * @param ms milliseconds.
 * @returns resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Refresh the composite status.
 * @returns void
 */
async function refreshStatus(): Promise<void> {
  setState({ statusLoading: true, statusError: null })
  try {
    setState({ status: await api('status'), statusLoading: false })
  } catch (error) {
    setState({ statusLoading: false, statusError: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Refresh playback state without surfacing transport noise.
 * @returns void
 */
async function refreshPlayback(): Promise<void> {
  try {
    setState({ playback: await api('state') })
  } catch {
    setState({ playback: null })
  }
}

/**
 * Run a search and store its results.
 * @param keyword search text.
 * @returns void
 */
async function runSearch(keyword: string): Promise<void> {
  const trimmed = keyword.trim()
  if (trimmed === '') return
  setState({ searching: true, searchError: null, searchedKeyword: trimmed })
  try {
    const data = await api(`search?keyword=${encodeURIComponent(trimmed)}&type=song`)
    const index = { ...snapshot.songIndex }
    for (const song of data.items ?? []) {
      if (song.encryptedId !== null) {
        index[String(song.encryptedId).toLowerCase()] = { name: song.name, originalId: song.originalId === null ? null : String(song.originalId) }
      }
    }
    setState({ results: data.items ?? [], searching: false, songIndex: index })
  } catch (error) {
    setState({ searching: false, results: [], searchError: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Play one song and refresh the transport state.
 * @param song chosen result.
 * @returns void
 */
async function playSong(song: Song): Promise<void> {
  if (!song.playable) {
    setState({ notice: '这首歌没有版权或不可播放' })
    return
  }
  setState({ busy: song.encryptedId ?? song.name, notice: null })
  try {
    if (song.encryptedId === null && song.originalId === null) {
      throw new Error('这条结果没有可用的歌曲 ID，无法播放')
    }
    setState((current) => ({ songIndex: { ...current.songIndex, [String(song.encryptedId).toLowerCase()]: { name: song.name, originalId: song.originalId === null ? null : String(song.originalId) } } }))
    const result = await api('play', {
      method: 'POST',
      body: JSON.stringify({ encryptedId: song.encryptedId, originalId: song.originalId }),
    })
    setState({ busy: null, error: null, notice: result?.message ?? `开始播放：${song.name}` })
    scheduleNoticeClear()
    await refreshPlayback()
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Play button: resume when paused, start the queue's current track when
 * stopped (`resume` refuses when nothing is playing), pause when playing.
 * @returns void
 */
async function playOrResume(): Promise<void> {
  const current = snapshot.playback?.state ?? snapshot.playback ?? null
  if (current?.status === 'playing') {
    await runControl('pause')
    return
  }
  if (current?.status === 'paused') {
    await runControl('resume')
    return
  }
  // Stopped: find the queue's current entry and play it by id.
  const entry = snapshot.queue.items.find((item) => item.current) ?? snapshot.queue.items[0]
  const id = entry === undefined ? null : idFromLabel(entry.label)
  if (id === null) {
    setState({ error: '队列为空，先在搜索结果里点「＋」加入歌曲' })
    return
  }
  const known = id === null ? undefined : snapshot.songIndex[id.toLowerCase()]
  setState({ busy: 'play', error: null })
  try {
    const result = await api('play', {
      method: 'POST',
      body: JSON.stringify({ encryptedId: id, originalId: known?.originalId ?? undefined }),
    })
    setState({ busy: null, error: null, notice: result?.message ?? `开始播放：${known?.name ?? '队列曲目'}` })
    scheduleNoticeClear()
    await refreshPlayback()
    await refreshQueue()
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Send one transport command.
 * @param action CLI action.
 * @param value optional numeric argument.
 * @returns void
 */
async function runControl(action: string, value?: number): Promise<void> {
  setState({ busy: action })
  try {
    const result = await api('control', { method: 'POST', body: JSON.stringify({ action, value }) })
    setState({ busy: null, error: null, notice: result?.message ?? null })
    scheduleNoticeClear()
    await refreshPlayback()
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Start the QR login flow.
 * @returns void
 */
async function startLogin(): Promise<void> {
  setState({ busy: 'login', notice: null, loginUrl: null })
  try {
    const result = await api('login', { method: 'POST', body: '{}' })
    setState({ busy: null, notice: result?.message ?? null, loginUrl: result?.url ?? null })
  } catch (error) {
    setState({ busy: null, notice: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Install the official CLI, then follow the job until it settles.
 *
 * The button is the whole point: the plugin is useless until `ncm-cli` exists,
 * and sending the user to a terminal at that moment loses most of them.
 * @returns void
 */
async function installCli(): Promise<void> {
  setState({ install: { id: '', state: 'running', log: ['正在启动安装…'] } })
  try {
    const job = await api('install', { method: 'POST', body: '{}' })
    setState({ install: job })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setState({ install: { id: '', state: 'failed', log: [message], message } })
    return
  }
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await sleep(1000)
    const job = await api('install').catch(() => null)
    if (job !== null && job !== undefined) setState({ install: job })
    if (job?.state !== 'running') {
      await refreshStatus()
      return
    }
  }
}

/**
 * Refresh the playback queue.
 * @returns void
 */
async function refreshQueue(): Promise<void> {
  try {
    setState({ queue: await api('queue') })
  } catch {
    setState({ queue: { items: [], total: 0 } })
  }
}

/**
 * Add one song to the queue (default: after the current track).
 * @param song chosen result.
 * @param next insert right after the current track.
 * @returns void
 */
async function enqueueSong(song: Song, next: boolean): Promise<void> {
  setState({ busy: song.encryptedId ?? song.name, notice: null })
  try {
    const result = await api('queue/add', {
      method: 'POST',
      body: JSON.stringify({ encryptedId: song.encryptedId, originalId: song.originalId, next }),
    })
    setState({ busy: null, error: null, notice: result?.message ?? (next ? '已插入下一首' : '已加入队列') })
    scheduleNoticeClear()
    await refreshQueue()
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Clear the whole queue.
 * @returns void
 */
async function clearQueue(): Promise<void> {
  setState({ busy: 'queue-clear' })
  try {
    await api('queue/clear', { method: 'POST', body: '{}' })
    setState({ busy: null, error: null, notice: '队列已清空' })
    scheduleNoticeClear()
    await refreshQueue()
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Playback status labels the CLI reports.
 */
const STATUS_LABELS: Record<string, string> = { playing: '播放中', paused: '已暂停', stopped: '未播放' }

/**
 * @param playback raw CLI state.
 * @returns one short Chinese status line.
 */
/**
 * @param seconds elapsed seconds from the player service.
 * @returns m:ss clock text.
 */
function formatClock(seconds: any): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function describePlayback(playback: any): string {
  if (playback === null || playback === undefined) return '状态未知'
  const status = STATUS_LABELS[String(playback.status)] ?? String(playback.status ?? '未知')
  if (playback.status === 'playing' || playback.status === 'paused') {
    const title = typeof playback.title === 'string' && playback.title !== '' ? ` ${playback.title}` : ''
    const elapsed = Number.isFinite(Number(playback.position)) && Number(playback.position) > 0 ? ` · ${formatClock(playback.position)}` : ''
    return `${status}${title}${elapsed}`
  }
  return playback.queueLength ? `${status} · 队列 ${playback.queueLength}` : status
}

/** Auto-clear timer for transient notices, so they never mask live state. */
let noticeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Fade a notice after a few seconds; the polled state line takes over again.
 * @returns void
 */
function scheduleNoticeClear(): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => setState({ notice: null }), 4000)
}

/**
 * Pull the 32-hex encrypted id out of a queue label like
 * `HEX | 歌曲 ID: HEX`. Case is preserved: the CLI sent uppercase and may be
 * strict about it.
 * @param label raw label from the CLI queue.
 * @returns the hex id as written, or null.
 */
function idFromLabel(label: string): string | null {
  const match = /([0-9a-fA-F]{32})/.exec(label)
  return match === null ? null : match[1]
}

/**
 * Best-effort display name for a queue entry: the plugin remembers the songs
 * it has seen (search results, explicit plays), because the CLI's queue only
 * reports ids.
 * @param label raw label from the CLI queue.
 * @param songIndex remembered songs.
 * @returns the song name when known, otherwise a shortened label.
 */
function queueDisplayName(label: string, songIndex: Snapshot['songIndex']): string {
  const raw = idFromLabel(label)
  const id = raw === null ? null : raw.toLowerCase()
  if (id !== null && songIndex[id] !== undefined) return songIndex[id].name
  const cleaned = label.split('|')[0].trim()
  return cleaned !== '' ? cleaned : label
}

/**
 * @param ms duration in milliseconds.
 * @returns formatted duration.
 */
function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const CSS = `
/* Everything derives from the shell's design tokens, so the page follows the
   app theme (body[data-ds-dark-theme]) instead of the OS preference. */
.ncm-root {
  --ncm-border: var(--dsw-alias-border-l2, #e6e6ea);
  --ncm-border-soft: var(--dsw-alias-border-l1, #efeff2);
  --ncm-fg: var(--dsw-alias-label-primary, #1a1a1c);
  --ncm-muted: var(--dsw-alias-label-secondary, #6b6b73);
  --ncm-faint: var(--dsw-alias-label-tertiary, #8a8a94);
  --ncm-card: var(--dsw-alias-bg-layer-1, #ffffff);
  --ncm-soft: var(--dsw-alias-bg-layer-2, #f6f6f8);
  --ncm-hover: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.045));
  --ncm-accent: var(--dsw-alias-brand-primary, #d33a31);
  --ncm-error: var(--dsw-alias-label-error, #d33a31);
  --ncm-success: var(--dsw-alias-state-success-primary, #2e9e5b);
  --ncm-warn: var(--dsw-alias-state-warn-primary, #d99a1e);
  --ncm-cover: var(--dsw-specific-input-major, #ededf0);
  font-family: var(--dsw-font-family, inherit);
  color: var(--ncm-fg);
}
.ncm-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ncm-page-inner { width: 100%; max-width: 820px; margin: 0 auto; padding: 26px 28px 18px; display: flex; flex-direction: column; gap: 16px; flex: 1; min-height: 0; }
.ncm-page-head { display: flex; align-items: center; gap: 10px; }
.ncm-h1 { font-size: 18px; line-height: 26px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.ncm-pill { font-size: 11px; line-height: 18px; color: var(--ncm-muted); background: var(--ncm-soft); border-radius: 999px; padding: 1px 9px; }
.ncm-icon-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--dsw-radius-md, 8px); border: 1px solid transparent; background: transparent; color: var(--ncm-muted); cursor: pointer; transition: background .12s ease, color .12s ease; }
.ncm-icon-btn:hover { background: var(--ncm-hover); color: var(--ncm-fg); }
.ncm-icon-btn-active { background: var(--ncm-hover); color: var(--ncm-fg); }

.ncm-section { display: flex; flex-direction: column; gap: 14px; }
.ncm-pane { flex: 1; min-height: 0; overflow: auto; padding-right: 2px; }
.ncm-pane-head { display: flex; align-items: center; }
.ncm-back { border: none; background: transparent; color: var(--ncm-muted); cursor: pointer; font-size: 12px; line-height: 20px; padding: 0; }
.ncm-back:hover { color: var(--ncm-fg); }

.ncm-h { font-size: 13px; line-height: 20px; font-weight: 600; margin: 0; }
.ncm-p { font-size: 12px; line-height: 19px; color: var(--ncm-muted); margin: 2px 0 0; }
.ncm-card { border: 1px solid var(--ncm-border-soft); border-radius: var(--dsw-radius-lg, 12px); padding: 14px 16px; background: var(--ncm-card); }
.ncm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
.ncm-kv { display: flex; flex-direction: column; gap: 3px; font-size: 13px; line-height: 20px; }
.ncm-kv > span:first-child { color: var(--ncm-faint); font-size: 11px; line-height: 16px; }
.ncm-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.ncm-ok { background: var(--ncm-success); } .ncm-bad { background: var(--ncm-error); } .ncm-warn { background: var(--ncm-warn); }

.ncm-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.ncm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.ncm-row .ncm-field { flex: 1 1 220px; }
.ncm-label { font-size: 11px; line-height: 16px; color: var(--ncm-faint); }
.ncm-input {
  height: 36px; border: 1px solid var(--ncm-border); border-radius: var(--dsw-radius-md, 8px);
  padding: 0 12px; font-size: 13px; font-family: inherit; color: var(--ncm-fg);
  background: var(--dsw-specific-input-major, transparent); outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.ncm-input::placeholder { color: var(--ncm-faint); }
.ncm-input:focus { border-color: var(--ncm-accent); box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px) color-mix(in srgb, var(--ncm-accent) 22%, transparent); }
select.ncm-input { padding-right: 8px; }

.ncm-btn {
  height: 36px; padding: 0 14px; border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--ncm-border);
  background: transparent; color: var(--ncm-fg); font-size: 13px; font-family: inherit; cursor: pointer;
  transition: background .12s ease, border-color .12s ease, color .12s ease; white-space: nowrap;
}
.ncm-btn:hover:not(:disabled) { background: var(--ncm-hover); }
.ncm-btn:disabled { opacity: .45; cursor: default; }
.ncm-btn-primary { background: var(--ncm-accent); border-color: var(--ncm-accent); color: var(--dsw-alias-label-primary-foreground, #fff); }
.ncm-btn-primary:hover:not(:disabled) { filter: brightness(1.06); background: var(--ncm-accent); }

.ncm-notice { font-size: 12px; line-height: 19px; padding: 10px 12px; border-radius: var(--dsw-radius-md, 8px); background: var(--ncm-soft); color: var(--ncm-muted); word-break: break-all; }
.ncm-notice a { color: var(--ncm-accent); }
.ncm-error { display: flex; align-items: center; gap: 10px; font-size: 12px; line-height: 19px; padding: 9px 12px; border-radius: var(--dsw-radius-md, 8px); color: var(--ncm-error); background: color-mix(in srgb, var(--ncm-error) 10%, transparent); }
.ncm-error span { flex: 1; word-break: break-all; }
.ncm-details { font-size: 12px; color: var(--ncm-faint); }
.ncm-details summary { cursor: pointer; }
.ncm-details pre, .ncm-log { max-height: 170px; overflow: auto; background: var(--ncm-soft); padding: 9px 11px; border-radius: var(--dsw-radius-md, 8px); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 11px; line-height: 16px; white-space: pre-wrap; word-break: break-all; margin: 8px 0 0; }

.ncm-search { display: flex; gap: 8px; }
.ncm-search .ncm-input { flex: 1; height: 38px; }
.ncm-search .ncm-btn { height: 38px; }

.ncm-results { flex: 1 1 auto; min-height: 120px; max-height: min(520px, 48vh); overflow: auto; border: 1px solid var(--ncm-border-soft); border-radius: var(--dsw-radius-lg, 12px); background: var(--ncm-card); }
.ncm-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; font-size: 13px; transition: background .12s ease; }
.ncm-item:hover { background: var(--ncm-hover); }
.ncm-item:hover .ncm-item-actions { opacity: 1; }
.ncm-item-actions { display: inline-flex; gap: 2px; opacity: 0; transition: opacity .12s ease; }
.ncm-mini { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--ncm-muted); cursor: pointer; font-size: 11px; }
.ncm-mini:hover:not(:disabled) { background: var(--ncm-hover); color: var(--ncm-fg); }
.ncm-mini:disabled { opacity: .4; cursor: default; }
.ncm-item + .ncm-item { box-shadow: inset 0 1px 0 var(--ncm-border-soft); }
.ncm-item:hover:not(:disabled) { background: var(--ncm-hover); }
.ncm-item:disabled { opacity: .42; cursor: default; }
.ncm-cover { width: 32px; height: 32px; flex: 0 0 32px; border-radius: var(--dsw-radius-sm, 6px); object-fit: cover; background: var(--ncm-cover); overflow: hidden; }
img.ncm-cover { display: block; }
span.ncm-cover { display: inline-flex; align-items: center; justify-content: center; color: var(--ncm-faint); font-size: 13px; }
.ncm-item-main { flex: 1; min-width: 0; }
.ncm-item-name { font-size: 13px; line-height: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ncm-item-sub { font-size: 11px; line-height: 17px; color: var(--ncm-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ncm-dur { font-size: 11px; color: var(--ncm-faint); font-variant-numeric: tabular-nums; }
.ncm-empty { height: 100%; min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 12px; color: var(--ncm-faint); }
.ncm-empty-mark { font-size: 22px; opacity: .5; }

.ncm-queue-toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px; border: none; border-radius: 999px; background: var(--ncm-soft); color: var(--ncm-muted); cursor: pointer; font-size: 11px; font-family: inherit; }
.ncm-queue-toggle:hover { color: var(--ncm-fg); background: var(--ncm-hover); }
.ncm-queue-toggle-active { color: var(--ncm-fg); background: var(--ncm-hover); }
.ncm-queue {
  position: sticky; bottom: 50px; z-index: 2; margin: 0 0 8px; max-height: min(300px, 36vh); overflow: auto;
  border: 1px solid var(--ncm-border-soft); border-radius: var(--dsw-radius-lg, 12px); background: var(--ncm-card);
}
.ncm-queue-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--ncm-card); border-bottom: 1px solid var(--ncm-border-soft); }
.ncm-queue-head span { font-size: 11px; line-height: 18px; color: var(--ncm-faint); }
.ncm-queue-head button { border: none; background: transparent; color: var(--ncm-muted); cursor: pointer; font-size: 11px; font-family: inherit; padding: 0; }
.ncm-queue-head button:hover { color: var(--ncm-error); }
.ncm-queue-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; padding: 6px 12px; cursor: pointer; font-size: 12px; font-family: inherit; }
.ncm-queue-row:hover { background: var(--ncm-hover); }
.ncm-queue-row-current { color: var(--ncm-accent); }
.ncm-queue-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ncm-player { position: sticky; bottom: 0; z-index: 2; flex: none; display: flex; align-items: center; gap: 6px; border: 1px solid var(--ncm-border-soft); border-radius: var(--dsw-radius-lg, 12px); padding: 7px 10px; background: var(--ncm-card); }
.ncm-player button { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--dsw-radius-sm, 6px); border: none; background: transparent; color: var(--ncm-muted); cursor: pointer; font-size: 12px; transition: background .12s ease, color .12s ease; }
.ncm-player button:hover { background: var(--ncm-hover); color: var(--ncm-fg); }
.ncm-player button.ncm-play { width: 34px; height: 34px; border-radius: 50%; background: var(--ncm-accent); color: var(--dsw-alias-label-primary-foreground, #fff); }
.ncm-player button.ncm-play:hover { background: var(--ncm-accent); filter: brightness(1.06); color: var(--dsw-alias-label-primary-foreground, #fff); }
.ncm-state { font-size: 11px; line-height: 18px; color: var(--ncm-faint); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 58%; }
`

let stylesInjected = false

/**
 * Inject the plugin stylesheet once per document.
 * @returns void
 */
function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  if (document.querySelector('style[data-ncm-styles]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.ncmStyles = ''
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/**
 * Sidebar glyph: a beamed note drawn inline, because the primitive icon set has
 * no music glyph.
 * @param props.size pixel size.
 * @returns icon element.
 */
function MusicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.4 12.1V4.3l5.9-1.2v7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.9" cy="12.1" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.8" cy="10.3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * Settings glyph: a horizontal-slider mark, drawn inline for the same reason.
 * @param props.size pixel size.
 * @returns icon element.
 */
function SlidersIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.7" fill="var(--ncm-bg)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.5" cy="8" r="1.7" fill="var(--ncm-bg)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="11.5" r="1.7" fill="var(--ncm-bg)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * Back glyph for leaving the settings pane.
 * @param props.size pixel size.
 * @returns icon element.
 */
function BackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * @param props.bad whether the value is bad.
 * @param props.warn whether the value is a warning.
 * @param props.children label content.
 * @returns status line.
 */
function Dot({ bad, warn, children }: { bad?: boolean; warn?: boolean; children: any }) {
  const tone = bad === true ? 'ncm-bad' : warn === true ? 'ncm-warn' : 'ncm-ok'
  return <span><i className={`ncm-dot ${tone}`} />{children}</span>
}

/**
 * Main page: search and play.
 * @returns page element.
 */
function MusicPage() {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [draft, setDraft] = React.useState('')
  const [showSettings, setShowSettings] = React.useState(false)

  useEffect(() => {
    if (state.status === null && !state.statusLoading) void refreshStatus()
    void refreshPlayback()
    void refreshQueue()
    // The CLI's state is the single source of truth for playback; poll it so
    // the transport bar keeps up with what the player service is doing,
    // including songs started elsewhere (Agent tools, another tab).
    const timer = setInterval(() => { void refreshPlayback(); void refreshQueue() }, 2000)
    return () => clearInterval(timer)
  }, [])

  const current = state.playback?.state ?? state.playback ?? null
  const playing = current?.status === 'playing'
  const ready = state.status?.ready === true

  return (
    <div className="ncm-root ncm-page">
      <div className="ncm-page-inner">
        <div className="ncm-page-head">
          <h1 className="ncm-h1">网易云音乐</h1>
          <span className="ncm-pill">
            {state.status === null ? '检测中…' : ready ? '已就绪' : '配置未完成'}
          </span>
          <button
            className={`ncm-icon-btn${showSettings ? ' ncm-icon-btn-active' : ''}`}
            title={showSettings ? '返回播放' : '设置'}
            aria-label={showSettings ? '返回播放' : '设置'}
            onClick={() => setShowSettings((value) => !value)}
          >
            {showSettings ? <BackIcon /> : <SlidersIcon />}
          </button>
        </div>

        {showSettings && <SettingsPane onClose={() => setShowSettings(false)} />}

        <div className="ncm-search" style={showSettings ? { display: 'none' } : undefined}>
          <input
            className="ncm-input"
            value={draft}
            placeholder="搜歌名、歌手或场景"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(draft) }}
          />
          <button className="ncm-btn ncm-btn-primary" disabled={state.searching || draft.trim() === ''} onClick={() => { void runSearch(draft) }}>
            {state.searching ? '搜索中…' : '搜索'}
          </button>
        </div>

        <div className="ncm-results" style={showSettings ? { display: 'none' } : undefined}>
          {state.searchError !== null && <div className="ncm-empty" style={{ color: '#d33a31' }}>{state.searchError}</div>}
          {state.searchError === null && state.results.length === 0 && !state.searching && (
            <div className="ncm-empty">
              <span className="ncm-empty-mark" aria-hidden="true">♪</span>
              <span>{state.searchedKeyword === '' ? '搜索一首歌开始播放' : `没有找到「${state.searchedKeyword}」`}</span>
            </div>
          )}
          {state.results.map((song, index) => (
            <div key={`${song.encryptedId ?? song.name}-${index}`} className="ncm-item" style={{ opacity: song.playable ? 1 : 0.42 }}>
              {song.cover === null
                ? <span className="ncm-cover" aria-hidden="true">♪</span>
                : <img className="ncm-cover" width={32} height={32} src={song.cover} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />}
              <div className="ncm-item-main">
                <div className="ncm-item-name">{song.name}</div>
                <div className="ncm-item-sub">{song.artists.join(' / ')}{song.album === '' ? '' : ` · ${song.album}`}</div>
              </div>
              <span className="ncm-dur">{formatDuration(song.durationMs)}</span>
              {song.playable && (
                <span className="ncm-item-actions">
                  <button className="ncm-mini" title="播放" disabled={state.busy !== null} onClick={() => { void playSong(song) }}>▶</button>
                  <button className="ncm-mini" title="下一首播放" disabled={state.busy !== null} onClick={() => { void enqueueSong(song, true) }}>↵</button>
                  <button className="ncm-mini" title="加入队列" disabled={state.busy !== null} onClick={() => { void enqueueSong(song, false) }}>＋</button>
                </span>
              )}
            </div>
          ))}
        </div>

        {state.error !== null && !showSettings && (
          <div className="ncm-error">
            <span>{state.error}</span>
            <button className="ncm-back" onClick={() => setState({ error: null })}>关闭</button>
          </div>
        )}

        {state.queueOpen && (
          <div className="ncm-queue" style={showSettings ? { display: 'none' } : undefined}>
            <div className="ncm-queue-head">
              <span>播放队列 · {state.queue.total} 首</span>
              <button onClick={() => { void clearQueue() }} disabled={state.busy !== null}>清空</button>
            </div>
            {state.queue.items.length === 0 && <div className="ncm-empty" style={{ minHeight: 80 }}>队列为空，在搜索结果上点「+」加入</div>}
            {state.queue.items.map((entry, index) => (
              <div key={index} className={`ncm-queue-row${entry.current ? ' ncm-queue-row-current' : ''}`}>
                <span style={{ width: 18, textAlign: 'right', color: 'var(--ncm-faint)' }}>{entry.index ?? index + 1}</span>
                <span className="ncm-queue-label">{queueDisplayName(entry.label, state.songIndex)}</span>
                {entry.current && <span style={{ fontSize: 11 }}>▶</span>}
              </div>
            ))}
          </div>
        )}

        <div className="ncm-player" style={showSettings ? { display: 'none' } : undefined}>
          <button className="ncm-play" title={playing ? '暂停' : '播放'} onClick={() => { void playOrResume() }}>{playing ? '⏸' : '▶'}</button>
          <span className="ncm-state" style={{ marginLeft: 8 }}>{state.notice !== null ? state.notice : describePlayback(current)}</span>
          <button
            className={`ncm-queue-toggle${state.queueOpen ? ' ncm-queue-toggle-active' : ''}`}
            title="播放队列"
            onClick={() => setState({ queueOpen: !state.queueOpen, error: null })}
          >
            ☰ {state.queue.total > 0 ? state.queue.total : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Settings pane rendered inside the plugin's own page, so configuration lives
 * next to the player instead of in a separate settings dialog.
 * @param props.onClose return to the player.
 * @returns settings panel.
 */
function SettingsPane({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [appId, setAppId] = React.useState('')
  const [privateKey, setPrivateKey] = React.useState('')
  const [player, setPlayer] = React.useState('')

  useEffect(() => {
    if (state.status === null && state.statusLoading === false && state.statusError === null) void refreshStatus()
  }, [state.status, state.statusLoading, state.statusError])

  const save = useCallback(async (payload: Record<string, unknown>) => {
    setState({ busy: 'save', notice: null })
    try {
      const status = await api('config', { method: 'POST', body: JSON.stringify(payload) })
      setState({ status, busy: null, notice: '已保存' })
      setPrivateKey('')
    } catch (error) {
      setState({ busy: null, notice: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  const status = state.status
  const configured = status !== null && status.credentials.appId !== null && status.credentials.hasPrivateKey
  const installing = state.install?.state === 'running'
  const cliMissing = status !== null && status.cli.installed === false

  return (
    <div className="ncm-root ncm-section ncm-pane">
      <div className="ncm-pane-head">
        <button className="ncm-back" onClick={onClose}>← 返回播放</button>
      </div>
      <div>
        <p className="ncm-h">状态</p>
        <p className="ncm-p">插件不保存任何凭证：调用官方 ncm-cli，凭据由 ncm-cli 自己加密存放。这里只显示“是否已配置”。</p>
      </div>

      <div className="ncm-card">
        <div className="ncm-grid">
          <div className="ncm-kv">
            <span>ncm-cli</span>
            <Dot bad={cliMissing}>{status === null ? '检测中…' : status.cli.installed ? `v${status.cli.version}` : '未安装'}</Dot>
          </div>
          <div className="ncm-kv">
            <span>API Key</span>
            <Dot bad={status !== null && !configured}>{configured ? '已配置' : '未配置'}</Dot>
          </div>
          <div className="ncm-kv">
            <span>登录</span>
            <Dot bad={status !== null && status.login.loggedIn === false}>{status === null ? '检测中…' : status.login.loggedIn ? '已登录' : '未登录'}</Dot>
          </div>
          <div className="ncm-kv">
            <span>播放器（mpv）</span>
            <Dot bad={status !== null && status.mpv.installed === false} warn={status?.player !== 'mpv'}>
              {status === null ? '检测中…' : status.mpv.installed ? `可用 v${status.mpv.version ?? '?'}` : '未安装'}
            </Dot>
          </div>
        </div>
        {state.statusError !== null && <p className="ncm-p" style={{ color: '#d33a31', marginTop: 10 }}>{state.statusError}</p>}
      </div>

      <div className="ncm-card">
        <p className="ncm-h">{cliMissing ? '安装 ncm-cli' : 'ncm-cli 已安装'}</p>
        <p className="ncm-p">
          {cliMissing
            ? '插件依赖网易云官方 CLI。点下面的按钮直接用 npm 全局安装到本机，安装过程会显示在这里。'
            : `当前路径：${status?.cli.binPath ?? 'ncm-cli'}。需要修复或升级时可以重新安装。`}
        </p>
        <div className="ncm-row" style={{ marginTop: 10 }}>
          <button className="ncm-btn ncm-btn-primary" disabled={installing} onClick={() => { void installCli() }}>
            {installing ? '安装中…' : cliMissing ? '安装 ncm-cli' : '重新安装 / 升级'}
          </button>
          {state.install?.state === 'success' && <span className="ncm-p" style={{ color: '#2e9e5b' }}>安装完成</span>}
          {state.install?.state === 'failed' && <span className="ncm-p" style={{ color: '#d33a31' }}>安装失败：{state.install.message}</span>}
        </div>
        {state.install !== null && state.install.log.length > 0 && (
          <pre className="ncm-log">{state.install.log.slice(-12).join('\n')}</pre>
        )}
      </div>

      <div className="ncm-field">
        <span className="ncm-label">App ID</span>
        <input className="ncm-input" value={appId} placeholder={status?.credentials.appId === null || status?.credentials.appId === undefined ? '开放平台申请的 appId' : `已配置：${status.credentials.appId}（留空不修改）`} onChange={(event) => setAppId(event.target.value)} />
      </div>
      <div className="ncm-field">
        <span className="ncm-label">Private Key</span>
        <input className="ncm-input" type="password" value={privateKey} placeholder={status?.credentials.hasPrivateKey === true ? '已保存，留空则不修改' : '开放平台申请的 privateKey'} onChange={(event) => setPrivateKey(event.target.value)} />
      </div>
      <div className="ncm-row">
        <button className="ncm-btn ncm-btn-primary" disabled={state.busy !== null || (appId.trim() === '' && privateKey.trim() === '')} onClick={() => { void save({ appId: appId.trim(), privateKey }) }}>保存凭证</button>
        <button className="ncm-btn" disabled={state.busy !== null} onClick={() => { void refreshStatus() }}>重新检测</button>
        <button className="ncm-btn" disabled={state.busy !== null || status?.login.loggedIn === true} onClick={() => { void startLogin() }}>扫码登录</button>
      </div>

      <div className="ncm-row">
        <div className="ncm-field">
          <span className="ncm-label">播放器</span>
          <select className="ncm-input" value={player === '' ? (status?.player ?? 'mpv') : player} onChange={(event) => setPlayer(event.target.value)}>
            <option value="mpv">mpv（内置，跨平台）</option>
            <option value="orpheus">orpheus（唤起云音乐 App，仅 macOS）</option>
          </select>
        </div>
        <button className="ncm-btn" disabled={state.busy !== null} onClick={() => { void save({ player: player === '' ? (status?.player ?? 'mpv') : player }) }}>保存播放器</button>
      </div>

      {(state.notice !== null || state.loginUrl !== null) && (
        <div className="ncm-notice">
          {state.notice}
          {state.loginUrl !== null && (
            <div style={{ marginTop: 6 }}>登录链接：<a href={state.loginUrl} target="_blank" rel="noreferrer">{state.loginUrl}</a></div>
          )}
        </div>
      )}

      <details className="ncm-details" onToggle={(event) => { if (event.currentTarget.open) void api('diagnostics').then((data) => setState({ diagnostics: data })).catch(() => undefined) }}>
        <summary>诊断信息</summary>
        <pre>{state.diagnostics === null ? '展开后加载…' : JSON.stringify(state.diagnostics, null, 2)}</pre>
      </details>
    </div>
  )
}

/**
 * Mount every surface.
 * @param ctx client plugin context.
 * @returns void
 */
export function apply(ctx: any): void {
  injectStyles()

  // The panel row and the page share one key: clicking the row opens this page.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, MusicPage))

  // Sits directly under "Automation tasks", which registers with order 10.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 11,
    label: () => '网易云音乐',
  }, MusicIcon))

}

/** Client plugin dependency: the slot registry only. */
export const inject = ['slots']
