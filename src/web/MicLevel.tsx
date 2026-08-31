/**
 * **The bars that move when you talk.**
 *
 * Five of them, and between them they answer the one question the microphone
 * button could not: *is anything getting in?* Everything about why is in
 * docs/plans/260827f-microphone-level-meter.md; this file is thirty lines of DOM.
 *
 * ## It does not re-render
 *
 * The level changes sixty times a second and React is told none of it. The
 * animation frame writes one CSS custom property — `--level`, on this
 * component's own root and nowhere wider — and the five bars are sized off it
 * in CSS. Scoping the property to the root rather than to `:root` matters: a
 * custom property invalidates everything below the element it is set on, and
 * setting it on the document would hand the whole page a style recalculation on
 * every frame.
 *
 * `transform: scaleY()`, never `height`. A height animated per frame is a
 * layout on every frame; a transform is composited and costs nothing.
 * `element.style.setProperty` does not itself force synchronous layout, so
 * writing it from the rAF is fine as long as nothing in the loop *reads* layout
 * back — and nothing does. GPT Sol's review, 2026-08-27, item 8.
 *
 * Capped at 30Hz. The eye cannot follow a level meter faster than that, and a
 * 120Hz display would otherwise do four times the work for no visible gain.
 *
 * ## Two sources, one appearance
 *
 * `useDictation` hands over either a real RMS off the track being transcribed,
 * or — on browsers where the spec's `start(audioTrack)` is missing, so there is
 * no safe way to get samples — the recogniser's own `soundstart`/`soundend` as
 * a 0 or a 1. Both are real observations of the real audio, so both drive the
 * same bars; the second is simply coarser, and the CSS transition on
 * `.mic-level.detected` is what stops it snapping. Neither is ever invented,
 * which is the property that makes the meter worth looking at.
 */
import { type MutableRefObject, useEffect, useRef } from "react";

/** Enough to read as a level, few enough to fit beside a line of text. */
const BARS = 5;
/**
 * How much of the level each bar takes, centre-weighted.
 *
 * A row of identical bars rising together reads as one fat bar. Weighting the
 * middle taller makes it read as a waveform, which is what people already know
 * a microphone level looks like — the shape is doing the explaining.
 */
const WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];
const MIN_FPS_MS = 1000 / 30;

export function MicLevel({
  level,
  detected,
}: {
  /** 0..1, read every frame. Never read during render. */
  level: MutableRefObject<number>;
  /** True when the number is the recogniser's binary sound flag rather than an RMS. */
  detected: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    let lastAt = 0;
    let lastWritten = -1;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastAt < MIN_FPS_MS) return;
      lastAt = now;
      const value = Math.min(1, Math.max(0, level.current));
      /* Rounded, and skipped when unchanged. Two decimal places is finer than
         26 pixels of bar can show, and not writing an identical value keeps a
         silent room from invalidating style sixty — well, thirty — times a
         second for no reason. */
      const rounded = Math.round(value * 100) / 100;
      if (rounded === lastWritten) return;
      lastWritten = rounded;
      el.style.setProperty("--level", String(rounded));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  return (
    /* `aria-hidden`, because this is a picture of a number that the strip
       beside it already says in words. A screen reader reading five unlabelled
       bars thirty times a second would be actively hostile. */
    <span
      ref={root}
      className={`mic-level${detected ? " detected" : ""}`}
      aria-hidden="true"
      style={{ "--level": 0 } as React.CSSProperties}
    >
      {WEIGHTS.slice(0, BARS).map((w, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed bars, never reordered
          key={i}
          style={{ "--w": w } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
