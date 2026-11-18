// Read OpenAI Codex CLI's local history into the same accumulator Claude Code uses.
// Format, from the Codex source (codex-rs/protocol, codex-rs/rollout): one JSON object per line,
// { timestamp, type, payload }, in $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl and in
// $CODEX_HOME/archived_sessions. Older files may be compressed to .jsonl.zst.
// Nothing here leaves the machine. Prompt text and file contents are never stored, only counts.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import readline from "node:readline";
import { emptyAcc, localDate, day, session, touch } from "./claude.mjs";

export function codexDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export const CAN_READ_ZSTD = typeof zlib.zstdDecompressSync === "function";

/** Every rollout file under sessions/ and archived_sessions/, compressed or not. */
export function listRollouts(dir) {
  const out = [];
  const walk = d => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zst"))) out.push(p);
    }
  };
  walk(path.join(dir, "sessions"));
  walk(path.join(dir, "archived_sessions"));
  return out;
}

/** Display name for a Codex tool call, grouped so it reads like the Claude Code names. */
export function codexToolName(type, name) {
  if (type === "local_shell_call") return "Shell";
  if (type === "web_search_call") return "Web search";
  if (!name) return null;
  if (name === "shell" || name === "exec_command" || name === "local_shell" || name === "container.exec") return "Shell";
  if (name === "apply_patch") return "apply_patch";
  if (name === "web_search") return "Web search";
  return name;
}

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
function patchedFiles(text) {
  return typeof text === "string" ? [...text.matchAll(PATCH_FILE)].map(m => m[1].trim()) : [];
}

function isSubagent(source) {
  if (!source) return false;
  if (typeof source === "string") return /sub_?agent/i.test(source);
  return Object.keys(source).some(k => /sub_?agent/i.test(k));
}

function tokensOf(u) {
  if (!u || typeof u !== "object") return null;
  const n = v => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { input: n(u.input_tokens), cached: n(u.cached_input_tokens ?? u.cache_read_input_tokens), output: n(u.output_tokens) };
}

/** Feed one parsed rollout line. `state` is per file; `seen` is shared so a forked session's copied history counts once. */
export function addCodexLine(acc, o, state, { year, seen } = {}) {
  const p = o?.payload;
  if (!p || typeof p !== "object") return;
  if (o.type === "session_meta") {
    state.id = p.id || state.id;
    state.sub = isSubagent(p.source);
    state.cwd = p.cwd || state.cwd;
    return;
  }
  if (o.type === "turn_context") {
    if (typeof p.model === "string" && p.model) state.model = p.model;
    if (p.cwd) state.cwd = p.cwd;
    return;
  }
  const ts = Date.parse(o.timestamp);
  if (!Number.isFinite(ts)) return;
  if (year && new Date(ts).getFullYear() !== year) return;

  const key = (kind, extra = "") => `${kind}|${o.timestamp}|${extra}`;
  const once = k => { if (!seen) return true; if (seen.has(k)) return false; seen.add(k); return true; };
  const date = localDate(ts);

  if (o.type === "response_item") {
    const label = codexToolName(p.type, p.name);
    if (!label || !/call$/.test(p.type || "")) return;
    if (!once(key("tool", p.call_id || p.id || p.name))) return;
    day(acc, date).toolCalls++;
    acc.tools.set(label, (acc.tools.get(label) || 0) + 1);
    if (p.name === "apply_patch") {
      let text = p.input;
      if (!text && typeof p.arguments === "string") { try { text = JSON.parse(p.arguments).input; } catch { text = p.arguments; } }
      for (const f of patchedFiles(text)) {
        const ext = path.extname(f).toLowerCase() || path.basename(f);
        acc.exts.set(ext, (acc.exts.get(ext) || 0) + 1);
      }
    }
    return;
  }

  if (o.type !== "event_msg") return;
  const d = day(acc, date);
  if (p.type === "user_message") {
    if (state.sub) return;
    if (!once(key("prompt", String(p.message || "").length))) return;
    d.prompts++; d.messages++;
    const dt = new Date(ts);
    acc.hours[dt.getHours()]++;
    acc.weekdays[dt.getDay()]++;
    if (state.id) {
      const s = session(acc, state.id);
      d.sessions.add(state.id); touch(acc, s, ts); s.prompts++; s.messages++;
      if (state.cwd) { s.cwd = state.cwd; acc.projects.add(state.cwd); }
    }
    return;
  }
  if (p.type === "token_count") {
    const last = tokensOf(p.info?.last_token_usage);
    const total = tokensOf(p.info?.total_token_usage);
    let u = last;
    if (!u && total) {
      const prev = state.prevTotal || { input: 0, cached: 0, output: 0 };
      u = { input: Math.max(0, total.input - prev.input), cached: Math.max(0, total.cached - prev.cached), output: Math.max(0, total.output - prev.output) };
    }
    if (total) state.prevTotal = total;
    if (!u || u.input + u.output === 0) return;
    if (!once(key("tokens", `${u.input}/${u.output}`))) return;
    // Same definition as Claude Code's /stats: input without cache reads, plus output. Cache reads are counted apart.
    const cached = Math.min(u.cached, u.input);
    const tokens = u.input - cached + u.output;
    acc.cacheReadTokens += cached;
    d.messages++; d.tokens += tokens;
    const model = state.model || "gpt-5";
    let mm = acc.models.get(model);
    if (!mm) acc.models.set(model, mm = { tokens: 0, messages: 0, first: date, last: date });
    mm.tokens += tokens; mm.messages++;
    if (date < mm.first) mm.first = date;
    if (date > mm.last) mm.last = date;
    const k = `${date}|${model}`;
    acc.modelDays.set(k, (acc.modelDays.get(k) || 0) + tokens);
    if (state.sub) { acc.subagentMessages++; return; }
    if (state.id) {
      const s = session(acc, state.id);
      d.sessions.add(state.id); touch(acc, s, ts); s.messages++;
    }
  }
}

async function* fileLines(file) {
  if (file.endsWith(".zst")) {
    yield* zlib.zstdDecompressSync(fs.readFileSync(file)).toString("utf8").split("\n");
    return;
  }
  yield* readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
}

/** Read every Codex rollout. Compressed files are skipped, and counted, when this Node cannot read zstd. */
export async function readCodex(dir, { year, onProgress } = {}) {
  const acc = emptyAcc();
  const files = listRollouts(dir);
  const seen = new Set();
  let done = 0, skippedCompressed = 0;
  for (const file of files) {
    if (file.endsWith(".zst") && !CAN_READ_ZSTD) { skippedCompressed++; onProgress?.(++done, files.length); continue; }
    const state = { id: path.basename(file).replace(/\.jsonl(\.zst)?$/, ""), model: null, sub: false, cwd: "", prevTotal: null };
    try {
      for await (const line of fileLines(file)) {
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        addCodexLine(acc, o, state, { year, seen });
      }
    } catch { /* an unreadable file is skipped; the rest still count */ }
    onProgress?.(++done, files.length);
  }
  acc.files = files.length;
  acc.skippedCompressed = skippedCompressed;
  return acc;
}
