// Codex rollouts built to the format in the Codex source (codex-rs/protocol, codex-rs/rollout):
// { timestamp, type, payload } per line, under sessions/YYYY/MM/DD and archived_sessions, .jsonl or .jsonl.zst.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyAcc, addLine } from "../src/claude.mjs";
import { readCodex, addCodexLine, codexToolName, CAN_READ_ZSTD } from "../src/codex.mjs";
import { summarize } from "../src/stats.mjs";
import { renderHtml } from "../src/html.mjs";

const BIN = fileURLToPath(new URL("../bin/agent-wrapped.mjs", import.meta.url));
const at = (h, m = 0, d = "2026-06-02") => new Date(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString();
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 10, total_tokens: input + output });

function rollout({ id = "s1", source = "cli", model = "gpt-5.6-sol", day = "2026-06-02", cwd = "/home/me/secret-api" } = {}) {
  return [
    line(at(9, 0, day), "session_meta", { id, timestamp: at(9, 0, day), cwd, originator: "codex_cli_rs", cli_version: "0.99.0", source }),
    line(at(9, 0, day), "turn_context", { cwd, model, effort: "medium" }),
    line(at(9, 1, day), "event_msg", { type: "user_message", message: "rotate the stripe key in billing.ts" }),
    line(at(9, 2, day), "response_item", { type: "function_call", name: "shell", arguments: "{\"command\":[\"ls\"]}", call_id: "c1" }),
    line(at(9, 3, day), "response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch\n*** Update File: src/billing.ts\n@@\n-a\n+b\n*** Add File: docs/notes.md\n+x\n*** End Patch" }),
    line(at(9, 4, day), "event_msg", { type: "token_count", info: { total_token_usage: usage(1000, 800, 200), last_token_usage: usage(1000, 800, 200) } }),
    line(at(9, 20, day), "event_msg", { type: "user_message", message: "now run the tests" }),
    line(at(9, 21, day), "event_msg", { type: "token_count", info: { total_token_usage: usage(3000, 2000, 500), last_token_usage: usage(2000, 1200, 300) } }),
  ].join("\n") + "\n";
}

function home(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-codex-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

test("tokens use the /stats definition: input minus cache reads, plus output", async () => {
  const dir = home({ "sessions/2026/06/02/rollout-2026-06-02T09-00-00-s1.jsonl": rollout() });
  const acc = await readCodex(dir, { year: 2026 });
  const d = [...acc.days.values()][0];
  assert.equal(d.tokens, (1000 - 800 + 200) + (2000 - 1200 + 300));
  assert.equal(acc.cacheReadTokens, 800 + 1200);
  assert.equal(d.prompts, 2);
  assert.equal(acc.models.get("gpt-5.6-sol").tokens, 1500);
  assert.equal(acc.sessions.get("s1").activeMs, 20 * 60 * 1000);
  fs.rmSync(dir, { recursive: true });
});

test("tool calls are named like Claude Code's, and apply_patch gives the edited languages", async () => {
  const dir = home({ "sessions/2026/06/02/r.jsonl": rollout() });
  const acc = await readCodex(dir, { year: 2026 });
  assert.equal(acc.tools.get("Shell"), 1);
  assert.equal(acc.tools.get("apply_patch"), 1);
  assert.equal(acc.exts.get(".ts"), 1);
  assert.equal(acc.exts.get(".md"), 1);
  assert.equal(codexToolName("local_shell_call"), "Shell");
  assert.equal(codexToolName("web_search_call"), "Web search");
  fs.rmSync(dir, { recursive: true });
});

test("only a running total: the turn's tokens are the difference", () => {
  const acc = emptyAcc(), state = { id: "s", model: "gpt-5", sub: false };
  addCodexLine(acc, JSON.parse(line(at(10), "event_msg", { type: "token_count", info: { total_token_usage: usage(100, 0, 50) } })), state, { year: 2026 });
  addCodexLine(acc, JSON.parse(line(at(11), "event_msg", { type: "token_count", info: { total_token_usage: usage(300, 0, 90) } })), state, { year: 2026 });
  assert.equal([...acc.days.values()][0].tokens, 150 + (200 + 40));
});

test("a forked session's copied history counts once", async () => {
  const dir = home({
    "sessions/2026/06/02/a.jsonl": rollout({ id: "s1" }),
    "sessions/2026/06/03/b.jsonl": rollout({ id: "s2" }),
  });
  const acc = await readCodex(dir, { year: 2026 });
  const d = [...acc.days.values()][0];
  assert.equal(d.prompts, 2);
  assert.equal(d.tokens, 1500);
  fs.rmSync(dir, { recursive: true });
});

test("subagent sessions count tokens but not sessions or prompts", async () => {
  const dir = home({ "sessions/2026/06/02/sub.jsonl": rollout({ id: "sub1", source: { subagent: { other: "review" } } }) });
  const acc = await readCodex(dir, { year: 2026 });
  assert.equal(acc.sessions.size, 0);
  assert.equal(acc.subagentMessages, 2);
  assert.equal([...acc.days.values()][0].prompts, 0);
  fs.rmSync(dir, { recursive: true });
});

test("archived sessions are read, including zstd-compressed ones when Node can", async () => {
  const files = { "archived_sessions/rollout-2026-06-02T09-00-00-old.jsonl": rollout({ id: "old", day: "2026-03-04" }) };
  if (CAN_READ_ZSTD) files["sessions/2026/05/01/rollout-cold.jsonl.zst"] = zlib.zstdCompressSync(Buffer.from(rollout({ id: "cold", day: "2026-05-01" })));
  const dir = home(files);
  const acc = await readCodex(dir, { year: 2026 });
  assert.ok(acc.days.has("2026-03-04"));
  if (CAN_READ_ZSTD) assert.ok(acc.days.has("2026-05-01"));
  assert.equal(acc.skippedCompressed, 0);
  fs.rmSync(dir, { recursive: true });
});

test("Claude Code and Codex together: days add up, the title names both, the card stays private", async () => {
  const claude = emptyAcc();
  addLine(claude, { type: "user", timestamp: at(8, 0, "2026-06-02"), sessionId: "c1", cwd: "/home/me/x", message: { content: "hi" } }, { year: 2026 });
  addLine(claude, { type: "assistant", timestamp: at(8, 1, "2026-06-02"), sessionId: "c1", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 90 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } }, { year: 2026 });
  const dir = home({ "sessions/2026/06/02/r.jsonl": rollout() });
  const codex = await readCodex(dir, { year: 2026 });
  const s = summarize({ acc: claude, cache: null, year: 2026, extra: [{ agent: "Codex", acc: codex }] });
  assert.deepEqual(s.agents, ["Claude Code", "Codex"]);
  assert.equal(s.agentsLabel, "Claude Code and Codex");
  assert.equal(s.tokens, 100 + 1500);
  assert.equal(s.activeDays, 1);
  assert.deepEqual(s.models.map(m => m.name).sort(), ["GPT-5.6 Sol", "Opus 5.5"]);
  const html = renderHtml(s, { font: "" });
  assert.match(html, /with Claude Code and Codex/);
  for (const leak of ["secret-api", "billing", "stripe key", "/home/me"]) assert.ok(!html.includes(leak), `page leaks "${leak}"`);
  fs.rmSync(dir, { recursive: true });
});

test("the CLI wraps Codex alone when there is no Claude Code history", () => {
  const codexHome = home({ "sessions/2026/06/02/r.jsonl": rollout() });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "aw-none-"));
  const r = spawnSync(process.execPath, [BIN, "--year", "2026", "--json"], { env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(empty, "missing"), CODEX_HOME: codexHome }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.deepEqual(s.agents, ["Codex"]);
  assert.equal(s.agentsLabel, "Codex");
  assert.equal(s.favourite.name, "GPT-5.6 Sol");
  const none = spawnSync(process.execPath, [BIN, "--json"], { env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(empty, "a"), CODEX_HOME: path.join(empty, "b") }, encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no history found/);
  fs.rmSync(codexHome, { recursive: true }); fs.rmSync(empty, { recursive: true });
});
