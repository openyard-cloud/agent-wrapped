// Build the self-contained Wrapped page: story slides, then a share card drawn on <canvas> and saved as PNG.
// One HTML file, no network: the font is embedded, the data is embedded, nothing is fetched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function fontBase64() {
  return fs.readFileSync(path.join(HERE, "..", "fonts", "bricolage-latin.woff2")).toString("base64");
}

// Safe inside <script>: no "</script>", no HTML comment openers, no U+2028/2029.
const LS = new RegExp(String.fromCharCode(0x2028), "g"), PS = new RegExp(String.fromCharCode(0x2029), "g");
const jsonForScript = o => JSON.stringify(o).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");

export function renderHtml(summary, { demo = false, font = fontBase64() } = {}) {
  const data = { ...summary, demo };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your ${summary.year} with Claude Code · agent-wrapped</title>
<style>
@font-face { font-family: "Bricolage"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 800; font-display: block; }
:root {
  --ink: #101418; --paper: #f3f1ea; --lime: #c6f432; --tomato: #ff5a36; --sky: #8ec5ff; --teal: #0e3b3a; --sand: #e9dcc3;
  --display: "Bricolage", "Avenir Next", "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--ink); color: var(--paper); font-family: var(--display); }
.stage { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; }
.story { position: relative; width: min(100%, 520px); height: min(100%, 900px); border-radius: 22px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.45); }
.bars { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 5px; z-index: 5; }
.bars i { flex: 1; height: 3px; border-radius: 2px; background: currentColor; opacity: .25; }
.bars i.on { opacity: .9; }
.slide { position: absolute; inset: 0; padding: 56px 30px 96px; display: none; flex-direction: column; justify-content: center; gap: 18px; background: var(--bg); color: var(--fg); }
.slide > .kicker { position: absolute; top: 46px; left: 30px; right: 30px; }
.slide.on { display: flex; animation: rise .45s cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .slide.on { animation: none; } }
.still .slide.on { animation: none; }
/* Embedded in another page (the website's phone frame): fill the frame, no chrome of our own. */
.embedded .stage { padding: 0; }
.embedded .story { width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
.embedded .hint { display: none; }
.kicker { font-family: var(--mono); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
h1, h2 { margin: 0; font-weight: 800; letter-spacing: -.03em; line-height: .95; }
h1 { font-size: clamp(54px, 15vw, 84px); }
h2 { font-size: clamp(34px, 9vw, 46px); }
.big { font-size: clamp(64px, 19vw, 112px); font-weight: 800; letter-spacing: -.045em; line-height: .9; font-variant-numeric: tabular-nums; }
.lead { font-size: 19px; line-height: 1.35; font-weight: 500; max-width: 30ch; }
.note { position: absolute; left: 30px; right: 30px; bottom: 26px; font-family: var(--mono); font-size: 11.5px; line-height: 1.5; opacity: .7; }
.rows { display: grid; gap: 10px; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: baseline; font-size: 18px; font-weight: 600; border-bottom: 2px solid color-mix(in srgb, currentColor 18%, transparent); padding-bottom: 8px; }
.row b { font-variant-numeric: tabular-nums; font-weight: 800; }
.bar { height: 10px; border-radius: 5px; background: currentColor; opacity: .85; margin-top: 4px; }
.chips { display: grid; gap: 8px; }
.chip { display: grid; grid-template-columns: 92px 1fr auto; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.chip span:first-child { font-family: var(--mono); font-size: 12px; font-weight: 500; opacity: .75; }
.chip .fav { font-family: var(--mono); font-size: 11px; font-weight: 600; border: 1.5px solid currentColor; border-radius: 99px; padding: 1px 8px; }
.heat { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); gap: 2px; width: 100%; aspect-ratio: 53 / 7.4; }
.heat i { border-radius: 2px; background: currentColor; }
.clock { display: grid; grid-template-columns: repeat(24, 1fr); align-items: end; gap: 3px; height: 150px; }
.clock i { background: currentColor; border-radius: 3px 3px 0 0; opacity: .35; min-height: 2px; }
.clock i.peak { opacity: 1; }
.clock-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; opacity: .7; }
.cardwrap { width: 100%; border-radius: 10px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
canvas { display: block; width: 100%; height: auto; }
.btns { display: flex; flex-wrap: wrap; gap: 10px; }
button { font: 700 16px var(--display); border: 0; border-radius: 99px; padding: 12px 18px; cursor: pointer; background: var(--fg); color: var(--bg); }
button.ghost { background: transparent; color: var(--fg); box-shadow: inset 0 0 0 2px currentColor; }
button:focus-visible { outline: 3px solid var(--fg); outline-offset: 3px; }
.tap { position: absolute; top: 0; bottom: 0; width: 35%; z-index: 4; }
.tap.prev { left: 0; } .tap.next { right: 0; }
.last .tap { display: none; }
.hint { position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 11px; color: #7d8590; }
.demo { position: absolute; top: 24px; right: 14px; z-index: 6; font: 700 11px var(--mono); background: var(--tomato); color: var(--ink); padding: 3px 8px; border-radius: 4px; letter-spacing: .08em; }
</style>
</head>
<body>
<div class="stage"><div class="story" id="story"><div class="bars" id="bars"></div></div></div>
<div class="hint">tap or use ← → · everything stays on this computer</div>
<script id="data" type="application/json">${jsonForScript(data)}</script>
<script>
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("data").textContent);
  try { if (window.self !== window.top) document.documentElement.classList.add("embedded"); } catch (e) { document.documentElement.classList.add("embedded"); }
  var story = document.getElementById("story"), bars = document.getElementById("bars");

  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (n >= 1e4) return Math.round(n / 1e3) + "K";
    return Math.round(n).toLocaleString("en-US");
  }
  function plain(n) { return Math.round(n).toLocaleString("en-US"); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k === "style") e.setAttribute("style", attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function dayLabel(d) { return d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; }
  function hourLabel(h) { return h === 0 ? "midnight" : h === 12 ? "noon" : (h % 12) + (h < 12 ? " am" : " pm"); }
  var cov = D.coverage || {};
  var coverNote = "Based on " + D.activeDays + " active days in your local history, " + dayLabel(cov.from) + " to " + dayLabel(cov.to) + ".";

  // Heatmap cells for every day of the year, Sunday-first weeks like GitHub.
  function heatCells(year) {
    var start = new Date(year, 0, 1), cells = [], max = 0;
    for (var k in D.heatmap) max = Math.max(max, D.heatmap[k]);
    for (var i = 0; i < start.getDay(); i++) cells.push(-1);
    for (var d = new Date(start); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      var v = D.heatmap[key] || 0;
      cells.push(v === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(v / (max || 1)) * 3.999)));
    }
    return cells;
  }
  var CELL_OPACITY = [0.1, 0.35, 0.55, 0.78, 1];
  function heatEl() {
    var h = el("div", { class: "heat", "aria-label": "Activity by day across " + D.year });
    heatCells(D.year).forEach(function (lv) { h.appendChild(el("i", { style: lv < 0 ? "opacity:0" : "opacity:" + CELL_OPACITY[lv] })); });
    return h;
  }

  var tokensWar = D.tokens / 780000;
  var fav = D.favourite;
  var slides = [
    { bg: "var(--ink)", fg: "var(--lime)", build: function () { return [
      el("div", { class: "kicker", text: "agent-wrapped · " + D.year }),
      el("h1", { text: "Your " + D.year + " with Claude Code" }),
      el("p", { class: "lead", text: "A year of prompts, tool calls and late nights, counted on your own machine." }),
      el("p", { class: "note", text: coverNote }) ]; } },
    { bg: "var(--lime)", fg: "var(--ink)", build: function () { return [
      el("div", { class: "kicker", text: "You showed up" }),
      el("div", { class: "big", text: plain(D.activeDays) }),
      el("p", { class: "lead", text: "days with your agent. " + (D.streak.days > 1 ? "Your longest run was " + D.streak.days + " days in a row." : "") }),
      el("div", { class: "rows" }, [
        el("div", { class: "row" }, ["Sessions", el("b", { text: plain(D.sessions) })]),
        el("div", { class: "row" }, ["Messages", el("b", { text: plain(D.messages) })]),
        el("div", { class: "row" }, ["Tool calls", el("b", { text: plain(D.toolCalls) })]),
        D.busiest ? el("div", { class: "row" }, ["Busiest day", el("b", { text: dayLabel(D.busiest.date) })]) : null ]) ]; } },
    { bg: "var(--teal)", fg: "var(--lime)", build: function () { return [
      el("div", { class: "kicker", text: "Your year, day by day" }),
      el("h2", { text: D.activeDays + " days lit up" }),
      heatEl(),
      el("p", { class: "lead", style: "color:var(--paper)", text: D.busiest ? "The brightest square is " + dayLabel(D.busiest.date) + ": " + plain(D.busiest.messages) + " messages." : "" }),
      el("p", { class: "note", style: "color:var(--paper)", text: "Claude Code deletes transcripts after 30 days unless you change cleanupPeriodDays, so earlier months may look quieter than they were." }) ]; } },
    { bg: "var(--tomato)", fg: "var(--ink)", build: function () { return [
      el("div", { class: "kicker", text: "Words, in and out" }),
      el("div", { class: "big", text: fmt(D.tokens) }),
      el("p", { class: "lead", text: "tokens written and read by your agent. That is roughly " + (tokensWar >= 2 ? Math.round(tokensWar) + " copies" : "one copy") + " of War and Peace." }),
      D.contextTokens ? el("p", { class: "lead", style: "font-size:16px", text: "On top of that, it re-read " + fmt(D.contextTokens) + " tokens of context from cache to keep track of your work." }) : null,
      el("p", { class: "note", text: "Input plus output tokens, the same count /stats uses. Cache reads are listed separately." }) ]; } },
    { bg: "var(--paper)", fg: "var(--ink)", build: function () {
      var list = el("div", { class: "chips" });
      D.models.forEach(function (m) { list.appendChild(el("div", { class: "chip" }, [el("span", { text: dayLabel(m.first) }), el("span", { text: m.name }), fav && m.id === fav.id ? el("span", { class: "fav", text: "most used" }) : el("span", { text: "" })])); });
      return [
        el("div", { class: "kicker", text: "Your model year" }),
        el("h2", { text: D.models.length > 1 ? D.models.length + " models came and went" : "One model all year" }),
        list,
        fav ? el("p", { class: "lead", text: "Your favourite was " + fav.name + ", with " + fmt(fav.tokens) + " tokens." }) : null ]; } },
    { bg: "var(--sky)", fg: "var(--ink)", build: function () {
      var c = el("div", { class: "clock" }), max = Math.max.apply(null, D.hours) || 1;
      D.hours.forEach(function (n, h) { c.appendChild(el("i", { class: h === D.peakHour ? "peak" : "", style: "height:" + Math.max(2, n / max * 100) + "%" })); });
      return [
        el("div", { class: "kicker", text: "When you worked" }),
        el("h2", { text: D.persona.title }),
        el("p", { class: "lead", text: D.persona.why }),
        c, el("div", { class: "clock-axis" }, [el("span", { text: "12 am" }), el("span", { text: "6 am" }), el("span", { text: "noon" }), el("span", { text: "6 pm" }), el("span", { text: "11 pm" })]),
        D.peakHour !== null ? el("p", { class: "note", text: "Most sessions started around " + hourLabel(D.peakHour) + "." }) : null ]; } },
    { bg: "var(--ink)", fg: "var(--sky)", build: function () {
      var maxT = (D.tools[0] || { count: 1 }).count, rows = el("div", { class: "rows" });
      D.tools.forEach(function (t) { rows.appendChild(el("div", {}, [el("div", { class: "row" }, [t.name, el("b", { text: plain(t.count) })]), el("div", { class: "bar", style: "width:" + Math.max(3, t.count / maxT * 100) + "%" })])); });
      return [
        el("div", { class: "kicker", text: "What your agent reached for" }),
        el("h2", { text: (D.tools[0] ? D.tools[0].name : "Tools") + " led the way" }),
        rows,
        D.languages.length ? el("p", { class: "lead", style: "font-size:16px;color:var(--paper)", text: "Files it edited most: " + D.languages.map(function (l) { return l.name; }).join(", ") + "." }) : null,
        el("p", { class: "note", style: "color:var(--paper)", text: "From the transcripts still on disk: " + dayLabel(cov.transcripts && cov.transcripts.from) + " to " + dayLabel(cov.transcripts && cov.transcripts.to) + "." }) ]; } },
    { bg: "var(--sand)", fg: "var(--ink)", build: function () {
      var L = D.longest;
      return [
        el("div", { class: "kicker", text: "The big one" }),
        el("div", { class: "big", text: L ? (L.hours >= 1 ? Math.round(L.hours) + "h" : Math.round(L.hours * 60) + "m") : "–" }),
        el("p", { class: "lead", text: L ? "of agent activity in your longest session, on " + dayLabel(L.date) + ". Pauses over 30 minutes don't count." : "" }),
        el("div", { class: "rows" }, [
          D.linesAdded ? el("div", { class: "row" }, ["Lines added", el("b", { text: "+" + plain(D.linesAdded) })]) : null,
          D.linesRemoved ? el("div", { class: "row" }, ["Lines removed", el("b", { text: "−" + plain(D.linesRemoved) })]) : null,
          D.projects ? el("div", { class: "row" }, ["Projects", el("b", { text: plain(D.projects) })]) : null,
          D.cost ? el("div", { class: "row" }, ["Value at API prices", el("b", { text: "$" + plain(D.cost) })]) : null ]),
        el("p", { class: "note", text: "Lines and value come from Claude Code's own session totals, for the transcripts still on disk. Value is what the same usage would cost at API prices, not what you paid." }) ]; } },
    { bg: "var(--ink)", fg: "var(--lime)", last: true, build: function () {
      var canvas = el("canvas", { width: 1200, height: 675, "aria-label": "Your shareable card" });
      var save = el("button", { text: "Save image" }), copy = el("button", { class: "ghost", text: "Copy text" });
      save.addEventListener("click", function () { canvas.toBlob(function (b) { var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "agent-wrapped-" + D.year + ".png"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }, "image/png"); });
      copy.addEventListener("click", function () {
        var t = "My " + D.year + " with Claude Code: " + D.persona.title + ". " + D.activeDays + " active days, " + plain(D.sessions) + " sessions, " + fmt(D.tokens) + " tokens" + (fav ? ", mostly " + fav.name : "") + ". Make yours: wrapped.openyard.cloud";
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { copy.textContent = "Copied"; }, function () { window.prompt("Copy this:", t); });
      });
      document.fonts.load('800 40px "Bricolage"').then(function () { drawCard(canvas); }, function () { drawCard(canvas); });
      return [
        el("div", { class: "kicker", text: "Share your year" }),
        el("h2", { text: "Your card" }),
        el("div", { class: "cardwrap" }, [canvas]),
        el("div", { class: "btns" }, [save, copy]),
        el("p", { class: "note", style: "color:var(--paper)", text: "The card shows totals only: no prompts, no file names, no project names. " + coverNote }) ]; } },
  ];

  function drawCard(cv) {
    var x = cv.getContext("2d"), W = 1200, H = 675, F = '"Bricolage", "Avenir Next", system-ui, sans-serif';
    var C = { ink: "#101418", lime: "#c6f432", paper: "#f3f1ea", tomato: "#ff5a36", sky: "#8ec5ff", teal: "#0e3b3a" };
    var L = 56, R = W - 56;
    x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
    // Top: who you were this year, with the year as the big number on the right.
    x.fillStyle = C.lime; x.font = "700 24px " + F; x.fillText("MY " + D.year + " WITH CLAUDE CODE", L, 76);
    x.fillStyle = C.paper; x.font = "800 92px " + F; fitText(x, D.persona.title, L, 166, 760, 92, F);
    x.fillStyle = "rgba(243,241,234,.8)"; x.font = "500 26px " + F; fitLine(x, D.persona.why, L, 210, 800, 26, "500");
    x.fillStyle = C.lime; x.font = "800 120px " + F;
    var yr = String(D.year); x.globalAlpha = 0.16; x.fillText(yr, R - x.measureText(yr).width, 168); x.globalAlpha = 1;
    // Middle: the whole year as a heatmap, edge to edge.
    var cells = heatCells(D.year), cols = Math.ceil(cells.length / 7), gap = 3;
    var cw = (R - L - gap * (cols - 1)) / cols, hy = 262, col = 0, row = 0;
    x.fillStyle = "rgba(198,244,50,.08)";
    cells.forEach(function (lv) {
      if (lv >= 0) { x.globalAlpha = lv === 0 ? 1 : CELL_OPACITY[lv]; x.fillStyle = lv === 0 ? "rgba(198,244,50,.09)" : C.lime; x.fillRect(L + col * (cw + gap), hy + row * (cw + gap), cw, cw); }
      row++; if (row === 7) { row = 0; col++; }
    });
    x.globalAlpha = 1;
    var hb = hy + 7 * (cw + gap);
    x.fillStyle = "rgba(243,241,234,.55)"; x.font = "500 15px " + F;
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].forEach(function (m, i) {
      var first = new Date(D.year, i, 1), jan1 = new Date(D.year, 0, 1);
      var c = Math.floor((jan1.getDay() + Math.round((first - jan1) / 864e5)) / 7);
      x.fillText(m, L + c * (cw + gap), hb + 20);
    });
    // Bottom: four numbers.
    var stats = [[plain(D.activeDays), "active days"], [fmt(D.tokens), "tokens"], [D.streak.days + " days", "longest streak"], [fav ? fav.name : "–", "favourite model"]];
    var sw = (R - L) / stats.length;
    stats.forEach(function (s, i) {
      x.fillStyle = C.paper; x.font = "800 58px " + F; fitText(x, s[0], L + i * sw, 498, sw - 28, 58, F);
      x.fillStyle = "rgba(243,241,234,.7)"; x.font = "500 22px " + F; x.fillText(s[1], L + i * sw, 532);
    });
    x.fillStyle = "rgba(198,244,50,.3)"; x.fillRect(L, 572, R - L, 2);
    x.fillStyle = C.lime; x.font = "700 24px " + F; x.fillText("wrapped.openyard.cloud", L, 622);
    x.fillStyle = "rgba(243,241,234,.6)"; x.font = "500 19px " + F;
    var right = plain(D.sessions) + " sessions · local history " + dayLabel(cov.from) + " – " + dayLabel(cov.to);
    x.fillText(right, R - x.measureText(right).width, 622);
    if (D.demo) { x.fillStyle = C.tomato; x.font = "700 20px " + F; var dm = "DEMO DATA"; x.fillText(dm, R - x.measureText(dm).width, 40); }
  }
  function wrapText(x, text, X, Y, max, lh) {
    var line = "", y = Y;
    text.split(" ").forEach(function (w) { var t = line ? line + " " + w : w; if (x.measureText(t).width > max && line) { x.fillText(line, X, y); y += lh; line = w; } else line = t; });
    if (line) x.fillText(line, X, y);
  }
  function fitText(x, t, X, Y, max, size, F) {
    while (x.measureText(t).width > max && size > 24) { size -= 2; x.font = "800 " + size + "px " + F; }
    x.fillText(t, X, Y);
  }
  function fitLine(x, t, X, Y, max, size, weight) {
    var F = '"Bricolage", "Avenir Next", system-ui, sans-serif';
    while (x.measureText(t).width > max && size > 16) { size -= 1; x.font = weight + " " + size + "px " + F; }
    x.fillText(t, X, Y);
  }

  // #card shows only the share card at its real size (for screenshots and README images).
  if (location.hash === "#card") {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#101418";
    var only = el("canvas", { width: 1200, height: 675, style: "display:block;width:1200px;height:675px" });
    document.body.appendChild(only);
    document.fonts.load('800 40px "Bricolage"').then(function () { drawCard(only); }, function () { drawCard(only); });
    return;
  }

  // Build and run the story.
  var nodes = slides.map(function (s) {
    var n = el("section", { class: "slide", style: "--bg:" + s.bg + ";--fg:" + s.fg });
    s.build().forEach(function (c) { if (c) n.appendChild(c); });
    story.appendChild(n);
    bars.appendChild(el("i"));
    return n;
  });
  if (D.demo) story.appendChild(el("div", { class: "demo", text: "DEMO DATA" }));
  var prevTap = el("div", { class: "tap prev" }), nextTap = el("div", { class: "tap next" });
  story.appendChild(prevTap); story.appendChild(nextTap);
  var at = 0;
  story.classList.add("still"); // no entrance animation on first load
  function show(i) {
    if (shown++) story.classList.remove("still");
    at = Math.max(0, Math.min(nodes.length - 1, i));
    nodes.forEach(function (n, k) { n.classList.toggle("on", k === at); });
    [].forEach.call(bars.children, function (b, k) { b.classList.toggle("on", k <= at); });
    bars.style.color = getComputedStyle(nodes[at]).color;
    story.classList.toggle("last", at === nodes.length - 1);
    try { location.hash = "s" + (at + 1); } catch (e) {}
  }
  prevTap.addEventListener("click", function () { show(at - 1); });
  nextTap.addEventListener("click", function () { show(at + 1); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); show(at + 1); }
    if (e.key === "ArrowLeft") show(at - 1);
  });
  var shown = 0;
  var start = /^#s(\\d+)$/.exec(location.hash);
  show(start ? +start[1] - 1 : 0);
  window.__wrapped = { show: show, count: nodes.length };
})();
</script>
</body>
</html>
`;
}
