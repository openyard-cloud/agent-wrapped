// The share card as live HTML for the landing page, built from the same demo summary as the PNG,
// so it can play: the year fills in week by week while the numbers count up with it.
// Without JS, or with reduced motion, it is simply the finished card.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = n => Math.round(n).toLocaleString("en-US");
export function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e4) return Math.round(n / 1e3) + "K";
  return Math.round(n).toLocaleString("en-US");
}
const dayLabel = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Cells for every day of the year, Sunday-first weeks, same levels as the story and the PNG. */
function cells(year, heatmap) {
  const out = [], start = new Date(year, 0, 1);
  const max = Math.max(1, ...Object.values(heatmap));
  for (let i = 0; i < start.getDay(); i++) out.push({ lv: -1, v: 0 });
  for (const d = new Date(start); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const key = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const v = heatmap[key] || 0;
    out.push({ lv: v === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(v / max) * 3.999)), v });
  }
  return out;
}

export function cardHtml(s) {
  const all = cells(s.year, s.heatmap);
  const weeks = Math.ceil(all.length / 7);
  // Running totals per week, so the counters can follow the sweep exactly.
  const days = [], load = [], streaks = [];
  let d = 0, m = 0, run = 0, best = 0;
  for (let w = 0; w < weeks; w++) {
    for (const c of all.slice(w * 7, w * 7 + 7)) {
      if (c.lv < 0) continue;
      if (c.lv > 0) { d++; run++; best = Math.max(best, run); } else run = 0;
      m += c.v;
    }
    days.push(d); load.push(m); streaks.push(best);
  }
  const share = load.map(x => +(x / (m || 1)).toFixed(4));
  const heat = all.map((c, i) => (c.lv < 0 ? `<i class="x"></i>` : `<i class="l${c.lv}" style="--w:${Math.floor(i / 7)}"></i>`)).join("");
  const jan1 = new Date(s.year, 0, 1);
  const months = MONTHS.map((name, i) => {
    const col = Math.floor((jan1.getDay() + Math.round((new Date(s.year, i, 1) - jan1) / 864e5)) / 7);
    return `<span style="--w:${col}">${name}</span>`;
  }).join("");
  const fav = s.favourite ? s.favourite.name : "–";
  const title = s.persona.title.split(" ").map((w, i) => `<span class="wd"><span style="--i:${i}">${esc(w)}</span></span>`).join(" ");
  const cov = s.coverage || {};
  const label = `A share card: My ${s.year} with ${s.agentsLabel}, ${s.persona.title}, a heatmap of the whole year, ${s.activeDays} active days, ${fmt(s.tokens)} tokens, a ${s.streak.days}-day streak, favourite model ${fav}. Demo data.`;
  return `<figure class="wcard" role="img" aria-label="${esc(label)}" style="--weeks:${weeks}" data-days="${days.join(",")}" data-share="${share.join(",")}" data-streaks="${streaks.join(",")}">
  <div aria-hidden="true" class="wc-in">
    <span class="wc-demo">Demo data</span>
    <div class="wc-top">
      <div>
        <p class="wc-kicker">My ${s.year} with ${esc(s.agentsLabel)}</p>
        <p class="wc-title">${title}</p>
        <p class="wc-why">${esc(s.persona.why)}</p>
      </div>
      <span class="wc-year">${s.year}</span>
    </div>
    <div class="wc-heat">${heat}</div>
    <div class="wc-months">${months}</div>
    <div class="wc-stats">
      <div><b data-count="days" data-to="${s.activeDays}">${plain(s.activeDays)}</b><span>active days</span></div>
      <div><b data-count="tokens" data-to="${s.tokens}">${fmt(s.tokens)}${s.tokenDays > 0 && s.tokenDays < s.activeDays ? "+" : ""}</b><span>tokens</span></div>
      <div><b data-count="streak" data-to="${s.streak.days}">${s.streak.days} days</b><span>longest streak</span></div>
      <div><b class="wc-fav"><span>${esc(fav)}</span></b><span>favourite model</span></div>
    </div>
    <div class="wc-rule"></div>
    <div class="wc-foot"><b>wrapped.openyard.cloud</b><span>${plain(s.sessions)} sessions · local history ${dayLabel(cov.from)} – ${dayLabel(cov.to)}</span></div>
  </div>
</figure>`;
}
