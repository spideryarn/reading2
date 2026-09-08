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
import type { ReactNode } from "react";

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

/** A section heading over a group of rows. Quiet, because the rows are the content. */
export function SectionHeading({ children }: { children: ReactNode }): ReactNode {
  return (
    <h2 className="tw:px-1 tw:pt-5 tw:pb-2 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
      {children}
    </h2>
  );
}
