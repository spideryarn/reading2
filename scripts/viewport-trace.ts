/**
 * **Reading a phone's viewport trace: the analysis, with no printing in it.**
 *
 * The CLI is [`read-viewport-trace.ts`](read-viewport-trace.ts); the tests are
 * `tests/viewport-trace.test.ts`. Separate files because a `--self-test` inside
 * a script is a check no gate runs (GPT Sol F37), and because an analysis worth
 * trusting has to be callable by something other than itself.
 *
 * The producer is `src/web/ViewportProbe.tsx`, reachable in production at
 * `?probe=1`. What this answers, and why only a device can:
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md
 * § Stage 4.
 *
 * ## The shape of a trace, which is the whole of why this file is careful
 *
 * The reader is asked to: tap **mark** with the keyboard shut, tap into the
 * composer, wait for the keyboard to settle, tap **mark** again. So the decision
 * is a **marked closed → marked settled-open transition**, and the hundreds of
 * `resize`/`scroll` frames between them are the keyboard *sliding* — worth
 * looking at, and not the state whose CSS is being chosen.
 *
 * **Everything below is chronological, and that is not a detail.** The first
 * version took a keyboard-closed sample from *anywhere* in the trace and treated
 * every moved sample as open relative to it — so an open→closed trace reported
 * `SHRANK` and `DEFECT` off a baseline that came afterwards. Sol ran that
 * counterexample. It is reachable in ordinary use: the probe's **clear** button
 * empties the sample list without recording a new `start`, so clearing while the
 * keyboard is up and then closing it makes a *future* closed frame the apparent
 * baseline. Samples are now walked in time order, a baseline governs only what
 * follows it, and anything before the first baseline is reported as orphaned
 * rather than folded in.
 *
 * ## Four rules, each of which was a bug first
 *
 * **1. A trace that cannot answer must say so, not say "clean".** `clean`
 * requires positive evidence: a chronological marked transition, the surface
 * profile's rectangles present **in the decision-bearing settled frame** rather
 * than merely somewhere in the file, and a focused editor at that endpoint.
 *
 * **2. "The viewport moved" is not "the keyboard opened".** Browser chrome
 * hiding, a rotation, or any scale-1 resize moves those numbers too. The probe
 * records the focused element's signature in `of.focus`, so the open endpoint
 * has to *have an editor focused* before this will call it a keyboard.
 *
 * **3. External JSON is not a type, and a dropped sample is not an absent one.**
 * Every field is validated, the producer marker in `head` is checked, and **any
 * rejected sample makes the arithmetic decision inconclusive** — because the
 * malformed frame is exactly as likely to be the clipped one, and silently
 * analysing the survivors is how a subset exits 0 as clean.
 *
 * **4. What a reader must be able to reach depends on the mode.** A global
 * `["head", "composer"]` is wrong for Glossary and Outline, which legitimately
 * have no composer, and `ModeSurface` permits no head. So the caller names a
 * `Profile`. The one the plan's recipe asks for is `CHAT`.
 *
 * Rules 1–4 are GPT Sol's, across two rounds; every one of them was a live bug
 * he demonstrated by running it rather than a hardening suggestion.
 *
 * ## The probe's own `vis` field is not used, deliberately
 *
 * `ViewportProbe` computes `vis` against `window.innerHeight` — the **layout**
 * viewport — so it means "is this in the page at all", not "can the reader see
 * it". A dock behind the keyboard is `on` by that test. Sol F38.
 *
 * The probe is **already deployed**, so changing it cannot alter the trace that
 * is about to arrive; and it need not, because it records the dock's and hint's
 * *rectangles*, from which occlusion against the visible strip is computable
 * here. `vis` is parsed, carried, and never used for a conclusion. Sol agrees
 * this is right for the imminent trace, and suggests renaming the field in the
 * producer on the next deployment so future raw traces do not carry a knowingly
 * misleading "on screen" — recorded in the plan, not done here.
 */

/** `[x, y, width, height]`, as the probe writes them. */
export type Box = readonly [number, number, number, number];

/** `[width, height, offsetTop, offsetLeft, scale]`. */
export type VV = readonly [number, number, number, number, number];

/**
 * The events the deployed probe emits. Anything else is a trace we do not
 * understand.
 *
 * `resize` and `scroll` are the visual viewport's. The three after them were
 * added on 2026-09-12 so a rotation shows up in a trace (the window's own
 * events, and the reader re-laying-out), and are listed here so a trace that
 * contains one still reads —
 * docs/plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md.
 */
export const EVENTS = [
  "start",
  "resize",
  "scroll",
  "window-resize",
  "orientationchange",
  "laid-out",
  "mark",
] as const;
export type Ev = (typeof EVENTS)[number];

export interface Sample {
  readonly t: number;
  readonly ev: Ev;
  /** `[innerWidth, innerHeight, scrollX, scrollY]`. */
  readonly win: Box;
  readonly vv: VV | null;
  readonly tok: Readonly<Record<string, number | null>>;
  readonly rect: Readonly<Record<string, Box | null>>;
  /** `tag.class` of the body, composer and **focused element** — the keyboard evidence. */
  readonly of: Readonly<Record<string, string | null>>;
  readonly vis: Readonly<Record<string, string>>;
  readonly dm: string;
  readonly bars: string;
}

/** A sample that did not survive validation, and why. Named, never dropped quietly. */
export interface Rejected {
  readonly index: number;
  readonly why: string;
}

export interface Parsed {
  readonly samples: readonly Sample[];
  readonly rejected: readonly Rejected[];
  /** Set when nothing could be read at all; `samples` is then empty. */
  readonly fatal: string | null;
}

/** The marker the deployed probe writes into `head`. Its absence means this is not our format. */
export const PRODUCER = "spideryarn viewport probe";

/* ------------------------------------------------------------- validation -- */

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function tuple(v: unknown, n: number): readonly number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  return v.every(finite) ? (v as readonly number[]) : null;
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function isEv(v: unknown): v is Ev {
  return typeof v === "string" && (EVENTS as readonly string[]).includes(v);
}

/**
 * One sample, checked field by field. Returns the reason it is unusable rather
 * than a boolean, because "sample 41 has a 4-long vv" is a debuggable sentence
 * and `false` is not.
 */
function validate(raw: unknown): { readonly ok: Sample } | { readonly why: string } {
  const o = record(raw);
  if (!o) return { why: "not an object" };
  if (!finite(o["t"])) return { why: "t is not a finite number" };
  if (!isEv(o["ev"]))
    return { why: `ev is ${JSON.stringify(o["ev"])}, not one of ${EVENTS.join("/")}` };
  const win = tuple(o["win"], 4);
  if (!win) return { why: "win is not four finite numbers" };
  let vv: VV | null = null;
  if (o["vv"] !== null && o["vv"] !== undefined) {
    const t5 = tuple(o["vv"], 5);
    if (!t5) return { why: "vv is neither null nor five finite numbers" };
    vv = [t5[0], t5[1], t5[2], t5[3], t5[4]] as VV;
  }
  const tokRaw = record(o["tok"]);
  if (!tokRaw) return { why: "tok is not an object" };
  const tok: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(tokRaw)) {
    if (v === null) tok[k] = null;
    else if (finite(v)) tok[k] = v;
    else return { why: `tok.${k} is neither null nor a finite number` };
  }
  const rectRaw = record(o["rect"]);
  if (!rectRaw) return { why: "rect is not an object" };
  const rect: Record<string, Box | null> = {};
  for (const [k, v] of Object.entries(rectRaw)) {
    if (v === null) {
      rect[k] = null;
      continue;
    }
    const t4 = tuple(v, 4);
    if (!t4) return { why: `rect.${k} is neither null nor four finite numbers` };
    rect[k] = [t4[0], t4[1], t4[2], t4[3]] as Box;
  }
  /* `of` is the keyboard evidence, and the first version discarded it. */
  const ofRaw = record(o["of"]);
  if (!ofRaw) return { why: "of is not an object — no way to tell what was focused" };
  const of: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(ofRaw)) of[k] = typeof v === "string" ? v : null;
  const visRaw = record(o["vis"]);
  if (!visRaw) return { why: "vis is not an object" };
  const vis: Record<string, string> = {};
  for (const [k, v] of Object.entries(visRaw)) if (typeof v === "string") vis[k] = v;
  if (typeof o["dm"] !== "string") return { why: "dm is not a string" };
  return {
    ok: {
      t: o["t"],
      ev: o["ev"],
      win: [win[0], win[1], win[2], win[3]] as Box,
      vv,
      tok,
      rect,
      of,
      vis,
      dm: o["dm"],
      bars: typeof o["bars"] === "string" ? o["bars"] : "",
    },
  };
}

export function parseTrace(raw: string): Parsed {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch (e) {
    return { samples: [], rejected: [], fatal: `not JSON: ${String(e)}` };
  }
  const o = record(root);
  if (!o) return { samples: [], rejected: [], fatal: "top level is not an object" };
  /* The producer marker. Its absence means this file is not one of ours, and
     guessing at somebody else's tuple order is how a confident wrong answer gets
     printed. The deployed probe writes no version, so this format is v0 by
     definition; a future probe should carry one. */
  const head = record(o["head"]);
  if (!head || head["probe"] !== PRODUCER) {
    return {
      samples: [],
      rejected: [],
      fatal: `head.probe is not ${JSON.stringify(PRODUCER)} — this is not a trace from src/web/ViewportProbe.tsx`,
    };
  }
  const list = o["samples"];
  if (!Array.isArray(list)) return { samples: [], rejected: [], fatal: "no samples array" };
  if (list.length === 0) return { samples: [], rejected: [], fatal: "the samples array is empty" };
  const samples: Sample[] = [];
  const rejected: Rejected[] = [];
  list.forEach((raw2, index) => {
    const r = validate(raw2);
    if ("ok" in r) samples.push(r.ok);
    else rejected.push({ index, why: r.why });
  });
  if (samples.length === 0)
    return { samples: [], rejected, fatal: "every sample failed validation" };
  /* The probe appends and never reorders, so out-of-order timestamps mean the
     file was edited, concatenated or truncated mid-object. Chronology is what
     every conclusion below rests on, so this is fatal rather than a warning. */
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const here = samples[i];
    if (prev && here && here.t < prev.t)
      return {
        samples: [],
        rejected,
        fatal: `samples are not in time order (${prev.t}ms then ${here.t}ms at index ${i}) — two traces concatenated, or an edited file`,
      };
  }
  return { samples, rejected, fatal: null };
}

/* --------------------------------------------------------------- geometry -- */

export interface Reading {
  readonly sample: Sample;
  /** True where `vv` exists and `scale` is 1 — the only regime the tokens share. */
  readonly usable: boolean;
  readonly visibleTop: number;
  readonly visibleBottom: number;
  readonly bottomInset: number;
  readonly offsetTop: number;
  /** Pixels below the visible strip. **Absent** where the probe recorded no rectangle. */
  readonly hiddenBelow: Readonly<Record<string, number>>;
  readonly hiddenAbove: Readonly<Record<string, number>>;
  /** Whether the dock / hint overlap the strip the reader can see — computed here, not read from `vis`. */
  readonly occludes: Readonly<Record<string, boolean>>;
  readonly anchorError: number | null;
  readonly baseClearance: number | null;
  readonly candidateMax: number | null;
  readonly candidatePlus: number | null;
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * The band's `bottom:` as the stylesheet computes it today —
 * `calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h))`,
 * `src/web/styles/mode-band.css` § mode band. `null` where any token is missing,
 * because a guessed token is a confident wrong column.
 */
export function baseClearance(tok: Readonly<Record<string, number | null>>): number | null {
  const dock = tok["--dock-bottom"];
  const safe = tok["--safe-bottom"];
  const hint = tok["--hint-h"];
  if (typeof dock !== "number" || typeof safe !== "number" || typeof hint !== "number") return null;
  return Math.max(dock, safe) + hint;
}

export function readSample(s: Sample): Reading {
  const ih = s.win[1];
  const vv = s.vv;
  const usable = vv !== null && vv[4] === 1;
  const visibleTop = vv ? vv[2] : 0;
  const visibleBottom = vv ? vv[2] + vv[1] : ih;
  const bottomInset = vv ? Math.max(0, round(ih - vv[1] - vv[2])) : 0;

  const hiddenBelow: Record<string, number> = {};
  const hiddenAbove: Record<string, number> = {};
  const occludes: Record<string, boolean> = {};
  for (const [name, r] of Object.entries(s.rect)) {
    if (!r) continue; /* absent, NOT zero — see `hiddenFor` */
    const [, y, , h] = r;
    hiddenBelow[name] = Math.max(0, round(y + h - visibleBottom));
    hiddenAbove[name] = Math.max(0, round(visibleTop - y));
    occludes[name] = h > 0 && y + h > visibleTop && y < visibleBottom;
  }

  const base = baseClearance(s.tok);
  const band = s.rect["band"] ?? null;
  const anchorError = band && base !== null ? round(band[1] + band[3] - (ih - base)) : null;

  return {
    sample: s,
    usable,
    visibleTop,
    visibleBottom,
    bottomInset,
    offsetTop: vv ? vv[2] : 0,
    hiddenBelow,
    hiddenAbove,
    occludes,
    anchorError,
    baseClearance: base,
    candidateMax: base === null ? null : Math.max(base, bottomInset),
    candidatePlus: base === null ? null : round(base + bottomInset),
  };
}

/**
 * How much of `name` is hidden, or `null` where the probe recorded no rectangle.
 * **The `null` is the point**: an absent measurement is not zero, and treating it
 * as zero is how a trace with no composer in it reports a composer that is not
 * hidden.
 */
export function hiddenFor(r: Reading, name: string, side: "below" | "above"): number | null {
  const map = side === "below" ? r.hiddenBelow : r.hiddenAbove;
  return name in map ? (map[name] as number) : null;
}

/* ---------------------------------------------------------------- profile -- */

/**
 * **What a reader must be able to reach in the mode that was traced.**
 *
 * A global list was wrong in both directions: Glossary and Outline have no
 * composer and `ModeSurface` permits no head, so requiring both is a bug there;
 * and for the Chat trace the plan's recipe actually asks for, a *missing*
 * composer means the requested experiment was not captured, and must be
 * inconclusive rather than quietly clean.
 */
export interface Profile {
  readonly name: string;
  /** Rectangles that must be present in the decision-bearing settled frame. */
  readonly reach: readonly string[];
  /** Whether an editor must be focused at that endpoint for this to count as a keyboard. */
  readonly needsEditor: boolean;
}

/** The trace the plan's recipe asks for: `?mode=chat`, tapped into the composer. */
export const CHAT: Profile = { name: "chat", reach: ["head", "composer"], needsEditor: true };

/** A mode with no composer — Glossary, Outline. The band's head is still a control the reader needs. */
export const NO_COMPOSER: Profile = { name: "no-composer", reach: ["head"], needsEditor: false };

/** `form.chat-composer`, `textarea.fb-body` — does this signature name something a keyboard opens for? */
export function isEditor(sig: string | null | undefined): boolean {
  if (!sig) return false;
  const tag = sig.split(".")[0] ?? "";
  return tag === "textarea" || tag === "input" || tag === "form";
}

/* ------------------------------------------------------------- chronology -- */

/** A pixel of slop, so a rounding wobble is not read as a movement. */
export const SLOP = 1;

const moved = (r: Reading, from: Reading): boolean =>
  r.bottomInset - from.bottomInset > SLOP || r.offsetTop - from.offsetTop > SLOP;

const atRest = (r: Reading): boolean => r.bottomInset <= SLOP && r.offsetTop <= SLOP;

/**
 * One closed → open episode, **in time order**. `settled` is the marked sample
 * inside it: the reader taps *mark* once the keyboard has stopped moving, and
 * that frame — not the animation — is what the CSS is chosen from.
 */
export interface Cycle {
  readonly closed: Reading;
  readonly open: readonly Reading[];
  readonly settled: Reading | null;
}

export interface Chronology {
  readonly cycles: readonly Cycle[];
  /** Moved samples appearing before any keyboard-closed sample, so nothing governs them. */
  readonly orphans: readonly Reading[];
  /** Layout-viewport height changed mid-trace — a rotation, or a browser resizing the layout viewport. */
  readonly resized: boolean;
}

/**
 * Walk the trace forwards, and let a baseline govern only what follows it.
 *
 * The bug this replaces: taking a closed sample from anywhere and treating every
 * moved sample as open relative to it. Reachable through the probe's **clear**
 * button, which empties the list without recording a new `start`.
 */
export function chronology(readings: readonly Reading[]): Chronology {
  const usable = readings.filter((r) => r.usable);
  const cycles: Cycle[] = [];
  const orphans: Reading[] = [];
  let closed: Reading | null = null;
  let open: Reading[] = [];

  const flush = () => {
    if (closed && open.length > 0) {
      const marks = open.filter((r) => r.sample.ev === "mark");
      cycles.push({ closed, open, settled: marks[marks.length - 1] ?? null });
    }
    open = [];
  };

  for (const r of usable) {
    if (atRest(r)) {
      flush();
      closed = r;
      continue;
    }
    if (!closed) {
      orphans.push(r);
      continue;
    }
    if (moved(r, closed)) open.push(r);
  }
  flush();

  const heights = new Set(usable.map((r) => r.sample.win[1]));
  return { cycles, orphans, resized: heights.size > 1 };
}

/* --------------------------------------------------------- classification -- */

export type Motion = "shrank" | "panned" | "mixed" | "inconclusive";

export interface Classification {
  readonly motion: Motion;
  readonly why: string;
  /** Whether a bottom-anchored rule can reach the problem at all. */
  readonly bottomRuleSuffices: boolean;
  /** Clipping seen only while the keyboard was moving — reported, never the decision. */
  readonly transientClipping: boolean;
}

function motionOf(closed: Reading, open: Reading): Motion {
  const dInset = open.bottomInset - closed.bottomInset;
  const dOffset = open.offsetTop - closed.offsetTop;
  if (dInset > SLOP && dOffset > SLOP) return "mixed";
  if (dInset > SLOP) return "shrank";
  if (dOffset > SLOP) return "panned";
  return "inconclusive";
}

/**
 * Which way the keyboard moved the viewport, **from the marked settled frames
 * only**, one per cycle.
 *
 * Transient and settled motion used to be pooled, so a single mid-animation
 * frame where both terms had moved made an entire trace `mixed` even when the
 * state the reader actually held still in was a clean shrink. The animation is
 * now reported beside the decision rather than inside it.
 *
 * The refusal at the end is the part that matters: however the deltas come out,
 * a **settled** frame whose head is clipped above cannot endorse bottom-only
 * arithmetic, because no `bottom:` value reaches something off the top.
 */
export function classify(chron: Chronology): Classification {
  const settled = chron.cycles.filter((c) => c.settled !== null);
  const transientClipping = chron.cycles.some((c) =>
    c.open.some(
      (r) =>
        (r.sample.ev === "resize" || r.sample.ev === "scroll") &&
        (hiddenFor(r, "head", "above") ?? 0) > 0,
    ),
  );
  if (settled.length === 0) {
    return {
      motion: "inconclusive",
      why:
        chron.cycles.length === 0
          ? "no keyboard-closed → moved episode in time order — the keyboard did not open during this trace, or this engine resizes the layout viewport instead"
          : "the viewport moved, but no `mark` was taken while it was moved, so no settled state was recorded — tap mark once the keyboard has stopped sliding",
      bottomRuleSuffices: false,
      transientClipping,
    };
  }

  const each = settled.map((c) => motionOf(c.closed, c.settled as Reading));
  const distinct = new Set(each.filter((m) => m !== "inconclusive"));
  const motion: Motion =
    distinct.size === 0
      ? "inconclusive"
      : distinct.size === 1
        ? ([...distinct][0] as Motion)
        : "mixed";

  const headClipped = settled.some(
    (c) => (hiddenFor(c.settled as Reading, "head", "above") ?? 0) > 0,
  );
  if (headClipped) {
    return {
      motion,
      why: `${motion} by the deltas, but a settled frame has the head clipped ABOVE the visible strip — no bottom-anchored rule reaches that, whatever the deltas say`,
      bottomRuleSuffices: false,
      transientClipping,
    };
  }
  return {
    motion,
    why:
      motion === "shrank"
        ? `the keyboard shrank the visible strip from the bottom in ${settled.length === 1 ? "the settled frame" : `all ${settled.length} settled frames`}; a bottom-edge rule is the right shape and \`--kb-inset\` is the term`
        : motion === "panned"
          ? "the keyboard panned the strip downwards rather than shrinking it; `bottomInset` is not the term that moved"
          : motion === "mixed"
            ? "the settled frames disagree with each other, or both terms moved at once; a bottom-only rule addresses part of it at best"
            : "no settled frame showed a movement large enough to classify",
    bottomRuleSuffices: motion === "shrank",
    transientClipping,
  };
}

/* ---------------------------------------------------------------- verdict -- */

export type Which = "defect" | "clean" | "inconclusive";

export interface Verdict {
  readonly which: Which;
  readonly why: string;
  /** Settled frames that hide something the profile says a reader must reach. */
  readonly offending: readonly Reading[];
}

/**
 * **`clean` requires evidence, not the absence of it**, and the evidence is
 * specific: a chronological marked transition, the profile's rectangles present
 * **in that settled frame** — not merely somewhere in the trace — and, for a
 * profile that asks for it, an editor focused at that endpoint.
 *
 * `rejected` is taken as an argument for the same reason: a malformed frame is
 * exactly as likely to be the clipped one, so analysing the survivors and
 * exiting 0 is the subset problem wearing a clean shirt.
 */
export function verdictOf(
  chron: Chronology,
  motion: Classification,
  profile: Profile,
  rejected: readonly Rejected[] = [],
): Verdict {
  if (rejected.length > 0) {
    return {
      which: "inconclusive",
      why: `${rejected.length} sample(s) failed validation and were not analysed — the malformed frame may be the one that mattered, so the surviving subset cannot be called clean`,
      offending: [],
    };
  }
  if (motion.motion === "inconclusive") {
    return { which: "inconclusive", why: motion.why, offending: [] };
  }
  const settled = chron.cycles.map((c) => c.settled).filter((r): r is Reading => r !== null);

  for (const r of settled) {
    const missing = profile.reach.filter(
      (k) => hiddenFor(r, k, "below") === null && hiddenFor(r, k, "above") === null,
    );
    if (missing.length > 0) {
      return {
        which: "inconclusive",
        why: `the settled frame at ${r.sample.t}ms has no rectangle for ${missing.join(" or ")}, which the ${profile.name} profile says a reader must reach — the requested experiment was not captured`,
        offending: [],
      };
    }
    if (profile.needsEditor && !isEditor(r.sample.of["focus"])) {
      return {
        which: "inconclusive",
        why: `the settled frame at ${r.sample.t}ms has ${r.sample.of["focus"] ? `\`${r.sample.of["focus"]}\`` : "nothing"} focused, not an editor — the viewport moved, but that does not establish a keyboard did it`,
        offending: [],
      };
    }
  }

  const offending = settled.filter((r) =>
    profile.reach.some(
      (k) => (hiddenFor(r, k, "below") ?? 0) > 0 || (hiddenFor(r, k, "above") ?? 0) > 0,
    ),
  );
  return offending.length > 0
    ? {
        which: "defect",
        why: `${offending.length} settled frame(s) put part of ${profile.reach.join(" or ")} outside the visible strip`,
        offending,
      }
    : {
        which: "clean",
        why: `${settled.length} settled keyboard-open frame(s) were measured and none put ${profile.reach.join(" or ")} outside the visible strip`,
        offending: [],
      };
}

/** `max(base, inset)` against `base + inset`, decided per sample rather than by argument. Sol F2. */
export function additiveCollapses(readings: readonly Reading[]): readonly Reading[] {
  return readings.filter((r) => {
    if (!r.usable || r.candidatePlus === null) return false;
    const barBottom = r.sample.tok["--bar-bottom"];
    if (typeof barBottom !== "number") return false;
    /* The band's top is `--bar-bottom`; a `bottom:` at or past it leaves no height. */
    return r.sample.win[1] - r.candidatePlus <= barBottom;
  });
}

/** Whether the band is pinned to the layout viewport, checked rather than cited. */
export function anchorVerdict(
  readings: readonly Reading[],
):
  | { readonly known: false }
  | { readonly known: true; readonly holds: boolean; readonly worst: number; readonly n: number } {
  const errors = readings.map((r) => r.anchorError).filter((n): n is number => n !== null);
  if (errors.length === 0) return { known: false };
  const worst = errors.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  return { known: true, holds: Math.abs(worst) <= 1, worst, n: errors.length };
}
