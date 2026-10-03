/**
 * **A share of a whole, drawn as a small pie rather than printed as a
 * percentage** — the exact figure, and what it is a share of, behind a card.
 *
 * Greg, 2026-10-01 (spya-mafmm6), about the quiz's "about 40% of the piece
 * read so far":
 *
 * > use a little pie-chart or sparkline, with a rich tooltip (see tooltips.md).
 *
 * It is `ScoreBars`' sibling: the figure in words in an `aria-label`, so a
 * screen reader never needs the card, and a real `Tooltip`, never a `title`.
 * Generic on purpose, so the next share of a whole reuses this rather than
 * drawing a second pie (docs/project/design-css-overview.md § Draw a number
 * rather than print it).
 *
 * **The slice is the exact share, never clamped.** A tiny share draws a
 * sliver too thin to see and nearly all draws a near-disc; the card's words
 * ("under 1%", "over 99%", from `readShareLabel`) are where that edge is told.
 * A 4%/96% clamp was in the plan and GPT Sol struck it: drawing 0.1% unread as
 * 4% is forty times too much, the picture lying in order to look legible.
 *
 * **The trigger is a button, so a finger and the keyboard reach the card**,
 * where `ScoreBars` is a bare span. Hover opens it for a mouse; a tap opens it
 * until the reader taps elsewhere or presses Escape (the `Tooltip`'s
 * `useDismiss`); focus opens it for the keyboard. A mouse click opens it too,
 * but does not pin this non-interactive card: leaving the trigger closes it as
 * an ordinary hover card.
 * Controlled, because the controlled `Tooltip` ignores a touch's synthesised
 * hover (Tooltip.tsx § `mouseOnly`), which would otherwise close the card the
 * tap just opened. The pie is 14px and the button 24px, so a finger has
 * something to hit; a negative margin takes the difference back so the row
 * does not grow.
 */
import { type ReactElement, type ReactNode, useState } from "react";
import { TipNote, Tooltip } from "./Tooltip.js";

/** The view box is centred on the origin: radius 6, drawn in a 14px square. */
const R = 6;

export type PieSlice = { kind: "none" } | { kind: "full" } | { kind: "slice"; d: string };

/**
 * Six decimals, and never `-0`: enough to keep a one-in-a-million edge from
 * collapsing to the arc's start while leaving the path stable enough to test.
 */
function fmt(n: number): string {
  return String(Math.round(n * 1_000_000) / 1_000_000 + 0);
}

/**
 * The slice for `share` of a circle of radius `r` centred on the origin,
 * from twelve o'clock clockwise. A single SVG arc cannot draw 360°, so all of
 * it is its own case rather than a path.
 */
export function pieSlice(share: number, r: number): PieSlice {
  if (!Number.isFinite(share) || share <= 0) return { kind: "none" };
  if (share >= 1) return { kind: "full" };
  const angle = share * 2 * Math.PI;
  const x = r * Math.sin(angle);
  const y = -r * Math.cos(angle);
  const large = share > 0.5 ? 1 : 0;
  return { kind: "slice", d: `M0 0 L0 ${fmt(-r)} A${r} ${r} 0 ${large} 1 ${fmt(x)} ${fmt(y)} Z` };
}

export function SharePie({
  share,
  label,
  detail,
  className,
}: {
  /** 0–1. Not a finite number, or at most 0, draws none; 1 or more draws all. */
  share: number;
  /** The figure in words — the card's first line and the button's name. */
  label: string;
  /** What the figure is a share of, or how it is counted. The card's second line. */
  detail?: ReactNode;
  className?: string;
}): ReactElement {
  const slice = pieSlice(share, R);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      placement="top"
      open={open}
      onOpenChange={setOpen}
      content={
        <>
          <p>{label}</p>
          {detail !== undefined && <TipNote>{detail}</TipNote>}
        </>
      }
    >
      <button
        type="button"
        className={["share-pie", className].filter(Boolean).join(" ")}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true">
          <circle className="share-pie-whole" r={R} />
          {slice.kind === "full" && <circle className="share-pie-part" r={R} />}
          {slice.kind === "slice" && <path className="share-pie-part" d={slice.d} />}
        </svg>
      </button>
    </Tooltip>
  );
}
