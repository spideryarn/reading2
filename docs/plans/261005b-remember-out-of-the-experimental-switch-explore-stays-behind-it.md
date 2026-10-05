# Remember out of the experimental switch; Explore stays behind it

Up: [plans.md](../project/plans.md)

Report `spya-cnqcjf` (Sentry SPIDERYARN-READING2-CG, queue item `qi-c4a7amv7`), from an admin, so
trusted input. Greg, 2026-10-04:

> I want to include at least part of the remember mode in the mainstream features, i.e. not only in
> the experimental features. I'm trying to decide which submodes. I think recall submode for sure.
> I think quiz mode as well. And then let's try tutorial too.

The Overseer's relay adds that Explore stays experimental unless there is a reason, and that `/help`
is to be updated.

## What changes for a reader

- **Switch off**: Remember's button is in the bottom bar and in the command bar. Inside it the chips
  read **Recall · Tutorial · Quiz**. No Explore chip, no *Remember › Explore* command-bar row, and
  the band's (i) lists three parts.
- **Switch on**: as today, four chips.
- **`?remember=explore` with the switch off** still opens Explore, and its chip is drawn while the
  reader is in it. That is the existing rule, *hidden means hidden from the controls, not
  unreachable* ([experimental-features.md](../project/experimental-features.md)), and the same code:
  `shownBehindTheSwitch` in `src/web/experimental-visibility.ts`.
- Remember stays owners-only (`POLICY.remember`). **A visitor's bar gains the Remember button**,
  because the bar filters by the same flag; pressing it opens the sentence *Remember is for whoever
  added this article*, as Skim's button does. What a visitor may do is unchanged.
- **A reader who used Explore and then turned the switch off** comes back to it on pressing
  Remember, because `remember=explore` is kept in the remembered address
  (`src/web/last-view.ts`). That is the bookmark rule again, and the chip is drawn while they are
  there.

## The build

1. `MODE_CATALOG.remember.experimental` to `false` (`src/mode-catalog.ts`), and `remember` out of
   `BEHIND_THE_SWITCH` (`tests/dock-experimental-modes.test.tsx`). The two edits
   [mode.md § Moving a mode in or out of the switch](../project/mode.md#moving-a-mode-in-or-out-of-the-switch)
   names.
2. `REMEMBER_SUB_MODES.explore.experimental` to `true` (`src/web/sub-modes.ts`). The field already
   exists on every sub-mode; until now only Diagram's pictures used it.
3. One pure helper beside it, `visibleRememberViews(on, current)`: the views in chip order, filtered
   by `shownBehindTheSwitch`. Two callers in the band, so they cannot disagree, and the command bar
   keeps its own generic filter with one more comparison:
   - `RememberSubModeToggle` (`QuizPanel.tsx`) takes a required `experimental: boolean` and draws
     only those chips. `RememberBand` reads `useExperimental().on` and hands it down, as
     `DiagramBand` does for `DiagramPanel`.
   - `RememberSubModesAbout` (`RememberAbout.tsx`), the (i) list, takes `current` and reads the hook
     itself. It is its own component, so only a Remember band subscribes.
   - `subModeRows` (`CommandBar.tsx`) already filters by the sub-mode flag. Its `current` covers only
     `?diagram=`; it gains the Remember view so the bar offers Explore exactly where the chips do.
4. `/help` (`src/web/help/help-modes.tsx`): the mode's *experimental* tag goes by itself, because it
   is read from the catalog. Explore's paragraph in Remember's section says it is one of the
   experimental features, linked to that section.
5. Docs: `experimental-features.md` (Remember's row leaves the table with the reason; § *The one
   thing that is gated below mode level* becomes two things), `remember-mode.md`, and the comment in
   `sub-modes.ts` that says only Diagram's pictures are behind the switch.

## Checked, and not changing

- **Nothing new is generated when an article is added.** The add page's list is every
  non-experimental mode *that makes something on a press*; Remember's press makes nothing
  (`MODE_TARGET.remember` is `none`: Recall waits on the reader), so `AUTO_MODE_STEPS` is unchanged
  and `tests/auto-modes.test.tsx` should stay green without an edit. The Quiz is still written on the
  first press of its chip.
- **No route is gated on the switch**, so nothing on the server changes.
- **The bar is one button longer for a reader with the switch off.** `dock-fit.ts` sheds labels by
  measured width, not by a count, so it adapts; the browser check looks at desktop, iPad and phone.

## The simpler option passed over

Flip the mode's flag and leave all four chips for everybody. One line, but it puts Explore in front
of every reader, which the brief says not to do. The sub-mode flag and the visibility rule both
exist already, so keeping Explore back costs one helper and one prop.

## Tests, red first

- `tests/dock-experimental-modes.test.tsx`: `remember` out of the list; red until the catalog flag
  moves.
- `tests/remember-header-cards.test.tsx`: switch off draws Recall, Tutorial, Quiz; switch on draws
  four; switch off with Explore open draws four with Explore pressed. The (i) list the same.
- `tests/command-match-mode-aliases.test.ts` or a new small test: `subModeRows` with the switch off
  has no *Remember › Explore*, and has it when Explore is the open view.
- A pin on `REMEMBER_SUB_MODES`: Explore alone is experimental, written as a literal list so the flag
  cannot be moved by one edit.

## GPT Sol's plan review, 2026-10-05

No P0 or P1; five P2s, all taken. Its verdict was *rework*, meaning the plan missed consequences,
not that the approach was wrong.

- The command-pick catalogue is compared exactly and gains Remember's rows with the switch off:
  regenerated. `tests/command-bar-sub-modes.test.tsx` asserted Remember absent when off: now asserts
  the three rows present and Explore absent.
- `ChatPanel.tsx` owns the (i) list's call and has to pass the part it is on. Done.
- "Nothing changes for a visitor" was wrong; corrected above.
- `/features` describes Explore under a portrait whose *Experimental* tag goes when the mode's flag
  flips. The caption now says Explore is one of the Experimental Features.
- The retained `remember=explore` door; recorded above.
- Keep the helper to the two band callers and leave the command bar's filter generic. That is how
  it was built.

It confirmed `AUTO_MODE_STEPS` does not change, and that no server route is affected.

## GPT Sol's code review, 2026-10-05

Verdict: approve, after one fix of its own.

- **P1, fixed by the reviewer.** The command bar treated a kept `remember=explore` as "Explore is
  open" in any mode, so with the switch off it offered *Remember › Explore* from Summary or the
  Metadata page. The row is now offered only when the address is on Remember. Two regression tests,
  red before the fix.
- **P2, fixed.** The helper test passed despite that bug, so it now goes through the bar's caller;
  one pressed chip is checked in all eight view and switch combinations.
- **P2, fixed.** Two passages in `remember-mode.md` and `experimental-features.md` still promised
  four chips; `/help` now also says the chip stays while Explore is open.
- **P2, fixed by me.** A stale comment in `tests/sub-mode-param-outlives-its-mode.test.tsx`.
- **P2, accepted, not fixed.** The bar reads the Remember part from the address, which can lag a chip
  press by about 50ms, where the reading view has parsed state. In that window the bar's rows could
  disagree with the chips. Nobody opens the command bar within 50ms of pressing a chip, and closing
  it means new wiring through Dock and Reader.

## What landed

Built as planned, in one stage. The browser check (desktop, iPad, phone) is in the debrief.

## Question for Greg

**[Q-quiz-on-import]** Now that Remember is a main mode, should the Quiz questions be written when an
article is added, like Glossary and Quotes are? Today they are written the first time the Quiz chip
is pressed, which takes about a minute. Writing them up front costs one model call per article
whether or not the reader ever opens the Quiz. Recommendation: leave it on the press, and revisit if
the minute's wait is annoying in use.
