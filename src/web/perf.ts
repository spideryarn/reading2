/**
 * What the page is doing when nobody asked it to.
 *
 * This exists because the reading view was burning CPU while sitting still —
 * including in a background tab, where by definition nothing is being read. The
 * hard part of that bug is not fixing it, it is *seeing* it: a page that wakes
 * up eight times a minute to re-render a tree looks exactly like a page that is
 * idle, because both of them look like nothing.
 *
 * So the probe counts the four ways this app can spend a CPU cycle without a
 * human touching it — a timer fired, an animation frame ran, a request went
 * out, a component re-rendered — and buckets every one of them by **whether
 * the tab was visible at the time**. That split is the whole point. A number
 * for "renders per minute" is an opinion; "renders per minute while hidden" is
 * a bug report.
 *
 * ## It is off unless you ask for it
 *
 * `?perf=1` on any URL, or `localStorage.setItem("spya-perf", "1")` to survive
 * navigations. When off, nothing here is patched and nothing is counted — the
 * globals keep their own identities, and `useRenderCount` returns on its first
 * line.
 * This matters more than it sounds: the probe patches `setTimeout`, `fetch` and
 * `requestAnimationFrame`, and a probe that is always on is a probe that is
 * part of what you are measuring.
 *
 * ## What it cannot see
 *
 * Compositor work. A CSS `animation: … infinite` on an off-screen spinner costs
 * real cycles and executes no JavaScript, so it leaves no trace here. Those are
 * found by reading `styles.css`, not by reading this. See
 * docs/project/performance.md for the ones that were.
 *
 * Also: `longtask` entries only exist for tasks over 50ms, so a page doing
 * three hundred 5ms re-renders a minute scores zero blocking time while being
 * exactly the thing we are hunting. Read `jsMs` — self-timed and complete —
 * rather than `blockingMs`, which is a headline and not the measurement.
 */

import {
  annotationCost,
  resetAnnotationCost,
  setAnnotationCostMode,
  startAnnotationCost,
} from "./annotation-cost.js";

/** One bucket of counts. There are two, and which one you land in is decided
 *  by `document.visibilityState` at the moment of the event. */
type Bucket = {
  /** Wall-clock ms this bucket has been the live one. The denominator for
   *  every rate — without it, "40 renders" is unreadable. */
  wallMs: number;
  /** Timer callbacks that actually ran. Not timers *set*: a `setTimeout` that
   *  is cleared before it fires costs nothing and must not be counted. */
  timers: number;
  /** `requestAnimationFrame` callbacks that ran. In a hidden tab this should
   *  be flatly zero — the browser stops serving frames — so a non-zero number
   *  here is either a bug in the probe or a tab that was not really hidden. */
  frames: number;
  /** `fetch` calls started, and separately the ones to `/api/jobs`, because
   *  that route is the known offender and burying it in a total hides it. */
  fetches: number;
  jobPolls: number;
  /** React component bodies that ran, via `useRenderCount`. Only components
   *  that opt in are counted, so this is a sample, not a census. */
  renders: number;
  /** Self-timed JavaScript, summed across every callback the probe wraps.
   *  This is the closest thing to "CPU" the page can measure about itself. */
  jsMs: number;
  /** `longtask` entries — the >50ms subset, for reference against DevTools. */
  blockingMs: number;
  longTasks: number;
};

const emptyBucket = (): Bucket => ({
  wallMs: 0,
  timers: 0,
  frames: 0,
  fetches: 0,
  jobPolls: 0,
  renders: 0,
  jsMs: 0,
  blockingMs: 0,
  longTasks: 0,
});

/** Per-label counts, so a report can say *which* component re-rendered forty
 *  times rather than only that something did. Kept outside the visible/hidden
 *  split: the split answers "is this a background bug", the labels answer
 *  "where", and crossing them would give four numbers nobody reads. */
type Tally = Map<string, number>;

const state = {
  on: false,
  visible: emptyBucket(),
  hidden: emptyBucket(),
  /** Which bucket is live, and since when. Switched by `settleClock`, which is
   *  the only thing allowed to move `live` — see the note there about why it
   *  cannot simply be re-derived from `document.visibilityState`. */
  since: 0,
  live: emptyBucket(),
  renders: new Map() as Tally,
  timerLabels: new Map() as Tally,
  fetchPaths: new Map() as Tally,
  startedAt: 0,
};

/** The bucket events are counted into right now. */
function live(): Bucket {
  return document.visibilityState === "hidden" ? state.hidden : state.visible;
}

function bump(tally: Tally, key: string, by = 1): void {
  tally.set(key, (tally.get(key) ?? 0) + by);
}

/**
 * Close off the elapsed wall time against the bucket that has been live, and
 * restart the clock.
 *
 * **The bucket is remembered rather than re-read**, and that is the whole
 * subtlety. By the time a `visibilitychange` listener runs, the browser has
 * already flipped `document.visibilityState` — so asking for it here names the
 * state we are entering, and charges the interval that just elapsed under the
 * *old* state to the new one. Every visible stretch was being billed to hidden
 * on the way out, and every hidden stretch to visible on the way back.
 *
 * The counts were never affected; the denominators were, which means every
 * per-minute rate and the `jsPercent` headline were wrong — the numbers most
 * likely to be quoted. Caught by a GPT Sol review, 2026-08-27, and a good
 * reminder that an event handler runs *after* the thing it is told about.
 *
 * Called on every visibility change and before every report, so the final
 * stretch — usually the one you care about — is in the denominator.
 */
function settleClock(): void {
  const at = performance.now();
  state.live.wallMs += at - state.since;
  state.since = at;
  state.live = document.visibilityState === "hidden" ? state.hidden : state.visible;
}

/**
 * Time one callback and charge it to the live bucket.
 *
 * `finally` rather than wrapping the return value, because a callback that
 * throws still spent the CPU, and losing those would systematically
 * under-report exactly the code that is going wrong.
 */
function timed<T>(kind: "timers" | "frames", label: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const bucket = live();
    bucket.jsMs += performance.now() - t0;
    bucket[kind] += 1;
    if (kind === "timers") bump(state.timerLabels, label);
  }
}

/**
 * Where a timer was set, as one line of stack.
 *
 * A count of "212 timers fired" names no file and fixes nothing. The frame two
 * levels up from `setTimeout` is the caller, and its `at foo (…/useJobs.ts:281)`
 * is the whole reason this probe is worth having. Wrapped in try/catch because
 * stack formats are not a contract, and a probe must never be the thing that
 * throws.
 */
function callSite(): string {
  try {
    const lines = (new Error().stack ?? "").split("\n");
    // 0 is "Error", 1 is callSite, 2 is the patched global, 3 is the caller.
    const raw = lines[3] ?? lines[2] ?? "?";
    const match = raw.match(/([\w.-]+\.tsx?):(\d+)/);
    return match ? `${match[1]}:${match[2]}` : raw.trim().slice(0, 80);
  } catch {
    return "?";
  }
}

/** The path of a fetch, without the query string — a `?slug=` would make every
 *  call to one route look like a different route, and the point of the tally is
 *  to group them. */
function pathOf(input: RequestInfo | URL): string {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(href, location.origin).pathname;
  } catch {
    return "?";
  }
}

/**
 * Count a render.
 *
 * A hook rather than a wrapper component, so adding it to something costs one
 * line and changes no tree. It deliberately does **not** use state or an
 * effect: it runs in the component body, which is precisely the thing being
 * counted, and an effect would miss the renders React throws away.
 */
export function useRenderCount(label: string): void {
  if (!state.on) return;
  bump(state.renders, label);
  live().renders += 1;
}

/**
 * Burn a known amount of CPU, so an outside sampler can find this tab.
 *
 * Chrome runs dozens of renderer processes and none of them says which tab it
 * is. `scripts/chrome-cpu.ts` therefore cannot tell the page we are profiling
 * from a video call in another window — and on a real machine the busiest
 * renderer is very often not ours. So: spin deliberately for a few seconds,
 * sample every renderer across that window, and the one whose CPU jumped by
 * about that much is this one. A fingerprint rather than a guess.
 *
 * A busy loop rather than anything cleverer, and that is the point — it must
 * be work the browser cannot optimise away, throttle, or move off-thread. It
 * blocks the main thread for the duration, which is fine for a tool whose
 * whole job is to be conspicuous.
 */
function spin(ms = 4000): string {
  const until = performance.now() + ms;
  let n = 0;
  while (performance.now() < until) n += Math.sqrt(n + 1);
  return `spun ${ms}ms (${Math.round(n)})`;
}

/**
 * What the browser says about this tab right now, recorded alongside every
 * report rather than trusted silently.
 *
 * **`visibilityState` lies under extension automation**, and this is written
 * down rather than assumed: docs/project/browser-testing.md § "A background tab
 * will lie to you" records a session where it read `"hidden"` throughout while
 * `document.hasFocus()` was `true` and successive screenshots showed live,
 * correctly-updating content. The whole value of this probe is its
 * visible/hidden split, so a split built on a field that can be wrong needs the
 * corroborating fields printed next to it. Three sources that agree are a
 * measurement; one that disagrees with the other two is a warning not to
 * believe the buckets.
 *
 * `frames` is the honest one and belongs in the same glance: a genuinely hidden
 * tab is served no animation frames at all, so a bucket labelled hidden with a
 * non-zero frame count did not happen while hidden.
 */
function visibility(): Record<string, unknown> {
  return {
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    // Zero in a hidden tab, whatever `visibilityState` claims.
    framesWhileHidden: state.hidden.frames,
  };
}

type Report = {
  onFor: string;
  /** Whether this report's own buckets can be believed. See `visibility`. */
  tab: Record<string, unknown>;
  /** Wall seconds since `reset()`, so a caller can tell a 60-second idle
   *  window from a 14-second one that was mostly page load. A window shorter
   *  than the thing being measured is the commonest way this goes wrong. */
  windowSeconds: number;
  visible: Bucket & { perMinute: Record<string, number> };
  hidden: Bucket & { perMinute: Record<string, number> };
  topRenders: [string, number][];
  topTimers: [string, number][];
  topFetches: [string, number][];
};

/** Counts are meaningless without their denominator, so every headline is also
 *  expressed per minute of that bucket's own wall time. A bucket that was never
 *  live gets zeroes rather than a division by zero. */
function rates(b: Bucket): Record<string, number> {
  const minutes = b.wallMs / 60_000;
  const per = (n: number) => (minutes > 0 ? Math.round((n / minutes) * 10) / 10 : 0);
  return {
    timers: per(b.timers),
    frames: per(b.frames),
    fetches: per(b.fetches),
    jobPolls: per(b.jobPolls),
    renders: per(b.renders),
    /** The headline: what fraction of wall time was spent executing our JS.
     *  0.4 means 0.4% of one core, which is what an idle page should look
     *  like. */
    jsPercent: b.wallMs > 0 ? Math.round((b.jsMs / b.wallMs) * 1000) / 10 : 0,
  };
}

const top = (t: Tally, n = 12): [string, number][] =>
  [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function report(): Report {
  settleClock();
  return {
    onFor: `${Math.round((performance.now() - state.startedAt) / 1000)}s`,
    tab: visibility(),
    windowSeconds: Math.round((performance.now() - state.startedAt) / 100) / 10,
    visible: { ...state.visible, perMinute: rates(state.visible) },
    hidden: { ...state.hidden, perMinute: rates(state.hidden) },
    topRenders: top(state.renders),
    topTimers: top(state.timerLabels),
    topFetches: top(state.fetchPaths),
  };
}

function reset(): void {
  state.visible = emptyBucket();
  state.hidden = emptyBucket();
  /* Re-pointed, not just re-created: `live` holds a reference, so leaving it
     alone would go on charging wall time to a bucket no report can see. */
  state.live = document.visibilityState === "hidden" ? state.hidden : state.visible;
  state.renders = new Map();
  state.timerLabels = new Map();
  state.fetchPaths = new Map();
  state.since = performance.now();
  state.startedAt = state.since;
}

/**
 * Patch the four globals and start counting.
 *
 * Called once from main.tsx. Everything it patches is captured first and
 * called through, so the app cannot tell the difference — a probe that changes
 * behaviour measures a page that does not exist.
 */
export function startPerf(): void {
  if (state.on) return;
  /* `localStorage` is wrapped because reading it can *throw*, not merely return
     null — Safari's private mode and a browser set to block site data both do,
     and jsdom simply does not define it under some origins. A profiler that
     takes the page down before React mounts because it wanted to know whether
     it was switched on is not a trade worth making. */
  const sticky = (): boolean => {
    try {
      return localStorage.getItem("spya-perf") === "1";
    } catch {
      return false;
    }
  };
  const wanted = new URLSearchParams(location.search).get("perf") === "1" || sticky();
  if (!wanted) return;
  state.on = true;
  reset();
  /* The annotation pipeline's own counters, which are a separate switch for a
     separate reason (annotation-cost.ts): they sit in code that runs thousands
     of times per render, so they are off unless asked for — and `?perf=1` is
     the asking, in a browser. `"counts"` is the default and the mode the
     decision is made in; `__perf.setAnnotationCostMode("full")` adds the leaf
     timers for a diagnostic run whose absolute numbers are not the decision. */
  startAnnotationCost();

  const realTimeout = window.setTimeout;
  const realInterval = window.setInterval;
  const realFrame = window.requestAnimationFrame;
  const realFetch = window.fetch;

  // `as never` on the assignments: the DOM lib types these as overloaded
  // callables with a `__promisify__` property, and reproducing that shape buys
  // nothing here. The behaviour is what matters and it is exact.
  /* `...rest` is forwarded, and that is a bug fix rather than thoroughness:
     `setTimeout(fn, ms, a, b)` calls `fn(a, b)`, and the first version of this
     dropped those arguments. A probe that silently changes what a callback
     receives is worse than no probe — the app would misbehave only while being
     measured, which is the hardest kind of fault to think about. The string
     form is passed straight through untouched for the same reason. */
  /* `Reflect.apply(fn, window, rest)` rather than `fn(...rest)`: a native timer
     calls a function handler with the global as its receiver, and an arrow
     calling `fn(...)` passes `undefined` in strict mode. Code that reads `this`
     inside a `setTimeout` callback would then behave differently *only under
     `?perf=1`* — which is the failure mode this whole probe has to avoid, since
     the fault would vanish every time anybody tried to reproduce it without
     measuring. `rest` is forwarded for the same reason: `setTimeout(fn, ms, a)`
     calls `fn(a)`, and the first version dropped it. The string form of the
     handler is passed straight through untouched. */
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (typeof fn !== "function") return realTimeout(fn, ms, ...rest);
    const where = callSite();
    return realTimeout(
      () => timed("timers", `setTimeout ${where}`, () => Reflect.apply(fn, window, rest)),
      ms,
    );
  }) as never;

  window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (typeof fn !== "function") return realInterval(fn, ms, ...rest);
    const where = callSite();
    return realInterval(
      () => timed("timers", `setInterval ${where}`, () => Reflect.apply(fn, window, rest)),
      ms,
    );
  }) as never;

  window.requestAnimationFrame = ((fn: FrameRequestCallback) =>
    realFrame((t) => timed("frames", "raf", () => Reflect.apply(fn, window, [t])))) as never;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    const bucket = live();
    bucket.fetches += 1;
    if (path === "/api/jobs") bucket.jobPolls += 1;
    bump(state.fetchPaths, path);
    return realFetch(input, init);
  }) as never;

  // The >50ms subset, for cross-checking against DevTools' own number. Wrapped
  // because `longtask` is not universal and an unsupported entry type throws
  // rather than being ignored.
  try {
    new PerformanceObserver((list) => {
      const bucket = live();
      for (const entry of list.getEntries()) {
        bucket.blockingMs += entry.duration;
        bucket.longTasks += 1;
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* Chrome-only, and its absence is not worth a warning in the console of a
       browser that was never going to be the one we profile on. */
  }

  document.addEventListener("visibilitychange", settleClock);

  const globals = window as unknown as Record<string, unknown>;
  globals.__perf = {
    report,
    reset,
    spin,
    state,
    annotationCost,
    resetAnnotationCost,
    setAnnotationCostMode,
  };
  // console rather than the app's logger on purpose: this is a developer tool
  // talking to a developer's devtools, not the server talking to an operator.
  // See the logging rule in CLAUDE.md — the rule is the destination.
  console.log("[perf] on — window.__perf.report()");
}
