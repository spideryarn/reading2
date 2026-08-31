/**
 * **The model's 0–1 judgments, drawn rather than printed** — two or three
 * hairline bars on a list row, with the numbers behind a tooltip.
 *
 * Greg, 2026-08-31:
 *
 * > Prefer to use UI (e.g. a little sparkline/bar rather than numbers) plus
 * > tooltip instead of numbers for the most-striking values, etc. Same goes for
 * > Glossary etc.
 *
 * So this is one component used by both panels, and being one is the point. The
 * glossary and the quotes are showing the same *kind* of thing — a score the
 * model produced, on a row the reader is scanning — and two panels drawing that
 * two ways would teach the reader it means two things. It is the same argument
 * the two provenance rules already make (`gloss-part-senseHere` and
 * `gloss-part-background` are reused by the ideas panel rather than
 * re-declared).
 *
 * ## Why a bar reads better than `d·72 c·85`
 *
 * A row's job is to be **skimmed**. Two decimal numbers are read, not skimmed:
 * the eye stops, parses digits, and compares them against a scale it has to
 * remember. A bar is a length, and lengths compare down a column without being
 * read at all — which is the whole of what a reader wants from a score list, and
 * it is exactly what the numbers were failing to give in an 18rem band where
 * they were also competing with the term or the sentence beside them.
 *
 * **The number is not lost, it is asked for.** It sits in the tooltip with the
 * name of what it measures, which is where it stops being noise and starts
 * being an answer.
 *
 * ## The three things that make this honest rather than decorative
 *
 * - **The scale is fixed at 0–1 and never normalised to the list.** A bar
 *   stretched to make the biggest score full-width would make every article
 *   look like it had one outstanding term, and two articles uncomparable. The
 *   track is always the whole of the scale, so an article whose scores are all
 *   middling *looks* middling.
 * - **A screen reader gets the number without hovering anything.** Each row of
 *   bars carries `role="img"` and an `aria-label` spelling out every score in
 *   words, so the information does not depend on a pointer — the failure a
 *   tooltip-only design would have. This is the same reasoning that put a
 *   `aria-valuetext` on the threshold slider.
 * - **The bars keep the order the scores were given in**, so a column of rows
 *   is comparable line by line. Nothing sorts them by value.
 *
 * ## What it does NOT do
 *
 * **It never draws a composite.** The panels rank on a product (glossary) or a
 * maximum (quotes), and neither is drawn here: that number is our arithmetic
 * dressed as the model's judgment, and one the reader can neither interpret nor
 * check. Only the scores the model actually returned get a bar.
 */
import type { ReactElement } from "react";
import { Tooltip } from "./Tooltip.js";

/** One score to draw: what it measures, and how the model rated it. */
export interface Score {
  /** The stable key — becomes the bar's class, so a panel can tint its own. */
  key: string;
  /** What this measures, in the words the reader gets. Goes in the tooltip and the label. */
  label: string;
  /** 0–1. Clamped when drawn, because a stored artefact is not a promise. */
  value: number;
}

/** `0.72` → `72%` of the track, and never outside it. */
function width(value: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${(clamped * 100).toFixed(0)}%`;
}

/** "Difficulty 72 out of 100" — the sentence a screen reader reads out. */
function spoken(scores: Score[]): string {
  return scores.map((s) => `${s.label} ${Math.round(s.value * 100)} out of 100`).join(", ");
}

/**
 * The bars, with the numbers on hover, focus or tap.
 *
 * **Not focusable itself**, and that is deliberate rather than an oversight: a
 * list of terms already has one tab stop per row and adding a second for a
 * decoration would double the cost of tabbing past the panel. What replaces
 * focus is the `aria-label` — a screen reader gets the numbers from the label
 * without needing to reach the tooltip at all, which is a better answer than a
 * tab stop because it does not depend on the reader finding it.
 *
 * The tooltip is therefore for pointers, and it is a genuine `Tooltip` rather
 * than a `title=` attribute so that it is styled, positioned and dismissible
 * like every other one in the app (docs/project/tooltips.md).
 */
export function ScoreBars({
  scores,
  className,
}: {
  scores: Score[];
  /** Extra class for per-panel spacing. The bars themselves look the same everywhere. */
  className?: string;
}): ReactElement | null {
  if (scores.length === 0) return null;

  const detail = scores.map((s) => `${s.label}: ${s.value.toFixed(2)}`).join(" · ");

  return (
    <Tooltip content={detail} placement="left" className="score-bars-card">
      {/* biome-ignore lint/a11y/useSemanticElements: `<meter>` is the obvious
          tag and is the wrong one — it carries its own UA-drawn appearance in
          every engine, which cannot be restyled consistently and cannot be
          stacked two to a row at this size. `role="img"` with a label that
          spells the numbers out is what ARIA has for a graphic that means
          something. */}
      <span
        className={["score-bars", className].filter(Boolean).join(" ")}
        role="img"
        aria-label={spoken(scores)}
      >
        {scores.map((score) => (
          <span key={score.key} className="score-bar">
            <span className={`score-bar-fill ${score.key}`} style={{ width: width(score.value) }} />
          </span>
        ))}
      </span>
    </Tooltip>
  );
}
