/**
 * **After a rotation, the reading view never makes the page wider than the
 * screen, even on the frames before React has caught up.**
 *
 * Greg, an iPad and an iPhone, 2026-10-08 (spya-gxbwug): after a rotation the
 * bottom bar sat partway up the screen and the article did not fill the width,
 * which is a page scale below 1. Every width in the reading view is pixels
 * computed by `fitView` for the window React last saw: `.reader`'s inline
 * `min-width`, `--page-w` (the masthead and the controls bar), the table and
 * its `<col>`s. On a wide-to-narrow rotation WebKit lays the page out at the new
 * size *before any script runs*, still carrying the old pixels, and on iOS it
 * chooses the new page scale from that too-wide content
 * (`WebPage::dynamicViewportSizeUpdate`). Measured in Playwright's WebKit: 360px
 * of overflow for up to 650ms on an iPad, 266px on an iPhone.
 * docs/plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md.
 *
 * So the test does what WebKit does: lay the page out with one width's numbers,
 * narrow the window, and change nothing else. The document must still be
 * exactly as wide as the window, and `.reader`'s own `scrollWidth` must still
 * see the stale content (so a check that looks there is not blinded). The
 * control puts today's styles back and must overflow, which is what proves each
 * fixture really is stale-wide and the run is not passing for nothing.
 *
 * Chrome always, as the sibling `*-in-chrome` tests; Playwright's WebKit too
 * where it is installed (the box has it), because WebKit is the engine the
 * report is about. Skipped where there is neither.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import {
  type FitInput,
  fitView,
  margTitleReserve,
  readerMinWidth,
} from "../src/web/layout.js";
import { readerCss } from "./helpers/stylesheets.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const CSS = `${readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")}\n${readerCss()}`;

/** Today's styles, before 261008b: no clip, and the `min-width` as bare pixels. */
const CONTROL_CSS = (px: number) => `.reader { overflow-x: visible !important; min-width: ${px}px !important; }`;

/**
 * The reading view's markup, in the shape Reader.tsx and TableView.tsx render
 * it: `#root > .reader` with the inline style Reader writes, the two sticky
 * bars sized from `--page-w`, the table with its `<col>`s, and, where the fit
 * asks for them, a band and Marginalia's note and fixed head.
 */
function page(input: FitInput, extraCss = ""): string {
  const fit = fitView(input);
  const cols = fit.widths.map((w) => `<col style="width:${w}px">`).join("");
  const classes = `reader spine-${fit.spine}${fit.alone ? " text-alone" : ""}${fit.modeW === 0 ? " band-covers" : ""}`;
  const style = [
    `min-width:${readerMinWidth(fit.minWidth)}`,
    `--mode-w:${fit.modeW}px`,
    `--page-w:${input.windowWidth}px`,
    `--table-w:${fit.tableW}px`,
    `--marg-w:${fit.margW}px`,
    `--marg-reserve:${fit.margReserve}px`,
    `--marg-title-reserve:${margTitleReserve(fit)}px`,
    `--marg-left:${fit.margLeft}px`,
  ].join(";");
  return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}\n${extraCss}</style>
<div id="root"><div class="${classes}" style="${style}">
  <header class="masthead"><h1>A title</h1></header>
  <div class="controls"></div>
  <table class="zoom reading only-prose" style="width:${fit.tableW}px"><colgroup>${cols}</colgroup>
    <tbody><tr><td class="text"><p>Some prose. ${"word ".repeat(200)}</p>
      ${fit.margW > 0 ? '<div class="marg-note" data-marg-note=""><p>A note in the margin.</p></div>' : ""}
    </td></tr></tbody></table>
  ${input.modeBand ? `<div class="mode-band" style="height:300px"></div>` : ""}
  ${fit.margW > 0 ? '<aside class="marg-head"><p>The margin head</p></aside>' : ""}
  <div style="height:3000px"></div>
</div></div>`;
}

interface Rotation {
  name: string;
  from: { width: number; height: number };
  to: { width: number; height: number };
  fit: Omit<FitInput, "windowWidth">;
}

const IPAD_L = { width: 1194, height: 834 };
const IPAD_P = { width: 834, height: 1194 };
const IPHONE_L = { width: 852, height: 393 };
const IPHONE_P = { width: 393, height: 852 };

const ROTATIONS: Rotation[] = [
  { name: "an iPad, Plain", from: IPAD_L, to: IPAD_P, fit: {} },
  { name: "an iPad, Structure's columns", from: IPAD_L, to: IPAD_P, fit: { modeBand: true, bandShape: "structure" } },
  { name: "an iPad, Tweets' wide band", from: IPAD_L, to: IPAD_P, fit: { modeBand: true, bandShape: "wide" } },
  { name: "an iPad, Marginalia", from: IPAD_L, to: IPAD_P, fit: { margin: true } },
  { name: "an iPad, a band and Marginalia", from: IPAD_L, to: IPAD_P, fit: { modeBand: true, margin: true } },
  { name: "an iPad, rail off", from: IPAD_L, to: IPAD_P, fit: { showSpine: false } },
  { name: "an iPhone, a band beside the prose", from: IPHONE_L, to: IPHONE_P, fit: { modeBand: true } },
  { name: "an iPhone, Plain", from: IPHONE_L, to: IPHONE_P, fit: {} },
];

describe("the inert half: `fitView` never asks for more width than it was given", () => {
  /* `readerMinWidth` caps at `100%`, which is only a no-op at rest because of
     this. If it ever stops holding, the cap starts squeezing a real layout and
     this is what says so. */
  it("at every width from 100 to 2600px, in every arrangement", () => {
    const over: string[] = [];
    for (let w = 100; w <= 2600; w++)
      for (const modeBand of [false, true])
        for (const margin of [false, true])
          for (const showSpine of [null, false])
            for (const bandShape of ["standard", "structure", "wide", "roomy"] as const)
              for (const rootFontPx of [12, 16, 20]) {
                const f = fitView({ windowWidth: w, modeBand, margin, showSpine, bandShape, rootFontPx });
                if (f.minWidth > w) over.push(`${w} ${JSON.stringify({ modeBand, margin, showSpine, bandShape, rootFontPx })}`);
              }
    expect(over.slice(0, 5)).toEqual([]);
  });
});

async function engines(): Promise<{ name: string; launch: () => Promise<import("playwright-core").Browser> }[]> {
  const pw = await import("playwright-core");
  const out: { name: string; launch: () => Promise<import("playwright-core").Browser> }[] = [];
  if (chrome !== null) {
    const path = chrome;
    out.push({ name: "Chrome", launch: () => pw.chromium.launch({ headless: true, executablePath: path, args: ["--no-sandbox"] }) });
  }
  if (pw.webkit.executablePath() && (await import("node:fs")).existsSync(pw.webkit.executablePath())) {
    out.push({ name: "WebKit", launch: () => pw.webkit.launch({ headless: true }) });
  }
  return out;
}

const available = await engines();

describe.skipIf(available.length === 0)("a rotation, before React has re-rendered", () => {
  for (const engine of available) {
    it(`${engine.name}: the document stays the window's width while every pixel is the old window's`, { timeout: 120_000 }, async () => {
      const browser = await engine.launch();
      try {
        const ctx = await browser.newContext({ viewport: IPAD_L });
        const p = await ctx.newPage();
        const measure = () =>
          p.evaluate(() => {
            const reader = document.querySelector<HTMLElement>(".reader");
            if (!reader) throw new Error("no .reader");
            return {
              doc: document.documentElement.scrollWidth,
              win: document.documentElement.clientWidth,
              reader: reader.scrollWidth,
              readerBox: reader.getBoundingClientRect().width,
              margNoteRight: document.querySelector<HTMLElement>(".marg-note")?.getBoundingClientRect().right ?? null,
              margHeadRight: document.querySelector<HTMLElement>(".marg-head")?.getBoundingClientRect().right ?? null,
            };
          });

        for (const r of ROTATIONS) {
          const input: FitInput = { ...r.fit, windowWidth: r.from.width };

          /* At rest, in the old orientation, nothing overflows either way. */
          await p.setViewportSize(r.from);
          await p.setContent(page(input));
          const rest = await measure();
          /* `<=`, not `===`: headless Chrome's root can be the scrollbar gutter
             (shell.css reserves it) narrower than the window. */
          expect(rest.doc, `${r.name}: overflows at rest`).toBeLessThanOrEqual(rest.win);

          /* The control: today's styles, then the rotation. It must overflow,
             or this fixture is not stale-wide and the real case proves nothing. */
          await p.setContent(page(input, CONTROL_CSS(fitView(input).minWidth)));
          await p.setViewportSize(r.to);
          const control = await measure();
          expect(control.doc, `${r.name}: the control no longer overflows`).toBeGreaterThan(control.win);

          /* The real thing: the old fit's numbers, the new window. */
          await p.setViewportSize(r.from);
          await p.setContent(page(input));
          await p.setViewportSize(r.to);
          const stale = await measure();
          expect(stale.win, `${r.name}: the window did not narrow`).toBe(r.to.width);
          expect(stale.doc, `${r.name}: the page is wider than the window after the rotation`).toBeLessThanOrEqual(stale.win);
          expect(stale.readerBox, `${r.name}: .reader is wider than the window`).toBeLessThanOrEqual(stale.win);
          /* Not blinded: `.reader` itself still reports what is clipped. */
          expect(stale.reader, `${r.name}: .reader's scrollWidth no longer sees the stale content`).toBeGreaterThan(stale.win);
          if (r.fit.margin && fitView(input).margW > 0) {
            /* The Marginalia row must exercise Marginalia, rather than pass on
               the same stale masthead every other row carries. The note is an
               absolute descendant and is clipped by `.reader`; the head is
               viewport-fixed, so `.reader` does not clip it, but a fixed box
               outside the layout viewport cannot extend the page's scrollable
               overflow (CSS Positioned Layout 3 § 2.1). */
            expect(stale.margNoteRight, `${r.name}: the note is not carrying the old margin geometry`).toBeGreaterThan(stale.win);
            expect(stale.margHeadRight, `${r.name}: the head is not carrying the old margin geometry`).toBeGreaterThan(stale.win);
          }

          /* `clip`, unlike `hidden`, must not create a scroll container. Check
             the consequence rather than the declaration: the controls still
             stick to the viewport after a vertical scroll. A fixed band also
             remains painted and hit-testable through `.reader`'s clip; there
             is no transform/filter/contain ancestor changing its containing
             block in the real styles. */
          await p.evaluate(() => window.scrollTo(0, 500));
          const positioned = await p.evaluate(() => {
            const controls = document.querySelector<HTMLElement>(".controls");
            const band = document.querySelector<HTMLElement>(".mode-band");
            const bandRect = band?.getBoundingClientRect() ?? null;
            const hit =
              bandRect && bandRect.width > 0
                ? document.elementFromPoint(
                    Math.min(document.documentElement.clientWidth - 1, bandRect.left + bandRect.width / 2),
                    Math.min(document.documentElement.clientHeight - 1, Math.max(0, bandRect.top) + 10),
                  )
                : null;
            return {
              controlsTop: controls?.getBoundingClientRect().top ?? null,
              bandHit: band === null ? null : hit?.closest(".mode-band") === band,
            };
          });
          expect(positioned.controlsTop, `${r.name}: overflow-x: clip changed sticky positioning`).toBeCloseTo(0, 1);
          if (r.fit.modeBand) {
            expect(positioned.bandHit, `${r.name}: .reader clipped its viewport-fixed band`).toBe(true);
          }
        }
      } finally {
        await browser.close().catch(() => {});
      }
    });
  }
});
