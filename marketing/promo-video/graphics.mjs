// Renders the still graphics for the promo (background, phone mask, captions, end card)
// as PNGs with Playwright. Run: node graphics.mjs  (then ./build.sh)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "build");
mkdirSync(out, { recursive: true });

const W = 1080, H = 1920;
// Phone screen placement (must match build.sh)
export const PHONE = { w: 766, h: 1360, x: 157, y: 500, r: 56 };

const BRAND = {
  orange: "#E95D3A",
  amber: "#F5A623",
  cream: "#FFF9F2",
  ink: "#1F1A17",
  muted: "#6B625C",
};

const logo = "data:image/png;base64," + readFileSync(path.join(here, "logo.png")).toString("base64");

const fonts = `<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">`;
const base = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
  body{font-family:'DM Sans',sans-serif;color:${BRAND.ink}}
  .serif{font-family:'Playfair Display',serif}
`;

// Captions: step number (optional), headline, subline. Sit in the top band above the phone.
export const CAPTIONS = [
  { id: "c0", head: "Group trips,<br>minus the chaos.", sub: "" },
  { id: "c1", step: "01", head: "Start a trip", sub: "Pick where, when and your vibe." },
  { id: "c2", step: "02", head: "Everyone adds wishes", sub: "Each friend adds what they want to do." },
  { id: "c3", step: "03", head: "Swipe to vote", sub: "The pack's favorites rise to the top." },
  { id: "c4", step: "04", head: "Get your itinerary", sub: "AI builds a day-by-day plan from the top picks." },
  { id: "c5", head: "Packing, chat<br>&amp; trip memories", sub: "All in one place." },
];

function captionHtml(c) {
  return `<!doctype html><html><head>${fonts}<style>${base}
    .wrap{position:absolute;left:0;right:0;top:0;height:${PHONE.y}px;display:flex;flex-direction:column;
      align-items:center;justify-content:center;text-align:center;padding:40px 70px 34px}
    .step{display:inline-flex;align-items:center;gap:14px;font-weight:700;font-size:30px;letter-spacing:.14em;
      color:${BRAND.orange};margin-bottom:18px}
    .step span{width:44px;height:3px;background:${BRAND.orange};border-radius:2px}
    h1{font-size:${c.step ? 84 : 92}px;line-height:1.02;font-weight:800;letter-spacing:-.01em}
    p{margin-top:20px;font-size:38px;line-height:1.25;color:${BRAND.muted};font-weight:500}
  </style></head><body><div class="wrap">
    ${c.step ? `<div class="step"><span></span>STEP ${c.step}<span></span></div>` : ""}
    <h1 class="serif">${c.head}</h1>
    ${c.sub ? `<p>${c.sub}</p>` : ""}
  </div></body></html>`;
}

const bgHtml = `<!doctype html><html><head><style>${base}
  body{background:${BRAND.cream}}
  .blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.30}
  .phone{position:absolute;left:${PHONE.x}px;top:${PHONE.y}px;width:${PHONE.w}px;height:${PHONE.h}px;
    border-radius:${PHONE.r}px;background:#fff;
    box-shadow:0 40px 90px rgba(233,93,58,.28),0 0 0 10px #1F1A17,0 0 0 12px rgba(0,0,0,.25)}
</style></head><body>
  <div class="blob" style="width:760px;height:760px;left:-260px;top:-220px;background:${BRAND.orange}"></div>
  <div class="blob" style="width:700px;height:700px;right:-280px;top:900px;background:${BRAND.amber}"></div>
  <div class="phone"></div>
</body></html>`;

const maskHtml = `<!doctype html><html><head><style>
  *{margin:0}html,body{width:${PHONE.w}px;height:${PHONE.h}px;background:#000}
  div{width:100%;height:100%;background:#fff;border-radius:${PHONE.r}px}
</style></head><body><div></div></body></html>`;

const endHtml = `<!doctype html><html><head>${fonts}<style>${base}
  body{background:${BRAND.orange};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .badge{width:300px;height:300px;border-radius:72px;background:${BRAND.cream};display:flex;align-items:center;justify-content:center;
    box-shadow:0 30px 80px rgba(0,0,0,.18)}
  .badge img{width:250px;height:250px}
  .word{margin-top:56px;font-size:150px;font-weight:700;letter-spacing:-.01em;line-height:1}
  .tag{margin-top:40px;font-size:64px;font-weight:700;letter-spacing:.02em}
  .tag b{color:${BRAND.cream};opacity:.55;font-weight:700;margin:0 14px}
  .cta{margin-top:110px;background:${BRAND.cream};color:${BRAND.orange};font-weight:700;font-size:44px;
    padding:30px 64px;border-radius:999px}
</style></head><body>
  <div class="badge"><img src="${logo}"></div>
  <div class="word serif">packyo</div>
  <div class="tag">Wish<b>·</b>Vote<b>·</b>Go</div>
  <div class="cta">Plan your next trip together</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });

async function shot(html, file, opts = {}) {
  await page.setViewportSize(opts.viewport ?? { width: W, height: H });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, file), omitBackground: !!opts.transparent });
}

await shot(bgHtml, "bg.png");
await shot(maskHtml, "mask.png", { viewport: { width: PHONE.w, height: PHONE.h } });
for (const c of CAPTIONS) await shot(captionHtml(c), `${c.id}.png`, { transparent: true });
await shot(endHtml, "end.png");

const usedFonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family));
console.log("fonts loaded:", [...new Set(usedFonts)].join(", ") || "NONE (fallback)");
await browser.close();
