// Made-up but plausible data for screenshots and trying the page without any history. Marked DEMO DATA everywhere.
import { summarize } from "./stats.mjs";
import { emptyAcc } from "./claude.mjs";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function demoSummary(year = new Date().getFullYear()) {
  const r = rng(2026);
  const dailyActivity = [], dailyModelTokens = [];
  const models = [["claude-sonnet-4-5-20250929", 0, 2], ["claude-opus-4-8", 2, 5], ["claude-sonnet-5", 5, 8], ["claude-opus-5", 8, 10], ["claude-opus-5-5", 10, 12]];
  for (let d = new Date(year, 0, 3); d.getFullYear() === year && d.getMonth() < 11; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (r() < (weekend ? 0.55 : 0.12)) continue;
    const date = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const busy = r() ** 2;
    const messageCount = Math.round(40 + busy * 1400);
    dailyActivity.push({ date, messageCount, sessionCount: 1 + Math.round(busy * 9), toolCallCount: Math.round(messageCount * 0.42) });
    const model = models.find(([, a, b]) => d.getMonth() >= a && d.getMonth() < b)[0];
    dailyModelTokens.push({ date, tokensByModel: { [model]: Math.round(messageCount * (900 + r() * 700)) } });
  }
  const hourCounts = {};
  for (let h = 0; h < 24; h++) hourCounts[h] = Math.round(h >= 22 || h < 2 ? 70 + r() * 30 : h >= 9 && h < 18 ? 30 + r() * 25 : 8 + r() * 10);
  const cache = {
    lastComputedDate: dailyActivity[dailyActivity.length - 1].date, dailyActivity, dailyModelTokens, hourCounts,
    firstSessionDate: `${year}-01-03T09:00:00.000Z`,
    modelUsage: { "claude-opus-5-5": { cacheReadInputTokens: 9.2e9 } },
    longestSession: { messageCount: 6120, timestamp: `${year}-09-14T02:00:00.000Z` },
  };
  const acc = emptyAcc();
  const tools = { Bash: 41210, Read: 23077, Edit: 17940, Grep: 8213, "mcp__claude-in-chrome__computer": 3120, Task: 2210, WebFetch: 1088 };
  for (const [k, v] of Object.entries(tools)) acc.tools.set(k, v);
  for (const [k, v] of Object.entries({ ".ts": 6120, ".tsx": 3302, ".py": 1880, ".md": 1210, ".rs": 640 })) acc.exts.set(k, v);
  acc.sessions.set("demo", { first: Date.parse(`${year}-09-14T01:00:00Z`), last: 0, activeMs: 11.5 * 3.6e6, prompts: 210, messages: 6120, cost: 18420, linesAdded: 412880, linesRemoved: 160214, cwd: "/home/demo/app", startHour: 1 });
  for (let i = 0; i < 37; i++) acc.sessions.set("p" + i, { first: Date.parse(`${year}-10-01T10:00:00Z`), last: 0, activeMs: 3.6e6, prompts: 1, messages: 1, cost: 0, linesAdded: 0, linesRemoved: 0, cwd: "/home/demo/p" + i, startHour: -1 });
  acc.subagentMessages = 21000;
  acc.interrupts = 46;
  // A few months of Codex on the side, so the demo shows both agents.
  const codex = emptyAcc();
  for (let d = new Date(year, 7, 4); d.getMonth() < 11; d.setDate(d.getDate() + 3)) {
    const date = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tokens = Math.round(180000 + r() * 420000), turns = 20 + Math.round(r() * 60);
    codex.days.set(date, { messages: turns, prompts: Math.round(turns / 4), sessions: new Set(["x" + date]), toolCalls: Math.round(turns * 0.8), tokens });
    codex.modelDays.set(`${date}|gpt-5.6-sol`, tokens);
    const m = codex.models.get("gpt-5.6-sol") || { tokens: 0, messages: 0, first: date, last: date };
    m.tokens += tokens; m.messages += turns; m.last = date;
    codex.models.set("gpt-5.6-sol", m);
  }
  codex.tools.set("Shell", 9100); codex.tools.set("apply_patch", 4300);
  return summarize({ acc, cache, year, now: Date.parse(`${year}-12-01T09:00:00Z`), extra: [{ agent: "Codex", acc: codex }] });
}
