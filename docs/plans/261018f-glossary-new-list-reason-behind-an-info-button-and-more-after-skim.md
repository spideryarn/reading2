# Glossary's "replaces the list" sentence behind an (i), and More after Skim

Two small admin reports from Greg, batched as queue item `qi-wkwce962`. Both are trusted
(`feedback-reporter.ts` exit 0), so they are built, simplest version first
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

## 1. spya-xtkv73 — the Glossary's rewrite sentence

Greg, 2026-10-17:

> "The article, your profile or how we write glossaries has changed since these terms were found,
> so this replaces the list. Terms you added are kept."
>
> Hide this behind a button or something with a tooltip so it doesn't take up valuable screen real
> estate
>
> And minimal update to relevant doc to prefer warnings and related non-critical notes in tooltips
> etc so they don't distract/take up space

**Now:** under *Write a new list* in `GlossaryPanel.tsx` § `MoreRow`, a `<p class="gloss-more-note">`
with that sentence, always shown when the press rewrites. It was put on screen rather than in a
tooltip on purpose (plan 261004f) because a touch screen never shows a hover card.

**Change:** the sentence moves into a card on a small **(i)** button beside *Write a new list*,
labelled for a screen reader *Why a new list?*. It reuses the shape Referee's *How to read this* and
every band's (i) already use — `Tooltip`, controlled by `usePressToggle` — so hover and focus open
it and **a tap toggles it**, which keeps 261004f's reason (a phone must still be able to read it)
while the sentence stops taking a line. The words are unchanged. The *No more terms worth adding
turned up* line stays visible: it is the answer to the press the reader just made, not a warning,
and without it the button looks like it did nothing (the comment beside it says so).

**Simpler option passed over:** put the sentence in the button's existing `data-tip`. One line
of code, but a finger never sees a `data-tip` card, which is exactly what 261004f fixed. The
controlled (i) is the existing machinery, not a new one.

**Doc:** a short paragraph in [tooltips.md § When something needs one](../project/tooltips.md#when-something-needs-one)
with Greg's words: a warning or note the reader does not need in order to act goes in a card on an
(i) rather than a line of text, and the card has to open on a tap where the note matters on a phone.
tooltips.md is not an entry point or a reusable doc, so it is edited directly.

## 2. spya-c0va9e — More after Skim

Greg, 2026-10-17:

> Move the three dots mode one to the right in the bottom bar after Skim but still in the same group

**Now:** `MORE_AFTER = "summary"` in `Dock.tsx`: `Structure Summary ⋯ [Diagram] Skim |`. Moved there
from after Skim on 2026-10-11 (spya-hdde62, plan 261011x), whose report said *"to the right of the
summary, and maybe, maybe to the right of the skim mode"*. Greg has now chosen the second.

**Change:** `MORE_AFTER = "skim"` → `Structure Summary [Diagram] Skim ⋯ |`. Still inside the shape
run, and now its last member: no line between Skim and More, and the run's line straight after More. An open gathered
mode (Glossary, say) is drawn after the cut, so it reads `Skim ⋯ | Glossary | Sources`. The
order has one home, so the metadata page's bar follows. Tests, comments and docs that say "after
Summary" are updated, and so are the Help page's prose and alt text, `bottom-bar.png` (reshot) and
its metadata in `help-images.ts`.

**The phone consequence, named rather than inherited.** On a phone with Diagram drawn (the
Experimental switch on, or Diagram open), the place after Skim was measured off the edge in plan
261009c (x 354–398 at 360/375/390), and the guard there (`moreOffTheEdge`, `bandsInOrder`) then
draws More **first** in the frame. That guard stays and is what keeps More reachable; it is how the
bar behaved from 2026-10-09 to 2026-10-11. Without Diagram, More after Skim fits. Nothing new is
built for it; if Greg wants it never to jump, that is a separate call.

## GPT Sol's plan review, and what was done with it

[`-plan-review-sol.md`](261018f-glossary-new-list-reason-behind-an-info-button-and-more-after-skim-plan-review-sol.md),
APPROVE WITH CHANGES. All five taken:

1. The hook's early returns — the (i) is its own component, `WhyANewList`, mounted only beside
   *Write a new list*, so `usePressToggle` never sits behind a conditional return.
2. Touch target — the (i) carries `.tap-target`, and under `any-pointer: coarse` stands 0.3rem
   further off the button, since the 40px target reaches about 10px past a 21px button.
3. The phone test modelled every control at 44px, which would have said More fits at 360 after
   Skim; it now models Plain wider, reproducing 261009c's measured x.
4. The Help screenshot is reshot, not just checked.
5. The separator wording, above.

## Gates

`npm test`, `npm run typecheck`, lint on touched files; GPT Sol on this plan (read-only) and on the
code (workspace-write); a browser check of both in a Sonnet subagent (Playwright on the box).

## Built, and checked

- **GPT Sol's code review**: [`-code-review-sol.md`](261018f-code-review-sol.md), APPROVE WITH CHANGES
  (made). It widened the (i)'s coarse-pointer clearance to 6px (at the 12px root the gap was 7.8px
  against a 9.5px reach, with a test that went red first), regenerated the Help corpus, fixed two
  stale comments, and added tests for the (i)'s keyboard focus, its state across row branches and
  the exact phone geometry (`[310,354]` without Diagram, `[354,398]` with).
- **Browser** (Playwright, this worktree's dev server): at 1440 the bar reads
  `Structure Summary Diagram Skim ⋯ | Sources …`, and with Glossary open `Skim ⋯ | Glossary | …`. At
  390 and 360 with touch, More stays after Skim at x 310–354 with Experimental off, and leads the
  frame with Diagram drawn. The (i) opens on hover, click and tap, a second press closes it, and
  `elementFromPoint` at *Write a new list*'s right edge returns that button. Shots:
  [1](261018f-shot-1-more-after-skim-glossary-1440.png),
  [2](261018f-shot-2-phone-390-experimental-on-more-first.png),
  [3](261018f-shot-3-phone-390-why-a-new-list-card.png). `bottom-bar.png` in Help was reshot.
- On desktop a card opened by a click closes when the pointer leaves. That is `usePressToggle`'s
  behaviour everywhere it is used (Referee's *How to read this*, every band's (i)), and is left alone.
