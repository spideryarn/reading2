# The bottom bar rises in when an article loads, and a More button gathers the lesser modes

*Status as of 2026-10-07: planned, not built — evidence: no `dock-more` or `dock-enter` in `src/`.*

Up: [plans.md](../project/plans.md). Report `spya-dest8x` (Sentry SPIDERYARN-READING2-E6), from Greg
as admin; Overseer queue item `qi-wpkewsk3`.

## Goal

Make the reading view less overwhelming for somebody opening their first article. Greg, 2026-10-06,
verbatim:

> I really want to make the experience for a brand new user a bit less baffling and overwhelming. So
> I've got a few ideas. One might be to draw a little bit of attention to the bottom bar, because
> obviously that's critical. So perhaps it appears, maybe it fades in or slowly rises to the top when
> the page, the article first loads after a second, so that the page can load and then it draws
> their eye to it. Let's try that. The other is there's a whole bunch of modes in the middle that
> people probably don't need to open that often. I'm thinking of the glossary, FAQ, ideas, timeline,
> quotes, because a lot of them have been folded into other larger modes, or meta modes like skim
> and marginalia. Or they're just visible in the text. You know, I don't think I use the glossary
> mode itself very often because I just hover over the word. And so for those, I wonder if we could
> maybe gather them together and create either a dot dot dot or a more button in their place. And if
> you click on them, it sort of expands upwards to let them choose from those. And that way, it
> would indicate somehow that they aren't as important as the other modes like summary, structure,
> chat, learn, search, marginalia. And maybe a couple of others I've forgotten. Those are the most
> important modes, and so I want them to be more visible. So let's try that as an experiment

Two things, then:

1. **A More button.** Quotes, Glossary, FAQ, Ideas and Timeline leave the bar and sit in a small
   menu that opens upwards from one button, labelled **More** with a `…` icon, where they used to
   be.
2. **An entrance.** When an article opens, the bar is absent for about a second and then fades and
   rises into place.

## What the bar draws, before and after

Owner, wide window, experimental switch off (FAQ and Timeline are experimental, so they are not
drawn today either):

```
before  [Plain] [Structure Summary | Skim Quotes Glossary Ideas | Search Chat Learn] [Marginalia]
after   [Plain] [Structure Summary | Skim | Search Chat Learn] [More…] [Marginalia]

                                                  ┌──────────┐
                                                  │ Quotes   │  the menu, opening upwards
                                                  │ Glossary │  (FAQ and Timeline join it
                                                  │ Ideas    │   when the switch is on)
                                                  └──────────┘
                                                    [More…]
```

More stands after the modes rather than exactly where the five were (D6 says why). Switch on:
`Structure Summary Diagram | Skim | Citations Referee Debate | Search Chat Learn` then `More…`, and
the menu holds Quotes, Glossary, FAQ, Ideas, Timeline in that order (their order in `MODES_UI`).

## References

- [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — the bar. `MODES_UI` (the rows and their order),
  `visibleModes` (which rows this reader has), `groupStarts`, `DockModes` (the buttons arm, the
  reading view), `DockModeLinks` (the links arm: Metadata and the visitor pages), `fitSignature`,
  `DockCommandBar modes={visible}`.
- [`src/web/dock-fit.ts`](../../src/web/dock-fit.ts), `styles/dock.css`, `styles/dock-fit.css`,
  `styles/narrow-window.css` — the fit ladder, the bar's `transform`, and the rule that holds the bar
  home on a phone (`:root:has(...)`, policed by `tests/the-dock-hides-in-a-mode-beside-the-article.test.ts`).
- [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) — the one Radix `DropdownMenu` in the
  client; the menu here copies its use.
- [interface-vision.md § Decluttering the bottom bar](../project/interface-vision.md#decluttering-the-bottom-bar)
  — the goal this serves, and the undecided "Extracts menu" (`qi-5ay85q7d`) that this report settles.
- [mode.md](../project/mode.md), [experimental-features.md](../project/experimental-features.md),
  [narrow-windows.md](../project/narrow-windows.md),
  [phone-and-touch.md](../project/phone-and-touch.md), [help-page.md](../project/help-page.md).
- Tests that enumerate the bar: `tests/dock-mode-order.test.ts`,
  `tests/dock-experimental-modes.test.tsx`, `tests/arrows-belong-to-the-article.test.tsx`,
  `tests/command-bar.test.tsx`, `tests/every-mode-draws-its-surface.test.tsx`,
  `tests/dock-mode-tooltips.test.tsx`, `tests/dock-fit.test.ts`,
  `tests/public-network-trace.test.tsx`, `scripts/measure-cpu.ts`.

## Decisions, and the assumptions an unattended run made

**D1. For everyone, not behind the experimental switch.** "As an experiment" is read as "let's try
it", not as "put it behind the switch on /profile". The switch is off for a new reader and forced
off for a signed-out visitor, who are exactly the people this is for, so gating it would hide it
from its audience. It is one flag on five rows and one CSS class to take back out.
*Assumption; Greg can reverse it in a sentence.*

**D2. Which modes go behind More: the five Greg named, and no others.** Quotes, Glossary, FAQ,
Ideas, Timeline. Plain, Structure, Summary, Skim, Search, Chat, Learn and Marginalia stay, and so do
the other experimental modes (Diagram, Citations, Referee, Debate), which only an opted-in reader
sees. One boolean, `more: true`, on a row of `MODES_UI`.

**D3. An open gathered mode is drawn in the bar, as it is today for an experimental mode.** While
the reader is in Glossary, a Glossary button stands in its usual place (just before More), checked.
This is the existing rule 2 of `visibleModes` ("plus whatever mode the reader is in"), applied to a
second reason for hiding. It keeps three things true with no new machinery: the radiogroup always
has exactly one checked button, a second press on the open mode still closes it, and the reader can
see where they are. The menu itself always lists every gathered mode this reader has, with the open
one marked, so its contents do not shuffle.

*Passed over:* the More button itself turning into the open mode (taking its icon and name). It
saves the bar reflowing by one button, but makes one control mean two things and needs its own
answer for "press again to close". Reconsider if the reflow reads badly in the browser.

**D4. The menu is Radix `DropdownMenu`, `side="top"`, portalled.** Already a dependency, already
used once, and it brings the keyboard, focus return and `role="menu"`. It must be portalled: `.dock`
clips (`overflow-y: hidden`) and has a `transform`. On the reading view an item calls `onMode`
(a pick opens the mode; it never closes one). On the links arm (Metadata, visitor pages) an item is
the same `modeLinkHref` link the bar draws today. A mode a visitor cannot use keeps its dimming and
its sentence.

*Passed over:* a hand-rolled Floating UI popover (more code, same result) and expanding the five in
place inside the bar (wider bar on a phone, which is the opposite of the point).

**D5. The command bar's contract changes, deliberately.** Today its mode rows are "exactly what the
Dock lists". They become exactly what the Dock **offers, directly or under More**. `visibleModes` is
unchanged, stays that reachable set and still feeds the command bar, so every gathered mode stays
one `⌘K` away. The code comments, `reading-view-overview.md` and the equality test in
`tests/command-bar.test.tsx` are rewritten to say so (PR-9). A new pure function splits that list into what the bar draws and what the menu
holds. `groupStarts`, `fitSignature` and the coarse-pointer counts (`--dock-mode-count` and
friends) read the **drawn** list, with More counted as a button.

**D6. More is not a radio, and stands outside the radiogroup.** It is a `<button
aria-haspopup="menu">` in a frame of its own, a sibling straight after `.dock-modes-radios` and
before Marginalia's frame, which is outside the group for the same reason. So it stands after Learn
rather than literally where the five were. The first draft put it beside Skim, inside
`role="radiogroup"`, where a screen reader would announce a menu button as one of "what the middle
column shows" (PR-1). Cost: Greg said "in their place", and this is two buttons to the right of it.

**D7. The entrance: once per page load, on the first article opened, on the reading view only.**
The first `Reader` mount in this tab's JavaScript lifetime plays it, for an owner or a signed-out
visitor reading an article. Later articles in the same tab do not, nor does coming back from
Metadata; Metadata's and `PublicPages`' own bars never do. A refresh may replay it. (The first draft
said once per article; PR-6: a regular opening ten articles would pay ten delays.)

A class on `.dock` plays one CSS animation: absent for 1s, then about 0.6s of opacity 0→1 and a rise
of the bar's own height. It animates `opacity` and the separate `translate` property, never
`transform`, which belongs to the phone's hide-on-scroll rule. Exactly (PR-8): `.dock-enter` has a
static `visibility: hidden` and `animation: dock-enter 0.6s ease 1s forwards`; both keyframes set
`visibility: visible`. So during the delay the bar cannot be focused or pressed; keyboard focus
skips it for that second, which is accepted. `prefers-reduced-motion: reduce` gets
`animation: none; visibility: visible`. The iOS install hint, a sibling fixed just above the bar,
gets the same treatment, or it would float over an empty strip (PR-5).

The guard is a module-level boolean, **read** in render and **written only in a committed effect**,
because StrictMode's discarded render would otherwise spend the entrance before anything showed
(PR-7).

It plays for every reader, not only a new one: there is no "new reader" signal in the client, and
the cost to a regular is one second without the bar, once per tab. *Assumption, and the
likeliest thing for Greg to dislike on use; it is one class to narrow or remove.*

*Passed over:* a pulse or glow on the bar after load (draws the eye without hiding anything, but is
not what was asked for and is easy to make garish).

**Out of scope.** A filter on Marginalia's note kinds (the other half of `qi-5ay85q7d`, still
waiting on Greg). Removing any mode. Changing what the experimental switch reveals.

## GPT Sol's plan review

[Prompt](261007c-bottom-bar-more-and-entrance-plan-review-prompt.md),
[answer](261007c-bottom-bar-more-and-entrance-plan-review-sol.md): build with the P1 fixes; no P0.
All ten findings taken. PR-1, 5, 6, 7, 8 and 9 are written into D5 to D7 above. The rest are build
requirements:

- **PR-2.** With the Comments drawer open and More open over it, the first Escape closes More and
  returns focus to its trigger; the drawer's capture-phase Escape handler yields while the menu is
  open. A rendered test. Link items use `DropdownMenu.Item asChild`.
- **PR-3.** More's tooltip card is shut while its menu is open.
- **PR-4.** `.dock-more-trigger[data-state="open"]` joins the `:root:has(...)` list that holds the
  bar home on a phone, and `tests/the-dock-hides-in-a-mode-beside-the-article.test.ts` asserts it.
- **PR-10.** `tests/public-network-trace.test.tsx` "through every mode" and any other sweep over
  `[role="radio"]` go through a helper that also opens More, and assert the set of modes visited;
  `scripts/measure-cpu.ts` opens More for a gathered mode and fails on one it could not measure.

Both halves are built as one stage, because they are small and share `Dock.tsx`.

## Stages

### Stage: the More button

- [ ] Tests first, seen failing: a pure-function test for the split (which rows are drawn and which
      are in the menu, switch on and off, with a gathered mode open, with Marginalia on); the
      rendered bar has a More button and no Quotes/Glossary/Ideas radio; opening the menu and
      picking Glossary calls `onMode("glossary")` and the bar then draws Glossary checked; the links
      arm's menu items are links with the right `href`; the command bar still lists the gathered
      modes.
- [ ] `more: true` on the five rows; the split function; More in `DockModes` and `DockModeLinks`;
      the tooltip card on More; counts and `fitSignature` from the drawn list.
- [ ] CSS: the More button like its neighbours on every rung of the fit ladder; the menu in the
      bar's own colours; on a phone, an open menu holds the bar home.
- [ ] Update the tests that hand-write the bar's contents, each one deliberately, not by deleting
      the assertion. `scripts/measure-cpu.ts` if it walks modes by bar button.
- [ ] Docs in the same stage: `interface-vision.md` § Decluttering (decided, with Greg's words),
      `mode.md` (a new mode's row says whether it is gathered), `reading-view-overview.md`,
      `narrow-windows.md` / `phone-and-touch.md` where they list the bar, and `/help` where it
      describes the bar.
- [ ] `npm run typecheck`, the touched suites, lint on touched files. Commit. GPT Sol code review
      (write-capable), read its diff, commit.

### Stage: the entrance

- [ ] Tests first: the reading view's Dock carries the entrance class the first time a slug is
      shown and not the second; the links arm never does; a CSS-text test that the animation does
      not name `transform` and is switched off under reduced motion.
- [ ] The class, the keyframes, the per-slug guard.
- [ ] Docs: one paragraph in `reading-view-overview.md` (or the doc that owns the bar) and `/help`
      only if it says the bar is always there.
- [ ] Gates, commit, GPT Sol code review of both stages' final state.

### Stage: in a real browser, and the bookkeeping

- [ ] Sonnet subagent, Playwright on the box: wide and 390px, light and dark, switch on and off;
      the menu opens upwards and is not clipped; a pick opens the mode; the open gathered mode is
      drawn; on a phone the bar stays put while the menu is open; the entrance plays once and not
      again after Metadata and back; keyboard: Tab to More, Enter, arrows, Escape returns focus.
      Screenshots into `docs/plans/261007c-shot-*.png`.
- [ ] Full `npm test`, `npm run typecheck`. Push to `dev`.
- [ ] Note in `docs/user-feedback/261006_2154-…`, `feedback-endings.ts`, queue items: `done
      qi-wpkewsk3`; `qi-5ay85q7d` edited to say its menu half is answered by this.

## Log

(filled in as stages land)
