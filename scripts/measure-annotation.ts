/**
 * How much of a gesture in the reading view the **annotation pipeline** costs.
 *
 * This is the instrument's other half. `src/web/annotation-cost.ts` records the
 * numbers inside the browser; this drives the browser, performs the gestures,
 * and reads them out. It is the measurement behind § Stage 1a of
 * docs/plans/260905i-measure-annotation-computation-before-optimising-it.md, and
 * it is committed rather than thrown away for two reasons: **Stage 3 has to run
 * the same measurement again** to show the optimisation worked, and a number
 * nobody can re-run is a number nobody can check (GPT Sol's F19, 2026-09-06 —
 * the original harness lived in a scratchpad and only its medians survived).
 *
 * ## What it measures
 *
 * For each gesture, twice: **end-to-end** — the wall clock from the event to two
 * animation frames later, which is roughly what the reader feels — and
 * **attributable**, `marksByBlock.ms + proseHtml.ms`, the two `useMemo`s in
 * TableView.tsx that own the annotation work. The pair is the point. An
 * end-to-end figure alone says a gesture is slow and nothing about whose fault
 * it is, and optimising on it is guessing.
 *
 * Every repetition is printed, not just the summary. "Stable across samples" is
 * a claim, and a claim needs the samples.
 *
 * ## What it cannot see
 *
 * - **Everything outside those two memos.** React reconciliation and commit, the
 *   live DOM's `innerHTML` parse, style, layout, paint, the geometry reads, and
 *   the dialog's or panel's own work are all in the end-to-end number and in
 *   none of the attributable one. The residual is *not* attributed here, and
 *   should not be attributed elsewhere on this evidence.
 * - **Anything asynchronous that lands after two frames.** A gesture that
 *   kicks off a fetch is measured up to the paint, not to the answer.
 * - **The reader's machine.** This is one Chrome on one box, and wall clock
 *   includes whatever else that box was doing. Hence the repetitions.
 *
 * ## `"counts"` mode leaf `ms` values are not measurements
 *
 * The default mode is `"counts"`, in which the four leaf sites increment their
 * call count and **deliberately never read the clock** — leaf timing would add
 * over a thousand `performance.now()` reads inside the very interval it is
 * meant to explain. So a leaf `ms` of 0 in the output below means "not timed",
 * not "free". Only the call counts are meaningful in that mode, and the header
 * of `src/web/annotation-cost.ts` is the long version of why. `--mode full`
 * turns the leaf timers on for a *diagnostic* run whose absolute numbers are
 * perturbed upward, unevenly between sites, and are never the numbers a
 * decision is applied to.
 *
 * ## Two things that are not obvious, both learned the hard way
 *
 * 1. **Every `page.evaluate` here is passed a *string*, never a closure.**
 *    tsx/esbuild injects `__name(...)` helper calls into named function
 *    expressions when it compiles this file, those calls travel inside the
 *    function source Playwright serialises to the browser, and `__name` does
 *    not exist there: `ReferenceError: __name is not defined`, on every single
 *    closure-based `evaluate`. A string literal never goes through that
 *    transform. Do not "tidy" these back into arrow functions.
 * 2. **Signing in needs a dev-server origin, even when measuring a production
 *    build.** The sign-in trick imports `/src/web/lib/supabase.ts` so the app's
 *    own SDK stores the session in the shape its own version reads, and only a
 *    dev server serves a module at its source path — `vite preview` throws.
 *    So `--sign-in-via <dev origin>` signs in there and carries the stored keys
 *    to `--url`'s origin. Same shape and the same guards as `--sign-in-via` in
 *    scripts/measure-cpu.ts; read that file for the reasoning at length.
 *
 * ## Usage
 *
 *     # a production build under `vite preview` on 5290, signed in via the dev
 *     # server on 5274, the gesture set Stage 1a used
 *     npx tsx scripts/measure-annotation.ts --slug some-article \
 *       --url http://localhost:5290 \
 *       --local-sign-in --sign-in-via http://localhost:5274 --email me@example.com
 *
 *     # the diagnostic breakdown, one gesture, raw samples to a file
 *     npx tsx scripts/measure-annotation.ts --slug some-article --url http://localhost:5290 \
 *       --gestures glossary --mode full --json /tmp/annotation.json
 *
 * `?perf=1` is appended to every URL by this script — it is what switches the
 * probe on. If `window.__perf` is missing, or the page has no blocks, this
 * **refuses to report** rather than printing zeroes. Silent zeroes are the
 * failure the whole instrument exists to avoid
 * (docs/reusable/silent-success.md).
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

import { chromePath } from "./browser-sign-in.js";
import { localMagicLink } from "./seed-local-session.js";

/**
 * A flag's value, where **another flag is not a value** — copied from
 * scripts/measure-cpu.ts, which explains what `--json --slug x` used to do.
 */
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? fallback : next;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * Refuse to carry a real session anywhere but this machine. Parsed hostname
 * rather than a substring, for scripts/seed-local-session.ts's reason:
 * `http://localhost.attacker.example/` contains "localhost" and is not it.
 */
function assertLocalOrigin(u: string, flagName: string): void {
  const { hostname, protocol } = new URL(u);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!local || (protocol !== "http:" && protocol !== "https:")) {
    throw new Error(
      `${flagName} points at ${u} — a session may only be carried between local origins`,
    );
  }
}

/** One site's numbers, as `annotationCost()` hands them out. */
interface Tally {
  n: number;
  ms: number;
  maxMs: number;
}

/** The snapshot. `mode` first, always — it is what says whether the rest means
 *  anything. See src/web/annotation-cost.ts § Three states, not two. */
interface Cost {
  mode: "off" | "counts" | "full";
  renderedText: Tally;
  resolveMark: Tally;
  annotateHtml: Tally;
  addZoomHandles: Tally;
  marksByBlock: Tally;
  proseHtml: Tally;
}

/** One repetition: what the reader waited, and what annotation spent. */
interface Sample {
  ms: number;
  cost: Cost;
}

/** A repetition that could not be taken. Kept rather than dropped, because
 *  "four of six errored" is the interesting half of a suspiciously fast run. */
interface Failed {
  error: string;
}

type Attempt = Sample | Failed;

const failed = (a: Attempt): a is Failed => "error" in a;

/** What is actually on the page, counted before anything is timed. */
interface Population {
  blocks: number;
  termMarks: number;
  distinctTerms: number;
  commentMarks: number;
  distinctComments: number;
  totalNodes: number;
}

/** The prelude every gesture expression starts with: two frames is "painted". */
const RAF_HELPERS = `
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const nextPaint = async () => { await raf(); await raf(); };
`;

/**
 * `page.evaluate` with the result parsed.
 *
 * The expression must be a **string** and must return a JSON string — see the
 * header. Returning JSON rather than an object also dodges Playwright's
 * structured-clone of a live snapshot object.
 */
async function evalJson<T>(page: Page, code: string): Promise<T> {
  const raw = await page.evaluate<string>(code);
  return JSON.parse(raw) as T;
}

/**
 * One gesture: where it happens, what has to be on the page for it to mean
 * anything, and the expression that performs and times it.
 */
interface Gesture {
  /** How the run reports it. */
  readonly label: string;
  /** Query appended after `?perf=1`, if the gesture needs a mode. */
  readonly query: string;
  /** Waited for after navigating; absent means the page never got there. */
  readonly waitFor: string;
  /** Why this gesture would be meaningless on this article, or null. */
  readonly refuseIf: (p: Population) => string | null;
  /** The expression, given the repetition index. */
  readonly expression: (i: number) => string;
}

/**
 * The measured region, shared by every gesture.
 *
 * `resetAnnotationCost()` immediately before `t0` is what makes the two numbers
 * comparable: both start at the same instant, and the snapshot afterwards
 * belongs to this gesture alone rather than to the page's whole life.
 */
function timedGesture(body: string): string {
  return `(async () => {
    ${RAF_HELPERS}
    try {
      ${body}
    } catch (e) { return JSON.stringify({ error: 'threw: ' + (e && e.message) }); }
  })()`;
}

/** Click something, and time the frame it causes. */
function clickGesture(selector: string, i: number): string {
  return timedGesture(`
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${i}];
    if (!el) return JSON.stringify({ error: 'no ${selector} at index ${i} (found ' + els.length + ')' });
    await nextPaint();
    window.__perf.resetAnnotationCost();
    const t0 = performance.now();
    el.click();
    await nextPaint();
    const t1 = performance.now();
    return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost() });`);
}

/**
 * The five gestures Stage 1a used. The first three move marks and are the ones
 * the decision rule was applied to; the last two are controls — a keystroke and
 * a hover should charge annotation nothing, and a run where they *do* is
 * evidence about the run rather than about the gesture.
 */
const GESTURES: Readonly<Record<string, Gesture>> = {
  glossary: {
    label: "press a glossary term",
    query: "&mode=glossary",
    waitFor: ".gloss-term-btn",
    refuseIf: (p) => (p.termMarks === 0 ? "the article has no glossary terms" : null),
    expression: (i) => clickGesture(".gloss-term-btn", i),
  },
  "comment-open": {
    label: "open a comment",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.commentMarks === 0 ? "the article has no stored comments" : null),
    /* `mouseup` rather than `click`: that is the event the mark listens for. */
    expression: () =>
      timedGesture(`
        const el = document.querySelector('mark[data-comment]');
        if (!el) return JSON.stringify({ error: 'no mark[data-comment] on the page' });
        document.querySelector('.cmt-close')?.click();
        await nextPaint();
        window.__perf.resetAnnotationCost();
        const t0 = performance.now();
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        await nextPaint();
        const t1 = performance.now();
        return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost() });`),
  },
  "comment-close": {
    label: "close a comment",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.commentMarks === 0 ? "the article has no stored comments" : null),
    /* Opens first, untimed, so the gesture is self-contained: a "close" that
       silently measured a no-op because nothing was open would be the flattering
       kind of wrong. It refuses instead. */
    expression: () =>
      timedGesture(`
        const el = document.querySelector('mark[data-comment]');
        if (!el) return JSON.stringify({ error: 'no mark[data-comment] on the page' });
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        await nextPaint();
        await new Promise((r) => setTimeout(r, 250));
        const close = document.querySelector('.cmt-close');
        if (!close) return JSON.stringify({ error: 'nothing opened, so there is nothing to close' });
        await nextPaint();
        window.__perf.resetAnnotationCost();
        const t0 = performance.now();
        close.click();
        await nextPaint();
        const t1 = performance.now();
        return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost() });`),
  },
  keystroke: {
    label: "one keystroke in the find box",
    query: "&mode=search&match=words",
    waitFor: 'input[aria-label="Find these words"]',
    refuseIf: () => null,
    expression: () =>
      timedGesture(`
        const input = document.querySelector('input[aria-label="Find these words"]');
        if (!input) return JSON.stringify({ error: 'no find box on the page' });
        input.focus();
        await nextPaint();
        window.__perf.resetAnnotationCost();
        const t0 = performance.now();
        input.value += 'x';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextPaint();
        const t1 = performance.now();
        return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost() });`),
  },
  hover: {
    label: "hover across two rows",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.blocks < 4 ? "fewer than four blocks to hover between" : null),
    expression: () =>
      timedGesture(`
        const rows = document.querySelectorAll('tr[data-block]');
        const a = rows[Math.floor(rows.length * 0.3)]?.querySelector('.prose');
        const b = rows[Math.floor(rows.length * 0.31)]?.querySelector('.prose');
        if (!a || !b) return JSON.stringify({ error: 'no .prose in the sample rows' });
        await nextPaint();
        window.__perf.resetAnnotationCost();
        const t0 = performance.now();
        a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        await nextPaint();
        b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        await nextPaint();
        const t1 = performance.now();
        return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost() });`),
  },
};

/** The set Stage 1a used, in the order it reported them. */
const DEFAULT_GESTURES = ["glossary", "comment-open", "comment-close", "keystroke", "hover"];

const num = (n: number, places = 2): string => n.toFixed(places);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const attributable = (c: Cost): number => c.marksByBlock.ms + c.proseHtml.ms;

/**
 * Load the article, prove the probe is live, and count what is on the page.
 *
 * **The counting is not a nicety.** A gesture timed over an article with no
 * marks charges annotation nothing, correctly, and reads exactly like an
 * article where annotation is free. Every run therefore says how many blocks
 * and marks it was looking at, and refuses outright when the answer is none.
 */
async function landAndCount(page: Page, url: string, waitFor: string): Promise<Population> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (e) {
    throw new Error(
      `could not reach ${url} — ${(e as Error).message}\n` +
        "  Is the server running, and on that port? `npm run dev` moves ports\n" +
        "  when another worktree holds 5273 (docs/project/browser-testing.md).",
    );
  }
  await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => {
    throw new Error(
      `${url} never rendered ${waitFor}.\n` +
        "  A signed-out page renders fine and costs nothing, which reads as a\n" +
        "  good result — pass --local-sign-in --sign-in-via <dev origin>.",
    );
  });
  /* The app settles after first paint — fetches land, memos re-run. Measuring
     through that measures the page load, which is the easiest way to measure
     the wrong thing (scripts/measure-cpu.ts § --settle). */
  await page.waitForTimeout(2000);

  const live = await evalJson<{ has: boolean; mode: string | null }>(
    page,
    `JSON.stringify({ has: !!window.__perf,
      mode: window.__perf ? window.__perf.annotationCost().mode : null })`,
  );
  if (!live.has) {
    throw new Error(
      `window.__perf is not defined on ${url} — nothing was measured.\n` +
        "  The probe is switched on by ?perf=1, which this script appends; if it\n" +
        "  is still absent the page is not the reading view, or the build predates\n" +
        "  src/web/perf.ts § startPerf.",
    );
  }
  if (live.mode === "off") {
    throw new Error(
      "window.__perf is present but the annotation probe reports mode \"off\" —\n" +
        "  every number would be a zero that means nothing. See\n" +
        "  src/web/annotation-cost.ts § Three states, not two.",
    );
  }

  return evalJson<Population>(
    page,
    `JSON.stringify({
      blocks: document.querySelectorAll('tr[data-block]').length,
      termMarks: document.querySelectorAll('mark[data-term]').length,
      distinctTerms: new Set([...document.querySelectorAll('mark[data-term]')]
        .flatMap((m) => (m.getAttribute('data-term') || '').split(' ').filter(Boolean))).size,
      commentMarks: document.querySelectorAll('mark[data-comment]').length,
      distinctComments: new Set([...document.querySelectorAll('mark[data-comment]')]
        .flatMap((m) => (m.getAttribute('data-comment') || '').split(' ').filter(Boolean))).size,
      totalNodes: document.querySelectorAll('*').length,
    })`,
  );
}

/** Everything one gesture produced, kept whole so `--json` can carry it. */
interface GestureRun {
  key: string;
  label: string;
  refused?: string;
  attempts: Attempt[];
}

/**
 * Print one gesture, raw samples first.
 *
 * The **raw vector** is the whole point of this function: Stage 1a's write-up
 * kept only medians, so "stable across samples" could not be checked by anybody
 * who had not been in the room (Sol F19). The summary lines are a convenience
 * on top of evidence that is present either way.
 */
function report(run: GestureRun, warmup: number): void {
  console.log(`\n── ${run.label} ${"─".repeat(Math.max(0, 46 - run.label.length))}`);
  if (run.refused) {
    console.log(`  REFUSED: ${run.refused} — this gesture measures nothing here.`);
    return;
  }
  const bad = run.attempts.filter(failed);
  if (bad.length > 0) console.log(`  ⚠ ${bad.length} repetition(s) errored — ${bad[0]?.error}`);
  const good = run.attempts.filter((a): a is Sample => !failed(a));
  if (good.length === 0) {
    console.log("  NO USABLE SAMPLES — nothing is reported, because nothing was measured.");
    return;
  }

  const shown = good.map((s, i) => (i < warmup ? `(${num(s.ms, 1)})` : num(s.ms, 1)));
  const shownAttr = good.map((s, i) =>
    i < warmup ? `(${num(attributable(s.cost))})` : num(attributable(s.cost)),
  );
  /* Warm-ups counted among the *usable* samples rather than by repetition
     number, so an errored first attempt does not silently promote a cold run
     into the summary. */
  console.log(`  every usable repetition; the first ${warmup} is a warm-up, bracketed and excluded:`);
  console.log(`    end-to-end ms    ${shown.join("  ")}`);
  console.log(`    attributable ms  ${shownAttr.join("  ")}`);

  const warmed = good.slice(warmup);
  if (warmed.length === 0) {
    console.log(`  every sample was a warm-up — raise --repeats above ${warmup}.`);
    return;
  }
  const e2e = warmed.map((s) => s.ms);
  const attr = warmed.map((s) => attributable(s.cost));
  /* **Per-run shares, then their median** — not a ratio of two separate
     medians, which pairs numbers from different runs (Sol F16). */
  const shares = warmed.map((s) => (s.ms > 0 ? (attributable(s.cost) / s.ms) * 100 : 0));
  const last = warmed[warmed.length - 1]?.cost;
  const mode = last?.mode ?? "?";
  console.log(
    `  warmed (${warmed.length}): end-to-end min/med/max ${num(Math.min(...e2e), 1)}/` +
      `${num(median(e2e), 1)}/${num(Math.max(...e2e), 1)} ms` +
      `   attributable [${mode}] ${num(Math.min(...attr))}/${num(median(attr))}/` +
      `${num(Math.max(...attr))} ms`,
  );
  console.log(`  annotation's share of the gesture: ${num(median(shares), 1)}% (median per-run)`);
  if (!last) return;
  console.log(
    `  leaf calls (last warmed run): renderedText=${last.renderedText.n}` +
      ` resolveMark=${last.resolveMark.n} annotateHtml=${last.annotateHtml.n}` +
      ` addZoomHandles=${last.addZoomHandles.n}`,
  );
  if (mode === "full") {
    console.log(
      `  leaf ms [DIAGNOSTIC, perturbed]: renderedText=${num(last.renderedText.ms)}` +
        ` resolveMark=${num(last.resolveMark.ms)} annotateHtml=${num(last.annotateHtml.ms)}` +
        ` addZoomHandles=${num(last.addZoomHandles.ms)}`,
    );
  } else {
    console.log("  leaf ms: not read in \"counts\" mode — those zeroes are not measurements.");
  }
  console.log(
    `  memo maxMs (worst single call at each site, NOT one render's cost —` +
      ` see annotation-cost.ts): marksByBlock=${num(last.marksByBlock.maxMs)}` +
      ` proseHtml=${num(last.proseHtml.maxMs)}`,
  );
}

/** Everything the command line said, validated before Chrome is launched. */
interface Options {
  slug: string;
  base: string;
  repeats: number;
  warmup: number;
  mode: "counts" | "full";
  json: string;
  wanted: string[];
  via: string;
}

/**
 * Read and check the flags, and **fail before launching a browser**. A bad
 * `--warmup` discovered after a sign-in and a 20-second page load is a bad
 * `--warmup` discovered a minute late.
 */
function options(): Options {
  const slug = flag("slug", "");
  if (!slug) throw new Error("--slug is required — which article to measure");
  const base = flag("url", "http://localhost:5290").replace(/\/$/, "");
  new URL(base); // throws on a --url that is not one
  const repeats = Number(flag("repeats", "6"));
  const warmup = Number(flag("warmup", "1"));
  const mode = flag("mode", "counts");
  const wanted = flag("gestures", DEFAULT_GESTURES.join(",")).split(",").filter(Boolean);

  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(`--repeats ${repeats} is not a count`);
  }
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error(`--warmup ${warmup} is not a count`);
  if (warmup >= repeats) {
    throw new Error(`--warmup ${warmup} discards every one of --repeats ${repeats}`);
  }
  if (mode !== "counts" && mode !== "full") {
    throw new Error(`--mode ${mode} is neither "counts" nor "full"`);
  }
  const unknown = wanted.filter((g) => !(g in GESTURES));
  if (unknown.length > 0) {
    throw new Error(
      `unknown gesture(s) ${unknown.join(", ")} — known: ${Object.keys(GESTURES).join(", ")}`,
    );
  }
  return {
    slug,
    base,
    repeats,
    warmup,
    mode,
    json: has("json") ? flag("json", "") : "",
    wanted,
    via: flag("sign-in-via", ""),
  };
}

/**
 * Sign in on a dev-server origin and carry the session to where we measure.
 *
 * The header's point 2, in code. Both origins are asserted local separately,
 * because they are separately dangerous — scripts/measure-cpu.ts says why at
 * length, and that reasoning is not repeated here.
 */
async function signInAndCarry(page: Page, o: Options, hashedToken: string): Promise<void> {
  const origin = new URL(o.via || o.base).origin;
  assertLocalOrigin(origin, o.via ? "--sign-in-via" : "--url");
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const said = await page.evaluate<string>(`(async () => {
    try {
      const m = await import('/src/web/lib/supabase.ts');
      const r = await m.supabase.auth.verifyOtp({
        type: 'magiclink', token_hash: ${JSON.stringify(hashedToken)} });
      if (r.error) return 'error: ' + r.error.message;
      return r.data.session ? 'ok:' + (r.data.user?.email ?? '?') : 'no session';
    } catch (e) { return 'threw: ' + (e && e.message); }
  })()`);
  if (!said.startsWith("ok:")) {
    throw new Error(
      `local sign-in failed — ${said}\n` +
        "  This step needs a **dev server** origin: it imports the app's own SDK\n" +
        "  at /src/web/lib/supabase.ts, which `vite preview` does not serve.\n" +
        "  Pass --sign-in-via <dev origin> when --url is a preview build.",
    );
  }
  console.log(`signed in locally (${said.slice(3)})`);

  const target = new URL(o.base).origin;
  if (origin === target) return;
  assertLocalOrigin(target, "--url");
  const dump = await page.evaluate<string>(
    `JSON.stringify(Object.fromEntries(Object.entries(localStorage)
      .filter(([k]) => k.startsWith('sb-') || k === 'spideryarn.lastUser')))`,
  );
  const carried = JSON.parse(dump) as Record<string, string>;
  const keys = Object.keys(carried);
  if (keys.length === 0) throw new Error("nothing to carry — the SDK stored no session");
  /* Blank page on the target origin first: `localStorage` is per origin, so
     this has to be written while standing on the origin that reads it. */
  await page.goto(`${target}/favicon.ico`, { waitUntil: "domcontentloaded" });
  await page.evaluate(`(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
    for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`);
  console.log(`carried ${keys.length} storage keys to ${target}`);
}

/** Take every requested gesture, in order, on a page already signed in. */
async function runGestures(page: Page, o: Options, population: Population): Promise<GestureRun[]> {
  const runs: GestureRun[] = [];
  for (const key of o.wanted) {
    const g = GESTURES[key];
    if (!g) continue; // unreachable: `options()` validated the names
    const refused = g.refuseIf(population);
    if (refused) {
      runs.push({ key, label: g.label, refused, attempts: [] });
      continue;
    }
    await landAndCount(page, `${o.base}/read/${o.slug}?perf=1${g.query}`, g.waitFor);
    /* Set **after** the navigation: a fresh load re-runs startPerf(), which puts
       the mode back to "counts", so setting it before goto() is a no-op that
       silently produces a "counts" run labelled as a diagnostic. */
    if (o.mode === "full") await page.evaluate(`window.__perf.setAnnotationCostMode('full')`);
    const attempts: Attempt[] = [];
    for (let i = 0; i < o.repeats; i++) {
      attempts.push(await evalJson<Attempt>(page, g.expression(i)));
      await page.waitForTimeout(300);
    }
    runs.push({ key, label: g.label, attempts });
  }
  return runs;
}

async function main(): Promise<void> {
  if (has("help")) {
    console.log(
      "npx tsx scripts/measure-annotation.ts --slug <slug> [--url http://localhost:5290]\n" +
        "  --gestures glossary,comment-open,comment-close,keystroke,hover\n" +
        "  --repeats 6   --warmup 1   --mode counts|full   --json out.json\n" +
        "  --local-sign-in --sign-in-via http://localhost:5274 --email you@example.com\n" +
        `  known gestures: ${Object.keys(GESTURES).join(", ")}`,
    );
    return;
  }

  const o = options();
  /* Minted before the browser, so a missing .env.local or a stopped Supabase
     fails in a second rather than after a browser launch. */
  const link = has("local-sign-in") ? await localMagicLink(o.via || o.base) : null;

  console.log(
    `measuring ${o.base}/read/${o.slug}  mode=${o.mode}  repeats=${o.repeats} (${o.warmup} warm-up)`,
  );
  if (o.mode === "full") {
    console.log(
      'DIAGNOSTIC RUN: "full" adds two clock reads per leaf call, unevenly between\n' +
        "sites, so the absolute numbers and the split are perturbed upward. Call\n" +
        "counts are not perturbed. Do not apply a decision rule to these.",
    );
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath: chromePath(), headless: !has("display") });
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);
    page.on("pageerror", (e: Error) => console.log("[pageerror]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[console:error]", m.text());
    });

    if (link) await signInAndCarry(page, o, link.hashedToken);

    const { slug, base, warmup, mode, repeats, json } = o;
    /* Population once, on a plain load, before any gesture. */
    const population = await landAndCount(page, `${base}/read/${slug}?perf=1`, "tr[data-block]");
    console.log(
      `\nPOPULATION  blocks=${population.blocks}` +
        `  term marks=${population.termMarks} (${population.distinctTerms} distinct)` +
        `  comment marks=${population.commentMarks} (${population.distinctComments} distinct)` +
        `  nodes=${population.totalNodes}`,
    );
    if (population.blocks === 0 || population.totalNodes === 0) {
      throw new Error(
        `${base}/read/${slug} has ${population.blocks} blocks and ${population.totalNodes} nodes —\n` +
          "  refusing to report timings over an empty page. Every number would be a\n" +
          "  zero, and a zero here reads as \"annotation is free\".",
      );
    }

    const runs = await runGestures(page, o, population);
    for (const run of runs) report(run, warmup);

    if (json) {
      writeFileSync(
        json,
        JSON.stringify({ slug, base, mode, repeats, warmup, population, runs }, null, 2),
      );
      console.log(`\nwrote ${json}`);
    }

    /* A refused or empty gesture is a failed run, said in the exit code as well
       as on screen — a summary nobody read is how a zero gets quoted later. */
    const empty = runs.filter((r) => r.refused || r.attempts.every(failed));
    if (empty.length > 0) {
      console.log(
        `\n${empty.length} of ${runs.length} gesture(s) produced nothing: ` +
          empty.map((r) => r.key).join(", "),
      );
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
  }
}

main().catch((e: Error) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
