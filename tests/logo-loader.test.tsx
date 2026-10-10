// @vitest-environment jsdom
/**
 * **The loading wordmark (LogoLoader.tsx): two tracks that must not fight, and
 * hand-overs that must not snap.**
 *
 * The loader runs one spider animation and one letters animation on the same
 * host at once. That is only safe while every animation in the spider's track
 * touches nothing but the spider, and every one in the letters' track nothing
 * but the letters — otherwise two rules set `animation` on one element, the
 * later one wins on source order, and one track silently does nothing for as
 * long as that pair is drawn. Nobody would report it: the loader still moves.
 *
 * And it swaps each track's animation when the draw's hold runs out, which is
 * snap-free only if the hold is a whole number of that animation's loops. The
 * loop lengths live in the stylesheet and the holds in the component, kept in
 * agreement by nothing but this file.
 *
 * Both are read off the stylesheet's own rules, the way
 * tests/logo-animation.test.tsx checks `reach`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_ANIMATIONS } from "../src/web/logo-animation.js";
import {
  LETTERS_START_MS,
  LOADER_EXCLUDED,
  LOADER_HOLD_MS,
  LOADER_TRACKS,
  LogoLoader,
  MARK_START_MS,
  useTrack,
} from "../src/web/LogoLoader.js";
import type { LogoAnimation } from "../src/web/logo-animation.js";

const CSS = readFileSync(
  path.join(import.meta.dirname, "..", "src", "web", "styles", "logo-animations.css"),
  "utf8",
);

type CssRule = [selector: string, body: string];

/** Split on a delimiter only outside CSS functions. */
function splitTopLevel(text: string, delimiter: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (delimiter === "," ? c === "," : /\s/.test(c ?? ""))) {
      const part = text.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function closingBrace(text: string, open: number): number {
  let depth = 1;
  let end = open + 1;
  while (end < text.length && depth > 0) {
    if (text[end] === "{") depth++;
    else if (text[end] === "}") depth--;
    end++;
  }
  return end;
}

/**
 * Every qualified rule, recursively through conditional at-rules and never
 * through keyframes. A regex over braces cannot make both of those promises.
 */
function cssRules(source: string): CssRule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: CssRule[] = [];

  function visit(text: string): void {
    let boundary = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ";") {
        boundary = i + 1;
        continue;
      }
      if (text[i] !== "{") continue;
      const prelude = text.slice(boundary, i).trim();
      const end = closingBrace(text, i);
      const body = text.slice(i + 1, end - 1);
      if (/^@(media|supports|layer|container)\b/.test(prelude)) visit(body);
      else if (!prelude.startsWith("@")) {
        for (const selector of splitTopLevel(prelude, ",")) found.push([selector, body]);
      }
      i = end - 1;
      boundary = end;
    }
  }

  visit(clean);
  return found;
}

const BLOCKS = cssRules(CSS);

/** The rules that name this animation's class, bar the marketing bar's own variants. */
function rulesOf(id: string): [string, string][] {
  const named = new RegExp(`\\.${id}(?![a-z0-9-])`);
  return BLOCKS.filter(([s]) => named.test(s) && !s.includes(".site-wordmark-host"));
}

/** Which half of the wordmark a selector reaches. */
function half(selector: string): "letters" | "mark" | "host" {
  if (/\.logo-letter|\.site-wordmark-rest/.test(selector)) return "letters";
  if (/\.logo-image|\.logo-mark/.test(selector)) return "mark";
  return "host";
}

/** `1.4s` or `640ms` as milliseconds. */
function literalMs(t: string | undefined): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(t ?? "");
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "s" ? 1000 : 1));
}

/** A literal delay, or the ten values of this sheet's `--i` stagger. */
function delayMs(value: string | undefined): number[] | null {
  const literal = literalMs(value);
  if (literal !== null) return [literal];
  const calc = /^calc\(var\(--i\)\s*\*\s*(\d*\.?\d+)(ms|s)(?:\s*\+\s*(\d*\.?\d+)(ms|s))?\)$/.exec(
    value ?? "",
  );
  if (!calc) return null;
  const step = literalMs(`${calc[1]}${calc[2]}`) ?? 0;
  const base = calc[3] ? (literalMs(`${calc[3]}${calc[4]}`) ?? 0) : 0;
  return Array.from({ length: 10 }, (_, i) => base + i * step);
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

/** The declarations that win on the loader target, including loader-only overrides. */
function timedTargets(id: string): { selector: string; values: Map<string, string> }[] {
  const rules = rulesOf(id);
  const targets = new Map<string, Map<string, string>>();
  for (const [selector, body] of rules) {
    const values = declarations(body);
    if (!values.has("animation")) continue;
    const target = selector.replace(".logo-loader", "");
    targets.set(target, new Map(values));
  }
  for (const [selector, body] of rules) {
    const target = selector.replace(".logo-loader", "");
    const values = targets.get(target);
    if (!values) continue;
    for (const [property, value] of declarations(body)) values.set(property, value);
  }
  return [...targets].map(([selector, values]) => ({ selector, values }));
}

function animationTiming(values: Map<string, string>): {
  duration: number;
  delays: number[];
  iterations: number | "infinite";
} | null {
  const tokens = splitTopLevel(values.get("animation") ?? "", " ");
  const times = tokens.map(literalMs).filter((x): x is number => x !== null);
  const duration = times[0];
  if (duration === undefined) return null;
  const delays = delayMs(values.get("animation-delay")) ?? [times[1] ?? 0];
  const count = values.get("animation-iteration-count") ?? tokens.find((t) => t === "infinite" || /^\d+$/.test(t));
  return { duration, delays, iterations: count === "infinite" ? "infinite" : Number(count ?? 1) };
}

function transitionMs(body: string): number | null {
  const value = declarations(body).get("transition") ?? "";
  return splitTopLevel(value, " ").map(literalMs).find((time) => time !== null) ?? null;
}

function targetTimingOffenders(
  selector: string,
  timing: NonNullable<ReturnType<typeof animationTiming>>,
  run: number,
): string[] {
  if (timing.iterations !== "infinite") {
    const complete = Math.max(...timing.delays) + timing.duration * timing.iterations;
    return run < complete ? [`${selector}: ${run}ms ends before its ${complete}ms run`] : [];
  }
  return timing.delays.flatMap((delay) => {
    const looped = run - delay;
    return looped < timing.duration || looped % timing.duration !== 0
      ? [`${selector}: ${run}ms is not whole ${timing.duration}ms loops after ${delay}ms`]
      : [];
  });
}

function holdTimingOffenders(id: string, hold: { run: number; rest?: number }): string[] {
  const animated = timedTargets(id);
  if (animated.length === 0) return hold.rest ? [] : [`${id}: a transition with no rest`];
  return animated.flatMap(({ selector, values }) => {
    const timing = animationTiming(values);
    return timing
      ? targetTimingOffenders(selector, timing, hold.run)
      : [`${selector}: timing could not be read`];
  });
}

describe("the loader's two tracks", () => {
  it("reads the stylesheet at all", () => {
    expect(rulesOf("spya-radius").length).toBeGreaterThan(0);
    expect(rulesOf("spya-pluck").length).toBeGreaterThan(0);
  });

  it("keeps each track to its own half of the wordmark", () => {
    const offenders: string[] = [];
    for (const [track, pool] of Object.entries(LOADER_TRACKS)) {
      for (const a of pool) {
        const found = rulesOf(a.id);
        if (found.length === 0) offenders.push(`${a.id}: no rule found`);
        for (const [s] of found) if (half(s) !== track) offenders.push(`${track} ← ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("decides every hover animation: in a track, or excluded with a reason", () => {
    const ids = LOGO_ANIMATIONS.map((a) => a.id);
    const decided = [...Object.keys(LOADER_HOLD_MS), ...Object.keys(LOADER_EXCLUDED)];
    expect([...decided].sort()).toEqual([...ids].sort());
    const tracked = [...LOADER_TRACKS.mark, ...LOADER_TRACKS.letters].map((a) => a.id);
    expect([...tracked].sort()).toEqual(Object.keys(LOADER_HOLD_MS).sort());
    expect(LOADER_TRACKS.mark.length).toBeGreaterThan(1);
    expect(LOADER_TRACKS.letters.length).toBeGreaterThan(1);
  });

  /* The class goes when the hold runs out. For a loop that is snap-free only at
     a loop boundary, counted from the end of the delay; for a one-shot, only
     once it has finished; and an animation with no keyframes at all (a
     transition) needs a rest to ease home in before the next draw. */
  it("holds every draw for complete runs, so a swap lands at rest", () => {
    const offenders = Object.entries(LOADER_HOLD_MS).flatMap(([id, hold]) =>
      holdTimingOffenders(id, hold),
    );
    expect(offenders).toEqual([]);
  });

  it("sees computed staggers, Retype's two clocks, and the @supports-nested Radius rule", () => {
    expect(
      Object.fromEntries(Object.keys(LOADER_HOLD_MS).map((id) => [id, timedTargets(id).length])),
    ).toEqual({
      "spya-settle": 0,
      "spya-warm": 1,
      "spya-dragline": 2,
      "spya-radius": 1,
      "spya-pluck": 1,
      "spya-sag": 1,
      "spya-register": 1,
      "spya-type": 2,
      "spya-abseil": 2,
      "spya-dew": 1,
      "spya-hop": 2,
      "spya-asterisk": 1,
      "spya-magnifier": 3,
      "spya-pacing": 1,
      "spya-lines": 1,
      "spya-semaphore": 2,
      "spya-quotes": 2,
      "spya-click": 1,
      "spya-shed": 1,
      "spya-xref": 1,
      "spya-skim": 1,
      "spya-tex": 1,
    });
    expect(animationTiming(timedTargets("spya-pluck")[0]?.values ?? new Map())?.delays.at(-1)).toBe(306);
    expect(timedTargets("spya-type").map(({ selector }) => selector).sort()).toEqual([
      ".spya-type .logo-letter",
      ".spya-type .logo-letter:nth-child(10)::after",
    ]);
    expect(animationTiming(timedTargets("spya-type")[0]?.values ?? new Map())?.delays.at(-1)).toBe(615);
    expect(timedTargets("spya-radius").map(({ selector }) => selector)).toEqual([
      ".spya-radius .logo-mark::after",
    ]);
    expect(
      animationTiming(new Map([["animation", "example 2s 180ms ease-in-out infinite"]])),
    ).toEqual({ duration: 2000, delays: [180], iterations: "infinite" });
  });

  it("lets Settle finish both its entrance and its resting exit", () => {
    const hold = LOADER_HOLD_MS["spya-settle"];
    const entrance = rulesOf("spya-settle").map(([, body]) => transitionMs(body)).find((x) => x !== null);
    const exit = BLOCKS.filter(([selector]) => selector === ".logo-image")
      .map(([, body]) => transitionMs(body))
      .find((x) => x !== null);
    expect(entrance).toBe(260);
    expect(exit).toBe(220);
    expect(hold?.run).toBeGreaterThanOrEqual(entrance ?? Number.POSITIVE_INFINITY);
    expect(hold?.rest).toBeGreaterThanOrEqual(exit ?? Number.POSITIVE_INFINITY);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The animation ids on the loader's host, in no order. */
function running(): string[] {
  const el = host.querySelector(".logo-loader");
  return [...(el?.classList ?? [])].filter((c) => c.startsWith("spya-") && c !== "spya-anim");
}

const trackOf = (id: string) =>
  LOADER_TRACKS.mark.some((a) => a.id === id) ? "mark" : "letters";

function paintLoader(): void {
  act(() => vi.advanceTimersToNextTimer());
}

function TrackProbe({ pool, start = 10, on }: { pool: readonly LogoAnimation[]; start?: number; on: boolean }) {
  const id = useTrack(pool, start, on);
  return <div data-track={id ?? "rest"} />;
}

describe("LogoLoader", () => {
  it("starts at rest, then runs one from each track, and keeps changing", () => {
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    expect(running()).toEqual([]);
    expect(host.textContent).toContain("Fetching the article…");

    /* The first pending callback is the paint barrier; neither class is born
       on the wordmark, including transition-based Settle. */
    paintLoader();
    expect(running()).toEqual([]);
    act(() => vi.advanceTimersByTime(LETTERS_START_MS));
    expect(running().map(trackOf)).toEqual(["letters"]);

    act(() => vi.advanceTimersByTime(MARK_START_MS - LETTERS_START_MS));
    expect(running().map(trackOf).sort()).toEqual(["letters", "mark"]);

    /* Each track changes draw, and never to the one it just ran. */
    const history: Record<string, string[]> = { mark: [], letters: [] };
    for (let i = 0; i < 400; i++) {
      act(() => vi.advanceTimersByTime(50));
      for (const id of running()) {
        const h = history[trackOf(id)] as string[];
        if (h.at(-1) !== id) h.push(id);
      }
    }
    for (const h of Object.values(history)) expect(h.length).toBeGreaterThan(3);
  });

  it("stops its timers when it goes", () => {
    act(() => root.render(<LogoLoader label="x" />));
    paintLoader();
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    act(() => root.render(<div />));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears and rearms a pool of one, so the same animation can restart", () => {
    const pool = LOADER_TRACKS.mark.filter((a) => a.id === "spya-warm");
    const id = pool[0]?.id;
    expect(id).toBeDefined();
    act(() => root.render(<TrackProbe pool={pool} on />));
    act(() => vi.advanceTimersByTime(10));
    expect(host.firstElementChild?.getAttribute("data-track")).toBe(id);

    act(() => vi.advanceTimersByTime(LOADER_HOLD_MS[id as string]?.run ?? 0));
    expect(host.firstElementChild?.getAttribute("data-track")).toBe("rest");
    act(() => vi.advanceTimersByTime(50));
    expect(host.firstElementChild?.getAttribute("data-track")).toBe(id);
  });

  it("has one timer under StrictMode, and stops immediately while off", () => {
    const pool = LOADER_TRACKS.letters.slice(0, 2);
    act(() =>
      root.render(
        <StrictMode>
          <TrackProbe pool={pool} on />
        </StrictMode>,
      ),
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(10));
    expect(host.firstElementChild?.getAttribute("data-track")).not.toBe("rest");

    act(() =>
      root.render(
        <StrictMode>
          <TrackProbe pool={pool} on={false} />
        </StrictMode>,
      ),
    );
    expect(host.firstElementChild?.getAttribute("data-track")).toBe("rest");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says the sentence, and runs nothing, for a reader who asked for reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    act(() => vi.advanceTimersByTime(MARK_START_MS * 3));
    expect(host.querySelector(".logo-loader")).toBeNull();
    expect(host.textContent).toBe("Fetching the article…");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the sentence available without creating a second live region", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    expect(host.querySelector(".tw\\:sr-only")?.textContent).toBe("Fetching the article…");
    expect(host.querySelector(".logo-loader")?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector("[role=status], [aria-live]")).toBeNull();
  });

  it("animates normally in a browser without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    paintLoader();
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    expect(running()).toHaveLength(2);
  });

  it("stops at once when the reader turns reduced motion on mid-wait", () => {
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reduce;
      },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }));
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    paintLoader();
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    expect(running()).toHaveLength(2);

    reduce = true;
    act(() => {
      for (const f of listeners) f();
    });
    expect(host.querySelector(".logo-loader")).toBeNull();
    expect(host.textContent).toBe("Fetching the article…");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("subscribes once even while animation state rerenders it", () => {
    let adds = 0;
    let removes = 0;
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => adds++,
      removeEventListener: () => removes++,
    }));
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    paintLoader();
    expect(adds).toBe(1);
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    expect(adds).toBe(1);
    expect(removes).toBe(0);
  });

  it("follows old Safari's addListener-only MediaQueryList", () => {
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reduce;
      },
      addListener: (f: () => void) => listeners.add(f),
      removeListener: (f: () => void) => listeners.delete(f),
    }));
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    paintLoader();
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    expect(running()).toHaveLength(2);

    reduce = true;
    act(() => {
      for (const f of listeners) f();
    });
    expect(host.querySelector(".logo-loader")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has a deterministic server snapshot without window", () => {
    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    try {
      expect(renderToStaticMarkup(<LogoLoader label="Fetching the article" />)).toContain(
        "Fetching the article…",
      );
    } finally {
      vi.stubGlobal("window", browserWindow);
    }
  });
});
