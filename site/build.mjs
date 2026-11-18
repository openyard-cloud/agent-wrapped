// Build the landing site into site/dist: the hand-written page, the demo story made by the real
// renderer, and the images. Deploy with `npm run site:deploy`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml } from "../src/html.mjs";
import { demoSummary } from "../src/demo.mjs";
import { cardHtml } from "./card.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dist = path.join(here, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(dist, to));
copy("site/static/favicon.png", "favicon.png");
copy("assets/card-demo.png", "card.png");
copy("assets/slides-demo.png", "slides.png");
copy("fonts/bricolage-latin.woff2", "bricolage-latin.woff2");
copy("fonts/OFL.txt", "OFL.txt");

// The landing page, with the share card drawn live from the demo data instead of shown as a picture.
const year = new Date().getFullYear();
const page = fs.readFileSync(path.join(here, "index.html"), "utf8");
if (!page.includes("<!-- CARD -->")) throw new Error("site/index.html has no <!-- CARD --> slot");
fs.writeFileSync(path.join(dist, "index.html"), page.replace("<!-- CARD -->", cardHtml(demoSummary(year))));

// The demo story is the real page, built from the same code people run, with demo data.
let demo = renderHtml(demoSummary(year), { demo: true });
demo = demo.replace("<title>", `<meta name="robots" content="noindex">\n<title>`);
fs.mkdirSync(path.join(dist, "demo"), { recursive: true });
fs.writeFileSync(path.join(dist, "demo", "index.html"), demo);

fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://wrapped.openyard.cloud/sitemap.xml\n");
fs.writeFileSync(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://wrapped.openyard.cloud/</loc></url></urlset>\n`);

for (const f of fs.readdirSync(dist, { recursive: true })) {
  const p = path.join(dist, f);
  if (fs.statSync(p).isFile()) console.log(`${String(fs.statSync(p).size).padStart(8)}  ${f}`);
}
