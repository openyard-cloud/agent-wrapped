import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyAcc, addLine, readTranscripts, localDate } from "../src/claude.mjs";
import { summarize, modelName, toolLabel, persona } from "../src/stats.mjs";
import { renderHtml } from "../src/html.mjs";
import { demoSummary } from "../src/demo.mjs";

const T = (h, d = "2026-03-02") => new Date(`${d}T${String(h).padStart(2, "0")}:00:00`).toISOString();
const assistant = (id, ts, { model = "claude-opus-5-5", input = 10, output = 90, cacheRead = 1000, tools = [], session = "s1" } = {}) => ({
  type: "assistant", timestamp: ts, sessionId: session, cwd: "/home/me/secret-project",
  message: { id, model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead }, content: tools.map(([name, input]) => ({ type: "tool_use", name, input })) },
});
const prompt = (ts, text = "fix the bug", session = "s1") => ({ type: "user", timestamp: ts, sessionId: session, cwd: "/home/me/secret-project", message: { role: "user", content: text } });

test("a streamed reply counted once, tokens are input plus output", () => {
  const acc = emptyAcc();
  addLine(acc, assistant("m1", T(9)), { year: 2026 });
  addLine(acc, assistant("m1", T(9)), { year: 2026 });
  const d = acc.days.get(localDate(Date.parse(T(9))));
  assert.equal(d.messages, 1);
  assert.equal(d.tokens, 100);
  assert.equal(acc.cacheReadTokens, 1000);
});

test("tool results and system lines are not prompts; typed text is", () => {
  const acc = emptyAcc();
  addLine(acc, prompt(T(10)), { year: 2026 });
  addLine(acc, { ...prompt(T(10)), message: { content: [{ type: "tool_result", content: "ok" }] } }, { year: 2026 });
  addLine(acc, { ...prompt(T(10)), promptSource: "system" }, { year: 2026 });
  addLine(acc, { ...prompt(T(10)), message: { content: "<command-name>/clear</command-name>" } }, { year: 2026 });
  assert.equal([...acc.days.values()][0].prompts, 1);
  assert.equal(acc.hours[10], 1);
});

test("other years are ignored", () => {
  const acc = emptyAcc();
  addLine(acc, prompt(T(10, "2025-12-31")), { year: 2026 });
  assert.equal(acc.days.size, 0);
});

test("session cost and lines take the latest running total, not a sum", () => {
  const acc = emptyAcc();
  addLine(acc, { type: "cost-state", sessionId: "s1", totalCostUSD: 99, totalLinesAdded: 1440 });
  addLine(acc, { type: "cost-state", sessionId: "s1", totalCostUSD: 705, totalLinesAdded: 26890 });
  addLine(acc, { type: "cost-state", sessionId: "s1", totalCostUSD: 705, totalLinesAdded: 26890 });
  assert.equal(acc.sessions.get("s1").cost, 705);
  assert.equal(acc.sessions.get("s1").linesAdded, 26890);
});

test("active time skips pauses longer than 30 minutes", () => {
  const acc = emptyAcc();
  for (const [h, m] of [[9, 0], [9, 20], [9, 40], [11, 0], [11, 10]]) addLine(acc, prompt(new Date(`2026-03-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString()), { year: 2026 });
  assert.equal(acc.sessions.get("s1").activeMs, 50 * 60 * 1000);
});

test("cache and transcripts merge without counting a day twice", () => {
  const acc = emptyAcc();
  addLine(acc, assistant("a", T(9, "2026-03-02"), { input: 0, output: 500 }), { year: 2026 });
  addLine(acc, assistant("b", T(9, "2026-05-01"), { input: 0, output: 300 }), { year: 2026 });
  const cache = {
    lastComputedDate: "2026-03-02",
    dailyActivity: [{ date: "2026-01-10", messageCount: 40, sessionCount: 2, toolCallCount: 10 }, { date: "2026-03-02", messageCount: 1, sessionCount: 1, toolCallCount: 0 }],
    dailyModelTokens: [{ date: "2026-01-10", tokensByModel: { "claude-sonnet-4-5-20250929": 1000 } }, { date: "2026-03-02", tokensByModel: { "claude-opus-5-5": 500 } }],
  };
  const s = summarize({ acc, cache, year: 2026 });
  assert.equal(s.activeDays, 3);
  assert.equal(s.tokens, 1000 + 500 + 300);
  const opus = s.models.find(m => m.id === "claude-opus-5-5");
  assert.equal(opus.tokens, 800, "the cache's 500 for Mar 2 plus the transcript's 300 for May 1, not the transcript's Mar 2 again");
  assert.deepEqual(s.models.map(m => m.name), ["Sonnet 4.5", "Opus 5.5"]);
});

test("streak counts consecutive local days", () => {
  const acc = emptyAcc();
  for (const d of ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-05"]) addLine(acc, prompt(T(12, d)), { year: 2026 });
  assert.equal(summarize({ acc, cache: null, year: 2026 }).streak.days, 3);
});

test("temp folders do not count as projects", () => {
  const acc = emptyAcc();
  addLine(acc, prompt(T(12)), { year: 2026 });
  addLine(acc, { ...prompt(T(13), "x", "s2"), cwd: "/private/var/folders/5y/abc/T/app" }, { year: 2026 });
  addLine(acc, { ...prompt(T(14), "x", "s3"), cwd: "/tmp/scratch" }, { year: 2026 });
  assert.equal(summarize({ acc, cache: null, year: 2026 }).projects, 1);
});

test("names: models and MCP tools", () => {
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
  assert.equal(modelName("claude-fable-5"), "Fable 5");
  assert.equal(modelName("gpt-x"), "gpt-x");
  assert.equal(toolLabel("mcp__claude-in-chrome__computer"), "MCP · claude in chrome");
  assert.equal(toolLabel("mcp__claude_ai_Supabase__execute_sql"), "MCP · Supabase");
  assert.equal(toolLabel("Bash"), "Bash");
});

test("persona: night owl wins over the rest when it fits", () => {
  const base = { nightShare: 0.4, morningShare: 0, shares: { agents: 0, bash: 0.9, read: 0, edit: 0, web: 0 }, subagentMessages: 0, messages: 1, longest: { hours: 20 }, streak: { days: 1 } };
  assert.equal(persona(base).title, "The Night Owl");
  assert.equal(persona({ ...base, nightShare: 0 }).title, "The Marathoner");
});

test("the page never contains prompts, file paths or project names", () => {
  const acc = emptyAcc();
  addLine(acc, prompt(T(9), "please rotate the AWS key in secret-project"), { year: 2026 });
  addLine(acc, assistant("m", T(9), { tools: [["Edit", { file_path: "/home/me/secret-project/src/payroll.ts" }]] }), { year: 2026 });
  const html = renderHtml(summarize({ acc, cache: null, year: 2026 }), { font: "" });
  for (const leak of ["secret-project", "payroll", "AWS key", "/home/me"]) assert.ok(!html.includes(leak), `page leaks "${leak}"`);
  assert.match(html, /TypeScript/);
});

test("data embedded in the page cannot close the script tag", () => {
  const s = demoSummary(2026);
  s.persona = { title: "</script><b>x", why: "y" };
  const html = renderHtml(s, { font: "" });
  assert.equal(html.split("</script>").length, 3, "only the two real closing tags");
});

test("reads transcripts and subagents from a projects folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-"));
  const p = path.join(dir, "projects", "-home-me-app");
  fs.mkdirSync(path.join(p, "abc", "subagents"), { recursive: true });
  fs.writeFileSync(path.join(p, "abc.jsonl"), [prompt(T(9)), assistant("m1", T(9))].map(o => JSON.stringify(o)).join("\n") + "\nnot json\n");
  fs.writeFileSync(path.join(p, "abc", "subagents", "agent-1.jsonl"), JSON.stringify(assistant("m2", T(9), { tools: [["Read", {}]] })) + "\n");
  const acc = await readTranscripts(dir, { year: 2026 });
  assert.equal(acc.files, 2);
  assert.equal(acc.subagentMessages, 1);
  assert.equal(acc.tools.get("Read"), 1);
  fs.rmSync(dir, { recursive: true });
});

test("demo data renders and is marked as demo", () => {
  const html = renderHtml(demoSummary(2026), { demo: true, font: "" });
  assert.match(html, /"demo":true/);
});

test("Esc interrupts are counted apart and are not prompts", async () => {
  const { emptyAcc, addLine } = await import("../src/claude.mjs");
  const acc = emptyAcc();
  const at = "2026-03-03T10:00:00.000Z";
  addLine(acc, { type: "user", timestamp: at, sessionId: "s", message: { content: "fix the build" } }, { year: 2026 });
  addLine(acc, { type: "user", timestamp: at, sessionId: "s", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } }, { year: 2026 });
  addLine(acc, { type: "user", timestamp: at, sessionId: "s", message: { content: "[Request interrupted by user for tool use]" } }, { year: 2026 });
  addLine(acc, { type: "user", timestamp: at, sessionId: "s", isSidechain: true, message: { content: "[Request interrupted by user]" } }, { year: 2026 });
  assert.equal(acc.interrupts, 2);
  assert.equal([...acc.days.values()][0].prompts, 1);
});
