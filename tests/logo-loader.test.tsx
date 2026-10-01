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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_ANIMATIONS } from "../src/web/logo-animation.js";
import {
  LETTERS_START_MS,
  LOADER_EXCLUDED,
  LOADER_HOLD_MS,
  LOADER_TRACKS,
  LogoLoader,
  MARK_START_MS,
} from "../src/web/LogoLoader.js";

const CSS = readFileSync(
  path.join(import.meta.dirname, "..", "src", "web", "styles", "logo-animations.css"),
  "utf8",
);

/** Every rule outside a keyframe block, comments removed: [selector, body]. */
const BLOCKS: [string, string][] = [
  ...CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes\s+[a-z0-9-]+\s*\{[\s\S]*?\n\}/g, "")
    .matchAll(/([^{};]+)\{([^{}]*)\}/g),
].flatMap((m) =>
  (m[1] as string).split(",").map((s) => [s.trim(), m[2] as string] as [string, string]),
);

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

/** `1.4s` or `640ms` as milliseconds; `null` for anything computed. */
function ms(t: string | undefined): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(t ?? "");
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "s" ? 1000 : 1));
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
  it("holds every draw for whole loops of itself, so a swap lands at rest", () => {
    const offenders: string[] = [];
    for (const [id, hold] of Object.entries(LOADER_HOLD_MS)) {
      const animated = rulesOf(id).filter(([, body]) => /animation:/.test(body));
      if (animated.length === 0 && !hold.rest) offenders.push(`${id}: a transition with no rest`);
      for (const [selector, body] of animated) {
        const parts = (/animation:\s*([^;]+)/.exec(body)?.[1] ?? "").trim().split(/\s+/);
        const times = parts.map(ms).filter((x): x is number => x !== null);
        const duration = times[0];
        const delay = ms(/animation-delay:\s*([^;]+)/.exec(body)?.[1]?.trim()) ?? times[1] ?? 0;
        if (duration === undefined) {
          offenders.push(`${selector}: no duration read`);
          continue;
        }
        if (parts.includes("infinite")) {
          const looped = hold.run - delay;
          if (looped < duration || looped % duration !== 0)
            offenders.push(`${selector}: ${hold.run}ms is not whole ${duration}ms loops after ${delay}ms`);
        } else if (hold.run < duration + delay) {
          offenders.push(`${selector}: ${hold.run}ms ends before its ${duration + delay}ms run`);
        }
      }
    }
    expect(offenders).toEqual([]);
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

describe("LogoLoader", () => {
  it("starts at rest, then runs one from each track, and keeps changing", () => {
    act(() => root.render(<LogoLoader label="Fetching the article" />));
    expect(running()).toEqual([]);
    expect(host.textContent).toContain("Fetching the article…");

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
    act(() => vi.advanceTimersByTime(MARK_START_MS + 100));
    act(() => root.render(<div />));
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
});
