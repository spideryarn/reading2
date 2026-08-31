# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app: TypeScript + ESM,
React client, Node server on Vercel). Read-only review — do not edit files. Be concrete, rank
findings by how much damage they would do, and mark each must-fix / should-fix / note. End with a
one-line verdict: ready to build, or not.

## The plan

Read `docs/plans/260827ak-touch-glossary-card.md` in full. That is the thing under review.

The ask, from the product owner: on an iPad, tap a dotted-underlined glossary term in the article
prose to see the preview card, and tap again (or press something in the card) to go to Glossary
mode. Desktop hover behaviour must not change.

## Context you will need

- `src/web/useHoverCard.ts` — the machine being changed. One floating panel for the whole page,
  anchored by hit-testing against injected HTML. Note the existing `if (event.pointerType ===
  "touch") return;` and the reasoning beside it, the `pending`/`current` split (a previous review
  of yours found that bug), and the MutationObserver that closes a card whose anchor node was
  replaced.
- `src/web/ProseHoverCard.tsx` — the card itself: a term half and a link half, one card when a
  hyperlink's text is also a glossary term. `TermCard`'s foot has the **in the glossary** button.
- `src/web/TableView.tsx` — the prose table. Its `onClick` (internal-fragment links) and
  `onMouseUp` (text selection → ask a question; `mark.chat` → open a thread; `mark.cmt` → open a
  comment) are the handlers a swallowed tap has to get past. React delegates these at the root
  container, i.e. below `document`.
- `src/web/annotate.ts` — how marks are built; one `<mark>` can carry several classes
  (`term`, `cmt`, `chat`, `hit`) when annotations overlap.
- `src/web/Spine.tsx` § `bandPress` and `tests/spine-tap.test.ts` — the existing reveal-then-commit
  pattern the plan copies, and the header comment on that test saying what a pure-function test
  could not catch last time (a tap synthesised `mouseleave` before `click`, so the card closed a
  moment before the click meant to commit it).
- `src/web/swipe.ts` and `docs/project/touch.md` § "The click afterwards is eaten" — the existing
  capture-phase click swallower, its 120ms/24px deadline-and-place rule, and why a one-shot
  listener was wrong.
- `src/web/styles.css` — `mark.term` (cursor `help`, and why not `pointer`), `td.text {
  touch-action: pan-y }`, `[data-swipe-step] { touch-action: pan-x }`.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.

## What I most want you to attack

1. **The event sequence on real iOS Safari.** The plan handles the tap at `pointerup` and then eats
   the following `mouseup` and `click` within 400ms / 24px. Walk the actual sequence iOS emits for
   a tap on a `<mark>` inside an `<a>` inside a `<td>` and say where this breaks. In particular:
   does `pointerup` reliably reach a `document`-level listener; does iOS fire `pointerover`/
   `pointerenter` before `pointerdown` on a tap and can that reach any of our code; and is
   `pointercancel` actually emitted when a scroll takes the gesture, or do we get a `pointerup`
   far away instead?
2. **The two swallowers colliding.** `swipe.ts` already has a capture-phase click/mouseup eater
   armed after a swipe on a gist column. This adds a second one armed after a tap on a term. Can
   they arm each other's window, eat each other's events, or leave one armed? Is a shared
   mechanism the right call instead?
3. **Interference with selection.** iOS text selection on the prose is a real feature here (drag to
   select → ask a question). Does anything in the plan — the swallowed `mouseup`, the
   `preventDefault` on `click`, opening a card on `pointerup` — break selecting a phrase that
   happens to contain or start on an underlined term? What about the callout menu?
4. **Double-tap and zoom.** `index.html` sets `width=device-width` but nothing sets
   `touch-action: manipulation` on the prose. Two fast taps to commit — does iOS treat that as
   double-tap-to-zoom, and if so what is the right fix that does not take zoom away from the
   article?
5. **The 10px tap slop, the 400ms, the 24px.** Are these the right numbers, and is the failure mode
   of each the harmless one?
6. **The commit target.** A `<mark>` can carry two term ids when two glossary terms overlap the
   same words (the card shows both). The plan's `onCommit` opens "the first entry". Is that
   defensible, or should a second tap do something else when the card is showing two terms?
7. **What the plan does not mention at all.** Scroll while a card is open; rotating the device; the
   card's own MutationObserver firing when the prose re-renders under a tapped card; VoiceOver;
   whether the tapped mark should get a visible "open" state the way `[data-term-open]` does.
8. **Is the whole design right?** If reveal-then-commit is the wrong gesture for prose — as opposed
   to for the spine's unreadable bands — say so and say what should replace it.

Quote file and line where you can.
