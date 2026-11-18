#!/usr/bin/env node
// agent-wrapped: your year with Claude Code, from the history already on your computer.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { claudeDir, readStatsCache, readTranscripts } from "../src/claude.mjs";
import { summarize } from "../src/stats.mjs";
import { renderHtml } from "../src/html.mjs";
import { terminalSummary } from "../src/terminal.mjs";
import { demoSummary } from "../src/demo.mjs";

const HELP = `agent-wrapped: your year with Claude Code, made from the history on this computer.

Usage
  npx github:openyard-cloud/agent-wrapped [options]

Options
  --year <yyyy>   Year to wrap (default: this year)
  --out <file>    Where to write the page (default: ./agent-wrapped-<year>.html)
  --no-open       Write the page but do not open it
  --json          Print the numbers as JSON instead of the summary
  --demo          Use made-up data, marked DEMO DATA, to see what it looks like
  -h, --help      Show this help

Nothing is uploaded. The page is one local file with no network requests.
It shows totals only: no prompts, no file names, no project names.`;

function parse(argv) {
  const o = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--year") o.year = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--no-open") o.open = false;
    else if (a === "--json") o.json = true;
    else if (a === "--demo") o.demo = true;
    else { o.bad = a; break; }
  }
  return o;
}

function openFile(file) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* the path is printed anyway */ }
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  if (o.bad) { console.error(`agent-wrapped: unknown option ${o.bad}\nRun agent-wrapped --help to see the options.`); return 2; }
  const year = o.year || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2024 || year > 2100) { console.error("agent-wrapped: --year needs a four-digit year, for example --year 2026"); return 2; }

  let summary;
  if (o.demo) summary = demoSummary(year);
  else {
    const dir = claudeDir();
    if (!fs.existsSync(dir)) { console.error(`agent-wrapped: no Claude Code history found at ${dir}\nIf it lives elsewhere, set CLAUDE_CONFIG_DIR. To see the page anyway, run it again with --demo`); return 1; }
    const progress = process.stderr.isTTY && !o.json;
    const acc = await readTranscripts(dir, { year, onProgress: progress ? (d, t) => process.stderr.write(`\r  reading your sessions ${d}/${t}`) : undefined });
    if (progress) process.stderr.write("\r\x1b[2K");
    summary = summarize({ acc, cache: readStatsCache(dir), year });
    if (summary.activeDays === 0) { console.error(`agent-wrapped: no Claude Code activity found for ${year} in ${dir}\nTry another --year, or run it again with --demo to see the page.`); return 1; }
  }

  if (o.json) { console.log(JSON.stringify(summary, null, 2)); return 0; }
  const file = path.resolve(o.out || `agent-wrapped-${year}${o.demo ? "-demo" : ""}.html`);
  fs.writeFileSync(file, renderHtml(summary, { demo: !!o.demo }));
  console.log(terminalSummary(summary, { file }));
  if (o.open && process.stdout.isTTY) openFile(file);
  return 0;
}

main().then(code => { process.exitCode = code; }, err => { console.error(`agent-wrapped: ${err.message}`); process.exitCode = 1; });
