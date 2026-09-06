/**
 * **The container the active reading mode stands in — and nothing else.**
 *
 * Fourteen files hand-wrote `<aside className="mode-band …">` and nine of them
 * also hand-wrote the `.band-head` inside it, so there was nowhere for a rule
 * about the band to live even once somebody decided what it should be. This is
 * that place. Item A5 of the main-app architecture review;
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md.
 *
 * ## It adds no DOM, and that is a hard constraint rather than a preference
 *
 * `head` wrapped in `.band-head` if there is one, then the children unwrapped
 * and in order, then `foot` unwrapped. **No body wrapper, no footer wrapper, no
 * padding, no box of its own.** Two reasons, both measured in Chrome on
 * 2026-09-06 (the `-baseline.md` beside the plan):
 *
 * - Fourteen sets of CSS selectors are written against today's shape, several
 *   of them child combinators, so an extra element does not merely add a box —
 *   it silently stops matching rules.
 * - **Search's band fits with zero slack.** Its children sum to the band height
 *   to the fraction of a pixel in all four measured conditions, and
 *   `.srch-hits` is `flex: 1 1 0%`, so a hairline of padding here would be
 *   absorbed by the scroller and the only evidence would be one pixel of
 *   scrollbar.
 *
 * ## What it is not
 *
 * **Not an error boundary, and it must not become one.** `FeatureBoundary`
 * sits *outside* the mode controller, at the point `Reader` composes the band,
 * because a boundary cannot catch a throw from the component it lives in
 * (docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md
 * § Where the boundary goes). `ModeSurface` is rendered by the panel, inside
 * the controller, inside that boundary. `FeatureBoundary`'s own fallback keeps
 * its raw `<aside className="mode-band">` on purpose: a fallback that rendered
 * `ModeSurface` would re-invoke the component that had just thrown, and the
 * second throw escapes to `AppBoundary`, which replaces the whole reader.
 *
 * **And it knows nothing about jobs, `Found`, HTTP statuses, filters, access or
 * model output.** Those belong to the mode; this owns the element.
 *
 * ## No viewport code lives here yet, deliberately
 *
 * The band and the dialogs fit a phone's visible area by two different
 * mechanisms, and unifying them is the point of stage 4 of that plan — but the
 * arithmetic is blocked on a real iOS measurement this box cannot produce, so
 * none of it is here. **Not even an inert version:** `keyboardInsetStyle()`
 * emits `--kb-inset: 0px` wherever `window.visualViewport` exists, which
 * includes desktop Chrome, so an "inert" style would already change the markup
 * this stage exists to leave alone. GPT Sol F7, 2026-09-06.
 *
 * When it does land, the subscription belongs *here* rather than in each panel:
 * iOS fires visual-viewport `scroll` continuously while the keyboard slides,
 * and a re-render owned by this component stops at it — `children` is the same
 * element reference across those renders, so React bails out of the whole panel
 * subtree instead of re-rendering a transcript on the frames a phone has least
 * to spare.
 */
import type { HTMLAttributes, ReactNode, Ref } from "react";

/**
 * Everything an `<aside>` takes that this component does not name itself.
 *
 * It exists because **`OutlinePanel` writes four things onto the band element
 * itself** — a `ref`, a `data-outline-rung` attribute, its own `padding`, and
 * two custom properties in `style`. A surface that could not carry those would
 * be a surface Outline could not migrate to, which would leave behind exactly
 * the copies this file exists to remove.
 *
 * `data-*` attributes are not in `HTMLAttributes` and do not need to be: a JSX
 * attribute whose name is not a valid JS identifier is not checked against the
 * element attributes type, and it still lands in `rest` and reaches the DOM.
 */
type PassThrough = Omit<HTMLAttributes<HTMLElement>, "className" | "aria-label" | "children">;

export function ModeSurface({
  label,
  feature,
  head,
  children,
  foot,
  ref,
  ...rest
}: {
  /**
   * The band's accessible name, as `aria-label` on the `<aside>`.
   *
   * **Required, because there are no unlabelled bands.** An `<aside>` is a
   * landmark; an unnamed one is announced as "complementary" and a reader
   * moving by landmark cannot tell Chat from Quotes. Several panels vary it
   * with state — Chat says "Remember what you took from this article" in
   * Remember mode — so it is a value rather than a constant.
   */
  label: string;
  /**
   * The mode's own hook class, appended to `mode-band`: `"srch"`, `"chat"`,
   * `"gloss ideas"`. Space-separated is deliberate — Chat's is conditional
   * (`chat remember`) and Glossary's carries two.
   */
  feature: string;
  /** The header row, rendered inside today's `.band-head`. */
  head?: ReactNode;
  children: ReactNode;
  /**
   * A pinned footer row the band itself places — `.gloss-foot`, `.ideas-again`,
   * `.quotes-foot` and `.tl-again` are the four that want it — rendered **with
   * no wrapper of its own**, because those four are already direct children of
   * the band and the CSS says so.
   *
   * Chat does not use it, and that is a documented exception rather than an
   * oversight: its composer is built deep inside `Conversation`, which owns the
   * scroller ref, the stick-to-bottom logic and the draft, and returns the
   * transcript and the composer as one fragment.
   */
  foot?: ReactNode;
  /** For `OutlinePanel`, which measures the band to choose a rung. */
  ref?: Ref<HTMLElement>;
} & PassThrough) {
  return (
    <aside {...rest} ref={ref} className={`mode-band ${feature}`} aria-label={label}>
      {/* `!= null` rather than truthiness, and not `!== undefined` either:
          absent and `null` both mean "this mode has no header row", and neither
          may leave an empty `.band-head` behind — several bands style their
          first child by position. */}
      {head != null && <div className="band-head">{head}</div>}
      {children}
      {foot}
    </aside>
  );
}
