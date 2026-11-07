window.__ModuleLoader__.load({
	id: "dsh-plugin-netease-music",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var API_ROOT = "/netease-music/api/";
var PANEL_ID = "netease-music";
var initial = {
  status: null,
  statusLoading: false,
  statusError: null,
  keyword: "",
  searching: false,
  results: [],
  searchError: null,
  searchedKeyword: "",
  playback: null,
  queue: { items: [], total: 0 },
  queueOpen: false,
  busy: null,
  notice: null,
  error: null,
  loginUrl: null,
  diagnostics: null,
  install: null
};
var snapshot = initial;
var listeners = /* @__PURE__ */ new Set();
function setState(patch) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return snapshot;
}
async function api(path, init = {}) {
  const response = await fetch(API_ROOT + path, {
    ...init,
    headers: {
      accept: "application/json",
      "x-ncm-request": "1",
      ...init.body === void 0 ? {} : { "content-type": "application/json" },
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (payload?.ok !== true) {
    throw new Error(payload?.error?.message ?? `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  }
  return payload.data;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function refreshStatus() {
  setState({ statusLoading: true, statusError: null });
  try {
    setState({ status: await api("status"), statusLoading: false });
  } catch (error) {
    setState({ statusLoading: false, statusError: error instanceof Error ? error.message : String(error) });
  }
}
async function refreshPlayback() {
  try {
    setState({ playback: await api("state") });
  } catch {
    setState({ playback: null });
  }
}
async function runSearch(keyword) {
  const trimmed = keyword.trim();
  if (trimmed === "") return;
  setState({ searching: true, searchError: null, searchedKeyword: trimmed });
  try {
    const data = await api(`search?keyword=${encodeURIComponent(trimmed)}&type=song`);
    setState({ results: data.items ?? [], searching: false });
  } catch (error) {
    setState({ searching: false, results: [], searchError: error instanceof Error ? error.message : String(error) });
  }
}
async function playSong(song) {
  if (!song.playable) {
    setState({ notice: "\u8FD9\u9996\u6B4C\u6CA1\u6709\u7248\u6743\u6216\u4E0D\u53EF\u64AD\u653E" });
    return;
  }
  setState({ busy: song.encryptedId ?? song.name, notice: null });
  try {
    if (song.encryptedId === null && song.originalId === null) {
      throw new Error("\u8FD9\u6761\u7ED3\u679C\u6CA1\u6709\u53EF\u7528\u7684\u6B4C\u66F2 ID\uFF0C\u65E0\u6CD5\u64AD\u653E");
    }
    const result = await api("play", {
      method: "POST",
      body: JSON.stringify({ encryptedId: song.encryptedId, originalId: song.originalId })
    });
    setState({ busy: null, error: null, notice: result?.message ?? `\u5F00\u59CB\u64AD\u653E\uFF1A${song.name}` });
    scheduleNoticeClear();
    await refreshPlayback();
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }
}
async function runControl(action, value) {
  setState({ busy: action });
  try {
    const result = await api("control", { method: "POST", body: JSON.stringify({ action, value }) });
    setState({ busy: null, error: null, notice: result?.message ?? null });
    scheduleNoticeClear();
    await refreshPlayback();
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }
}
async function startLogin() {
  setState({ busy: "login", notice: null, loginUrl: null });
  try {
    const result = await api("login", { method: "POST", body: "{}" });
    setState({ busy: null, notice: result?.message ?? null, loginUrl: result?.url ?? null });
  } catch (error) {
    setState({ busy: null, notice: error instanceof Error ? error.message : String(error) });
  }
}
async function installCli() {
  setState({ install: { id: "", state: "running", log: ["\u6B63\u5728\u542F\u52A8\u5B89\u88C5\u2026"] } });
  try {
    const job = await api("install", { method: "POST", body: "{}" });
    setState({ install: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState({ install: { id: "", state: "failed", log: [message], message } });
    return;
  }
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await sleep(1e3);
    const job = await api("install").catch(() => null);
    if (job !== null && job !== void 0) setState({ install: job });
    if (job?.state !== "running") {
      await refreshStatus();
      return;
    }
  }
}
async function refreshQueue() {
  try {
    setState({ queue: await api("queue") });
  } catch {
    setState({ queue: { items: [], total: 0 } });
  }
}
async function enqueueSong(song, next) {
  setState({ busy: song.encryptedId ?? song.name, notice: null });
  try {
    const result = await api("queue/add", {
      method: "POST",
      body: JSON.stringify({ encryptedId: song.encryptedId, originalId: song.originalId, next })
    });
    setState({ busy: null, error: null, notice: result?.message ?? (next ? "\u5DF2\u63D2\u5165\u4E0B\u4E00\u9996" : "\u5DF2\u52A0\u5165\u961F\u5217") });
    scheduleNoticeClear();
    await refreshQueue();
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }
}
async function clearQueue() {
  setState({ busy: "queue-clear" });
  try {
    await api("queue/clear", { method: "POST", body: "{}" });
    setState({ busy: null, error: null, notice: "\u961F\u5217\u5DF2\u6E05\u7A7A" });
    scheduleNoticeClear();
    await refreshQueue();
  } catch (error) {
    setState({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }
}
var STATUS_LABELS = { playing: "\u64AD\u653E\u4E2D", paused: "\u5DF2\u6682\u505C", stopped: "\u672A\u64AD\u653E" };
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function describePlayback(playback) {
  if (playback === null || playback === void 0) return "\u72B6\u6001\u672A\u77E5";
  const status = STATUS_LABELS[String(playback.status)] ?? String(playback.status ?? "\u672A\u77E5");
  if (playback.status === "playing" || playback.status === "paused") {
    const title = typeof playback.title === "string" && playback.title !== "" ? ` ${playback.title}` : "";
    const elapsed = Number.isFinite(Number(playback.position)) && Number(playback.position) > 0 ? ` \xB7 ${formatClock(playback.position)}` : "";
    return `${status}${title}${elapsed}`;
  }
  return playback.queueLength ? `${status} \xB7 \u961F\u5217 ${playback.queueLength}` : status;
}
var noticeTimer;
function scheduleNoticeClear() {
  if (noticeTimer !== void 0) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => setState({ notice: null }), 4e3);
}
function formatDuration(ms) {
  if (ms === null || !Number.isFinite(ms)) return "";
  const total = Math.round(ms / 1e3);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
var CSS = `
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
`;
var stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  if (document.querySelector("style[data-ncm-styles]") !== null) return;
  const tag = document.createElement("style");
  tag.dataset.ncmStyles = "";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function MusicIcon({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.4 12.1V4.3l5.9-1.2v7.2", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "4.9", cy: "12.1", r: "1.6", stroke: "currentColor", strokeWidth: "1.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10.8", cy: "10.3", r: "1.6", stroke: "currentColor", strokeWidth: "1.3" })
  ] });
}
function SlidersIcon({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2 4.5h12M2 8h12M2 11.5h12", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "6", cy: "4.5", r: "1.7", fill: "var(--ncm-bg)", stroke: "currentColor", strokeWidth: "1.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10.5", cy: "8", r: "1.7", fill: "var(--ncm-bg)", stroke: "currentColor", strokeWidth: "1.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "5", cy: "11.5", r: "1.7", fill: "var(--ncm-bg)", stroke: "currentColor", strokeWidth: "1.2" })
  ] });
}
function BackIcon({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.5 3.5 5 8l4.5 4.5", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function Dot({ bad, warn, children }) {
  const tone = bad === true ? "ncm-bad" : warn === true ? "ncm-warn" : "ncm-ok";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: `ncm-dot ${tone}` }),
    children
  ] });
}
function MusicPage() {
  const state = (0, import_react.useSyncExternalStore)(subscribe, getSnapshot);
  const [draft, setDraft] = import_react.default.useState("");
  const [showSettings, setShowSettings] = import_react.default.useState(false);
  (0, import_react.useEffect)(() => {
    if (state.status === null && !state.statusLoading) void refreshStatus();
    void refreshPlayback();
    void refreshQueue();
    const timer = setInterval(() => {
      void refreshPlayback();
      void refreshQueue();
    }, 2e3);
    return () => clearInterval(timer);
  }, []);
  const current = state.playback?.state ?? state.playback ?? null;
  const playing = current?.status === "playing";
  const ready = state.status?.ready === true;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ncm-root ncm-page", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-page-inner", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-page-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { className: "ncm-h1", children: "\u7F51\u6613\u4E91\u97F3\u4E50" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-pill", children: state.status === null ? "\u68C0\u6D4B\u4E2D\u2026" : ready ? "\u5DF2\u5C31\u7EEA" : "\u914D\u7F6E\u672A\u5B8C\u6210" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: `ncm-icon-btn${showSettings ? " ncm-icon-btn-active" : ""}`,
          title: showSettings ? "\u8FD4\u56DE\u64AD\u653E" : "\u8BBE\u7F6E",
          "aria-label": showSettings ? "\u8FD4\u56DE\u64AD\u653E" : "\u8BBE\u7F6E",
          onClick: () => setShowSettings((value) => !value),
          children: showSettings ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BackIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SlidersIcon, {})
        }
      )
    ] }),
    showSettings && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsPane, { onClose: () => setShowSettings(false) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-search", style: showSettings ? { display: "none" } : void 0, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "ncm-input",
          value: draft,
          placeholder: "\u641C\u6B4C\u540D\u3001\u6B4C\u624B\u6216\u573A\u666F",
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") void runSearch(draft);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn ncm-btn-primary", disabled: state.searching || draft.trim() === "", onClick: () => {
        void runSearch(draft);
      }, children: state.searching ? "\u641C\u7D22\u4E2D\u2026" : "\u641C\u7D22" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-results", style: showSettings ? { display: "none" } : void 0, children: [
      state.searchError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ncm-empty", style: { color: "#d33a31" }, children: state.searchError }),
      state.searchError === null && state.results.length === 0 && !state.searching && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-empty-mark", "aria-hidden": "true", children: "\u266A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: state.searchedKeyword === "" ? "\u641C\u7D22\u4E00\u9996\u6B4C\u5F00\u59CB\u64AD\u653E" : `\u6CA1\u6709\u627E\u5230\u300C${state.searchedKeyword}\u300D` })
      ] }),
      state.results.map((song, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-item", style: { opacity: song.playable ? 1 : 0.42 }, children: [
        song.cover === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-cover", "aria-hidden": "true", children: "\u266A" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: "ncm-cover", width: 32, height: 32, src: song.cover, alt: "", loading: "lazy", onError: (event) => {
          event.currentTarget.style.visibility = "hidden";
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-item-main", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ncm-item-name", children: song.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-item-sub", children: [
            song.artists.join(" / "),
            song.album === "" ? "" : ` \xB7 ${song.album}`
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-dur", children: formatDuration(song.durationMs) }),
        song.playable && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ncm-item-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-mini", title: "\u64AD\u653E", disabled: state.busy !== null, onClick: () => {
            void playSong(song);
          }, children: "\u25B6" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-mini", title: "\u4E0B\u4E00\u9996\u64AD\u653E", disabled: state.busy !== null, onClick: () => {
            void enqueueSong(song, true);
          }, children: "\u21B5" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-mini", title: "\u52A0\u5165\u961F\u5217", disabled: state.busy !== null, onClick: () => {
            void enqueueSong(song, false);
          }, children: "\uFF0B" })
        ] })
      ] }, `${song.encryptedId ?? song.name}-${index}`))
    ] }),
    state.error !== null && !showSettings && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-error", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: state.error }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-back", onClick: () => setState({ error: null }), children: "\u5173\u95ED" })
    ] }),
    state.queueOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-queue", style: showSettings ? { display: "none" } : void 0, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-queue-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "\u64AD\u653E\u961F\u5217 \xB7 ",
          state.queue.total,
          " \u9996"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => {
          void clearQueue();
        }, disabled: state.busy !== null, children: "\u6E05\u7A7A" })
      ] }),
      state.queue.items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ncm-empty", style: { minHeight: 80 }, children: "\u961F\u5217\u4E3A\u7A7A\uFF0C\u5728\u641C\u7D22\u7ED3\u679C\u4E0A\u70B9\u300C+\u300D\u52A0\u5165" }),
      state.queue.items.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `ncm-queue-row${entry.current ? " ncm-queue-row-current" : ""}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: 18, textAlign: "right", color: "var(--ncm-faint)" }, children: entry.index ?? index + 1 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-queue-label", children: entry.label || "(\u672A\u77E5\u66F2\u76EE)" }),
        entry.current && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11 }, children: "\u25B6" })
      ] }, index))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-player", style: showSettings ? { display: "none" } : void 0, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-play", title: playing ? "\u6682\u505C" : "\u64AD\u653E", onClick: () => {
        void runControl(playing ? "pause" : "resume");
      }, children: playing ? "\u23F8" : "\u25B6" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-state", style: { marginLeft: 8 }, children: state.notice !== null ? state.notice : describePlayback(current) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          className: `ncm-queue-toggle${state.queueOpen ? " ncm-queue-toggle-active" : ""}`,
          title: "\u64AD\u653E\u961F\u5217",
          onClick: () => setState({ queueOpen: !state.queueOpen, error: null }),
          children: [
            "\u2630 ",
            state.queue.total > 0 ? state.queue.total : ""
          ]
        }
      )
    ] })
  ] }) });
}
function SettingsPane({ onClose }) {
  const state = (0, import_react.useSyncExternalStore)(subscribe, getSnapshot);
  const [appId, setAppId] = import_react.default.useState("");
  const [privateKey, setPrivateKey] = import_react.default.useState("");
  const [player, setPlayer] = import_react.default.useState("");
  (0, import_react.useEffect)(() => {
    if (state.status === null && state.statusLoading === false && state.statusError === null) void refreshStatus();
  }, [state.status, state.statusLoading, state.statusError]);
  const save = (0, import_react.useCallback)(async (payload) => {
    setState({ busy: "save", notice: null });
    try {
      const status2 = await api("config", { method: "POST", body: JSON.stringify(payload) });
      setState({ status: status2, busy: null, notice: "\u5DF2\u4FDD\u5B58" });
      setPrivateKey("");
    } catch (error) {
      setState({ busy: null, notice: error instanceof Error ? error.message : String(error) });
    }
  }, []);
  const status = state.status;
  const configured = status !== null && status.credentials.appId !== null && status.credentials.hasPrivateKey;
  const installing = state.install?.state === "running";
  const cliMissing = status !== null && status.cli.installed === false;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-root ncm-section ncm-pane", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ncm-pane-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-back", onClick: onClose, children: "\u2190 \u8FD4\u56DE\u64AD\u653E" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ncm-h", children: "\u72B6\u6001" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ncm-p", children: "\u63D2\u4EF6\u4E0D\u4FDD\u5B58\u4EFB\u4F55\u51ED\u8BC1\uFF1A\u8C03\u7528\u5B98\u65B9 ncm-cli\uFF0C\u51ED\u636E\u7531 ncm-cli \u81EA\u5DF1\u52A0\u5BC6\u5B58\u653E\u3002\u8FD9\u91CC\u53EA\u663E\u793A\u201C\u662F\u5426\u5DF2\u914D\u7F6E\u201D\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "ncm-cli" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dot, { bad: cliMissing, children: status === null ? "\u68C0\u6D4B\u4E2D\u2026" : status.cli.installed ? `v${status.cli.version}` : "\u672A\u5B89\u88C5" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "API Key" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dot, { bad: status !== null && !configured, children: configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u767B\u5F55" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dot, { bad: status !== null && status.login.loggedIn === false, children: status === null ? "\u68C0\u6D4B\u4E2D\u2026" : status.login.loggedIn ? "\u5DF2\u767B\u5F55" : "\u672A\u767B\u5F55" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u64AD\u653E\u5668\uFF08mpv\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dot, { bad: status !== null && status.mpv.installed === false, warn: status?.player !== "mpv", children: status === null ? "\u68C0\u6D4B\u4E2D\u2026" : status.mpv.installed ? `\u53EF\u7528 v${status.mpv.version ?? "?"}` : "\u672A\u5B89\u88C5" })
        ] })
      ] }),
      state.statusError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ncm-p", style: { color: "#d33a31", marginTop: 10 }, children: state.statusError })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ncm-h", children: cliMissing ? "\u5B89\u88C5 ncm-cli" : "ncm-cli \u5DF2\u5B89\u88C5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ncm-p", children: cliMissing ? "\u63D2\u4EF6\u4F9D\u8D56\u7F51\u6613\u4E91\u5B98\u65B9 CLI\u3002\u70B9\u4E0B\u9762\u7684\u6309\u94AE\u76F4\u63A5\u7528 npm \u5168\u5C40\u5B89\u88C5\u5230\u672C\u673A\uFF0C\u5B89\u88C5\u8FC7\u7A0B\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002" : `\u5F53\u524D\u8DEF\u5F84\uFF1A${status?.cli.binPath ?? "ncm-cli"}\u3002\u9700\u8981\u4FEE\u590D\u6216\u5347\u7EA7\u65F6\u53EF\u4EE5\u91CD\u65B0\u5B89\u88C5\u3002` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-row", style: { marginTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn ncm-btn-primary", disabled: installing, onClick: () => {
          void installCli();
        }, children: installing ? "\u5B89\u88C5\u4E2D\u2026" : cliMissing ? "\u5B89\u88C5 ncm-cli" : "\u91CD\u65B0\u5B89\u88C5 / \u5347\u7EA7" }),
        state.install?.state === "success" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-p", style: { color: "#2e9e5b" }, children: "\u5B89\u88C5\u5B8C\u6210" }),
        state.install?.state === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ncm-p", style: { color: "#d33a31" }, children: [
          "\u5B89\u88C5\u5931\u8D25\uFF1A",
          state.install.message
        ] })
      ] }),
      state.install !== null && state.install.log.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "ncm-log", children: state.install.log.slice(-12).join("\n") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-label", children: "App ID" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: "ncm-input", value: appId, placeholder: status?.credentials.appId === null || status?.credentials.appId === void 0 ? "\u5F00\u653E\u5E73\u53F0\u7533\u8BF7\u7684 appId" : `\u5DF2\u914D\u7F6E\uFF1A${status.credentials.appId}\uFF08\u7559\u7A7A\u4E0D\u4FEE\u6539\uFF09`, onChange: (event) => setAppId(event.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-label", children: "Private Key" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: "ncm-input", type: "password", value: privateKey, placeholder: status?.credentials.hasPrivateKey === true ? "\u5DF2\u4FDD\u5B58\uFF0C\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539" : "\u5F00\u653E\u5E73\u53F0\u7533\u8BF7\u7684 privateKey", onChange: (event) => setPrivateKey(event.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn ncm-btn-primary", disabled: state.busy !== null || appId.trim() === "" && privateKey.trim() === "", onClick: () => {
        void save({ appId: appId.trim(), privateKey });
      }, children: "\u4FDD\u5B58\u51ED\u8BC1" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn", disabled: state.busy !== null, onClick: () => {
        void refreshStatus();
      }, children: "\u91CD\u65B0\u68C0\u6D4B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn", disabled: state.busy !== null || status?.login.loggedIn === true, onClick: () => {
        void startLogin();
      }, children: "\u626B\u7801\u767B\u5F55" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ncm-label", children: "\u64AD\u653E\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "ncm-input", value: player === "" ? status?.player ?? "mpv" : player, onChange: (event) => setPlayer(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "mpv", children: "mpv\uFF08\u5185\u7F6E\uFF0C\u8DE8\u5E73\u53F0\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "orpheus", children: "orpheus\uFF08\u5524\u8D77\u4E91\u97F3\u4E50 App\uFF0C\u4EC5 macOS\uFF09" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ncm-btn", disabled: state.busy !== null, onClick: () => {
        void save({ player: player === "" ? status?.player ?? "mpv" : player });
      }, children: "\u4FDD\u5B58\u64AD\u653E\u5668" })
    ] }),
    (state.notice !== null || state.loginUrl !== null) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ncm-notice", children: [
      state.notice,
      state.loginUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 6 }, children: [
        "\u767B\u5F55\u94FE\u63A5\uFF1A",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: state.loginUrl, target: "_blank", rel: "noreferrer", children: state.loginUrl })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "ncm-details", onToggle: (event) => {
      if (event.currentTarget.open) void api("diagnostics").then((data) => setState({ diagnostics: data })).catch(() => void 0);
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u8BCA\u65AD\u4FE1\u606F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: state.diagnostics === null ? "\u5C55\u5F00\u540E\u52A0\u8F7D\u2026" : JSON.stringify(state.diagnostics, null, 2) })
    ] })
  ] });
}
function apply(ctx) {
  injectStyles();
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: PANEL_ID
  }, MusicPage));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: PANEL_ID,
    order: 11,
    label: () => "\u7F51\u6613\u4E91\u97F3\u4E50"
  }, MusicIcon));
}
var inject = ["slots"];

		return module.exports;
	}
});
