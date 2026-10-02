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
 * 2026-09-06 (docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md):
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
import type { Mode } from "../modes.js";
import { AboutMode, BandAbout } from "./BandAbout.js";
import { helpHref, modeAnchor } from "./help/help-anchors.js";

/**
 * Everything an `<aside>` takes that this component does not name itself.
 *
 * **The seam this actually exists for is `data-outline-rung`.** `OutlinePanel`
 * writes a `ref` and that one attribute onto the band
 * (`OutlinePanel.tsx:307`), and without `{...rest}` the attribute would simply
 * be dropped on migration — a surface Outline could not adopt, which would
 * leave behind exactly the copy this file exists to remove.
 *
 * An earlier version of this comment also claimed Outline sets its own
 * `padding` and two custom properties on the element. **It does not**: those
 * are in `src/web/styles/outline-mode.css` under `.mode-band.outln`, and no
 * mode panel writes `style` on its band today. GPT Sol F19, 2026-09-06 —
 * checked against the source, and the plan doc carried the same error.
 *
 * `data-*` attributes are not in `HTMLAttributes` and do not need to be: a JSX
 * attribute whose name is not a valid JS identifier is not checked against the
 * element attributes type, and it still lands in `rest` and reaches the DOM.
 * So what the type below governs is only the *standard* attributes a caller may
 * also pass — and two of those have to go:
 *
 * - **`dangerouslySetInnerHTML`**, because `children` is required, and React
 *   throws "Can only set one of `children` or `props.dangerouslySetInnerHTML`"
 *   for a call that is otherwise perfectly type-valid.
 * - **`role`**, because this component's stated job includes being a labelled
 *   `complementary` landmark, and `role="presentation"` would quietly remove
 *   the thing every band's `aria-label` is for.
 *
 * GPT Sol F18, 2026-09-06. And then **`aria-hidden` and `aria-labelledby` for
 * the same reason** — the first takes the landmark out of the accessibility
 * tree entirely, the second overrides the accessible name that `label` is a
 * required prop in order to guarantee. Omitting `role` while leaving those two
 * was half a rule: all four are ways to undo the one invariant this component
 * claims. Sol F23.
 */
type PassThrough = Omit<
  HTMLAttributes<HTMLElement>,
  | "className"
  | "aria-label"
  | "children"
  | "dangerouslySetInnerHTML"
  | "role"
  | "aria-hidden"
  | "aria-labelledby"
  /* `about` is an RDFa attribute in `HTMLAttributes` (a string); here it is the
     band's (i) card, a `ReactNode`, and the two intersect to "string" unless the
     attribute is taken out. Nobody passes RDFa to a band. */
  | "about"
>;

/**
 * A profile badge is the second half of the band's corner, never a corner of
 * its own. Requiring `mode` when `profile` is supplied prevents a caller from
 * handing us a badge that the `hasAbout` guard below would otherwise discard
 * silently because there is no adjacent (i) to put it beside.
 */
type Corner =
  | { mode: Mode; profile?: ReactNode }
  | { mode?: undefined; profile?: never };

export function ModeSurface({
  label,
  feature,
  head,
  children,
  foot,
  mode,
  about,
  profile,
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
   *
   * **Optional, because two bands genuinely have no hook class**: the visitor
   * band in `PublicChrome.tsx` and `FeatureBoundary`'s fallback are both a bare
   * `<aside className="mode-band">`. Omitted or empty, the class attribute is
   * exactly `"mode-band"` — never `"mode-band "` with a trailing space, which is
   * a real diff to anything comparing the attribute as a string, and which is
   * what an unguarded template would have produced for the one band this
   * component exists to be able to absorb.
   *
   * `| undefined` explicitly, despite `exactOptionalPropertyTypes`: that flag is
   * there to make "absent" and "present but undefined" different when they mean
   * different things, and here they mean the same one. A caller computing the
   * hook class conditionally should not have to spread a key in and out.
   */
  feature?: string | undefined;
  /**
   * The header row, rendered inside today's `.band-head`.
   *
   * Absent, `null` or a boolean means **no header element at all**, not an
   * empty one — see the guard below for why that distinction is load-bearing.
   */
  head?: ReactNode;
  children: ReactNode;
  /**
   * A pinned footer row the band itself places, rendered **with no wrapper of
   * its own**, because every one of them is already a direct child of the band
   * and the CSS says so.
   *
   * **Seven panels want it, not four**: `.gloss-foot`, `.ideas-again`,
   * `.quotes-foot`, `.tl-again`, and — missed by the first inventory and by the
   * plan — Debate's `.dbt-again` and Quiz's `.quiz-rewrite`, plus Skim's
   * `.skim-foot`. All are direct
   * children sitting after the scrolling child, and `debate.css` says of
   * `.dbt-again` in as many words: "Pinned under the scroller rather than at the
   * end of it, like `.tl-again`". GPT Sol F22, 2026-09-06. Four of those —
   * the standing redo buttons — went on 2026-09-29 (plan 260929b), when Metadata
   * became the one place to ask for a mode again. Their footers still appear for
   * a running or failed job; moving the action must not hide its status.
   *
   * Chat does not use it, and that is a documented exception rather than an
   * oversight: its composer is built deep inside `Conversation`, which owns the
   * scroller ref, the stick-to-bottom logic and the draft, and returns the
   * transcript and the composer as one fragment.
   */
  foot?: ReactNode;
  /**
   * **Which mode this band is**, for the (i) in its corner: the card opens with
   * that mode's own sentence and its *how* from `MODE_CATALOG`
   * (src/mode-catalog.ts) — the words the Dock's card on the same mode says, so
   * the two cannot drift — and then `about`. Given a mode, the band always has
   * its (i), in every state, empty and visitor included. Optional only for the
   * bands that are not one mode's (`PublicChrome`'s visitor band);
   * tests/every-mode-draws-its-surface.test.tsx holds every mode to it.
   */
  mode?: Mode | undefined;
  /**
   * **What the band's (i) adds after the mode's own words**, which sits in the band's top-right
   * corner — the same place in every band. Greg, 2026-10-01 (spya-ucu35y):
   * *"Each mode should have such an (i) icon"*. After `mode`'s words: the
   * counts, the caveats, and who made it and when (`AboutMade`). docs/project/mode.md § No description line in the band;
   * docs/plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md.
   *
   * **This is the one exception to "adds no DOM"**, and it is out of flow: the
   * button is `position: absolute` against the band (which is `fixed`), so it
   * takes no flex space and Search's zero-slack fit is unchanged. It comes
   * first so it is first in tab order. No stylesheet selects the band's
   * children by position (checked 2026-10-01). The band gets `has-about`,
   * which sets `--band-about-room`; a mode's top row pads its right edge by
   * that so the icon never covers a control (`.band-head` does it in
   * mode-band.css; a mode's own top row does it in its own stylesheet).
   *
   * Absent, `null` or a boolean adds nothing, like `head`; with no `mode`
   * either, there is no (i).
   */
  about?: ReactNode;
  /**
   * **The owner's *written for you* badge**, already rendered (`WrittenForYou`),
   * which this puts in the corner beside the (i) — the same place and the same
   * size in every mode. Greg, 2026-10-02 (spya-hf4svm): *"We've added (i) and
   * profile icons to every mode. Great. But their position/sizing/alignment
   * looks a bit off, especially on a phone … make this reusable/template as part
   * of creating new modes"*. Each mode used to put it in its own top row.
   *
   * Second in the DOM, after the (i), so the (i) stays first in tab order.
   * Out of flow like the (i), and the room the top row keeps clear grows only
   * when a badge actually rendered — `WrittenForYou` returns `null` for an
   * artefact written without a profile, so mode-band.css asks
   * `:has(> .prof-badge)` rather than this component guessing from the prop.
   * docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md.
   */
  profile?: ReactNode;
  /** For `OutlinePanel`, which measures the band to choose a rung. */
  ref?: Ref<HTMLElement>;
} & Corner & PassThrough) {
  const extra = typeof about !== "boolean" && about != null;
  const hasAbout = mode !== undefined || extra;
  const className = [feature ? `mode-band ${feature}` : "mode-band", hasAbout ? "has-about" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <aside {...rest} ref={ref} className={className} aria-label={label}>
      {hasAbout && (
        <BandAbout label="About this mode" help={mode ? helpHref(modeAnchor(mode)) : undefined}>
          {mode && <AboutMode mode={mode} />}
          {extra && about}
        </BandAbout>
      )}
      {hasAbout && profile}
      {/* **The three values React renders as nothing, and a boolean is two of
          them.** `head` is written by a caller as `cond && <X/>` or
          `cond ? <X/> : null` at least as often as it is omitted, and those hand
          this component `false` and `null` — `DesignPage.tsx` already writes a
          head that is "absent for the states with nothing to say there".

          The guard here was `head != null` and then `head !== false`, and both
          were too narrow: React renders `true` as nothing as well, so
          `head={someBoolean}` still produced an **empty** `.band-head` —
          invisible on screen, and one extra slot in front of every band that
          styles its first child by position. `typeof head !== "boolean"` is the
          rule that is actually true of React rather than of the two cases
          somebody happened to think of. GPT Sol F15, 2026-09-06.

          **`""` and `[]` are deliberately NOT treated as absent**, and the line
          is not "some empties but not others" — it is between a **sentinel** and
          **content**. `undefined`, `null` and the booleans are what control flow
          produces when a caller decided there is no header; a string or an array
          is the caller *supplying* a header, and this component is in no
          position to judge that the header they supplied is worthless. (An
          earlier version of this comment justified the same boundary as
          "a rule with an edge beats a partial rule", which was a weaker reason
          for a sound decision. Sol F24, 2026-09-06.) A caller whose header may
          be empty passes `null`. */}
      {typeof head !== "boolean" && head != null && <div className="band-head">{head}</div>}
      {children}
      {foot}
    </aside>
  );
}
