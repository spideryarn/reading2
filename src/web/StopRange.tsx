/**
 * **The range input under every numeric threshold slider**, which moves only
 * to the values that change the list and draws a tick at each one.
 *
 * Greg, 2026-10-17 (spya-t80rep):
 *
 * > I'd rather that, as I slide it, it jumps to the values that will affect
 * > the number of results shown. And/or little visual ticks on the slider that
 * > show where within the spectrum such thresholds are.
 *
 * So a drag or a tap lands on the nearest stop, an arrow key moves to the next
 * stop that changes the list (threshold.ts § stepToStop), and a faint tick sits
 * under the track at each stop's true position. The track stays linear — the
 * caller's `min`, `max` and `step` — so the ticks say where on the spectrum the
 * scores bunch, which an index into the stops (Quotes' track until this) could
 * not.
 *
 * Still a native `<input type="range">`, for the reasons every slider here
 * gives: dragging, touch and the screen reader's own value announcement come
 * free. What is added is a snap in `onChange` and an `onKeyDown`.
 *
 * With no stops — an unscored list — it is the plain input, native step and all.
 *
 * Used by `ThresholdSlider` (Glossary, Citations, FAQ), Search's `ConfSlider`
 * and Quotes' `BarSlider`. Reception's `StopBar` is not one of them: its stops
 * are words, one per position already.
 * docs/plans/261017f-threshold-sliders-jump-between-the-values-that-change-the-count.md.
 */
import { type CSSProperties, type KeyboardEvent, useEffect, useRef } from "react";
import { nearestStop, stepToStop } from "./threshold.js";

export function StopRange({
  id,
  min,
  max,
  step,
  value,
  stops,
  title,
  valueText,
  onChange,
}: {
  /** The input's id, for its label. */
  id: string;
  min: number;
  max: number;
  /** `"any"` for scores on no grid (Quotes); the snap keeps the thumb on a stop. */
  step: number | "any";
  value: number;
  /** Ascending and distinct — threshold.ts § thresholdStops. */
  stops: readonly number[];
  title: string;
  /** `aria-valuetext`: the count, since a thumb position is a number nobody can hear. */
  valueText: string;
  onChange(value: number): void;
}) {
  const span = max - min;
  /* Is a pointer (mouse, pen or finger) on the control? Only then does a
     change mean "here", to be snapped to the nearest stop. Any other change —
     TalkBack's swipe, which moves the native value one step without a key
     event (WAI's slider pattern says touch assistive technologies do not all
     synthesise keys) — means "one more that way", and gets a stop in that
     direction; snapping it to the nearest would put it straight back. GPT Sol's
     plan review, P1. */
  const pointer = useRef(false);

  useEffect(() => {
    /* A mouse does not implicitly capture its pointer, so a drag can finish
       outside the input and never reach its `onPointerUp`. Clear at the
       window boundary as well; blur covers a release after the whole window
       lost focus. Mouse and touch are fallbacks for browsers that do not
       expose Pointer Events. */
    const endPointer = () => {
      pointer.current = false;
    };
    window.addEventListener("pointerup", endPointer, true);
    window.addEventListener("pointercancel", endPointer, true);
    window.addEventListener("mouseup", endPointer, true);
    window.addEventListener("touchend", endPointer, true);
    window.addEventListener("touchcancel", endPointer, true);
    window.addEventListener("blur", endPointer);
    return () => {
      window.removeEventListener("pointerup", endPointer, true);
      window.removeEventListener("pointercancel", endPointer, true);
      window.removeEventListener("mouseup", endPointer, true);
      window.removeEventListener("touchend", endPointer, true);
      window.removeEventListener("touchcancel", endPointer, true);
      window.removeEventListener("blur", endPointer);
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (stops.length === 0) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
      case "PageUp":
        next = stepToStop(stops, value, 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
      case "PageDown":
        next = stepToStop(stops, value, -1);
        break;
      case "Home":
        next = stops[0] ?? value;
        break;
      case "End":
        next = stops[stops.length - 1] ?? value;
        break;
      default:
        return;
    }
    /* Always, even when there is nowhere to go: the browser's own 0.01 step
       would otherwise run as well and land between stops. */
    e.preventDefault();
    if (next !== value) onChange(next);
  }

  return (
    <div className="gloss-gate-track">
      <input
        id={id}
        className="gloss-gate-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title={title}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          pointer.current = true;
        }}
        onPointerUp={() => {
          pointer.current = false;
        }}
        onPointerCancel={() => {
          pointer.current = false;
        }}
        onMouseDown={() => {
          pointer.current = true;
        }}
        onMouseUp={() => {
          pointer.current = false;
        }}
        onTouchStart={() => {
          pointer.current = true;
        }}
        onTouchEnd={() => {
          pointer.current = false;
        }}
        onTouchCancel={() => {
          pointer.current = false;
        }}
        onChange={(e) => {
          const raw = Number.parseFloat(e.target.value);
          /* Firefox fires `input` for a press on the thumb that moves nothing;
             without this, an off-stop default would jump at a mere touch. */
          if (Number.isNaN(raw) || raw === value) return;
          const next = pointer.current
            ? nearestStop(stops, raw)
            : stepToStop(stops, value, raw > value ? 1 : -1);
          /* With no stops both return what they were given: the plain input. */
          if (next !== value) onChange(stops.length === 0 ? raw : next);
        }}
      />
      {stops.length > 0 && span > 0 && (
        <div className="gloss-gate-ticks" aria-hidden="true">
          {stops.map((s) => (
            <span
              key={s}
              className="gloss-gate-tick"
              style={{ "--at": String(Math.min(Math.max((s - min) / span, 0), 1)) } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
