/**
 * The four small pieces of chrome this tool draws more than once.
 *
 * WHY THESE ARE HERE RATHER THAN IMPORTED. The brief allowed importing
 * `src/web/components/ui/`, and both files there — `button.tsx` and
 * `toggle.tsx` — are self-contained in the sense that matters (no product
 * logic, no database). They are not portable, though, and the reason is the
 * palette rather than the code: they are written against `styles/tokens.css`,
 * which is dark-only by decision, and against `@custom-variant dark (&)` in
 * src/web/tailwind.css, which redefines Tailwind's `dark:` to mean "always".
 * Button alone carries five `dark:` utilities that depend on that redefinition.
 * Importing them into a page that has to work in daylight would mean either
 * copying the product's whole token file or shipping components whose dark
 * branch fires in light mode. So: the PATTERN is copied — `cva`-shaped
 * variants, a `data-slot` attribute, one radius, one height — and the imports
 * are not. Said out loud because the next person will wonder.
 *
 * `cn` is not imported either, for a smaller reason: it lives at
 * `src/web/lib/utils.ts`, outside `components/ui/`, and pulling it in would put
 * the `@/` alias into a tool whose whole point is that it does not reach into
 * `src/`. `cx` below is the two lines of it this file actually uses — no
 * `tailwind-merge`, because nothing here takes a className from a caller that
 * could conflict with its own.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

/* One direction only: `Tooltip.tsx` imports nothing of this page's, so a
   heading that can carry a card costs no cycle. */
import { Explain, type Tip } from "./Tooltip";
import type { Tone } from "./view";

/** Join class names, dropping the falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ");
}

/**
 * The colour language, in one place.
 *
 * A `Record` keyed by the tone rather than a `switch`, so a fifth tone is a
 * type error at every call site at once rather than a quiet fall-through to
 * grey — which is the same shape of mistake as a status arm rounding to "idle".
 */
const TONE_CLASSES: Record<Tone, { pill: string; edge: string; wash: string; ink: string }> = {
  needs: {
    pill: "tw:bg-needs tw:text-page",
    edge: "tw:border-l-needs",
    wash: "tw:bg-needs-wash",
    ink: "tw:text-needs-ink",
  },
  work: {
    pill: "tw:bg-work tw:text-page",
    edge: "tw:border-l-work",
    wash: "tw:bg-work-wash",
    ink: "tw:text-work-ink",
  },
  unknown: {
    pill: "tw:bg-unknown tw:text-page",
    edge: "tw:border-l-unknown",
    wash: "tw:bg-unknown-wash",
    ink: "tw:text-unknown-ink",
  },
  idle: {
    pill: "tw:bg-quiet-wash tw:text-ink-soft",
    edge: "tw:border-l-rule-strong",
    wash: "tw:bg-panel",
    ink: "tw:text-ink-soft",
  },
  alarm: {
    pill: "tw:bg-alarm tw:text-page",
    edge: "tw:border-l-alarm",
    wash: "tw:bg-alarm-wash",
    ink: "tw:text-alarm-ink",
  },
};

export function toneClasses(tone: Tone): { pill: string; edge: string; wash: string; ink: string } {
  return TONE_CLASSES[tone];
}

/** A status chip. Short, so it can sit on one line with a long title beside it. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }): ReactNode {
  return (
    <span
      data-slot="pill"
      className={cx(
        "tw:inline-flex tw:shrink-0 tw:items-center tw:rounded-full tw:px-2 tw:py-0.5",
        "tw:text-[11px] tw:font-semibold tw:tracking-wide tw:uppercase tw:whitespace-nowrap",
        toneClasses(tone).pill,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A monospace fact — a tmux handle, a pane, a count.
 *
 * `break-all` rather than `break-word`: these are addresses with no spaces in
 * them, and on a narrow phone an unbreakable `$1643`-shaped string is what
 * pushes a card wider than the screen.
 */
export function Mono({ children }: { children: ReactNode }): ReactNode {
  return <span className="tw:font-mono tw:text-[12px] tw:break-all tw:text-ink-faint">{children}</span>;
}

/** A card. One radius, one border, one surface — the three things every panel here shares. */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      data-slot="card"
      className={cx("tw:rounded-xl tw:border tw:border-rule tw:bg-panel", className)}
    >
      {children}
    </div>
  );
}

/**
 * A section heading over a group of rows. Quiet, because the rows are the
 * content.
 *
 * **`tip` is optional and the heading is the trigger.** Every heading on this
 * page names a group by a word chosen for brevity — *Undated*, *History*,
 * *Recently settled*, *The tree* — and the reader who has to ask what one means
 * is the reader who has never seen the tab before. Until 2026-09-09 there was
 * no way to attach a card to one at all, so each caller either wrapped its own
 * `Explain` around the children (`DeploysPanel`) or, far more often, left the
 * word unexplained. One optional prop is cheaper than eight wrappers and it
 * puts the sentence in the heading's own accessible name.
 *
 * A heading WITHOUT a tip is drawn exactly as before — no button, no cursor
 * change — so nothing about the existing page moves.
 */
export function SectionHeading({ children, tip }: { children: ReactNode; tip?: Tip }): ReactNode {
  return (
    <h2 className="tw:px-1 tw:pt-5 tw:pb-2 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
      {tip === undefined ? children : <Explain tip={tip} placement="bottom">{children}</Explain>}
    </h2>
  );
}

/**
 * **One height, one radius** — docs/project/controls.md, whose numbers section
 * is the whole of what a page this size needs from a design system:
 *
 * > Not a scale — the page has no spacing scale and this does not invent one —
 * > but the controls on a list page now agree, and agreeing is the whole of it.
 *
 * 28px (`h-7`) and `rounded-md` are the product's chip, which is what it landed
 * on for anything sitting in a row beside other controls. The height is stated
 * as a HEIGHT rather than as padding, which is what lets an icon-only control
 * agree with a text one without anybody redoing the arithmetic.
 *
 * `cva`-shaped variants and a `data-slot` attribute, per the note at the top of
 * this file: the pattern is shadcn's, the import is not.
 *
 * Two things about the variants are the product's hard-won ones. `loud` hovers
 * by `brightness`, not by an alpha — `hover:bg-alarm/90` composites the colour
 * over what is behind it, which on a dark page makes the button DARKER on
 * hover. And no variant sets `outline: none`: the product's controls doc
 * records months of a button with no visible focus at all, and never writing
 * that line is the cheapest way not to repeat it.
 */
const BUTTON_VARIANTS = {
  /** The ordinary one: a hairline box that firms up under the pointer. */
  quiet:
    "tw:border tw:border-rule tw:bg-transparent tw:text-ink-soft tw:hover:border-rule-strong tw:hover:text-ink",
  /** The one the page wants you to press, and there is at most one on screen. */
  loud: "tw:border tw:border-transparent tw:bg-alarm tw:font-semibold tw:text-page tw:hover:brightness-110",
  /**
   * **An action whose effect is outside the conversation** — a directory
   * deleted, a process signalled. Not `loud`: loud means *this is the one to
   * press*, and none of these is. It reads as a sibling of `quiet` — same
   * hairline box, same height — carrying the alarm colour, so the difference is
   * legible without the page shouting at somebody who came to press Continue.
   *
   * The colour is never the only carrier: every one of these sits under its own
   * heading saying what that class of action does, and every one asks twice.
   */
  danger:
    "tw:border tw:border-alarm/50 tw:bg-transparent tw:font-medium tw:text-alarm-ink tw:hover:border-alarm tw:hover:bg-alarm-wash",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = "quiet",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">): ReactNode {
  return (
    <button
      type="button"
      data-slot="button"
      className={cx(
        "tw:inline-flex tw:h-7 tw:shrink-0 tw:items-center tw:gap-1.5 tw:rounded-md tw:px-2.5",
        "tw:text-[12px] tw:whitespace-nowrap tw:transition-colors",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
