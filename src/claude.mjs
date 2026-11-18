// Read Claude Code's local history: the /stats cache (long, coarse) and session transcripts (recent, detailed).
// Nothing here leaves the machine. Prompt text and file contents are never stored, only counts.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

export function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function readStatsCache(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "stats-cache.json"), "utf8")); } catch { return null; }
}

/**
 * Claude Code's prompt history (history.jsonl, what the up arrow recalls). It is not cleaned up after 30 days,
 * so it still knows which days you worked after the transcripts are gone and /stats was last run. Only the time
 * and the project folder of each prompt are read; the prompt text is skipped. Sessions are estimated: a new one
 * starts when a project has been quiet for 30 minutes.
 * Returns date -> { prompts, sessions, startHours: [hour...], weekdays: [7] } and the project folders.
 */
export function readHistory(dir, { year } = {}) {
  const days = new Map(), projects = new Set(), lastByProject = new Map();
  let text;
  try { text = fs.readFileSync(path.join(dir, "history.jsonl"), "utf8"); } catch { return { days, projects }; }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = typeof o.timestamp === "number" ? o.timestamp : Date.parse(o.timestamp);
    if (!Number.isFinite(ts) || (year && new Date(ts).getFullYear() !== year)) continue;
    rows.push([ts, typeof o.project === "string" ? o.project : ""]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const [ts, project] of rows) {
    const date = localDate(ts), dt = new Date(ts);
    let d = days.get(date);
    if (!d) days.set(date, d = { prompts: 0, sessions: 0, startHours: [], weekdays: Array(7).fill(0) });
    d.prompts++; d.weekdays[dt.getDay()]++;
    const last = lastByProject.get(project);
    if (last === undefined || ts - last >= IDLE_GAP || localDate(last) !== date) { d.sessions++; d.startHours.push(dt.getHours()); }
    lastByProject.set(project, ts);
    if (project) projects.add(project);
  }
  return { days, projects };
}

/** Every transcript file: main sessions at projects/<p>/<id>.jsonl, subagents at projects/<p>/<id>/subagents/*.jsonl. */
export function listTranscripts(dir) {
  const root = path.join(dir, "projects"), out = [];
  let projects;
  try { projects = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const p of projects) {
    const pdir = path.join(root, p.name);
    let entries = [];
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ file: path.join(pdir, e.name), sub: false });
      else if (e.isDirectory()) {
        const sd = path.join(pdir, e.name, "subagents");
        try { for (const f of fs.readdirSync(sd)) if (f.endsWith(".jsonl")) out.push({ file: path.join(sd, f), sub: true }); } catch { /* no subagents */ }
      }
    }
  }
  return out;
}

const pad = n => String(n).padStart(2, "0");
/** Local calendar date, YYYY-MM-DD, in the machine's time zone. */
export function localDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const IDLE_GAP = 30 * 60 * 1000;

export function emptyAcc() {
  return {
    days: new Map(),      // date -> { messages, prompts, sessions:Set, toolCalls, tokens }
    hours: Array(24).fill(0), // prompts per local hour
    weekdays: Array(7).fill(0),
    models: new Map(),    // model -> { tokens, messages, first, last }
    modelDays: new Map(), // "date|model" -> tokens, so a day the /stats cache already has is not counted twice
    tools: new Map(),     // tool name -> calls
    exts: new Map(),      // file extension -> edits
    sessions: new Map(),  // sessionId -> { first, last, activeMs, prompts, messages, cost, linesAdded, linesRemoved, cwd, startHour }
    projects: new Set(),
    seen: new Set(),      // assistant message ids already counted (streamed replies repeat them)
    subagentMessages: 0,
    interrupts: 0,        // times the user stopped the agent mid-reply (Esc)
    cacheReadTokens: 0,
    firstTs: Infinity, lastTs: -Infinity,
  };
}

export function day(acc, date) {
  let d = acc.days.get(date);
  if (!d) acc.days.set(date, d = { messages: 0, prompts: 0, sessions: new Set(), toolCalls: 0, tokens: 0 });
  return d;
}

export function session(acc, id) {
  let s = acc.sessions.get(id);
  if (!s) acc.sessions.set(id, s = { first: Infinity, last: -Infinity, activeMs: 0, prompts: 0, messages: 0, cost: 0, linesAdded: 0, linesRemoved: 0, cwd: "", startHour: -1 });
  return s;
}

export function touch(acc, s, ts) {
  if (ts < s.first) { s.first = ts; s.startHour = new Date(ts).getHours(); }
  if (s.last > -Infinity && ts > s.last && ts - s.last < IDLE_GAP) s.activeMs += ts - s.last;
  if (ts > s.last) s.last = ts;
  if (ts < acc.firstTs) acc.firstTs = ts;
  if (ts > acc.lastTs) acc.lastTs = ts;
}

// Claude Code writes this as a user line when you press Esc while the agent is working.
const INTERRUPT = /^\[Request interrupted by user/;
function textOf(c) {
  if (typeof c === "string") return c;
  return Array.isArray(c) ? (c.find(x => x?.type === "text")?.text || "") : "";
}
export function isInterrupt(o) {
  return o.type === "user" && !o.isSidechain && INTERRUPT.test(textOf(o.message?.content).trim());
}

function isPrompt(o) {
  if (isInterrupt(o)) return false;
  if (o.isSidechain || o.isMeta || o.promptSource === "system") return false;
  const c = o.message?.content;
  if (typeof c === "string") return !c.startsWith("<command-") && !c.startsWith("<local-command") && c.trim().length > 0;
  return Array.isArray(c) && c.some(x => x?.type === "text" || x?.type === "image") && !c.some(x => x?.type === "tool_result");
}

/** Feed one parsed transcript line. `year` limits counting to that calendar year (local time). */
export function addLine(acc, o, { sub = false, year } = {}) {
  const t = o.type;
  if (t === "cost-state") {
    if (!o.sessionId) return;
    const s = session(acc, o.sessionId);
    s.cost = Math.max(s.cost, Number(o.totalCostUSD) || 0);
    s.linesAdded = Math.max(s.linesAdded, Number(o.totalLinesAdded) || 0);
    s.linesRemoved = Math.max(s.linesRemoved, Number(o.totalLinesRemoved) || 0);
    return;
  }
  if (t !== "user" && t !== "assistant") return;
  const ts = Date.parse(o.timestamp);
  if (!Number.isFinite(ts)) return;
  if (year && new Date(ts).getFullYear() !== year) return;
  const date = localDate(ts), d = day(acc, date);
  if (t === "assistant") {
    const m = o.message || {}, id = m.id || o.uuid;
    if (id && acc.seen.has(id)) return;
    if (id) acc.seen.add(id);
    const model = m.model;
    if (!model || model === "<synthetic>") return;
    const u = m.usage || {};
    const tokens = (u.input_tokens || 0) + (u.output_tokens || 0);
    acc.cacheReadTokens += u.cache_read_input_tokens || 0;
    d.messages++; d.tokens += tokens;
    let mm = acc.models.get(model);
    if (!mm) acc.models.set(model, mm = { tokens: 0, messages: 0, first: date, last: date });
    mm.tokens += tokens; mm.messages++;
    const key = `${date}|${model}`;
    acc.modelDays.set(key, (acc.modelDays.get(key) || 0) + tokens);
    if (date < mm.first) mm.first = date;
    if (date > mm.last) mm.last = date;
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c?.type !== "tool_use") continue;
      d.toolCalls++;
      acc.tools.set(c.name, (acc.tools.get(c.name) || 0) + 1);
      const fp = c.input?.file_path || c.input?.notebook_path;
      if (EDIT_TOOLS.has(c.name) && typeof fp === "string") {
        const ext = path.extname(fp).toLowerCase() || path.basename(fp);
        acc.exts.set(ext, (acc.exts.get(ext) || 0) + 1);
      }
    }
    if (sub) { acc.subagentMessages++; return; }
  } else {
    if (!sub && isInterrupt(o)) { acc.interrupts++; return; }
    if (sub || !isPrompt(o)) return;
    d.prompts++; d.messages++;
    const dt = new Date(ts);
    acc.hours[dt.getHours()]++;
    acc.weekdays[dt.getDay()]++;
  }
  if (sub || !o.sessionId) return;
  d.sessions.add(o.sessionId);
  const s = session(acc, o.sessionId);
  touch(acc, s, ts);
  if (t === "user") s.prompts++;
  s.messages++;
  if (o.cwd) { s.cwd = o.cwd; acc.projects.add(o.cwd); }
}

const WANTED = ['"type":"assistant"', '"type":"user"', '"type":"cost-state"'];

/** Stream every transcript into one accumulator. onProgress(doneFiles, totalFiles) is optional. */
export async function readTranscripts(dir, { year, onProgress } = {}) {
  const acc = emptyAcc();
  const files = listTranscripts(dir);
  let done = 0;
  for (const { file, sub } of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!WANTED.some(w => line.includes(w))) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      addLine(acc, o, { sub, year });
    }
    onProgress?.(++done, files.length);
  }
  acc.files = files.length;
  return acc;
}
