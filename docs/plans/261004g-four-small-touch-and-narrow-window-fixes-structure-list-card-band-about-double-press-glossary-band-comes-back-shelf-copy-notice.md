# Four small fixes: a card off the screen, a card that reopens, a band left hidden, a notice left up

Four queue items the Overseer handed over on 2026-10-04. Greg, the same day, on the Overseer's
list of small queued fixes: *"If you're confident, address all of the Q-queue-yeses"*. Each is a
small client defect on a touch screen or a narrow window. One stage, one commit per item.

Status: **built; code review and browser check under way.**

## 1. qi-fkyrdns3: Structure's list face opens a row's card off the screen on a phone

**What the reader sees.** At 390px, in Structure's list face, the first tap on a row opens its card
at x 367..693: off the screen. The page widens from 390 to 706px, the list re-wraps, rows move
under the finger, and the second tap can land on a different row.

**Cause.** `src/web/OutlinePanel.tsx` § `Row` draws its `Tooltip` with `placement="right"` and
`keepSide`. `keepSide` restricts `flip` to left and right; at 390px neither side has room, so the
card stays where it does not fit, and `shift` cannot help because for a `right` placement it slides
vertically. `src/web/StructurePanel.tsx` § `CardRow` has a long comment describing exactly this
trap, measured at 420px, and avoids it by leaving `keepSide` off.

**Fix.** Drop `keepSide` from `Row`'s tooltip. Then `fallbackAxisSideDirection: "end"` drops the
card below the row when neither side fits, where `shift` is horizontal and keeps it on screen.
A short comment pointing at `CardRow`'s, not a second copy of it.

**Red first.** jsdom lays nothing out, so no unit test can see a card's position. The red is a
Playwright measurement at 390px on the unfixed tree (card rect and `scrollWidth`), and the green is
the same measurement after. A jsdom test is added only as a tripwire: it mocks `Tooltip`, and fails
if either face's row tooltip is given `keepSide` again. It says in its header that it is a tripwire
and where the real evidence is.

**Passed over.** Changing `Tooltip` so `keepSide` falls back to the other axis when both sides fail.
It would fix every `keepSide` caller at once, but `keepSide` exists because a card on the other axis
covers a row of sibling triggers (Tooltip.tsx § `keepSide`), and thirty callers rely on that. Too
wide for this item; noted for the debrief if the browser check finds another caller off-screen.

## 2. qi-9rk34gjz: a quick double press on a band's (i) reopens the card

**What the reader sees.** Point at any band's corner (i) and press twice quickly. The card opens,
shuts, then opens again by itself.

**Cause.** Pointing schedules a hover-open timer. The two presses toggle `open` through the
button's own `onClick`, which does not go through Floating UI, so the pending timer survives and
fires after the second press.

**Fix.** Copy what GPT Sol wrote into Referee's `HowToRead`
(`src/web/modes/referee/RefereeMode.tsx`): a `dismissedByPress` ref, set when a press closes the
card, cleared on a fresh `pointerenter` or keyboard focus, and `onOpenChange` refusing an open while
it is set. Into `src/web/BandAbout.tsx` § `BandAbout`.

**One mechanism, not two.** Two copies of an eight-line guard is the start of a third. If it lifts
cleanly, both use one small hook (`usePressToggle` or similar, beside `useTapReveal`); if lifting it
means changing `HowToRead`'s behaviour, `BandAbout` gets the copy and the debrief says so.

**Red first.** In `tests/band-about.test.tsx`, with fake timers: `mouseenter`, two clicks before the
hover delay, advance the timers, expect `aria-expanded="false"`. And the guard must not break what
is already tested there: a hover-open card that a click closes, and a touch-open card.

## 3. qi-fs4qzzfm: Open glossary from a term's card leaves the Glossary band hidden

**What the reader sees.** On a phone or a narrow window, in Glossary, follow a passage link: the
band steps aside (`bandAway`). Point at a term in the prose and press *Open glossary* or *Dig
deeper*. Nothing appears, and a dig's answer streams into a band nobody can see.

**Cause.** `openTermInGlossary` (`src/web/reader/Reader.tsx`) sets `?mode=glossary`, which is
already the mode, so the effect that clears `bandAway` on a mode change never runs. 261004b fixed
the same defect for the citation card with one `setBandAway(false)`.

**The class, and the callers that have it.** *A prose-side control that names a band as its
destination, while that band may already be the mode and stepped aside.* Every `setMode(` in
Reader.tsx, checked:

| Caller | Can the mode already be the target, with the band away? |
|---|---|
| `openTermInGlossary` (term card: Open glossary, Dig deeper) | **Yes.** This item. |
| `handToChat` (Glossary's Ask in chat; a Summary paragraph's Ask) | No today: both callers are inside their own bands, so the mode always changes (plan review F3; the first draft said yes). It calls `showBand` anyway, because it names a band. |
| executor's `openGlossary` (the command bar) | **Yes.** |
| `citeActions.dig` | Was; fixed in 261004b. |
| `openFromStopCard` → ideas, timeline, glossary | No: the card is in Skim's band, so the mode changes. |
| `onOpenInQuotes` | No: the button is not drawn in Quotes mode. |
| `onOpenFull` (floating chat panel) | No: the panel is suppressed in Chat mode. |
| `openAskedFromDrawer` (a question opened from the Comments drawer or the margin) | **Yes, in Chat** (plan review F1; the first draft said no). The `remember` guard is only on the mode switch; in Chat the thread opens in a hidden band and the floating panel is suppressed. |
| the Dock's press | Already clears it. |

**Fix.** One callback in Reader, `showBand(mode)`: `setBandAway(false)`, then `setMode(mode)` only
when the mode is changing, because `nuqs` pushes a history entry for a same-value write (plan
review F2; 261004b's citation dig was already adding one). The *yes* rows, `handToChat` and
`citeActions.dig` call it, so the two lines cannot be written apart again.

**Red first.** Twins of 261004b's whole-page case in
`tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx`, at 390px and 600px: step the Glossary
band aside with a passage link, open a term's card in the prose, press *Open glossary*, expect no
`band-away`. Seen red, then the fix. A second case for `handToChat` if the harness reaches it
without a second mock of the chat stream; if not, it is covered by sharing `showBand` and the
debrief says it has no test of its own.

## 4. qi-pnqc7eh4: a good Copy link leaves the earlier "Couldn't copy" notice up

**What the reader sees.** On the shelf, Copy link fails and the strip says *Couldn't copy the
link…*. Press it again, it works, the button shows its tick, and the strip still says it couldn't.

**Cause.** `useShelf`'s one `actionError` is shared by archive, rename, re-run and copy, and
`report()` can only set it. A successful copy tells nobody.

**Fix.** `useShelf` remembers who set the notice. `report(message, "copy")` marks it as a copy's;
a new `copied()` clears the notice only when a copy set it, so a good copy never wipes an archive
or re-run failure the reader has not dealt with. `ShelfEntry`'s copy callback calls `copied()` on
the `"copied"` outcome. `actionError` stays a `string | null` for everyone who reads it.

**Red first.** A test that draws a shelf row with a clipboard that refuses then accepts: notice up
after the first press, gone after the second. And the other half: a re-run failure's notice survives
a good copy.

**While there: one failed-copy glyph.** The queue item says *consider*. `Tweets.tsx` § the copy
button and `ChatPanel.tsx` § `CopyAnswer` draw an `X` for a refused copy; BlockGutter, the feedback
dialog and the rest draw `TriangleAlert`. An `X` on a button reads as "close" or "remove". Swap the
two, and update `tests/tweets-copy-icons.test.tsx` if it names the glyph. Its own small commit.

## Done looks like

- Each defect has a test seen red, then green (item 1: a browser measurement, red then green).
- `npm test`, `npm run typecheck`, lint on the touched files.
- A Sonnet subagent's browser check at desktop, iPad and phone widths, for items 1 to 3 and the
  shelf strip.
- GPT Sol's review of this plan, then of the code.
- Docs: `structure.md`, `touch.md`, `narrow-windows.md`, `library.md` where a sentence there
  describes the changed behaviour. No `/help` change expected: nothing a reader can do is new.

## Review log

**Plan review, GPT Sol, 2026-10-04** (`261004g-plan-review-by-gpt-sol.md`). Verdict: build it with
changes. All three findings checked against the code and accepted.

- **F1 (P1), accepted.** `openAskedFromDrawer` was a wrong "No" in the table: fixed with the same
  callback. It has no regression test of its own yet; the code review is asked to add one.
- **F2 (P1), accepted.** `showBand` writes the mode only when it changes. The citation case in the
  band-link test now also asserts no `pushState`.
- **F3 (P3), accepted.** The table's `handToChat` row was wrong about who calls it; corrected. The
  second test the plan proposed for it cannot be reached through the UI and was not written.
- Item 4: the policy that any row's good copy clears any row's copy failure is now stated on
  `Shelf.copied`. The hook's tests cover a copy's notice, another button's notice, and the order
  of the two.

## Not in scope

- `Tooltip`'s `keepSide` itself (above).
- Clearing the shelf notice on any other success (archive, rename): they already clear it at the
  start of the attempt.
