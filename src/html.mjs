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
<title>Your ${summary.year} with ${summary.agentsLabel || "Claude Code"} · agent-wrapped</title>
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
.story { container-type: size; position: relative; width: min(100%, 520px); height: min(100%, 900px); border-radius: 22px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.45); }
.bars { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 5px; z-index: 5; }
.bars i { flex: 1; height: 3px; border-radius: 2px; background: currentColor; opacity: .25; }
.bars i.on { opacity: .9; }
/* Autoplay, only when the page embedding the story asks for it: the current bar fills over the slide's time
   (linear, as a progress indicator). Hovering pauses it; a tap or a key hands control to the viewer for good. */
.auto .bars i.now { transform-origin: left center; animation: bar-fill var(--slide-ms, 3400ms) linear both; }
.auto.paused .bars i.now { animation-play-state: paused; }
@keyframes bar-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.slide { position: absolute; inset: 0; padding: 64px 28px 92px; display: none; flex-direction: column; justify-content: safe center; gap: 16px; background: var(--bg); color: var(--fg); overflow: hidden; }
.slide > .label { position: absolute; top: 40px; left: 28px; right: 28px; }
.slide.on { display: flex; }
/* Embedded in another page (the website's phone frame): fill the frame, no chrome of our own. */
.embedded .stage { padding: 0; }
.embedded .story { width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
.embedded .hint { display: none; }
.label { font-size: 15px; font-weight: 600; opacity: .8; }
h1, h2 { margin: 0; font-weight: 800; letter-spacing: -.03em; line-height: .95; }
h1 { font-size: clamp(54px, 15vw, 84px); }
h2 { font-size: clamp(34px, 9.5vw, 48px); }
.big { font-size: clamp(76px, 24vw, 132px); font-weight: 800; letter-spacing: -.05em; line-height: .85; font-variant-numeric: tabular-nums; }
.lead { margin: 0; font-size: 20px; line-height: 1.3; font-weight: 600; max-width: 28ch; }
.small { margin: 0; font-size: 16px; line-height: 1.35; font-weight: 500; max-width: 32ch; opacity: .85; }
.note { position: absolute; left: 28px; right: 28px; bottom: 26px; margin: 0; font-size: 12.5px; line-height: 1.45; font-weight: 500; opacity: .7; }
.trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; padding-top: 18px; border-top: 2px solid color-mix(in srgb, currentColor 22%, transparent); }
.trio b { display: block; font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.trio span { display: block; margin-top: 6px; font-size: 14px; font-weight: 600; opacity: .75; }
.rows { display: grid; gap: 12px; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: baseline; font-size: 18px; font-weight: 600; }
.row b { font-variant-numeric: tabular-nums; font-weight: 800; }
.bar { height: 10px; border-radius: 5px; background: currentColor; margin-top: 6px; }
.models { display: grid; gap: 2px; }
.model { position: relative; display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 10px; padding: min(4px, .4cqh) 10px; margin: 0 -10px; border-radius: 8px; font-size: clamp(14px, 2.5cqh, 18px); font-weight: 700; }
.model span:first-child { font-size: 13px; font-weight: 600; opacity: .65; }
.model.fav { background: var(--ink); color: var(--lime); }
.model.fav span:last-child { font-size: 12px; font-weight: 700; }
/* Twelve months must fit the slide's height as well as its width: 4 rows of 6 weeks plus labels, headline and notes. */
.months { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 14px; width: 100%; max-width: max(150px, calc(71cqh - 245px)); }
.month b { display: block; font-size: 12px; font-weight: 700; margin-bottom: 4px; opacity: .8; color: var(--paper); }
.month div { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.month i { aspect-ratio: 1; border-radius: 2px; background: currentColor; }
.clock { display: grid; grid-template-columns: repeat(24, 1fr); align-items: end; gap: 3px; height: 170px; }
.clock i { background: currentColor; border-radius: 3px 3px 0 0; opacity: .32; min-height: 2px; }
.clock i.peak { opacity: 1; }
.clock-axis { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; opacity: .7; }
.books { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 3px; max-width: 100%; }
.books i { width: 7px; border-radius: 2px; background: currentColor; }
.persona h1 { font-size: clamp(58px, 17vw, 96px); }
.cardwrap { width: 100%; border-radius: 10px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
canvas { display: block; width: 100%; height: auto; }
.btns { display: flex; flex-wrap: wrap; gap: 10px; }
button { font: 700 16px var(--display); border: 0; border-radius: 99px; padding: 12px 18px; cursor: pointer; background: var(--fg); color: var(--bg); transition: transform 120ms cubic-bezier(.2,0,0,1); }
button:active { transform: scale(.97); }
button.ghost { background: transparent; color: var(--fg); box-shadow: inset 0 0 0 2px currentColor; }
button:focus-visible { outline: 3px solid var(--fg); outline-offset: 3px; }
.tap { position: absolute; top: 0; bottom: 0; width: 35%; z-index: 4; }
.tap.prev { left: 0; } .tap.next { right: 0; }
.last .tap { display: none; }
.hint { position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 11px; color: #7d8590; }
.demo { position: absolute; top: 24px; right: 14px; z-index: 6; font: 700 11px var(--display); background: var(--ink); color: var(--tomato); box-shadow: inset 0 0 0 1.5px var(--tomato); padding: 3px 8px; border-radius: 4px; letter-spacing: .04em; }

/*
  Motion. Each slide plays its own short scene when it comes on: the headline rises out of its line, the
  number counts up, then the details land in order (bars grow, cells pop, the list deals in). --d is the
  delay in ms for each piece. Only transform and opacity move. Reduced motion shows every slide finished.
*/
.story { --e: cubic-bezier(.22, 1, .36, 1); --pop: cubic-bezier(.34, 1.56, .64, 1); }
@keyframes up { from { opacity: 0; transform: translateY(18px); } }
@keyframes word { from { transform: translateY(130%); } to { transform: none; } }
@keyframes grow-x { from { transform: scaleX(0); } to { transform: none; } }
@keyframes grow-y { from { transform: scaleY(0); } to { transform: none; } }
@keyframes pop { from { opacity: 0; transform: scale(.2); } }
@keyframes land { from { opacity: 0; transform: scale(1.35); } }
@keyframes fade { from { opacity: 0; } }
.w { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: .14em; margin-bottom: -.14em; }
.w > span { display: inline-block; }
.slide.on .in { animation: up 640ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .w > span { animation: word 760ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .gx { transform-origin: left center; animation: grow-x 900ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .gy { transform-origin: center bottom; animation: grow-y 700ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .pp { animation: pop 420ms var(--pop) calc(var(--d, 0) * 1ms) both; }
.slide.on .ld { animation: land 900ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .fd { animation: fade 500ms var(--e) calc(var(--d, 0) * 1ms) both; }
.slide.on .note { animation: fade 600ms var(--e) 1200ms both; }
@media (prefers-reduced-motion: reduce) { .slide.on * { animation: none !important; } }
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
  var WHO = D.agentsLabel || "Claude Code";
  var HAS_CLAUDE = !D.agents || D.agents.indexOf("Claude Code") >= 0;
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

  var tokensWar = D.tokens / 780000;
  var fav = D.favourite, L = D.longest;
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // A: give a piece of a slide its entrance and the moment it starts (ms after the slide comes on).
  function A(n, d, cls) { n.classList.add(cls || "in"); n.style.setProperty("--d", d); return n; }
  // A headline that rises out of its own line, word by word.
  function words(tag, text, d0, step) {
    var h = el(tag);
    String(text).split(" ").forEach(function (w, i) {
      if (i) h.appendChild(document.createTextNode(" "));
      var s = el("span", { text: w }); s.style.setProperty("--d", d0 + i * (step || 70));
      h.appendChild(el("span", { class: "w" }, [s]));
    });
    return h;
  }
  // A number that counts up from zero when its slide comes on.
  function counter(n, to, f, d) { n._to = to; n._f = f; n._d = d || 0; n.classList.add("count"); return n; }
  function label(t) { return el("div", { class: "label", text: t }); }
  function lv(v, max) { return v === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(v / max) * 3.999)); }
  function monthsEl() {
    var wrap = el("div", { class: "months", "aria-label": "Activity by day across " + D.year }), max = 1;
    for (var k in D.heatmap) max = Math.max(max, D.heatmap[k]);
    for (var m = 0; m < 12; m++) {
      var grid = el("div"), first = new Date(D.year, m, 1);
      for (var i = 0; i < first.getDay(); i++) grid.appendChild(el("i", { style: "visibility:hidden" }));
      for (var d = new Date(first); d.getMonth() === m; d.setDate(d.getDate() + 1)) {
        var key = D.year + "-" + String(m + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        grid.appendChild(A(el("i", { style: "opacity:" + CELL_OPACITY[lv(D.heatmap[key] || 0, max)] }), 300 + m * 70 + d.getDate() * 6, "pp"));
      }
      wrap.appendChild(el("div", { class: "month" }, [A(el("b", { text: MONTHS[m] }), 250 + m * 70, "fd"), grid]));
    }
    return wrap;
  }
  var hoursLabel = function (h) { return h >= 1 ? Math.round(h) + "h" : Math.round(h * 60) + "m"; };
  var daysLabel = function (n) { n = Math.round(n); return n + (n === 1 ? " day" : " days"); };
  var maxDay = D.weekdays ? Math.max.apply(null, D.weekdays) : 0;
  var peakDay = maxDay > 0 ? D.weekdays.indexOf(maxDay) : -1;

  var slides = [
    { bg: "var(--ink)", fg: "var(--lime)", build: function () { return [
      label("agent-wrapped"),
      words("h1", "Your " + D.year + " with " + WHO, 150, 80),
      A(el("p", { class: "lead", text: "A year of prompts, tool calls and late nights, counted on your own machine." }), 800),
      el("p", { class: "note", text: coverNote }) ]; } },

    { bg: "var(--lime)", fg: "var(--ink)", build: function () {
      var trio = el("div", { class: "trio" });
      [[D.streak.days, daysLabel, "in a row"], [D.sessions, plain, "sessions"], [D.toolCalls, fmt, "tool calls"]].forEach(function (x, i) {
        trio.appendChild(A(el("div", {}, [counter(el("b", { text: x[1](x[0]) }), x[0], x[1], 900 + i * 120), el("span", { text: x[2] })]), 900 + i * 120));
      });
      return [
        label("You showed up"),
        counter(A(el("div", { class: "big", text: plain(D.activeDays) }), 100), D.activeDays, plain, 100),
        A(el("p", { class: "lead", text: "days with your agent this year." }), 500),
        trio ]; } },

    { bg: "var(--teal)", fg: "var(--lime)", build: function () { return [
      label("Your year, day by day"),
      words("h2", D.busiest ? dayLabel(D.busiest.date) + " was your biggest day" : D.activeDays + " days lit up", 100, 70),
      D.busiest ? A(el("p", { class: "small", style: "color:var(--paper)", text: plain(D.busiest.messages) + " messages back and forth, the brightest square below." }), 450) : null,
      monthsEl(),
      HAS_CLAUDE ? el("p", { class: "note", style: "color:var(--paper)", text: D.historyDays ? D.historyDays + " of these days come from your prompt history alone: Claude Code had already deleted their transcripts, so they count prompts, not replies or tokens." : "Claude Code deletes transcripts after 30 days unless you change cleanupPeriodDays, so earlier months may look quieter than they were." }) : null ]; } },

    { when: D.peakHour !== null, bg: "var(--sky)", fg: "var(--ink)", build: function () {
      var c = el("div", { class: "clock" }), max = Math.max.apply(null, D.hours) || 1;
      D.hours.forEach(function (n, h) { c.appendChild(A(el("i", { class: h === D.peakHour ? "peak" : "", style: "height:" + Math.max(2, n / max * 100) + "%" }), 450 + h * 28, "gy")); });
      return [
        label("When you worked"),
        words("h2", "Your hour was " + hourLabel(D.peakHour), 100, 70),
        peakDay >= 0 ? A(el("p", { class: "small", text: WEEKDAYS[peakDay] + "s were your busiest day of the week." }), 450) : null,
        c, A(el("div", { class: "clock-axis" }, [el("span", { text: "12 am" }), el("span", { text: "6 am" }), el("span", { text: "noon" }), el("span", { text: "6 pm" }), el("span", { text: "11 pm" })]), 450, "fd") ]; } },

    { bg: "var(--tomato)", fg: "var(--ink)", build: function () {
      var copies = Math.max(1, Math.round(tokensWar)), per = copies > 120 ? Math.ceil(copies / 120) : 1, n = Math.max(1, Math.round(copies / per));
      var books = el("div", { class: "books", "aria-hidden": "true" });
      for (var i = 0; i < n; i++) books.appendChild(A(el("i", { style: "height:" + (18 + (i * 7) % 11) + "px" }), 900 + i * Math.min(14, 1200 / n), "pp"));
      return [
        label("Words, in and out"),
        counter(A(el("div", { class: "big", text: fmt(D.tokens) }), 100), D.tokens, fmt, 100),
        A(el("p", { class: "lead", text: "tokens written and read by your agent." }), 500),
        books,
        A(el("p", { class: "small", text: tokensWar >= 1.5 ? "About " + Math.round(tokensWar) + " copies of War and Peace" + (per > 1 ? ", one spine for every " + per + "." : ", one spine each.") : "About " + Math.max(1, Math.round(tokensWar * 100)) + "% of War and Peace." }), 800),
        D.contextTokens ? A(el("p", { class: "small", text: "On top of that, it re-read " + fmt(D.contextTokens) + " tokens of context from cache to keep track of your work." }), 1600) : null,
        el("p", { class: "note", text: "Input plus output tokens, the same count /stats uses. Cache reads are listed separately." }) ]; } },

    { bg: "var(--paper)", fg: "var(--ink)", build: function () {
      var list = el("div", { class: "models" });
      D.models.forEach(function (m, i) {
        var isFav = fav && m.id === fav.id;
        list.appendChild(A(el("div", { class: "model" + (isFav ? " fav" : "") }, [el("span", { text: dayLabel(m.first) }), el("span", { text: m.name }), el("span", { text: isFav ? "most used" : "" })]), 400 + i * 70));
      });
      return [
        label("Your model year"),
        words("h2", D.models.length > 1 ? D.models.length + " models came and went" : "One model all year", 100, 70),
        list,
        fav ? A(el("p", { class: "small", text: "Your favourite was " + fav.name + ", with " + fmt(fav.tokens) + " tokens." }), 500 + D.models.length * 70) : null ]; } },

    { when: D.tools.length > 0, bg: "var(--ink)", fg: "var(--sky)", build: function () {
      var maxT = D.tools[0].count, rows = el("div", { class: "rows" });
      D.tools.forEach(function (t, i) {
        rows.appendChild(A(el("div", {}, [el("div", { class: "row" }, [t.name, counter(el("b", { text: plain(t.count) }), t.count, plain, 400 + i * 90)]), A(el("div", { class: "bar", style: "width:" + Math.max(3, t.count / maxT * 100) + "%" }), 450 + i * 90, "gx")]), 400 + i * 90));
      });
      return [
        label("What your agent reached for"),
        words("h2", D.tools[0].name + " led the way", 100, 70),
        rows,
        D.languages.length ? A(el("p", { class: "small", style: "color:var(--paper)", text: "Files it edited most: " + D.languages.map(function (l) { return l.name; }).join(", ") + "." }), 500 + D.tools.length * 90) : null,
        el("p", { class: "note", style: "color:var(--paper)", text: "From the transcripts still on disk: " + dayLabel(cov.transcripts && cov.transcripts.from) + " to " + dayLabel(cov.transcripts && cov.transcripts.to) + "." }) ]; } },

    { when: !!L, bg: "var(--sand)", fg: "var(--ink)", build: function () {
      var rows = el("div", { class: "rows" }), r = 0;
      [[D.linesAdded, "Lines added", function (n) { return "+" + plain(n); }], [D.linesRemoved, "Lines removed", function (n) { return "−" + plain(n); }],
       [D.projects, "Projects", plain], [D.cost, "Value at API prices", function (n) { return "$" + plain(n); }]].forEach(function (x) {
        if (!x[0]) return;
        rows.appendChild(A(el("div", { class: "row" }, [x[1], counter(el("b", { text: x[2](x[0]) }), x[0], x[2], 900 + r * 90)]), 900 + r++ * 90));
      });
      return [
        label("The big one"),
        counter(A(el("div", { class: "big", text: hoursLabel(L.hours) }), 100), L.hours, hoursLabel, 100),
        A(el("p", { class: "lead", text: "of agent activity in your longest session, on " + dayLabel(L.date) + ". Pauses over 30 minutes don't count." }), 500),
        rows,
        el("p", { class: "note", text: "Lines and value come from Claude Code's own session totals, for the transcripts still on disk. Value is what the same usage would cost at API prices, not what you paid." }) ]; } },

    { when: D.interrupts >= 3, bg: "var(--ink)", fg: "var(--tomato)", build: function () {
      var every = D.prompts > D.interrupts ? Math.round(D.prompts / D.interrupts) : 0;
      return [
        label("Hands on the wheel"),
        counter(A(el("div", { class: "big", text: plain(D.interrupts) }), 100), D.interrupts, plain, 100),
        A(el("p", { class: "lead", style: "color:var(--paper)", text: "times you pressed Esc to stop your agent mid-reply." }), 500),
        every > 1 ? A(el("p", { class: "small", style: "color:var(--paper)", text: "About once every " + every + " prompts. It took every one of them well." }), 1100) : null,
        el("p", { class: "note", style: "color:var(--paper)", text: "Counted from the transcripts still on disk." }) ]; } },

    { bg: "var(--lime)", fg: "var(--ink)", cls: "persona", build: function () { return [
      label("Your " + D.year + " in one line"),
      A(el("p", { class: "lead", text: "All of that makes you" }), 150),
      // Sized so the longest word fits the slide's width (Bricolage 800 is about 0.6em per letter).
      A(el("h1", { text: D.persona.title, style: "font-size:min(96px, calc((100cqw - 56px) / " + (0.62 * Math.max.apply(null, D.persona.title.split(" ").map(function (w) { return w.length; }))).toFixed(2) + "))" }), 1000, "ld"),
      A(el("p", { class: "lead", text: D.persona.why }), 1700) ]; } },

    { bg: "var(--ink)", fg: "var(--lime)", last: true, build: function () {
      var canvas = el("canvas", { width: 1200, height: 675, "aria-label": "Your shareable card" });
      var save = el("button", { text: "Save image" }), copy = el("button", { class: "ghost", text: "Copy text" });
      save.addEventListener("click", function () { canvas.toBlob(function (b) { var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "agent-wrapped-" + D.year + ".png"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }, "image/png"); });
      copy.addEventListener("click", function () {
        var t = "My " + D.year + " with " + WHO + ": " + D.persona.title + ". " + D.activeDays + " active days, " + plain(D.sessions) + " sessions, " + fmt(D.tokens) + " tokens" + (fav ? ", mostly " + fav.name : "") + ". Make yours: wrapped.openyard.cloud";
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { copy.textContent = "Copied"; }, function () { window.prompt("Copy this:", t); });
      });
      document.fonts.load('800 40px "Bricolage"').then(function () { drawCard(canvas); }, function () { drawCard(canvas); });
      return [
        label("Share your year"),
        words("h2", "Your card", 100, 70),
        A(el("div", { class: "cardwrap" }, [canvas]), 350),
        A(el("div", { class: "btns" }, [save, copy]), 650),
        el("p", { class: "note", style: "color:var(--paper)", text: "The card shows totals only: no prompts, no file names, no project names. " + coverNote }) ]; } },
  ].filter(function (s) { return s.when !== false; });

  var countRun = 0;
  function runCounters(node) {
    var run = ++countRun;
    [].forEach.call(node.querySelectorAll(".count"), function (n) {
      if (reduce) { n.textContent = n._f(n._to); return; }
      n.textContent = n._f(0);
      var t0 = performance.now() + n._d;
      (function tick(now) {
        if (run !== countRun) { n.textContent = n._f(n._to); return; }
        var p = Math.max(0, Math.min(1, (now - t0) / 1100));
        n.textContent = p >= 1 ? n._f(n._to) : n._f(n._to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      })(performance.now());
    });
  }

  function drawCard(cv) {
    var x = cv.getContext("2d"), W = 1200, H = 675, F = '"Bricolage", "Avenir Next", system-ui, sans-serif';
    var C = { ink: "#101418", lime: "#c6f432", paper: "#f3f1ea", tomato: "#ff5a36", sky: "#8ec5ff", teal: "#0e3b3a" };
    var L = 56, R = W - 56;
    x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
    // Top: who you were this year, with the year as the big number on the right.
    x.fillStyle = C.lime; x.font = "700 24px " + F; fitLine(x, "MY " + D.year + " WITH " + WHO.toUpperCase(), L, 76, 760, 24, "700");
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
    var n = el("section", { class: "slide" + (s.cls ? " " + s.cls : ""), style: "--bg:" + s.bg + ";--fg:" + s.fg });
    s.build().forEach(function (c) { if (c) n.appendChild(c); });
    story.appendChild(n);
    bars.appendChild(el("i"));
    return n;
  });
  if (D.demo) story.appendChild(el("div", { class: "demo", text: "DEMO DATA" }));
  var prevTap = el("div", { class: "tap prev" }), nextTap = el("div", { class: "tap next" });
  story.appendChild(prevTap); story.appendChild(nextTap);
  var at = 0;
  var SLIDE_MS = 4200, auto = false, timer = null, startedAt = 0, remaining = 0;
  function stopAuto() { auto = false; clearTimeout(timer); story.classList.remove("auto", "paused"); }
  function step(ms) {
    clearTimeout(timer); startedAt = Date.now(); remaining = ms;
    timer = setTimeout(function () { show(at + 1); if (at >= nodes.length - 1) stopAuto(); else step(SLIDE_MS); }, ms);
  }
  function pause() { if (!auto || story.classList.contains("paused")) return; clearTimeout(timer); remaining -= Date.now() - startedAt; story.classList.add("paused"); }
  function resume() { if (!auto || !story.classList.contains("paused")) return; story.classList.remove("paused"); step(Math.max(300, remaining)); }
  function show(i) {
    shown++;
    at = Math.max(0, Math.min(nodes.length - 1, i));
    nodes.forEach(function (n, k) { n.classList.toggle("on", k === at); });
    [].forEach.call(bars.children, function (b, k) { b.classList.toggle("on", k <= at); b.classList.toggle("now", k === at); });
    bars.style.color = getComputedStyle(nodes[at]).color;
    story.classList.toggle("last", at === nodes.length - 1);
    runCounters(nodes[at]);
    try { location.hash = "s" + (at + 1); } catch (e) {}
  }
  prevTap.addEventListener("click", function () { stopAuto(); show(at - 1); });
  nextTap.addEventListener("click", function () { stopAuto(); show(at + 1); });
  story.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") pause(); });
  story.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") resume(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); else resume(); });
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.data !== "agent-wrapped:play") return;
    if (auto || shown > 1 || at > 0) return; // the viewer already took over
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    auto = true; story.style.setProperty("--slide-ms", SLIDE_MS + "ms"); story.classList.add("auto"); show(at); step(SLIDE_MS);
  });
  document.addEventListener("keydown", function () { stopAuto(); });
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
