/**
 * **Draws `public/og-card.png`, the picture on every link preview.**
 *
 *   npx tsx scripts/make-og-card.ts
 *
 * Run by hand when the logo, the name or the strapline changes, and the PNG is
 * committed: nothing draws it at build time, so a deploy cannot fail on a
 * browser. It is one static image for the whole site — the choice, and the
 * per-article image it passed over, are in
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md.
 *
 * 1200x630 is the size every platform draws large; `OG_CARD` in
 * src/public/page-head.ts publishes those two numbers, and
 * tests/og-card.test.ts reads them back out of the file, with the 300KB above
 * which WhatsApp is reported to drop a thumbnail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { OG_CARD } from "../src/public/page-head.js";
import { APP_NAME, TAGLINE } from "../src/title-text.js";
import { chromePath } from "./browser-sign-in.js";

const root = process.cwd();
const dataUri = (file: string, type: string): string =>
  `data:${type};base64,${readFileSync(path.join(root, file)).toString("base64")}`;

const logo = dataUri("public/spideryarn-logo.png", "image/png");
const font = dataUri(
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  "font/woff2",
);

/* The dark theme's ground and the logo's own colour: the card is seen beside
   other sites' cards, so it wears what the app wears by default. */
const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  @font-face { font-family: Geist; src: url(${font}) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; }
  body {
    width: ${OG_CARD.width}px; height: ${OG_CARD.height}px; box-sizing: border-box;
    background: #0a0a0a; color: #fafafa; font-family: Geist, sans-serif;
    display: flex; align-items: center; justify-content: center; gap: 72px;
  }
  img { height: 300px; }
  h1 { margin: 0; font-size: 112px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
  p { margin: 28px 0 0; font-size: 46px; font-weight: 400; color: #a3a3a3; line-height: 1; }
</style>
<img src="${logo}" alt="" />
<div><h1>${APP_NAME}</h1><p>${TAGLINE}</p></div>`;

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: OG_CARD.width, height: OG_CARD.height },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, "public", OG_CARD.path.replace(/^\//, ""));
  writeFileSync(out, await page.screenshot({ type: "png" }));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
