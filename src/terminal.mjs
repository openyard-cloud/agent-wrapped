// The short version, printed in the terminal before the page opens.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c(1, s), dim = s => c(2, s), lime = s => c("38;5;154", s);

const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : Math.round(n).toLocaleString("en-US");

/** One line of blocks per month: how many active days each month had. */
function monthStrip(heatmap, year) {
  const blocks = " ▁▂▃▄▅▆▇█";
  const counts = Array(12).fill(0);
  for (const [d, v] of Object.entries(heatmap)) if (v > 0 && d.startsWith(String(year))) counts[+d.slice(5, 7) - 1]++;
  return counts.map(n => blocks[Math.min(8, Math.ceil(n / 31 * 8))]).join("");
}

export function terminalSummary(s, { file } = {}) {
  const rows = [
    ["Active days", `${s.activeDays}  ${dim("longest streak " + s.streak.days + "d")}`],
    ["Sessions", s.sessions.toLocaleString("en-US")],
    ["Tokens", `${fmt(s.tokens)}  ${dim("+ " + fmt(s.contextTokens) + " re-read from cache")}`],
    ["Favourite model", s.favourite ? s.favourite.name : "–"],
    ["Top tool", s.tools[0] ? s.tools[0].name : "–"],
    ["Jan … Dec", lime(monthStrip(s.heatmap, s.year))],
  ];
  const out = ["", `  ${lime(bold(`Your ${s.year} with Claude Code`))}`, `  ${bold(s.persona.title)} ${dim("· " + s.persona.why)}`, ""];
  for (const [k, v] of rows) out.push(`  ${dim(k.padEnd(16))}${v}`);
  out.push("", `  ${dim(`Based on ${s.activeDays} active days of local history, ${s.coverage.from || "–"} to ${s.coverage.to || "–"}.`)}`);
  if (file) out.push(`  ${dim("Your story and card:")} ${file}`);
  out.push("");
  return out.join("\n");
}
