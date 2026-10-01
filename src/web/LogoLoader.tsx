/**
 * **The wordmark as a loading spinner**: the spider and the name, large and
 * centred, never doing the same thing for long.
 *
 * Greg, 2026-10-01 (spya-ns2v83):
 *
 * > Instead of "Fetching the article and its summaries", show an animated
 * > loading spinner. Perhaps actually it would be fun to make a rich, complex,
 * > fun, ever-morphing animation of the logo itself as the loading spinner?
 *
 * **Nothing here is a new animation.** It is the hover set from
 * logo-animation.ts and styles/logo-animations.css, run on two tracks at once:
 * one draws from the animations that move only the spider, the other from the
 * ones that move only the letters, and they start at different times, so the
 * spider and the word are always doing two different things and rarely change
 * together. The restrained ones (*Warm Drift*) would look stalled on their own;
 * beside a partner they read as texture. docs/project/loading-spinner.md has
 * the design.
 *
 * **Each draw is held for whole loops of itself** (`LOADER_HOLD_MS`), because
 * that is the only moment a class can change without a snap: a keyframe
 * animation removed mid-loop jumps home from wherever it was, and nothing can
 * ease it (logo-animations.css § A soft landing for The Settle).
 * tests/logo-loader.test.tsx reads every loop length out of the stylesheet and
 * fails if a hold here stops agreeing with it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { LOGO_ANIMATIONS, type LogoAnimation, pickFrom } from "./logo-animation.js";
import { LogoLetters, LogoMark } from "./LogoGlyphs.js";

/**
 * The hover animations the loader does not run, and why. Every animation is
 * either here or in `LOADER_HOLD_MS`, and the test fails on one in neither, so
 * a fourteenth hover animation is a decision rather than a default.
 */
export const LOADER_EXCLUDED: Readonly<Record<string, string>> = {
  "spya-strain": "moves the letters as well as the spider, so it would fight the letters track",
  "spya-dawn": "masks the whole host, so it would eat the other track",
  "spya-seam": "a held pose whose transition is scoped to its class, so leaving it snaps",
  "spya-i": "a held pose whose transition is scoped to its class, so leaving it snaps",
};

/**
 * How long each draw runs, then how long the track rests at the base style
 * before its next draw.
 *
 * A looping animation is held for a whole number of its loops, counted from
 * the end of its delay, so it is at its 100% frame — at rest, by the
 * stylesheet's own rule — when the class goes. A one-shot is held at least as
 * long as it runs, stagger included. The Settle is a transition and the one
 * with a rest: its exit eases along the resting `.logo-image` transition, and
 * the rest is that ease's time to finish before a keyframe takes the image.
 */
export const LOADER_HOLD_MS: Readonly<Record<string, { run: number; rest?: number }>> = {
  "spya-settle": { run: 1400, rest: 300 },
  "spya-warm": { run: 3200 }, // 1 × 3.2s
  "spya-dragline": { run: 3200 }, // 2 × 1.6s
  "spya-radius": { run: 2400 }, // 1 × 2.4s
  "spya-pluck": { run: 2800 }, // 2 × 1.4s
  "spya-sag": { run: 1800 }, // once, 1.6s
  "spya-register": { run: 1200 }, // once, 640ms + nine 20ms staggers
  "spya-type": { run: 2820 }, // the cursor: 700ms delay + 2 × 1.06s blink
  "spya-abseil": { run: 2000 }, // 1 × 2s
};

const eligible = (reach: LogoAnimation["reach"]) =>
  LOGO_ANIMATIONS.filter((a) => a.reach === reach && a.id in LOADER_HOLD_MS);

/** The two tracks, each a pool of animations that touch only its own half. */
export const LOADER_TRACKS = {
  mark: eligible("mark"),
  letters: eligible("letters"),
} as const;

/** When the letters' track starts: a beat after mount, so its first frame paints at rest. */
export const LETTERS_START_MS = 100;

/** When the spider's track starts — out of step with the letters from the first. */
export const MARK_START_MS = 1200;

/**
 * One track: the animation id now running on it, or `null` at rest. Starts at
 * rest, so the first draw is a change from a painted resting frame — the
 * transition-based Settle has nothing to move *from* on an element born with
 * its class (DesignPage.tsx § LogoAnimations says the same).
 */
function useTrack(pool: readonly LogoAnimation[], start: number, on: boolean): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!on) {
      setId(null);
      return;
    }
    let previous: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const draw = () => {
      const next = pickFrom(pool, previous);
      if (!next) return;
      previous = next.id;
      setId(next.id);
      const hold = LOADER_HOLD_MS[next.id] ?? { run: 2400 };
      timer = setTimeout(() => {
        if (hold.rest) {
          setId(null);
          timer = setTimeout(draw, hold.rest);
        } else draw();
      }, hold.run);
    };
    timer = setTimeout(draw, start);
    return () => clearTimeout(timer);
  }, [pool, start, on]);
  return id;
}

const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * Whether the reader has asked for reduced motion, **live**: a reader who
 * changes the setting during a long wait gets the still at once, timers and
 * all, not on the next page.
 */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const q = window.matchMedia?.(REDUCE);
      q?.addEventListener?.("change", changed);
      return () => q?.removeEventListener?.("change", changed);
    },
    () => window.matchMedia?.(REDUCE).matches ?? false,
  );
}

/**
 * The loader. `label` is the sentence the wait used to show, without its
 * ellipsis: visually hidden beside the animation, so a screen reader that
 * reaches it hears what is being waited for, and shown *instead* of the
 * animation to a reader who asked for reduced motion. Under the global guard
 * (tailwind.css) every one of these collapses to a still, so a cycling
 * wordmark would be a still logo that twitched between poses — neither motion
 * nor information.
 *
 * **Not a live region.** The page's title already announces the wait
 * (page-title.ts § articleWaitTitle), and a region created already filled
 * announces nothing anyway (page-title.ts § The three-step dance) — so a
 * second announcer here would be either silent or a duplicate.
 *
 * Draw it only once a wait is worth mentioning (useSlow.ts); it is not a
 * placeholder for a fast fetch.
 */
export function LogoLoader({ label }: { label: string }) {
  const still = useReducedMotion();
  const letters = useTrack(LOADER_TRACKS.letters, LETTERS_START_MS, !still);
  const mark = useTrack(LOADER_TRACKS.mark, MARK_START_MS, !still);

  if (still) return <div className="loading">{label}…</div>;

  const running = [letters, mark].filter((x): x is string => x !== null);
  return (
    <div className="tw:flex tw:items-center tw:justify-center tw:py-6">
      <span className="tw:sr-only">{label}…</span>
      <div
        className={`logo-loader tw:flex tw:items-center tw:gap-3 ${running.length ? `spya-anim ${running.join(" ")}` : ""}`}
        aria-hidden="true"
      >
        <LogoMark size={36} />
        <span className="tw:font-prose tw:text-3xl tw:text-foreground">
          <LogoLetters />
        </span>
      </div>
    </div>
  );
}
