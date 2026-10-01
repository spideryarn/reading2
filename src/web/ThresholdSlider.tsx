/**
 * **A threshold slider, given every number it shows.** The row the Glossary's
 * `GateSlider` and Citations' `BarSlider` each draw for themselves — label,
 * value, `N of M`, a reset once the bar has moved, the range, and the foot line
 * — as one dumb component that computes nothing: the caller runs the one pass
 * (threshold.ts § applyThreshold) and hands over the counts, so the list and
 * the numbers here cannot disagree.
 *
 * The FAQ's is the first caller (2026-09-29). Moving the Glossary and Citations
 * onto it is deliberately separate work, with its own browser check — GPT Sol's
 * plan review, F4, in
 * docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md.
 *
 * The four decisions it carries are the Glossary's, and the argument for each
 * is beside `GateSlider` in GlossaryPanel.tsx: the track ends where the data
 * does (the caller's `max`), the count is on screen, the foot line is always
 * there wherever the slider is, and the reset appears only once there is
 * something to undo. A native range input, for its keyboard, touch and screen
 * reader behaviour for free.
 *
 * The shared "show items above a score" row — web-client.md#shared-code-client.
 */
import { RotateCcw } from "lucide-react";
import { GATE_STEP } from "./threshold.js";

export function ThresholdSlider({
  id,
  value,
  max,
  defaultValue,
  moved,
  visible,
  total,
  noun,
  title,
  note,
  onChange,
}: {
  /** The input's id, for its label. Unique on the page. */
  id: string;
  value: number;
  /** The track's right-hand end — `thresholdMax` over the caller's score. */
  max: number;
  /** Where the reset returns to. */
  defaultValue: number;
  /** Has the reader touched it? Only then is there a reset. */
  moved: boolean;
  /** How many items the bar shows, and of how many — from the same pass as the list. */
  visible: number;
  total: number;
  /** The plural noun, for the spoken value: "questions". */
  noun: string;
  /** What the bar measures, in the reader's words. */
  title: string;
  /** The foot line — threshold.ts § hiddenNote, with the caller's noun. */
  note: string;
  /** A number, or null to go back to the default. */
  onChange(value: number | null): void;
}) {
  const count = `${visible} of ${total}`;
  return (
    <div className="gloss-gate">
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor={id}>
          threshold
        </label>
        <span className="gloss-gate-value">
          {value.toFixed(2)} · {count}
        </span>
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
            title={`Back to ${defaultValue.toFixed(2)}`}
            aria-label={`Reset the threshold to ${defaultValue.toFixed(2)}`}
            onClick={() => onChange(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id={id}
        className="gloss-gate-range"
        type="range"
        min={0}
        max={max}
        step={GATE_STEP}
        value={value}
        title={title}
        aria-valuetext={`${value.toFixed(2)}, showing ${count} ${noun}`}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
      <p className="gloss-gate-note">{note}</p>
    </div>
  );
}
