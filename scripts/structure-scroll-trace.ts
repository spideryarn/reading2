/**
 * **How often Structure's band redraws while the page scrolls**, counted in
 * WebKit at an iPad's size — the check behind
 * docs/plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md.
 *
 *   npm run dev                                   # read the port off Vite's line
 *   SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/structure-scroll-trace.ts \
 *     [--slug <article slug>] [--width 725] [--height 967] [--view fisheye|expanded] [--out <file.json>]
 *
 * Greg saw the band flicker on a portrait iPad while he scrolled (spya-m5gxk9).
 * A headless WebKit does not drop frames the way iOS does under a finger, so
 * this does not try to photograph a flicker. It counts what causes one: every
 * state the band's list is committed in during one scroll down and back up,
 * recorded by a MutationObserver (so a slow headless timer cannot miss any),
 * and how many of those happened with **no change of section**, which is the
 * list redrawing because the bottom bar slid rather than because the reader
 * moved. On the default article, 2026-10-25: before plan 261025e, 6 redraws,
 * 1 with no change of section (rung 4 → 3 as the bar came back), and the room
 * the fit measures jumping 846 ↔ 955px with the bar; after, 5 redraws, none
 * without a change of section, the room 846px throughout.
 *
 * **What it cannot show is the once-a-second hold**: a headless WebKit steps
 * this scroll so slowly that two crossings rarely land inside one second.
 * tests/structure-focus-row.test.tsx holds the hold, with fake timers.
 *
 * Signed in as the seeded administrator, so the slug must be theirs; the
 * default is the local copy of the paper Greg was reading.
 */
import { writeFileSync } from "node:fs";
import { webkit } from "playwright-core";
import { baseUrl, signIn } from "./browser-sign-in.js";

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const base = flag("base") ?? baseUrl();
const slug = flag("slug") ?? "arxiv-2308-08708-spya-w598t3";
/* 725 × 967 is Greg's iPad (spya-e5t77w's diagnostics; scripts/measure-line-length.ts). */
const width = Number(flag("width") ?? 725);
const height = Number(flag("height") ?? 967);
const view = flag("view") ?? "fisheye";
const out = flag("out");
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface State {
  t: number;
  /** The list's current row, or null. */
  now: string | null;
  rung: string | null;
  rows: number;
  /** The visible list's height, px. */
  listH: number;
  /** The band's content height: what the fit measures against. */
  contentH: number;
  bars: string | null;
}

const browser = await webkit.launch({ headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width, height },
    userAgent: IPAD,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  /* tsx names functions through an `__name` helper the page does not have. */
  await ctx.addInitScript("globalThis.__name = (f) => f;");
  const page = await ctx.newPage();
  await signIn(page, base);
  await page.goto(`${base}/read/${slug}?mode=structure&structure=${view}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mode-band.outln .outln-list > li", { timeout: 60_000 });
  /* Let fonts, images and the first fit settle; then record from a still page. */
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const w = window as unknown as { __states: State[]; __mutations: number };
    w.__states = [];
    w.__mutations = 0;
    const band = document.querySelector<HTMLElement>(".mode-band.outln")!;
    const snap = (): State => {
      const list = band.querySelector<HTMLElement>(":scope > .outln-list");
      const pad = getComputedStyle(band);
      return {
        t: Math.round(performance.now()),
        now: list?.querySelector(".now")?.id ?? null,
        rung: band.dataset.outlineRung ?? null,
        rows: list?.children.length ?? 0,
        listH: Math.round(list?.getBoundingClientRect().height ?? 0),
        contentH: Math.round(
          band.clientHeight - (Number.parseFloat(pad.paddingTop) || 0) - (Number.parseFloat(pad.paddingBottom) || 0),
        ),
        bars: document.documentElement.dataset.bars ?? null,
      };
    };
    const record = () => {
      const s = snap();
      const prev = w.__states.at(-1);
      if (!prev || prev.now !== s.now || prev.rung !== s.rung || prev.rows !== s.rows || prev.listH !== s.listH) {
        w.__states.push(s);
      }
    };
    record();
    new MutationObserver((m) => {
      w.__mutations += m.length;
      record();
    }).observe(band, { childList: true, subtree: true, attributes: true, characterData: true });
  });

  /* A steady scroll on the page, down then back up, as a finger would. */
  const drag = (totalPx: number, ms: number) =>
    page.evaluate(
      ({ totalPx, ms }) =>
        new Promise<void>((done) => {
          const start = performance.now();
          const y0 = window.scrollY;
          const step = () => {
            const f = Math.min(1, (performance.now() - start) / ms);
            window.scrollTo(0, y0 + totalPx * f);
            if (f < 1) setTimeout(step, 16);
            else done();
          };
          step();
        }),
      { totalPx, ms },
    );
  await drag(9000, 3000);
  await page.waitForTimeout(1500);
  await drag(-4000, 1500);
  await page.waitForTimeout(1500);

  const { states, mutations } = await page.evaluate(() => {
    const w = window as unknown as { __states: State[]; __mutations: number };
    return { states: w.__states, mutations: w.__mutations };
  });
  if (out) writeFileSync(out, JSON.stringify(states, null, 1));

  const redraws = states.length - 1;
  let sameSection = 0;
  for (let i = 1; i < states.length; i++) if (states[i]!.now === states[i - 1]!.now) sameSection++;
  let busiest = 0;
  for (const s of states) busiest = Math.max(busiest, states.filter((o) => o.t >= s.t && o.t < s.t + 1000).length);
  const content = new Set(states.map((s) => s.contentH));

  console.log(`Target: ${base}/read/${slug} at ${width}×${height}, ${view}`);
  for (const s of states) {
    console.log(`  ${String(s.t).padStart(6)}ms  now ${s.now ?? "-"}  rung ${s.rung}  rows ${s.rows}  list ${s.listH}px  room ${s.contentH}px  bars ${s.bars ?? "shown"}`);
  }
  console.log(`redraws ${redraws} · with no change of section ${sameSection} · most in any second ${busiest} · band mutations ${mutations} · room heights seen ${[...content].join(", ")}px`);
  /* The positive control: a scroll of 13,000px through a paper must cross sections. */
  if (redraws === 0) {
    console.error("no redraw at all: the trace saw nothing, which is not the same as nothing happening");
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
