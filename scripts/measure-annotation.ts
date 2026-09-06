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
 * ## Three things that are not obvious, all learned the hard way
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
 * 3. **An element grabbed before a paint may not survive it, and a dispatch at
 *    a detached node is a successful call that does nothing.** Opening or
 *    closing a comment genuinely rewrites that block's HTML — the open flag
 *    lives in the mark itself — so a reference taken before the setup click has
 *    been replaced by the time the timed dispatch happens. No listener runs, no
 *    render follows, nothing throws, and the repetition is recorded as a
 *    gesture that cost **exactly zero**. It showed up as an attributable vector
 *    of `[25.6, 0, 22.4, 0, 35.3, 0]` — alternating real samples and exact
 *    zeroes, on *both* arms of an A/B, and was nearly taken for a property of
 *    the code. Hence: every gesture re-queries its target after the last paint
 *    and immediately before dispatching, and nothing may `await` between that
 *    query and the dispatch.
 *
 * ## A gesture that did nothing must not be reportable as a fast one
 *
 * Re-querying fixes the bug above; it does not fix the class. A no-op and a
 * free operation produce the same number, and this script exists to produce
 * numbers somebody will act on. So each gesture **declares what must become
 * true afterwards that was not true before** — an `Effect`: a small in-page
 * probe read either side of the timed region, and a pure predicate over the two
 * readings, `happened(before, after)`.
 *
 * The predicate lives here in TypeScript rather than inside the `evaluate`
 * string, deliberately: a branch buried in a browser expression can only be
 * checked by running a browser, and this one is now the check the whole
 * instrument rests on.
 * `tests/a-gesture-that-did-nothing-is-not-a-fast-one.test.ts` calls it
 * directly. A repetition whose declared effect did not occur is a **failed
 * sample**, printed in its own column as `FAILED`, with its repetition number
 * and both readings — never a fast one, and never quietly dropped into a
 * filtered median either, which is the same failure wearing a hat.
 *
 * Two backstops behind it, each computed a different way, because a check that
 * shares an assumption with the code agrees with it
 * (docs/reusable/silent-success.md):
 *
 * - every sample carries the **render delta** from `window.__perf.state`, which
 *   knows nothing about marks or attributes;
 * - an **exactly-zero attributable** sample on a gesture that is supposed to
 *   re-annotate blocks is marked suspect, kept out of the summary, and pushes
 *   the exit code to 1.
 *
 * `hover` is the one gesture that declares **no** effect — a pointer crossing
 * prose changes no attribute — and the report says so on its own line rather
 * than letting its zero pass for evidence.
 *
 * **Two controls were strengthened at the same time, so their Stage 1a numbers
 * are not strictly comparable.** The keystroke types through
 * `HTMLInputElement.prototype`'s value setter, because React ignores a value
 * assigned through the element itself; and the hover sends
 * `pointerType: 'mouse'`, the only kind `useHoverCard` acts on. Both were
 * gestures that might never have reached the app at all — the same class as the
 * bug above, found while looking for it. If a control's end-to-end figure moves
 * against Stage 1a, that is why, and the new one is the honest one.
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
 * **refuses to report** rather than printing zeroes — and the same refusal now
 * applies one repetition at a time. Silent zeroes are the failure the whole
 * instrument exists to avoid (docs/reusable/silent-success.md).
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

import { isMain } from "../src/is-main.js";
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
export interface Cost {
  mode: "off" | "counts" | "full";
  renderedText: Tally;
  resolveMark: Tally;
  annotateHtml: Tally;
  addZoomHandles: Tally;
  marksByBlock: Tally;
  proseHtml: Tally;
}

/**
 * One repetition: what the reader waited, what annotation spent, and the
 * evidence that the gesture happened at all.
 */
export interface Sample {
  /** 1-based — the number a reader counts when reading the vectors below. */
  rep: number;
  ms: number;
  cost: Cost;
  /** The declared effect's probe, read either side of the timed region. */
  before: string;
  after: string;
  /** Component bodies `useRenderCount` saw during the gesture (src/web/perf.ts).
   *  A witness of a different kind: it knows nothing about marks. */
  renders: number;
}

/** A repetition that could not be taken, or that did not happen. Kept rather
 *  than dropped, because "four of six errored" is the interesting half of a
 *  suspiciously fast run. */
export interface Failed {
  rep: number;
  error: string;
}

export type Attempt = Sample | Failed;

/** What the in-page expression hands back: everything a `Sample` needs bar the
 *  repetition number, which only this side knows — or why there is none. */
type Raw = { error: string } | Omit<Sample, "rep">;

export const failed = (a: Attempt): a is Failed => "error" in a;

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
 * What must become true for the gesture to have happened at all.
 *
 * **The decision is here and not in the browser.** The page reports two
 * readings; this file judges them. See the header § A gesture that did nothing.
 */
export interface Effect {
  /** Said back in the failure message, so a wrong guess about the DOM reads as
   *  a wrong guess rather than as a mystery. */
  readonly describe: string;
  /** In-page expression evaluating to a string, read before and after. */
  readonly probe: string;
  /** Pure, and testable without a browser. */
  readonly happened: (before: string, after: string) => boolean;
}

/* The three shapes of `happened` this file needs. `Number("")` is 0 and
   `Number("x")` is NaN, and every comparison with NaN is false — so a probe
   that broke fails the check rather than passing it. */
const grew = (before: string, after: string): boolean => Number(after) > Number(before);
const shrank = (before: string, after: string): boolean => Number(after) < Number(before);
const moved = (before: string, after: string): boolean => after !== before;

/** How many comment marks are drawn as pressed. `src/web/annotate.ts` sets
 *  `data-cmt-open` on exactly the mark whose comment is open. */
const OPEN_COMMENTS = `String(document.querySelectorAll('mark[data-cmt-open]').length)`;

/** *Which* glossary terms are drawn as pressed — a set, not a count, because a
 *  press both selects one term and deselects the last, and a count would not
 *  move. */
const OPEN_TERMS = `JSON.stringify([...new Set([...document.querySelectorAll('mark[data-term-open]')]
    .map((m) => m.getAttribute('data-term') || ''))].sort())`;

/** How much text is in the find box. `-1` when the box has gone, which no
 *  comparison can read as growth. */
const FIND_LENGTH = `String(document.querySelector('input[aria-label="Find these words"]')?.value.length ?? -1)`;

/** What a gesture is entitled to charge nothing for. A control's zero is the
 *  result; a mark-moving gesture's zero is a bug until proved otherwise. */
export interface Expects {
  /** Must the annotation pipeline do measurable work? */
  readonly work: boolean;
  /** Must at least one instrumented React component re-render? */
  readonly render: boolean;
}

/**
 * One gesture: where it happens, what has to be on the page for it to mean
 * anything, what must be true afterwards, and the expression that performs and
 * times it.
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
  /** What it must have cost, before any of its numbers is quoted. */
  readonly expects: Expects;
  /** What must change for the gesture to have happened. `null` only where
   *  nothing observable does — and the report says so out loud. */
  readonly effect: Effect | null;
  /** The expression, given the repetition index. */
  readonly expression: (i: number) => string;
}

/**
 * The measured region, shared by every gesture.
 *
 * `resetAnnotationCost()` immediately before `t0` is what makes the two numbers
 * comparable: both start at the same instant, and the snapshot afterwards
 * belongs to this gesture alone rather than to the page's whole life.
 *
 * **The order of the four parts is the point**, and it is enforced here rather
 * than trusted to each gesture: `setup` may await as much as it likes, `grab`
 * runs after the last paint, and nothing between `grab` and `act` awaits. A
 * reference carried across a paint can be a detached node by the time it is
 * dispatched at, and that dispatch is a successful call that does nothing —
 * header § Three things, point 3.
 */
function timedGesture(parts: {
  /** Statements putting the page in the state the gesture starts from. May await. */
  readonly setup?: string;
  /** Statements re-querying the target and refusing a detached one. No awaits. */
  readonly grab: string;
  /** Statements that dispatch. Anything re-queried after an await in here
   *  carries its own `isConnected` check — see `hover`. */
  readonly act: string;
  /** The effect's probe expression, or null where a gesture declares none. */
  readonly probe: string | null;
}): string {
  const probe = parts.probe ?? `'(no effect declared)'`;
  return `(async () => {
    ${RAF_HELPERS}
    const renders = () => window.__perf.state.visible.renders + window.__perf.state.hidden.renders;
    try {
      ${parts.setup ?? ""}
      await nextPaint();
      ${parts.grab}
      const before = String(${probe});
      const r0 = renders();
      window.__perf.resetAnnotationCost();
      const t0 = performance.now();
      ${parts.act}
      await nextPaint();
      const t1 = performance.now();
      return JSON.stringify({ ms: t1 - t0, cost: window.__perf.annotationCost(),
        before, after: String(${probe}), renders: renders() - r0 });
    } catch (e) { return JSON.stringify({ error: 'threw: ' + (e && e.message) }); }
  })()`;
}

/**
 * Re-query, and refuse to dispatch at a node the last paint may have replaced.
 *
 * Both halves earn their place. The re-query is the fix; `isConnected` is the
 * alarm for the next way this goes wrong — a reference that goes stale between
 * the query and the dispatch, which is exactly what `comment-open` used to do.
 * `querySelector` cannot itself return a detached node, so on the paths below
 * the assertion is a backstop rather than a live check; it is what makes a
 * future two-step gesture fail loudly instead of quietly measuring nothing.
 */
function grabbed(name: string, expr: string, what: string): string {
  const w = JSON.stringify(what);
  return `
    const ${name} = ${expr};
    if (!${name}) return JSON.stringify({ error: 'nothing matched ' + ${w} });
    if (!${name}.isConnected) return JSON.stringify({ error: ${w} +
      ' is detached from the document — a dispatch at it would do nothing and be timed as free' });`;
}

/** Click the i-th match, timed — and re-queried at the moment of the click. */
function clickGesture(selector: string, i: number, probe: string | null): string {
  const sel = JSON.stringify(selector);
  return timedGesture({
    grab: `
    const els = document.querySelectorAll(${sel});
    const el = els[${i}];
    if (!el) return JSON.stringify({ error: 'no ' + ${sel} + ' at index ${i} (found ' + els.length + ')' });
    if (!el.isConnected) return JSON.stringify({ error: ${sel} +
      ' at index ${i} is detached — a click on it would do nothing and be timed as free' });`,
    act: "el.click();",
    probe,
  });
}

/**
 * The five gestures Stage 1a used. The first three move marks and are the ones
 * the decision rule was applied to; the last two are controls — a keystroke and
 * a hover should charge annotation nothing, and a run where they *do* is
 * evidence about the run rather than about the gesture.
 */
export const GESTURES: Readonly<Record<string, Gesture>> = {
  glossary: {
    label: "press a glossary term",
    query: "&mode=glossary",
    waitFor: ".gloss-term-btn",
    refuseIf: (p) => (p.termMarks === 0 ? "the article has no glossary terms" : null),
    expects: { work: true, render: true },
    /* *Moves*, not appears: each repetition presses a different term, so the
       press both lights one set of marks and puts out the last. */
    effect: {
      describe: "the set of mark[data-term-open] terms moves",
      probe: OPEN_TERMS,
      happened: moved,
    },
    expression: (i) => clickGesture(".gloss-term-btn", i, OPEN_TERMS),
  },
  "comment-open": {
    label: "open a comment",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.commentMarks === 0 ? "the article has no stored comments" : null),
    expects: { work: true, render: true },
    effect: {
      describe: "a mark[data-cmt-open] appears",
      probe: OPEN_COMMENTS,
      happened: grew,
    },
    /* `mouseup` rather than `click`: that is the event the mark listens for.
       The close first, so every repetition times an *open* rather than a
       toggle — and the mark is grabbed **after** that close and its settle,
       because closing replaces the very node we are about to dispatch at.
       Grabbing it first is the bug in the header, and it produced a clean
       alternating vector of real samples and exact zeroes. */
    expression: () =>
      timedGesture({
        setup: `
        document.querySelector('.cmt-close')?.click();
        await nextPaint();
        await new Promise((r) => setTimeout(r, 250));`,
        grab: grabbed("el", `document.querySelector('mark[data-comment]')`, "mark[data-comment]"),
        act: `el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));`,
        probe: OPEN_COMMENTS,
      }),
  },
  "comment-close": {
    label: "close a comment",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.commentMarks === 0 ? "the article has no stored comments" : null),
    expects: { work: true, render: true },
    /* `shrank` needs a `before` above zero to be satisfiable at all, so a setup
       that silently failed to open anything cannot pass this. */
    effect: {
      describe: "the mark[data-cmt-open] goes away",
      probe: OPEN_COMMENTS,
      happened: shrank,
    },
    /* Opens first, untimed, so the gesture is self-contained: a "close" that
       silently measured a no-op because nothing was open would be the flattering
       kind of wrong. It refuses instead. */
    expression: () =>
      timedGesture({
        setup: `
        ${grabbed("opener", `document.querySelector('mark[data-comment]')`, "mark[data-comment]")}
        opener.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        await nextPaint();
        await new Promise((r) => setTimeout(r, 250));`,
        grab: grabbed(
          "el",
          `document.querySelector('.cmt-close')`,
          ".cmt-close — nothing opened, so there is nothing to close",
        ),
        act: "el.click();",
        probe: OPEN_COMMENTS,
      }),
  },
  keystroke: {
    label: "one keystroke in the find box",
    query: "&mode=search&match=words",
    waitFor: 'input[aria-label="Find these words"]',
    refuseIf: () => null,
    /* A control: annotation should charge nothing. The page must still
       re-render, or the keystroke never reached React and the zero is a no-op
       rather than a result. */
    expects: { work: false, render: true },
    effect: {
      describe: "the find box gets one character longer",
      probe: FIND_LENGTH,
      happened: grew,
    },
    /* **The native setter, not `input.value +=`.** React installs a value
       tracker on controlled inputs and compares against it before dispatching
       `onChange`; assigning through the element updates that tracker too, so
       React sees no change and the keystroke goes nowhere — the DOM keeps the
       character, so even the probe agrees it happened. Going through
       `HTMLInputElement.prototype`'s setter leaves the tracker stale, which is
       what React reads as "the user typed". The render column is the check that
       would catch this if the trick ever stops working. */
    expression: () =>
      timedGesture({
        setup: `document.querySelector('input[aria-label="Find these words"]')?.focus();`,
        grab: `${grabbed("input", `document.querySelector('input[aria-label="Find these words"]')`, "the find box")}
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;`,
        act: `
        if (setValue) setValue.call(input, input.value + 'x'); else input.value += 'x';
        input.dispatchEvent(new Event('input', { bubbles: true }));`,
        probe: FIND_LENGTH,
      }),
  },
  hover: {
    label: "hover across two rows",
    query: "",
    waitFor: "tr[data-block]",
    refuseIf: (p) => (p.blocks < 4 ? "fewer than four blocks to hover between" : null),
    /* The other control, and the honest gap in this instrument: a pointer
       crossing prose sets no attribute and opens no card, so there is nothing
       to declare and nothing to check. Its zero is therefore **not evidence
       that it happened**, the report says so on its own line, and the render
       column is all the corroboration there is. */
    expects: { work: false, render: false },
    effect: null,
    /* `pointerType: 'mouse'` because useHoverCard ignores anything else
       (src/web/useHoverCard.ts § Mouse and pen only), and an event its listener
       drops is another gesture that costs nothing by not happening. */
    expression: () =>
      timedGesture({
        grab: `
    const rows = document.querySelectorAll('tr[data-block]');
    const bAt = Math.floor(rows.length * 0.31);
    ${grabbed("a", `rows[Math.floor(rows.length * 0.3)]?.querySelector('.prose')`, ".prose in the first sample row")}`,
        act: `
        a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        await nextPaint();
        ${grabbed("b", `document.querySelectorAll('tr[data-block]')[bAt]?.querySelector('.prose')`, ".prose in the second sample row")}
        b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));`,
        probe: null,
      }),
  },
};

/** The set Stage 1a used, in the order it reported them. */
const DEFAULT_GESTURES = ["glossary", "comment-open", "comment-close", "keystroke", "hover"];

const num = (n: number, places = 2): string => n.toFixed(places);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const attributable = (c: Cost): number => c.marksByBlock.ms + c.proseHtml.ms;

/**
 * Why this repetition cannot be believed, or null.
 *
 * The whole instrument now rests on this, so it is pure and a test calls it
 * directly: `tests/a-gesture-that-did-nothing-is-not-a-fast-one.test.ts`.
 */
export function effectVerdict(
  effect: Effect | null,
  before: string,
  after: string,
): string | null {
  if (!effect) return null;
  if (effect.happened(before, after)) return null;
  return (
    `the declared effect did not occur — ${effect.describe}` +
    ` (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`
  );
}

/**
 * A repetition whose effect *was* confirmed and which still may not be quoted.
 *
 * Both cases are about a gesture that is supposed to move marks: annotation
 * charged exactly nothing, or the page rendered nothing at all. Either is far
 * likelier to be a gesture that half-landed than a pipeline that ran for free,
 * so neither goes into a median — and neither is thrown away quietly.
 */
export function suspectReason(
  expects: Expects,
  s: Pick<Sample, "cost" | "renders">,
): string | null {
  if (expects.work && attributable(s.cost) === 0) {
    return "attributable is exactly 0.00 ms, on a gesture that has to re-annotate blocks";
  }
  if (expects.render && s.renders === 0) {
    return "window.__perf counted no React render at all, so nothing reacted to it";
  }
  return null;
}

/** How a gesture's repetitions divide up: what may be quoted, what may not, and
 *  why — decided once, and used by both the report and the exit code. */
export interface Classified {
  /** Every repetition whose declared effect was confirmed, in order. */
  samples: Sample[];
  /** Confirmed and still not quotable, by repetition number, with the reason. */
  suspect: Map<number, string>;
  failures: Failed[];
  /** Repetition numbers spent warming the page up. */
  warmups: Set<number>;
  /** What a median may be taken over: confirmed, warmed, unsuspected. */
  warmed: Sample[];
}

export function classify(attempts: Attempt[], warmup: number, expects: Expects): Classified {
  const failures = attempts.filter(failed);
  const samples = attempts.filter((a): a is Sample => !failed(a));
  const suspect = new Map<number, string>();
  for (const s of samples) {
    const why = suspectReason(expects, s);
    if (why) suspect.set(s.rep, why);
  }
  /* Warm-ups counted among the *confirmed* samples rather than by repetition
     number, so a failed first attempt does not silently promote a cold run
     into the summary. */
  const warmups = new Set(samples.slice(0, warmup).map((s) => s.rep));
  const warmed = samples.filter((s) => !warmups.has(s.rep) && !suspect.has(s.rep));
  return { samples, suspect, failures, warmups, warmed };
}

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
export interface GestureRun {
  key: string;
  label: string;
  /** What the gesture required to have happened, in words — null where it
   *  declares nothing, which is a fact about the run and belongs in the file
   *  as much as on screen. The predicate itself is a function and would not
   *  survive `JSON.stringify`, so the sentence is what is kept. */
  declared: string | null;
  expects: Expects;
  refused?: string;
  attempts: Attempt[];
}

/**
 * Print one gesture, every repetition first, and say what is wrong with it.
 *
 * The **raw vectors** are the whole point of this function: Stage 1a's write-up
 * kept only medians, so "stable across samples" could not be checked by anybody
 * who had not been in the room (Sol F19). The summary lines are a convenience
 * on top of evidence that is present either way.
 *
 * **Every repetition gets a column, failures included**, rather than the
 * surviving ones being closed up: three real samples and three `FAILED` is a
 * different fact from three samples, and a filtered vector cannot tell them
 * apart. That is how the bug in the header presented — as a vector of six.
 *
 * @returns a one-line complaint for the run-level summary, or null when the
 *   gesture measured cleanly.
 */
export function report(run: GestureRun, warmup: number): string | null {
  console.log(`\n── ${run.label} ${"─".repeat(Math.max(0, 46 - run.label.length))}`);
  if (run.refused) {
    console.log(`  REFUSED: ${run.refused} — this gesture measures nothing here.`);
    return `refused — ${run.refused}`;
  }
  console.log(
    run.declared
      ? `  requires: ${run.declared}`
      : "  requires: NOTHING DECLARED — nothing observable changes, so this gesture\n" +
          "            cannot prove it happened and its zero is not evidence that it did.\n" +
          "            Read the renders row instead.",
  );

  const c = classify(run.attempts, warmup, run.expects);
  const cell = (rep: number, of: (s: Sample) => string): string => {
    const s = c.samples.find((x) => x.rep === rep);
    if (!s) return "FAILED";
    const v = of(s);
    if (c.warmups.has(rep)) return `(${v})`;
    return c.suspect.has(rep) ? `${v}!` : v;
  };
  const reps = run.attempts.map((a) => a.rep);
  const rows: readonly (readonly [string, (s: Sample) => string])[] = [
    ["end-to-end ms", (s) => num(s.ms, 1)],
    ["attributable ms", (s) => num(attributable(s.cost))],
    ["renders", (s) => String(s.renders)],
  ];
  const labelW = Math.max("repetition".length, ...rows.map(([l]) => l.length));
  const widths = reps.map((rep) =>
    Math.max(String(rep).length, ...rows.map(([, of]) => cell(rep, of).length)),
  );
  const line = (label: string, cells: string[]): string =>
    `    ${label.padEnd(labelW)}  ${cells.map((v, i) => v.padStart(widths[i] ?? 0)).join("  ")}`;
  console.log(
    `  every repetition; the first ${warmup} confirmed one(s) bracketed and excluded,` +
      " ! = suspect and excluded:",
  );
  console.log(line("repetition", reps.map(String)));
  for (const [label, of] of rows) console.log(line(label, reps.map((rep) => cell(rep, of))));

  if (c.failures.length > 0) {
    console.log(
      `  ✗ ${c.failures.length} of ${run.attempts.length} repetition(s) did not happen,` +
        " and are NOT reported as fast ones:",
    );
    for (const f of c.failures) console.log(`      rep ${f.rep}: ${f.error}`);
  }
  for (const [rep, why] of c.suspect) {
    console.log(`  ⚠ rep ${rep} is SUSPECT and excluded from the summary: ${why}`);
  }

  const gripe = (): string | null => {
    const parts: string[] = [];
    if (c.failures.length > 0) parts.push(`${c.failures.length} did not happen`);
    if (c.suspect.size > 0) parts.push(`${c.suspect.size} suspect`);
    return parts.length > 0 ? `${parts.join(", ")} of ${run.attempts.length} repetitions` : null;
  };

  if (c.warmed.length === 0) {
    console.log(
      "  NOTHING QUOTABLE — no repetition survived both the effect check and the warm-up," +
        (c.samples.length > warmup ? "" : ` so raise --repeats above --warmup ${warmup}.`),
    );
    return `nothing quotable out of ${run.attempts.length} repetitions`;
  }
  const warmed = c.warmed;
  const e2e = warmed.map((s) => s.ms);
  const attr = warmed.map((s) => attributable(s.cost));
  /* **Per-run shares, then their median** — not a ratio of two separate
     medians, which pairs numbers from different runs (Sol F16). */
  const shares = warmed.map((s) => (s.ms > 0 ? (attributable(s.cost) / s.ms) * 100 : 0));
  const last = warmed[warmed.length - 1]?.cost;
  const mode = last?.mode ?? "?";
  console.log(
    `  quotable (${warmed.length} of ${run.attempts.length}): end-to-end min/med/max ${num(Math.min(...e2e), 1)}/` +
      `${num(median(e2e), 1)}/${num(Math.max(...e2e), 1)} ms` +
      `   attributable [${mode}] ${num(Math.min(...attr))}/${num(median(attr))}/` +
      `${num(Math.max(...attr))} ms`,
  );
  console.log(`  annotation's share of the gesture: ${num(median(shares), 1)}% (median per-run)`);
  if (!last) return gripe();
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
  return gripe();
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
    const declared = g.effect?.describe ?? null;
    const refused = g.refuseIf(population);
    if (refused) {
      runs.push({ key, label: g.label, declared, expects: g.expects, refused, attempts: [] });
      continue;
    }
    await landAndCount(page, `${o.base}/read/${o.slug}?perf=1${g.query}`, g.waitFor);
    /* Set **after** the navigation: a fresh load re-runs startPerf(), which puts
       the mode back to "counts", so setting it before goto() is a no-op that
       silently produces a "counts" run labelled as a diagnostic. */
    if (o.mode === "full") await page.evaluate(`window.__perf.setAnnotationCostMode('full')`);
    const attempts: Attempt[] = [];
    for (let i = 0; i < o.repeats; i++) {
      const rep = i + 1;
      const raw = await evalJson<Raw>(page, g.expression(i));
      if ("error" in raw) {
        attempts.push({ rep, error: raw.error });
      } else {
        /* The judgment is here rather than in the page: see the header. A
           repetition whose declared effect did not occur becomes a failure,
           and a failure is never a fast sample. */
        const why = effectVerdict(g.effect, raw.before, raw.after);
        attempts.push(why ? { rep, error: why } : { rep, ...raw });
      }
      await page.waitForTimeout(300);
    }
    runs.push({ key, label: g.label, declared, expects: g.expects, attempts });
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
        `  known gestures: ${Object.keys(GESTURES).join(", ")}\n` +
        "  Each gesture declares what must change for it to have happened. A repetition\n" +
        "  where it did not is printed as FAILED, kept out of every median, and exits 1.",
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
    const complaints: string[] = [];
    for (const run of runs) {
      const gripe = report(run, warmup);
      if (gripe) complaints.push(`${run.key}: ${gripe}`);
    }

    if (json) {
      writeFileSync(
        json,
        JSON.stringify({ slug, base, mode, repeats, warmup, population, runs }, null, 2),
      );
      console.log(`\nwrote ${json}`);
    }

    /* Anything a reader could mistake for a measurement is said in the exit code
       as well as on screen — a summary nobody read is how a zero gets quoted
       later. A refusal, a repetition that did not happen and a suspect zero all
       land here, because from outside they are the same mistake. */
    if (complaints.length > 0) {
      console.log(`\n${complaints.length} of ${runs.length} gesture(s) did not measure cleanly:`);
      for (const complaint of complaints) console.log(`  ${complaint}`);
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
  }
}

/* Guarded, so that the test which calls `effectVerdict`, `suspectReason` and
   `classify` directly does not launch a browser by importing this file. */
if (isMain(import.meta.url)) {
  main().catch((e: Error) => {
    console.error(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
