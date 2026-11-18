#!/usr/bin/env node
// agent-wrapped: your year with Claude Code and Codex, from the history already on your computer.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { claudeDir, readStatsCache, readTranscripts, emptyAcc } from "../src/claude.mjs";
import { codexDir, readCodex } from "../src/codex.mjs";
import { tally, finish, mergeTallies, readTally } from "../src/stats.mjs";
import { renderHtml } from "../src/html.mjs";
import { terminalSummary } from "../src/terminal.mjs";
import { demoSummary } from "../src/demo.mjs";

const HELP = `agent-wrapped: your year with Claude Code and Codex, made from the history on this computer.

Usage
  npx github:openyard-cloud/agent-wrapped [options]

Options
  --agent <name>  claude, codex or all (default: all it finds)
  --year <yyyy>   Year to wrap (default: this year)
  --out <file>    Where to write the page (default: ./agent-wrapped-<year>.html)
  --no-open       Write the page but do not open it
  --json          Print the numbers as JSON instead of the summary
  --export <file> Save this computer's totals to a file, to add on another computer
  --add <file>    Add totals saved with --export on another computer (repeatable)
  --demo          Use made-up data, marked DEMO DATA, to see what it looks like
  -h, --help      Show this help

It reads Claude Code from ~/.claude (or CLAUDE_CONFIG_DIR) and Codex from ~/.codex (or CODEX_HOME).
Nothing is uploaded. The page is one local file with no network requests.
It shows totals only: no prompts, no file names, no project names.

Used more than one computer this year? On each other one run
  npx github:openyard-cloud/agent-wrapped --export wrapped-laptop.json
then copy the file over and run
  npx github:openyard-cloud/agent-wrapped --add wrapped-laptop.json`;

function parse(argv) {
  const o = { open: true, agent: "all", add: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--year") o.year = Number(argv[++i]);
    else if (a === "--agent") o.agent = String(argv[++i] || "").toLowerCase();
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--no-open") o.open = false;
    else if (a === "--json") o.json = true;
    else if (a === "--export") o.export = argv[++i];
    else if (a === "--add") o.add.push(argv[++i]);
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
  if (!["all", "claude", "codex"].includes(o.agent)) { console.error("agent-wrapped: --agent takes claude, codex or all"); return 2; }
  const year = o.year || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2024 || year > 2100) { console.error("agent-wrapped: --year needs a four-digit year, for example --year 2026"); return 2; }

  if (o.export === undefined && process.argv.includes("--export")) { console.error("agent-wrapped: --export needs a file name, for example --export wrapped-laptop.json"); return 2; }
  if (o.add.some(f => !f)) { console.error("agent-wrapped: --add needs a file made with --export"); return 2; }

  let summary;
  if (o.demo) summary = demoSummary(year);
  else {
    const added = [];
    for (const f of o.add) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { console.error(`agent-wrapped: can't read ${f}`); return 1; }
      try { added.push(readTally(text, f)); } catch (e) { console.error(`agent-wrapped: ${e.message}`); return 1; }
      if (added.at(-1).year !== year) { console.error(`agent-wrapped: ${f} is for ${added.at(-1).year}, not ${year}. Add --year ${added.at(-1).year} or export it again with --year ${year}`); return 1; }
    }
    const cdir = claudeDir(), xdir = codexDir();
    const useClaude = o.agent !== "codex" && fs.existsSync(cdir);
    const useCodex = o.agent !== "claude" && fs.existsSync(xdir);
    if (!useClaude && !useCodex && !added.length) {
      console.error(`agent-wrapped: no history found. Looked for Claude Code at ${cdir} and Codex at ${xdir}.\nIf yours lives elsewhere, set CLAUDE_CONFIG_DIR or CODEX_HOME. To see the page anyway, run it again with --demo`);
      return 1;
    }
    const progress = process.stderr.isTTY && !o.json;
    const show = name => (progress ? (d, t) => process.stderr.write(`\r\x1b[2K  reading your ${name} sessions ${d}/${t}`) : undefined);
    const acc = useClaude ? await readTranscripts(cdir, { year, onProgress: show("Claude Code") }) : emptyAcc();
    const extra = useCodex ? [{ agent: "Codex", acc: await readCodex(xdir, { year, onProgress: show("Codex") }) }] : [];
    if (progress) process.stderr.write("\r\x1b[2K");
    const here = tally({ acc, cache: useClaude ? readStatsCache(cdir) : null, year, extra });
    if (o.export) {
      fs.writeFileSync(o.export, JSON.stringify(here));
      const n = Object.values(here.days).filter(d => d.messages + d.tokens + d.toolCalls > 0).length;
      console.log(`Saved this computer's totals for ${year} (${n} active days) to ${path.resolve(o.export)}.\nIt holds counts only: no prompts, no file names, no project names.\nCopy it to your main computer and run: npx github:openyard-cloud/agent-wrapped --add ${path.basename(o.export)}`);
      return 0;
    }
    summary = finish(added.length ? mergeTallies([here, ...added]) : here);
    if (summary.activeDays === 0) { console.error(`agent-wrapped: no activity found for ${year}.\nTry another --year, or run it again with --demo to see the page.`); return 1; }
  }

  if (o.json) { console.log(JSON.stringify(summary, null, 2)); return 0; }
  const file = path.resolve(o.out || `agent-wrapped-${year}${o.demo ? "-demo" : ""}.html`);
  fs.writeFileSync(file, renderHtml(summary, { demo: !!o.demo }));
  console.log(terminalSummary(summary, { file }));
  if (o.open && process.stdout.isTTY) openFile(file);
  return 0;
}

main().then(code => { process.exitCode = code; }, err => { console.error(`agent-wrapped: ${err.message}`); process.exitCode = 1; });
