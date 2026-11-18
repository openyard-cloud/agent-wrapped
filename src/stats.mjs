// Merge the /stats cache and the transcripts into one year summary, then derive the story bits.
import { createHash } from "node:crypto";
import { localDate } from "./claude.mjs";

const TEMP = /(^|\/)(private\/)?(tmp|var\/folders)\//;

/** Friendly tool label: MCP tools are grouped by server, built-ins keep their name. */
export function toolLabel(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return name;
  const server = m[1].replace(/^claude_ai_/, "").replace(/^plugin_[^_]+_/, "").replace(/[-_]+/g, " ");
  return `MCP · ${server}`;
}

const LANG = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".dart": "Dart",
  ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".cpp": "C++", ".cc": "C++", ".c": "C", ".h": "C", ".hpp": "C++",
  ".md": "Markdown", ".mdx": "Markdown", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
  ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sql": "SQL", ".sh": "Shell", ".zsh": "Shell", ".bash": "Shell",
  ".vue": "Vue", ".svelte": "Svelte", ".lua": "Lua", ".ex": "Elixir", ".exs": "Elixir", ".zig": "Zig", ".scala": "Scala",
  ".ipynb": "Notebook", ".tf": "Terraform", ".prisma": "Prisma", ".graphql": "GraphQL",
};

const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;

/**
 * Model id to a short display name:
 * claude-opus-5-5 -> Opus 5.5, claude-sonnet-4-5-20250929 -> Sonnet 4.5, gpt-5.6-sol -> GPT-5.6 Sol, gpt-5-codex -> GPT-5 Codex.
 */
export function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  const g = /^gpt-(\d+(?:\.\d+)?)(?:-(.+?))?(?:-\d{4}-\d{2}-\d{2})?$/.exec(id);
  if (g) return `GPT-${g[1]}${g[2] ? " " + g[2].split("-").map(cap).join(" ") : ""}`;
  return id;
}

/** "Claude Code", "Codex", or "Claude Code and Codex", for titles and the card. */
export function agentsLabel(agents) {
  if (!agents.length) return "your coding agent";
  return agents.length === 1 ? agents[0] : agents.slice(0, -1).join(", ") + " and " + agents[agents.length - 1];
}

function top(map, n, label = x => x) {
  const merged = new Map();
  for (const [k, v] of map) { const l = label(k); merged.set(l, (merged.get(l) || 0) + v); }
  return [...merged].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}

function longestStreak(dates) {
  const sorted = [...dates].sort();
  let best = 0, run = 0, prev = null, bestEnd = null;
  for (const d of sorted) {
    const t = Date.parse(d + "T12:00:00");
    run = prev !== null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = d; }
    prev = t;
  }
  return { days: best, end: bestEnd };
}

/** The coverage window, so the card can say what it is based on. */
function coverage(dates) {
  const s = [...dates].sort();
  return { from: s[0] || null, to: s[s.length - 1] || null };
}

/**
 * Count one computer's history into a tally: plain JSON with totals per day, model, tool and hour, and nothing
 * else (no prompts, no file names; project folders only as short one-way hashes so two computers can share them).
 * acc: Claude Code transcripts, merged with its /stats cache.
 * extra: other agents' accumulators, e.g. [{ agent: "Codex", acc }]. They share no days with Claude Code's
 * cache, so they are added on top after that merge.
 */
export function tally({ acc, cache, year, extra = [], history = null }) {
  const y = String(year);
  const days = new Map(); // date -> { messages, sessions, toolCalls, tokens, source }
  const cacheUntil = cache?.lastComputedDate || null;
  // 1. The /stats cache, for its whole range inside the year.
  for (const d of cache?.dailyActivity || []) {
    if (!d.date?.startsWith(y)) continue;
    days.set(d.date, { messages: d.messageCount || 0, sessions: d.sessionCount || 0, toolCalls: d.toolCallCount || 0, tokens: 0, source: "cache" });
  }
  const modelFirst = new Map(), modelTokens = new Map();
  for (const d of cache?.dailyModelTokens || []) {
    if (!d.date?.startsWith(y)) continue;
    let dayTokens = 0;
    for (const [m, t] of Object.entries(d.tokensByModel || {})) {
      dayTokens += t;
      modelTokens.set(m, (modelTokens.get(m) || 0) + t);
      if (!modelFirst.has(m) || d.date < modelFirst.get(m)) modelFirst.set(m, d.date);
    }
    const cur = days.get(d.date);
    if (cur) cur.tokens = dayTokens; else days.set(d.date, { messages: 0, sessions: 0, toolCalls: 0, tokens: dayTokens, source: "cache" });
  }
  // 2. Transcripts. Where both cover a day, keep the larger count (the cache was built from the same transcripts).
  for (const [date, d] of acc.days) {
    const cur = days.get(date);
    const t = { messages: d.messages, sessions: d.sessions.size, toolCalls: d.toolCalls, tokens: d.tokens };
    if (!cur) days.set(date, t);
    else days.set(date, { messages: Math.max(cur.messages, t.messages), sessions: Math.max(cur.sessions, t.sessions), toolCalls: Math.max(cur.toolCalls, t.toolCalls), tokens: Math.max(cur.tokens, t.tokens) });
  }
  // 2b. Prompt history, only for days neither the cache nor the transcripts know (it has no tokens or tools).
  const historyDates = [];
  for (const [date, h] of history?.days || []) {
    const cur = days.get(date);
    if (cur && cur.messages + cur.tokens + cur.toolCalls > 0) continue;
    days.set(date, { messages: h.prompts, sessions: h.sessions, toolCalls: 0, tokens: 0 });
    historyDates.push(date);
  }
  // 3. Other agents, added on top.
  for (const { acc: x } of extra) {
    for (const [date, d] of x.days) {
      const cur = days.get(date) || { messages: 0, sessions: 0, toolCalls: 0, tokens: 0 };
      days.set(date, { messages: cur.messages + d.messages, sessions: cur.sessions + d.sessions.size, toolCalls: cur.toolCalls + d.toolCalls, tokens: cur.tokens + d.tokens });
    }
  }
  const cacheModelDays = new Set((cache?.dailyModelTokens || []).map(d => d.date));
  for (const [m, v] of acc.models) if (!modelFirst.has(m) || v.first < modelFirst.get(m)) modelFirst.set(m, v.first);
  // Transcript tokens per model only for days the cache does not have, so nothing is counted twice.
  for (const [key, t] of acc.modelDays) {
    const [date, m] = key.split("|");
    if (cacheModelDays.has(date)) continue;
    modelTokens.set(m, (modelTokens.get(m) || 0) + t);
  }
  for (const { acc: x } of extra) {
    for (const [m, v] of x.models) if (!modelFirst.has(m) || v.first < modelFirst.get(m)) modelFirst.set(m, v.first);
    for (const [key, t] of x.modelDays) { const m = key.split("|")[1]; modelTokens.set(m, (modelTokens.get(m) || 0) + t); }
  }
  const all = [acc, ...extra.map(e => e.acc)];
  const mergeMaps = k => { const out = {}; for (const a of all) for (const [n, v] of a[k]) out[n] = (out[n] || 0) + v; return out; };

  // Hours: cache counts sessions per start hour; transcripts add their sessions after the cache's last day.
  const hours = Array(24).fill(0);
  for (const [h, n] of Object.entries(cache?.hourCounts || {})) if (cache?.firstSessionDate?.startsWith(y) || !cache?.firstSessionDate) hours[+h] += n;
  for (const s of acc.sessions.values()) if (s.startHour >= 0 && (!cacheUntil || localDate(s.first) > cacheUntil)) hours[s.startHour]++;
  for (const { acc: x } of extra) for (const s of x.sessions.values()) if (s.startHour >= 0) hours[s.startHour]++;
  for (const date of historyDates) for (const h of history.days.get(date).startHours) hours[h]++;

  // Sessions from transcripts: active time, cost, lines, projects.
  const sessions = all.flatMap(a => [...a.sessions.values()]);
  const longest = sessions.reduce((best, s) => (s.activeMs > (best?.activeMs || 0) ? s : best), null);
  const cacheLongest = cache?.longestSession?.timestamp?.startsWith(y) ? cache.longestSession : null;
  const projects = [...new Set([...sessions.map(s => s.cwd), ...(history?.projects || [])].filter(c => c && !TEMP.test(c)).map(c => createHash("sha256").update(c).digest("hex").slice(0, 12)))];
  const hasClaude = acc.days.size > 0 || historyDates.length > 0 || (cache?.dailyActivity || []).some(d => d.date?.startsWith(y));
  const fromHistory = (k, start) => historyDates.reduce((a, date) => k(a, history.days.get(date)), start);

  return {
    format: TALLY_FORMAT, year,
    agents: [...(hasClaude ? ["Claude Code"] : []), ...extra.filter(e => e.acc.days.size > 0).map(e => e.agent)],
    days: Object.fromEntries([...days].map(([k, d]) => [k, { messages: d.messages, sessions: d.sessions, toolCalls: d.toolCalls, tokens: d.tokens }])),
    transcriptDates: [...new Set(all.flatMap(a => [...a.days.keys()]))].sort(),
    cacheUntil,
    models: Object.fromEntries([...modelFirst].map(([id, first]) => [id, { first, tokens: modelTokens.get(id) || 0 }])),
    hours,
    weekdays: fromHistory((w, h) => w.map((n, i) => n + h.weekdays[i]), all.reduce((w, x) => w.map((n, i) => n + (x.weekdays?.[i] || 0)), Array(7).fill(0))),
    historyDays: historyDates.length,
    tools: mergeMaps("tools"), exts: mergeMaps("exts"),
    longest: longest ? { activeMs: longest.activeMs, messages: longest.messages, first: longest.first } : null,
    cacheLongest: cacheLongest ? { messageCount: cacheLongest.messageCount, timestamp: cacheLongest.timestamp } : null,
    projects,
    cost: sessions.reduce((a, s) => a + s.cost, 0),
    linesAdded: sessions.reduce((a, s) => a + s.linesAdded, 0),
    linesRemoved: sessions.reduce((a, s) => a + s.linesRemoved, 0),
    contextTokens: (cache?.firstSessionDate?.startsWith(y) ? Object.values(cache?.modelUsage || {}).reduce((a, u) => a + (u.cacheReadInputTokens || 0), 0) : 0) + all.reduce((a, x) => a + x.cacheReadTokens, 0),
    subagentMessages: all.reduce((a, x) => a + x.subagentMessages, 0),
    prompts: fromHistory((a, h) => a + h.prompts, all.reduce((a, x) => a + [...x.days.values()].reduce((b, d) => b + (d.prompts || 0), 0), 0)), // transcripts, then history
    interrupts: all.reduce((a, x) => a + (x.interrupts || 0), 0),
    skippedCompressed: extra.reduce((a, e) => a + (e.acc.skippedCompressed || 0), 0),
  };
}

export const TALLY_FORMAT = "agent-wrapped-tally/1";

/** Add tallies from different computers. Their sessions are different, so days and counts add up. */
export function mergeTallies(list) {
  const [first, ...rest] = list;
  const out = structuredClone(first);
  const add = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; };
  for (const t of rest) {
    if (t.year !== out.year) throw new Error(`a tally for ${t.year} can't be added to ${out.year}`);
    for (const a of t.agents) if (!out.agents.includes(a)) out.agents.push(a);
    for (const [date, d] of Object.entries(t.days)) {
      const c = out.days[date] || (out.days[date] = { messages: 0, sessions: 0, toolCalls: 0, tokens: 0 });
      for (const k of ["messages", "sessions", "toolCalls", "tokens"]) c[k] += d[k] || 0;
    }
    out.transcriptDates = [...new Set([...out.transcriptDates, ...t.transcriptDates])].sort();
    if (t.cacheUntil && (!out.cacheUntil || t.cacheUntil > out.cacheUntil)) out.cacheUntil = t.cacheUntil;
    for (const [id, m] of Object.entries(t.models)) {
      const c = out.models[id];
      if (!c) out.models[id] = { ...m };
      else { c.tokens += m.tokens; if (m.first < c.first) c.first = m.first; }
    }
    out.hours = out.hours.map((n, i) => n + (t.hours[i] || 0));
    out.weekdays = out.weekdays.map((n, i) => n + (t.weekdays[i] || 0));
    add(out.tools, t.tools); add(out.exts, t.exts);
    if (t.longest && (!out.longest || t.longest.activeMs > out.longest.activeMs)) out.longest = t.longest;
    if (t.cacheLongest && (!out.cacheLongest || t.cacheLongest.messageCount > out.cacheLongest.messageCount)) out.cacheLongest = t.cacheLongest;
    out.projects = [...new Set([...out.projects, ...t.projects])];
    for (const k of ["cost", "linesAdded", "linesRemoved", "contextTokens", "subagentMessages", "prompts", "interrupts", "skippedCompressed", "historyDays"]) out[k] = (out[k] || 0) + (t[k] || 0);
  }
  return out;
}

/** Check a tally read from a file before trusting its shape. */
export function readTally(text, where = "the tally file") {
  let t;
  try { t = JSON.parse(text); } catch { throw new Error(`${where} is not JSON`); }
  if (!t || t.format !== TALLY_FORMAT) throw new Error(`${where} is not an agent-wrapped tally (make one with --export)`);
  for (const k of ["days", "models", "tools", "exts"]) if (!t[k] || typeof t[k] !== "object") throw new Error(`${where} is missing "${k}"`);
  if (!Array.isArray(t.hours) || t.hours.length !== 24 || !Array.isArray(t.weekdays) || t.weekdays.length !== 7) throw new Error(`${where} has bad hours or weekdays`);
  t.agents = Array.isArray(t.agents) ? t.agents.filter(a => typeof a === "string") : [];
  t.projects = Array.isArray(t.projects) ? t.projects : [];
  t.transcriptDates = Array.isArray(t.transcriptDates) ? t.transcriptDates : [];
  return t;
}

/** Turn a tally into the summary the story and card are drawn from. */
export function finish(t, { now = Date.now() } = {}) {
  const days = Object.entries(t.days);
  const activeDates = days.filter(([, d]) => d.messages + d.tokens + d.toolCalls > 0).map(([k]) => k);
  const total = k => days.reduce((a, [, d]) => a + (d[k] || 0), 0);
  const models = Object.entries(t.models).map(([id, m]) => ({ id, name: modelName(id), first: m.first, tokens: m.tokens || 0 }))
    .sort((a, b) => a.first.localeCompare(b.first));
  const favourite = [...models].sort((a, b) => b.tokens - a.tokens)[0] || null;
  const hours = t.hours;
  const hourSum = hours.reduce((a, b) => a + b, 0) || 1;
  const peakHour = hours.some(Boolean) ? hours.indexOf(Math.max(...hours)) : null;
  const allTools = new Map(Object.entries(t.tools)), allExts = new Map(Object.entries(t.exts));
  const toolTotal = [...allTools.values()].reduce((a, b) => a + b, 0) || 1;
  const share = names => names.reduce((a, n) => a + (allTools.get(n) || 0), 0) / toolTotal;
  const busiest = days.sort((a, b) => b[1].messages - a[1].messages)[0];
  const s = {
    year: t.year, generatedAt: new Date(now).toISOString(),
    coverage: { ...coverage(activeDates), cacheUntil: t.cacheUntil, transcripts: coverage(t.transcriptDates) },
    activeDays: activeDates.length,
    sessions: total("sessions"),
    messages: total("messages"),
    toolCalls: total("toolCalls"),
    tokens: total("tokens") || models.reduce((a, m) => a + m.tokens, 0),
    // Days with any token count. Fewer than activeDays means some days are known only from prompt history,
    // so the token total is a floor, and the page says so.
    tokenDays: days.filter(([, d]) => d.tokens > 0).length || (total("tokens") ? 0 : activeDates.length),
    contextTokens: t.contextTokens || 0,
    streak: longestStreak(activeDates),
    busiest: busiest ? { date: busiest[0], messages: busiest[1].messages } : null,
    heatmap: Object.fromEntries(Object.entries(t.days).map(([k, d]) => [k, d.messages])),
    hours, peakHour,
    nightShare: hours.reduce((a, n, h) => a + (h >= 22 || h < 5 ? n : 0), 0) / hourSum,
    morningShare: hours.reduce((a, n, h) => a + (h >= 5 && h < 9 ? n : 0), 0) / hourSum,
    models, favourite,
    longest: t.longest ? { hours: t.longest.activeMs / 3.6e6, messages: t.longest.messages, date: localDate(t.longest.first) } : null,
    longestByMessages: t.cacheLongest ? { messages: t.cacheLongest.messageCount, date: t.cacheLongest.timestamp.slice(0, 10) } : null,
    projects: t.projects.length,
    cost: t.cost || 0, linesAdded: t.linesAdded || 0, linesRemoved: t.linesRemoved || 0,
    tools: top(allTools, 6, toolLabel),
    languages: top(new Map([...allExts].filter(([e]) => LANG[e])), 5, e => LANG[e]),
    subagentMessages: t.subagentMessages || 0,
    prompts: t.prompts || 0,
    interrupts: t.interrupts || 0,
    historyDays: t.historyDays || 0,
    weekdays: t.weekdays,
    shares: { bash: share(["Bash", "Shell"]), read: share(["Read", "Grep", "Glob", "LS"]), edit: share(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]), agents: share(["Task", "Agent"]), web: share(["WebFetch", "WebSearch", "Web search"]) },
    agents: t.agents,
    agentsLabel: agentsLabel(t.agents),
    skippedCompressed: t.skippedCompressed || 0,
  };
  s.persona = persona(s);
  return s;
}

/** One computer, start to finish. */
export function summarize({ acc, cache, year, now = Date.now(), extra = [], history = null }) {
  return finish(tally({ acc, cache, year, extra, history }), { now });
}

/** A playful label, picked by the first rule that fits. Each one is explained on the card. */
export function persona(s) {
  const rules = [
    [s.nightShare >= 0.3, "The Night Owl", `${Math.round(s.nightShare * 100)}% of your sessions started between 10 pm and 5 am.`],
    [s.morningShare >= 0.3, "The Early Bird", `${Math.round(s.morningShare * 100)}% of your sessions started before 9 am.`],
    [s.shares.agents >= 0.08 || s.subagentMessages > s.messages * 0.3, "The Orchestrator", "You handed work to subagents more than most."],
    [(s.longest?.hours || 0) >= 8, "The Marathoner", `Your longest session kept the agent busy for ${Math.round(s.longest?.hours || 0)} hours.`],
    [s.shares.bash >= 0.45, "The Commander", `${Math.round(s.shares.bash * 100)}% of tool calls were shell commands.`],
    [s.shares.read >= 0.4, "The Explorer", "Most of your agent's work was reading and searching code."],
    [s.shares.edit >= 0.3, "The Builder", "Edits and new files were the biggest share of the work."],
    [s.shares.web >= 0.1, "The Researcher", "You sent your agent to the web more than most."],
    [s.streak.days >= 14, "The Regular", `You showed up ${s.streak.days} days in a row.`],
  ];
  const hit = rules.find(([ok]) => ok) || [true, "The Collaborator", "A bit of everything: reading, building and running."];
  return { title: hit[1], why: hit[2] };
}
