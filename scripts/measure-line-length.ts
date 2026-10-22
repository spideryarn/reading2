/**
 * **How many characters a line of the article actually holds**, counted in a
 * real browser at the windows that matter — the check behind
 * docs/project/typography.md § The measure, counted in real characters.
 *
 * `--reading-measure` is written in `ch`, and a `ch` is the width of a "0", not
 * of a character. In Source Serif 4 a zero is wider than the average letter, so
 * `65ch` held a median of 70 characters and nobody knew until Greg counted
 * (spya-vywcpu, plan 261022d). The only honest check is to count, so this does:
 * every full line of every paragraph of three or more lines (the last line of
 * each paragraph is left out, since it is short by nature), spaces included.
 *
 *   npm run dev                                   # read the port off Vite's line
 *   SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/measure-line-length.ts \
 *     [--slug <article slug>] [--shots <dir>]
 *
 * Use a long article of ordinary prose; the default is the essay the rule was
 * measured on. **Exit 1** when any window where the column is at the measure
 * (as wide as `--reading-measure`, not squeezed by the window) has a median
 * outside 45–62 or a 90th percentile over 66: that is the rule, and it was red
 * on `65ch` (70 / 75) before it was green. A window too narrow for the measure is reported and not
 * judged — that one is the screen's choice, not ours — except that a window
 * 1000px or wider must be at the measure: narrower there means
 * `PROSE_ALONE_MAX_REM` in layout.ts is clipping it.
 */
import { chromePath, signIn, baseUrl } from "./browser-sign-in.js";

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const base = flag("base") ?? baseUrl();
const slug = flag("slug") ?? "simulators-spya-q2xbny";
const shots = flag("shots");

/** The rule, as numbers. typography.md § The measure owns the words. */
const MIN_MEDIAN = 45;
const MAX_MEDIAN = 62;
const MAX_P90 = 66;
/* A broken collector that splits every glyph into its own "line" satisfies an
   upper bound more convincingly than a correct one. This is not a reading rule;
   it is the positive control that proves the instrument still sees lines. The
   narrowest window in the default ordinary-prose corpus is about 40 characters. */
const MIN_PLAUSIBLE_MEDIAN = 25;

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface Window {
  name: string;
  width: number;
  height: number;
  textSize: "default" | "large" | "larger" | "largest";
  /** A touch device's user agent, so `(hover: none)` matches; null for a mouse. */
  touch: string | null;
}

/* 725 × 967 is Greg's iPad, from the diagnostics of spya-e5t77w. */
const WINDOWS: Window[] = [
  { name: "ipad", width: 725, height: 967, textSize: "default", touch: IPAD },
  { name: "ipad-large", width: 725, height: 967, textSize: "large", touch: IPAD },
  { name: "ipad-largest", width: 725, height: 967, textSize: "largest", touch: IPAD },
  { name: "ipad-air", width: 820, height: 1180, textSize: "default", touch: IPAD },
  { name: "desktop", width: 1440, height: 900, textSize: "default", touch: null },
  { name: "iphone", width: 390, height: 844, textSize: "default", touch: IPHONE },
  { name: "iphone-se", width: 375, height: 667, textSize: "default", touch: IPHONE },
];

interface Count {
  lines: number;
  median: number;
  p10: number;
  p90: number;
  max: number;
  proseWidth: number;
  /** `--reading-measure` resolved in the prose's own font: the width the column is at when nothing squeezes it. */
  measureWidth: number;
  zeroWidth: number;
  measureToken: string;
  textSizeAttr: string | null;
}

/* Runs in the page. Characters are grouped into lines by their box's top; a
   collapsed space has no box and joins the line it ends. */
function count(): Count {
  const counts: number[] = [];
  for (const p of document.querySelectorAll("td.text .prose p")) {
    const lines: { top: number; h: number; n: number }[] = [];
    let cur: { top: number; h: number; n: number } | undefined;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || r.height === 0) {
          if (cur && /\s/.test(text[i]!)) cur.n++;
          continue;
        }
        if (!cur || r.top > cur.top + Math.max(3, cur.h / 2)) {
          cur = { top: r.top, h: r.height, n: 0 };
          lines.push(cur);
        }
        cur.n++;
      }
    }
    if (lines.length >= 3) for (const l of lines.slice(0, -1)) counts.push(l.n);
  }
  counts.sort((a, b) => a - b);
  const q = (f: number) => counts[Math.min(counts.length - 1, Math.round(f * (counts.length - 1)))] ?? 0;
  const prose = document.querySelector<HTMLElement>("td.text .prose")!;
  const ruler = document.createElement("div");
  ruler.style.cssText = "position:absolute;visibility:hidden;width:var(--reading-measure)";
  prose.appendChild(ruler);
  const measureWidth = ruler.getBoundingClientRect().width;
  ruler.remove();
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  probe.textContent = "0".repeat(100);
  prose.querySelector("p")!.appendChild(probe);
  const zeroWidth = probe.getBoundingClientRect().width / 100;
  probe.remove();
  const proseWidth = prose.getBoundingClientRect().width;
  return {
    lines: counts.length,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    max: counts[counts.length - 1] ?? 0,
    proseWidth: Math.round(proseWidth * 10) / 10,
    measureWidth: Math.round(measureWidth * 10) / 10,
    zeroWidth: Math.round(zeroWidth * 1000) / 1000,
    measureToken: getComputedStyle(prose).getPropertyValue("--reading-measure").trim(),
    textSizeAttr: document.documentElement.getAttribute("data-text-size"),
  };
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--no-sandbox"] });
let failed = false;
try {
  const first = await browser.newContext();
  await signIn(await first.newPage(), base);
  const storageState = await first.storageState();
  await first.close();

  console.log(`${base}/read/${slug}?mode=plain`);
  console.log("window          text     lines  median  p10  p90  max  prose px  measure px  zero px");
  for (const w of WINDOWS) {
    const context = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      deviceScaleFactor: 2,
      storageState,
      ...(w.touch ? { isMobile: true, hasTouch: true, userAgent: w.touch } : {}),
    });
    /* tsx's keepNames wraps functions in `__name`, which the page lacks
       (scripts/safe-area-check.ts). */
    await context.addInitScript({ content: "globalThis.__name = globalThis.__name || ((f) => f);" });
    if (w.textSize !== "default") {
      await context.addInitScript((size) => localStorage.setItem("spya.text-size", size), w.textSize);
    }
    const page = await context.newPage();
    await page.goto(`${base}/read/${slug}?mode=plain`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("td.text .prose p", { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const c = await page.evaluate(count);
    if (w.textSize !== "default" && c.textSizeAttr !== w.textSize) {
      throw new Error(`${w.name}: asked for text size ${w.textSize}, the page has ${c.textSizeAttr ?? "default"}`);
    }
    if (c.lines < 40) throw new Error(`${w.name}: only ${c.lines} full lines — pick a longer article`);
    if (c.median < MIN_PLAUSIBLE_MEDIAN) {
      throw new Error(
        `${w.name}: median ${c.median} is not a plausible line — the character-to-line collector is not measuring what it claims`,
      );
    }
    if (!c.measureToken || c.measureWidth <= 0 || c.zeroWidth <= 0) {
      throw new Error(
        `${w.name}: the reading-measure instrument is missing (${c.measureToken || "unset"}, ${c.measureWidth}px, ${c.zeroWidth}px)`,
      );
    }
    const atMeasure = Math.abs(c.proseWidth - c.measureWidth) < 1;
    const under = atMeasure && c.median < MIN_MEDIAN;
    const over = atMeasure && (c.median > MAX_MEDIAN || c.p90 > MAX_P90);
    /* A wide window has room for the measure, so a column narrower than it there
       is layout.ts's `PROSE_ALONE_MAX_REM` clipping it. The cap may deliberately
       be wider than the measure, but it must never be narrower. */
    const clipped = !atMeasure && w.width >= 1000;
    if (under || over || clipped) failed = true;
    console.log(
      [
        w.name.padEnd(15),
        w.textSize.padEnd(8),
        String(c.lines).padStart(5),
        String(c.median).padStart(7),
        String(c.p10).padStart(4),
        String(c.p90).padStart(4),
        String(c.max).padStart(4),
        String(c.proseWidth).padStart(9),
        String(c.measureWidth).padStart(9),
        String(c.zeroWidth).padStart(8),
        atMeasure
          ? under
            ? "  UNDER"
            : over
              ? "  OVER"
              : "  ok"
          : clipped
            ? "  CLIPPED by the cap"
            : "  (window-bound, not judged)",
      ].join(" "),
    );
    if (shots) {
      await page.evaluate(() => {
        const long = [...document.querySelectorAll("td.text .prose p")].filter(
          (p) => p.getBoundingClientRect().height > 150,
        );
        (long[8] ?? long[0])?.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/line-length-${w.name}.png` });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(
  failed
    ? `FAIL: a column at the measure is outside median ${MIN_MEDIAN}–${MAX_MEDIAN} / p90 ≤ ${MAX_P90}, or a wide window's column is narrower than the measure`
    : "ok",
);
process.exit(failed ? 1 : 0);
