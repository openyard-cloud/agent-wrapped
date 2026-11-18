// Two computers: totals saved with --export on one are added with --add on the other.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeTallies, readTally, TALLY_FORMAT } from "../src/stats.mjs";

const BIN = fileURLToPath(new URL("../bin/agent-wrapped.mjs", import.meta.url));

// A Claude Code config dir with one session per given day, in a project folder whose name must never leak.
function claudeHome(days, { project = "/home/me/secret-startup", model = "claude-opus-5-5" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-merge-"));
  const p = path.join(dir, "projects", "-home-me-secret-startup");
  fs.mkdirSync(p, { recursive: true });
  days.forEach((d, i) => {
    const sid = `s-${path.basename(dir)}-${i}`;
    const lines = [
      { type: "user", timestamp: `${d}T10:00:00.000Z`, sessionId: sid, cwd: project, message: { content: "migrate the billing tables" } },
      { type: "assistant", timestamp: `${d}T10:01:00.000Z`, sessionId: sid, cwd: project, message: { id: `m-${sid}`, model, usage: { input_tokens: 100, output_tokens: 900 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } },
    ];
    fs.writeFileSync(path.join(p, `${sid}.jsonl`), lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  });
  return dir;
}
const run = (args, env) => spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, CODEX_HOME: "/nonexistent-codex", ...env }, encoding: "utf8" });

test("--export on one computer and --add on another add up the year", () => {
  const laptop = claudeHome(["2026-03-02", "2026-03-03"], { model: "claude-sonnet-5" });
  const desk = claudeHome(["2026-03-03", "2026-10-20"]);
  const file = path.join(laptop, "wrapped-laptop.json");

  const ex = run(["--year", "2026", "--export", file], { CLAUDE_CONFIG_DIR: laptop });
  assert.equal(ex.status, 0, ex.stderr);
  assert.match(ex.stdout, /2 active days/);
  const saved = fs.readFileSync(file, "utf8");
  assert.equal(JSON.parse(saved).format, TALLY_FORMAT);
  for (const leak of ["secret-startup", "billing", "/home/me"]) assert.ok(!saved.includes(leak), `export leaks "${leak}"`);

  const r = run(["--year", "2026", "--json", "--add", file], { CLAUDE_CONFIG_DIR: desk });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.activeDays, 3);              // Mar 2, Mar 3 (both computers), Oct 20
  assert.equal(s.sessions, 4);
  assert.equal(s.heatmap["2026-03-03"], 4);   // two messages from each computer
  assert.equal(s.tokens, 4 * 1000);
  assert.equal(s.projects, 1);                // the same folder on both computers counts once
  assert.equal(s.streak.days, 2);
  assert.deepEqual(s.models.map(m => m.name).sort(), ["Opus 5.5", "Sonnet 5"]);
  fs.rmSync(laptop, { recursive: true }); fs.rmSync(desk, { recursive: true });
});

test("--add works on a computer with no history of its own", () => {
  const laptop = claudeHome(["2026-05-05"]);
  const file = path.join(laptop, "t.json");
  assert.equal(run(["--year", "2026", "--export", file], { CLAUDE_CONFIG_DIR: laptop }).status, 0);
  const r = run(["--year", "2026", "--json", "--add", file], { CLAUDE_CONFIG_DIR: "/nonexistent-claude" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).activeDays, 1);
  fs.rmSync(laptop, { recursive: true });
});

test("--add refuses files that are not tallies, or are for another year", () => {
  const dir = claudeHome(["2026-05-05"]);
  const junk = path.join(dir, "junk.json"), other = path.join(dir, "2025.json");
  fs.writeFileSync(junk, JSON.stringify({ hello: 1 }));
  const bad = run(["--year", "2026", "--json", "--add", junk], { CLAUDE_CONFIG_DIR: dir });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not an agent-wrapped tally/);
  fs.writeFileSync(other, JSON.stringify({ format: TALLY_FORMAT, year: 2025, days: {}, models: {}, tools: {}, exts: {}, hours: Array(24).fill(0), weekdays: Array(7).fill(0) }));
  const wrongYear = run(["--year", "2026", "--json", "--add", other], { CLAUDE_CONFIG_DIR: dir });
  assert.equal(wrongYear.status, 1);
  assert.match(wrongYear.stderr, /is for 2025, not 2026/);
  assert.throws(() => readTally("not json"), /not JSON/);
  fs.rmSync(dir, { recursive: true });
});

test("merging keeps the earliest first use of a model and the longest session", () => {
  const base = { format: TALLY_FORMAT, year: 2026, agents: ["Claude Code"], days: {}, transcriptDates: [], cacheUntil: null, hours: Array(24).fill(0), weekdays: Array(7).fill(0), tools: {}, exts: {}, projects: [], cacheLongest: null };
  const a = { ...base, models: { "claude-opus-5": { first: "2026-06-01", tokens: 10 } }, longest: { activeMs: 1000, messages: 5, first: 0 } };
  const b = { ...base, agents: ["Codex"], models: { "claude-opus-5": { first: "2026-02-01", tokens: 5 } }, longest: { activeMs: 9000, messages: 9, first: 0 } };
  const m = mergeTallies([a, b]);
  assert.deepEqual(m.models["claude-opus-5"], { first: "2026-02-01", tokens: 15 });
  assert.equal(m.longest.activeMs, 9000);
  assert.deepEqual(m.agents, ["Claude Code", "Codex"]);
  assert.equal(a.models["claude-opus-5"].tokens, 10); // inputs are not changed
});

test("prompt history fills the days the cache and transcripts lost, and nothing else", () => {
  const dir = claudeHome(["2026-10-20"]);
  const at = (d, hm) => Date.parse(`${d}T${hm}:00`);
  const hist = [
    { display: "rotate the stripe key", timestamp: at("2026-09-03", "09:00"), project: "/home/me/secret-startup" },
    { display: "now the tests", timestamp: at("2026-09-03", "09:10"), project: "/home/me/secret-startup" },
    { display: "after lunch", timestamp: at("2026-09-03", "14:00"), project: "/home/me/secret-startup" },
    { display: "same day as a transcript", timestamp: at("2026-10-20", "11:00"), project: "/home/me/secret-startup" },
    { display: "last year", timestamp: at("2025-12-30", "11:00"), project: "/home/me/x" },
  ];
  fs.writeFileSync(path.join(dir, "history.jsonl"), hist.map(h => JSON.stringify(h)).join("\n") + "\n");
  const r = run(["--year", "2026", "--json"], { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.activeDays, 2);
  assert.equal(s.historyDays, 1);
  assert.equal(s.tokenDays, 1);
  assert.equal(s.prompts, 3 + 1);              // history prompts count toward the year...
  assert.equal(s.transcriptPrompts, 1);        // ...but not toward the Esc rate, which only transcripts know               // the history day has no tokens, so the total is a floor
  assert.equal(s.heatmap["2026-09-03"], 3);   // three prompts
  assert.equal(s.heatmap["2026-10-20"], 2);   // the transcript's count, not the history's
  assert.equal(s.sessions, 1 + 2);             // a 30-minute gap starts a new session
  assert.equal(s.projects, 1);
  const out = path.join(dir, "page.html");
  assert.equal(run(["--year", "2026", "--out", out, "--no-open"], { CLAUDE_CONFIG_DIR: dir }).status, 0);
  const html = fs.readFileSync(out, "utf8");
  for (const leak of ["stripe", "secret-startup", "after lunch"]) assert.ok(!html.includes(leak), `page leaks "${leak}"`);
  assert.match(html, /"tokenDays":1/);
  fs.rmSync(dir, { recursive: true });
});
