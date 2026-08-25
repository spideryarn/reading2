/**
 * The granularity pills' class string, and **the only copy of it**.
 *
 * It lives in a module of its own rather than in App.tsx because `/design`
 * renders a real pill as well (DesignPage.tsx). The design page's one rule is
 * that it shows the actual thing rather than a restatement of it: a second copy
 * of this string would go on looking right after the real one broke, which is
 * the exact failure that page exists to catch. Importing it out of App.tsx
 * instead would have App and DesignPage importing each other.
 */

/**
 * The granularity pills, restated over shadcn's Toggle.
 *
 * Individual `Toggle`s rather than a `ToggleGroup`, which is what you would
 * normally reach for and what the migration plan called for. The reason is
 * this app's keyboard design: a ToggleGroup wraps its items in Radix's roving
 * focus, which binds ArrowLeft, ArrowRight, ArrowUp AND ArrowDown. Here ↑/↓
 * step through the article and ←/→ are deliberately handed back to the browser
 * to pan a table wider than the window (see keynav.ts and
 * docs/project/keyboard.md). A group would swallow all four whenever focus sat
 * inside the bar — which is precisely where focus lands after you click a
 * pill. Separate toggles give the same `aria-pressed` and `data-state` and
 * leave the arrow keys alone.
 *
 * The class string is mostly undoing shadcn's defaults, because these are
 * pills and its Toggle is a square-ish icon button:
 *
 *  - `rounded-full`, `h-auto`, `py-*` — its default is `h-9 min-w-9 rounded-md`.
 *  - `hover:bg-transparent` — its default hover paints `bg-muted`; ours moves
 *    only the border and the text to orange.
 *  - the `data-[state=on]` trio — its default on-state is `bg-accent`, and in
 *    this palette `--accent` is a raised dark SURFACE, not the brand orange.
 *    Left alone it marks the ON state with dark grey on a near-black page:
 *    not an error, not visibly broken, just the signal quietly gone. Both
 *    tokens.css and styles.css carry warnings about this exact confusion.
 */
export const PILL =
  // Shape and metrics, matched to the rule this replaced rather than to
  // Tailwind's defaults: `text-xs` would also set line-height to 1rem, where
  // these inherited the body's 1.55, and the padding is the original 0.22/0.6
  // rather than the nearest scale step. Both differences are a couple of
  // pixels of pill height, which is exactly the sort of drift nobody notices
  // individually and everybody notices in aggregate.
  "tw:rounded-full tw:h-auto tw:min-w-0 tw:px-[0.6rem] tw:py-[0.22rem] " +
  "tw:text-xs tw:leading-[1.55] tw:font-normal " +
  // font-family and cursor were coming from `.controls button`, which step 8
  // deletes. Stated here so this string stands on its own and that deletion
  // cannot quietly change the pills.
  "tw:font-sans tw:cursor-pointer " +
  "tw:border tw:border-rule-strong tw:text-ink-faint tw:bg-transparent " +
  // The base Toggle animates only `color` and `box-shadow`. Background and
  // border are the two properties that actually say "on" here, so without
  // this they snap while the text fades — the old rule animated all three.
  "tw:transition-[color,background-color,border-color] tw:duration-[120ms] " +
  "tw:hover:bg-transparent tw:hover:border-highlight tw:hover:text-highlight " +
  "tw:data-[state=on]:bg-highlight-wash tw:data-[state=on]:border-highlight " +
  "tw:data-[state=on]:text-highlight-ink tw:data-[state=on]:font-semibold";
