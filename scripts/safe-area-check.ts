/**
 * **Does the reading view still hold together when the phone's insets are not
 * zero?** — a browser check for the one class of bug nothing on this box can
 * see by looking.
 *
 * `index.html` carries `viewport-fit=cover`, so on a phone the document is laid
 * out across the whole physical screen and every piece of fixed or sticky
 * chrome has to add back the edge it faces (`src/web/styles/tokens.css § tokens`). Those four
 * insets are **`0px` on every machine we develop on**, so a rule that forgets
 * one is invisible here and correct-looking in every screenshot. On 2026-09-03
 * that cost the mode band its top edge: `.controls` is `top: var(--safe-top)`,
 * the covering-band rules take the masthead away, and nothing was left painting
 * `[0, --safe-top)` — 59px of article scrolling along the top of the screen
 * above a panel that was supposed to be covering it. Nothing rendered wrong
 * here, and no screenshot from this box showed it.
 *
 * So this does what `§ tokens` already told anyone to do by hand — *"set the
 * token to `40px` here and watch the chrome move"* — and turns it into a
 * red/green run.
 *
 * **It asks what is painted, not where the boxes are.** A geometric test is
 * satisfied by a paragraph whose box runs under an opaque bar, and misses a
 * panel that is the right size and behind something. This walks
 * `elementsFromPoint` down two columns of the screen and asks, at each step,
 * *is the top-most thing here the article?* — which is the reader's own
 * question. `docs/reusable/silent-success.md`.
 *
 * Run it against your own dev server, and read the port off Vite's own line —
 * 5273 belongs to the primary checkout:
 *
 *   npm run dev                                    # prints the port it took
 *   SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/safe-area-check.ts
 *
 * Flags: `--modes a,b`, `--width`, `--height`, `--top`, `--bottom`, `--slug`,
 * `--scroll`, `--shots <dir>`; `--site` checks the signed-out pages' bar
 * instead, on `--paths /,/features,…`. The defaults are an installed iPhone: 390 × 844,
 * a 59px notch and a 34px home indicator.
 *
 * docs/project/browser-testing-playwright.md § The insets are zero here.
 */
import type { Page } from "playwright-core";
import { chromePath, signIn } from "./browser-sign-in.js";

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const base = flag("base") ?? process.env.SPIDERYARN_BASE_URL ?? "http://localhost:5273";
const slug = flag("slug") ?? "fowler-phrenology";
const width = Number(flag("width") ?? 390);
const height = Number(flag("height") ?? 844);
const top = flag("top") ?? "59px";
const bottom = flag("bottom") ?? "34px";
/* **Scrolled by default, because at the top of the article the strip may be
   holding blank page rather than prose** — the bug is *"you can see it
   scrolling behind"*, and an unscrolled scan of the same broken build found
   leaks over 12px of screen where a scrolled one found 56. `--scroll 0` for
   the resting state. */
const scroll = Number(flag("scroll") ?? 1200);
const shots = flag("shots");
const modes = (flag("modes") ?? "glossary,summary,search,chat,ideas,outline,quotes,timeline,referee,diagram,learn").split(",");

/* **`--site`: the signed-out pages instead of the reading view.** Their bar is
   `.site-nav`, sticky at `top: 0`, and from the redesign until 2026-10-26 only
   DocumentPage's copy of it added the inset — `spya-tfsjvq`,
   docs/plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md. Never
   signed in, so `/` is the landing page rather than the shelf. `--break` then
   takes the bar's padding away. */
const site = process.argv.includes("--site");
const sitePaths = (flag("paths") ?? "/,/features,/pricing,/login,/read/public,/features/public-readable-sharing,/privacy").split(",");

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--no-sandbox"] });

try {
  const context = await browser.newContext({
    viewport: { width, height },
    /* `hasTouch` is what makes `(pointer: coarse)` match, and the dock is 3.25rem
       rather than 2.5rem under it — so without this the bottom edge under test
       is not the one a phone has. */
    hasTouch: true,
  });
  const page = await context.newPage();
  /* `tsx` compiles with esbuild's `keepNames`, which wraps every function in a
     `__name(…)` the page has never heard of. Without this each `evaluate` dies
     with `ReferenceError: __name is not defined`. */
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || ((f) => f);" });
  /* **Unlayered on purpose.** styles.css is `@import`ed into `@layer app`
     (see tailwind.css), and an unlayered declaration beats a layered one
     whatever the specificity — which is the only reason a four-line override
     can stand in for a device. */
  /* **`--break` is how you watch this fail.** A check nobody has seen go red is
     not evidence (docs/reusable/silent-success.md), and this one cannot be made
     to fail by any machine we own — the insets it depends on are `0px` here.
     So it carries the defect: `.reader::before` is § shell's backstop over the
     status-bar strip, and switching it off is exactly the state Greg reported.
     `npx tsx scripts/safe-area-check.ts --break` must print FAIL and exit 1. */
  const broken = !process.argv.includes("--break")
    ? ""
    : site
      ? ".site-nav{padding-top:0}"
      : ".reader::before{display:none}";
  await context.addInitScript({
    content: `document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = ":root{--safe-top:${top};--safe-bottom:${bottom};--safe-left:0px;--safe-right:0px;}${broken}";
      document.head.appendChild(s);
    });`,
  });

  const failed = site ? await checkSite(page) : await checkReader(page);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}

/** Every band mode, signed in, on the article `--slug`. Returns how many failed. */
async function checkReader(page: Page): Promise<number> {
  await signIn(page, base);

  let failed = 0;
  for (const mode of modes) {
    await page.goto(`${base}/read/${slug}?mode=${mode}`, { waitUntil: "domcontentloaded" });
    /* Not a sleep: the band is the thing under test, so its arrival is the
       signal. A mode that never opens one is reported below rather than
       silently passing. */
    const opened = await page
      .waitForFunction(() => !!document.querySelector(".mode-band"), undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1500);
    if (scroll) {
      await page.mouse.wheel(0, scroll);
      await page.waitForTimeout(1000);
    }

    const seen = await page.evaluate(() => {
      const band = document.querySelector(".mode-band");
      const covering = !!document.querySelector(".reader.band-covers");
      const leaks: number[] = [];
      if (band && covering) {
        for (let y = 1; y < window.innerHeight; y += 2) {
          for (const x of [Math.round(window.innerWidth / 2), window.innerWidth - 4]) {
            const el = document.elementsFromPoint(x, y)[0];
            if (!el || el.closest(".mode-band")) continue;
            if (el.closest("td.text, .prose, table.zoom")) leaks.push(y);
          }
        }
      }
      const rect = (sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? `[${Math.round(r.top)}, ${Math.round(r.bottom)}]` : "-";
      };
      return {
        covering,
        bars: `bar ${rect(".controls")} band ${rect(".mode-band")} dock ${rect(".dock")}`,
        leaks: [...new Set(leaks)].sort((a, b) => a - b),
      };
    });

    if (shots) await page.screenshot({ path: `${shots}/safe-${mode}.png` });

    if (!opened) {
      failed += 1;
      console.log(`  ??  ${mode.padEnd(9)} no .mode-band appeared — the check proved nothing here`);
    } else if (!seen.covering) {
      console.log(`  ·   ${mode.padEnd(9)} band sits beside the prose at ${width}px; nothing to cover`);
    } else if (seen.leaks.length) {
      failed += 1;
      const ys = seen.leaks;
      console.log(`  FAIL ${mode.padEnd(9)} article painted on top at y ${ys[0]}..${ys[ys.length - 1]} (${ys.length} rows) — ${seen.bars}`);
    } else {
      console.log(`  ok  ${mode.padEnd(9)} ${seen.bars}`);
    }
  }

  console.log(
    failed
      ? `\nFAIL — ${failed} of ${modes.length} mode(s) leave the article visible behind the panel at --safe-top: ${top}, --safe-bottom: ${bottom}`
      : `\nok — no mode leaves the article visible behind the panel at --safe-top: ${top}, --safe-bottom: ${bottom} (${width} × ${height})`,
  );
  return failed;
}

function siteGeometryProblems(
  label: string,
  seen: { inset: number; insetValid: boolean; token: string; tops: number[] },
): string[] {
  const problems: string[] = [];
  if (!seen.insetValid) problems.push(`${label}: --safe-top is not a CSS length (${JSON.stringify(seen.token)})`);
  if (!seen.tops.length) problems.push(`${label}: no links in the bar`);
  const under = seen.tops.filter((top) => top < seen.inset);
  if (under.length) {
    const ys = under.map((y) => Math.round(y * 100) / 100);
    problems.push(`${label}: links start at y ${ys.join(", ")}, above ${seen.inset}`);
  }
  return problems;
}

/**
 * Each signed-out page, at rest and scrolled: every visible link and button in
 * the bar must start below the inset. Returns how many pages failed.
 *
 * **Geometry, not paint, and on purpose.** The reading view's question is
 * what is painted behind the clock; here the bar is sticky at `top: 0`, so its
 * own row covers that strip with or without the padding, and a painted probe
 * passed on the broken build as well as the fixed one (tried, 2026-10-26). A
 * check that cannot fail is not evidence. Where the links start can.
 */
async function checkSite(page: Page): Promise<number> {
  let failed = 0;
  for (const path of sitePaths) {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    const found = await page
      .waitForSelector(".site-nav", { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) {
      failed += 1;
      console.log(`  ??  ${path.padEnd(13)} no .site-nav appeared — the check proved nothing here`);
      continue;
    }
    await page.waitForTimeout(800);
    const problems: string[] = [];
    for (const to of [0, scroll || 600]) {
      await page.evaluate((y) => window.scrollTo(0, y), to);
      await page.waitForTimeout(500);
      const seen = await page.evaluate(() => {
        const nav = document.querySelector(".site-nav")!;
        /* Read the token through a real property, rather than `parseFloat` on
           the command-line spelling. A caller may say `--top 3rem` or use a
           `calc(…)`; the custom property's computed value keeps that spelling,
           while padding resolves it to the pixels getBoundingClientRect uses. */
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--safe-top)";
        document.body.appendChild(probe);
        const token = getComputedStyle(document.documentElement).getPropertyValue("--safe-top").trim();
        const inset = parseFloat(getComputedStyle(probe).paddingTop);
        probe.remove();
        const tops = [...nav.querySelectorAll("a, button")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => r.top);
        return {
          inset,
          insetValid: CSS.supports("padding-top", token) && Number.isFinite(inset),
          token,
          tops,
          scrolled: Math.round(window.scrollY),
        };
      });
      const label = seen.scrolled ? `scrolled ${seen.scrolled}` : "at rest";
      problems.push(...siteGeometryProblems(label, seen));
    }
    if (shots) await page.screenshot({ path: `${shots}/safe-site${path === "/" ? "-home" : path.replace(/\//g, "-")}.png` });
    if (problems.length) {
      failed += 1;
      console.log(`  FAIL ${path.padEnd(13)} ${problems.join("; ")}`);
    } else {
      console.log(`  ok  ${path}`);
    }
  }
  console.log(
    failed
      ? `\nFAIL — ${failed} of ${sitePaths.length} signed-out page(s) put the bar under the clock at --safe-top: ${top}`
      : `\nok — every signed-out bar starts below the clock at --safe-top: ${top} (${width} × ${height})`,
  );
  return failed;
}
