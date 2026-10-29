# A reminder bar at the top, and adding a selection to the glossary

Two of Greg's reports, filed minutes apart on 2026-10-28 while reading
`arxiv-2308-08708-spya-xax6v4` (Consciousness in AI) with `?margin=1`, both proved his
(`feedback-reporter.ts` exit 0, no addenda). Session `fbga6m76-top-bar-select-to-glossary`.

> When I scroll in one direction, it shows the bottom bar, like when I'm on an iPad. That's great. I
> think it might be useful if it also perhaps showed a bunch of stuff about the article at the top,
> like the title and author and publication date and maybe any other metadata you think would be
> useful, how much we read. It could just be useful as a reminder.
>
> And then when I scroll in the opposite direction, it would disappear just like the bottom bar does.
>
> — Greg, 2026-10-28 (`spya-ga6m76`, #727, Sentry `SPIDERYARN-READING2-PW`)

> When I highlight a piece of text, it gives me the option to highlight or comment it. Okay, great.
> Can we also have the option to add it to the glossary?
>
> — Greg, 2026-10-28 (`spya-turkg3`, #728, Sentry `SPIDERYARN-READING2-PX`)

Both are an admin's suggestions, so they are built ([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)),
simplest version first. The prior-work check found nothing in flight: the nearest finished work is
the masthead's read-so-far pie ([261025j](261025j-how-much-of-the-article-you-have-read-at-the-top.md))
and the glossary's *Look up a term*, which adds a term for the owner
([261002f](261002f-glossary-add-a-looked-up-term.md)) and which the command bar can already hand a
term to ([261003f](261003f-commands-take-arguments-tags-dictation-and-chat-tools.md) — the hand-off in
`src/web/glossary-ask-handoff.ts`).

## What is there today

- **The bottom bar slides away while you read forwards and comes back when you scroll back** — on
  a small device only, `(max-height: 620px), (max-width: 731px)` in `styles/narrow-window.css`
  § a small device, driven by `data-bars` on the root, which `scroll.ts` § `watchBarVisibility`
  sets and which ignores our own jumps.
- **The top bar (`.controls`) does the same at every width, but is usually not drawn at all**:
  `Reader.tsx` § `showBar` renders it only for a visitor's View-only chip or the experimental
  headings breadcrumb. With Marginalia's column on screen (Greg's `?margin=1`) the breadcrumb is
  not drawn, so for an owner there is no top bar. That is why Greg saw only the bottom one.
- **A finger's selection gets a chip** (`TouchSelectionChip.tsx`), *Highlight or comment*. A
  mouse's selection highlights at once and opens the comment's *fresh* box
  (`CommentDialog.tsx` § `FreshBox`), which offers *Copy, don't highlight* and *Remove highlight*.

## Part 1 — the reminder bar (`spya-ga6m76`)

**A slim bar fixed to the top of the screen that comes and goes with the bottom bar.** Two lines:

```
┌──────────────────────────────────────────────────────────┐
│ Consciousness in Artificial Intelligence: Insights fro…  │  title, one line, ellipsis
│ Butlin, Long, Elmoznino … · arXiv · Published 2023 · ~95 min ◔ │  the masthead's facts line
└──────────────────────────────────────────────────────────┘
                 … the prose, unmoved, under it …
```

- **Contents are the masthead's own facts**, in its order: title; then byline, journal/site,
  *Published …*, `~N min` and the read-so-far pie (owner only; `ReadSoFarMark`). Plain text, no
  links, no cards: a reminder, not a second masthead. One shared function builds the facts so the
  two lines cannot drift (`Masthead.tsx` already filters a list; that list moves to a small exported
  helper both call). "Any other metadata you think would be useful": nothing more for v1 — the facts
  line is what Greg asked for, and the counts are behind *Show counts* for a reason (261015c).
- **When it shows**: exactly when the bottom bar shows on a small device, and only once the
  masthead has scrolled out of view (at the top the masthead itself is the reminder). Hidden while
  a band is open — a band beside the prose on a short window, or covering it on a narrow one — so it
  never lies over a mode's own header. So: same media query, `:root:not([data-bars="hidden"])`, plus
  a `data-` flag on the bar from an `IntersectionObserver` on the masthead.
- **It overlays; it reserves nothing.** `position: fixed`, under any `.controls` bar
  (`top: var(--bar-bottom)`), slid out with `transform` like `.controls`. No row moves when it comes
  or goes, so `layoutKey`, `?at=` and every jump destination are untouched. It covers the top ~3rem
  of the prose while you scroll back, which is when you are looking for something, not reading —
  the trade the old top bar made, minus the reflow.
- **Not interactive** in v1 (`aria-hidden`, `pointer-events: none`): everything in it is in the
  masthead, which a screen reader already has, and a bar that vanishes on the next scroll is a bad
  home for a control. Tap-to-top was considered and left for if it is asked for.
- **Owner and visitor alike**, except the pie, which is owner-only already.

**The simpler option passed over: putting the facts into `.controls`.** It would reuse the bar's
slide, but drawing `.controls` changes `showBar`, which reserves 44px in flow and moves every row,
re-keys `layoutKey` and changes `stickyDestination` for every deep link — the machinery 260908a
added *not* drawing the bar to escape. An overlay touches none of it.

**The product choice for Greg**: should it also appear where the bottom bar never slides — a
full-screen iPad and a laptop? There it would be the only thing that comes and goes. Recommended:
no, keep the two bars one gesture, and widen later if he wants it. Asked as a question file; built
the recommended way meanwhile.

## Part 2 — *Add to glossary* from a selection (`spya-turkg3`)

**A second button beside the chip, and a button in the fresh box, that do what the command bar's
*Look up "X"* row does**, with the selected words as X:

- **The words name an entry already in the visible glossary** (name or alias, `canonical`
  comparison): open that entry. No model call.
- **Otherwise**: leave the words in the one-shot hand-off and open the Glossary band with the plain
  setter (`showBand("glossary")`); its *Look up a term* box asks once, streams the answer, and a
  finished answer adds the term, labelled *added by you*, owner-only, underlined in the prose.
- Both decisions are `resolveArgument({ kind: "glossary", words }, { glossary })` in
  `command-proposal.ts`, run through the reading view's existing `executor.runners` with
  `runProposal`. No new matching rule, no new route, no new prompt.

**Offered only when it can work**: the owner (a selection by a visitor is silent), the glossary
read settled with a glossary in it (`glossaryReady`, the same gate the bar's ask row has — an
article with no glossary would otherwise *generate one on open*), Glossary drawn by the Dock, and
words that are term-sized (`parseAskedTerm`: at most 80 characters, the server's own rule). A long
selection simply does not get the button.

- **The chip** becomes a pair: *Highlight or comment* and *Add to glossary* (`BookPlus`-style icon).
  The glossary press does not highlight; it clears the selection as the chip's press does today.
  The chip's armed-press and grace rules apply to both buttons unchanged.
- **The fresh box** gets *Add to glossary* beside *Copy, don't highlight*. While the highlight is
  pristine it takes the highlight off first, as Copy does — the reader selected in order to look
  something up, not to mark it — and closes the box; once touched, the highlight stays.

**"Its definition the way Glossary writes one"**: an added term's explanation is the look-up answer
Glossary already writes for a term a reader adds (`makeAskAboutTerm` → `explain`), not a fresh run
of the glossary step's two-field entry. A new two-field definition would be a new prompt, which is
Greg's, for no gain the reader can see; the added row is already drawn as an entry.

**Model calls**: none new. The ask is a paid `explain` call on production's key, unaffected. On the
box the OpenRouter key is over its monthly limit until 1 November, so the look-up cannot be run end
to end here; the tests drive it against a stubbed stream, as the command-bar hand-off's test does.

**The simpler option passed over**: only the chip, since that is what Greg pressed. The fresh box
is the same request on a mouse and one button; leaving it out would make the two inputs disagree
about what a selection offers ([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).

## Stages

1. **Add to glossary**: `Reader` builds `glossaryForWords(words)` → a proposal or `null`; chip and
   fresh box take an optional action; tests in `tests/touch-selection-chip.test.tsx` and a new
   `tests/selection-adds-to-glossary.test.tsx` (chip press → one `POST …/ask` with the words and
   the Glossary band; an existing entry → opened, no POST; no glossary → no button; 81 characters →
   no button; fresh box → pristine highlight removed).
2. **The reminder bar**: `ReminderBar.tsx`, the facts helper out of `Masthead.tsx`, CSS in
   `styles/narrow-window.css` § a small device beside the bottom bar's rule; tests for the facts and
   for render conditions (no band, owner pie only).
3. Docs (touch.md, comments.md, glossary.md, phone-and-touch.md, narrow-windows.md), GPT Sol's code
   review, a browser check at 390×844 and 844×390 with touch, the question file, the notes.

## Review

GPT Sol on this plan before building; GPT Sol on the code before pushing. Findings and what was
done with them are added below.

### GPT Sol on the plan

[Prompt](261029d-plan-review-prompt.md), [answer](261029d-plan-review-sol.md). No P0. Every finding
was taken; the design above is amended by these, and where they differ these win.

| # | Finding | What was done |
|---|---|---|
| F1 P1 | The reminder collides with Marginalia's fixed head on the same top edge. | Sized to the reading column, from the widths `Reader` already gives the page, and stacked below `.marg-head`. |
| F2 P1 | A visible reminder covers a jump's destination: `stickyOffset` measures only `.controls`. | Simpler than teaching four measurements a second bar: **a jump of ours puts the reminder away.** It shows on `data-scrolled-back`, which `watchBarVisibility` sets only when a reader's scroll brings the bars back, and which `moveWindow` (every jump this app makes) and the bars hiding remove. So it is never up when a jump lands. A reader's own upward scroll can still pass text under it, which is the point of it. |
| F3 P1 | After the fresh box's *Add to glossary*, `CommentDialog` returns focus to the prose behind a covering band. | The press sets the box's existing `closedByPress`, which skips the return, when it actually went (`onAddToGlossary` returns whether it did). |
| F4 P1 | The masthead's facts are focusable nodes; reusing them in an `aria-hidden` bar leaves them in the tab order. | The reminder takes plain strings and draws the pie as a bare SVG; it is `inert` as well as `aria-hidden`, and a test asserts nothing in it is focusable. |
| F5 P2 | A shared alias makes "the first match" open an arbitrary entry. | `glossaryProposalFor` returns a proposal only when there is exactly one row; two entries that could be meant get no button (both are already in the glossary). |
| F6 P2 | `runProposal`'s outcome is ignored, so a `stay` would still clear the selection and drop the highlight. | `add` re-resolves at the press and reports success only for `close`; the chip clears the selection, and the fresh box removes the highlight and closes, only then. |
| F7 P3 | "Exactly when the bottom bar shows" is not what `data-bars` says (the Dock is forced back by dialogs, focus, a band). | Worded as *the same scroll-direction state*, which is what was meant; it is hidden while a band is open. |

**Found while building**: after a jump the bars are already shown, so a reader's next scroll up
flipped nothing and the reminder never came. `data-scrolled-back` is now set by any upward movement
of the reader's, not only the hidden-to-shown flip (the scroll-settlement test pins both).

### GPT Sol on the code

[Prompt](261029d-code-review-prompt.md), [diff](261029d-code-review.diff),
[answer](261029d-code-review-sol.md). No P0 or P1; it fixed three things in place, and I read and
kept all three:

- **P2, focus after the fresh box.** Skipping the return to the prose left focus on `<body>`. The
  Glossary band now takes it once: the opened entry's row, or the band itself for a look-up (never
  the text field, so no phone keyboard). `GlossarySelectionFocus` in `GlossaryPanel.tsx`, set by
  `Reader` only for the fresh box's press. About a hundred lines for a keyboard user's edge case,
  weighed and kept: contained, tested, and the alternative was a known defect left in place.
- **P2, the reminder folded authors differently from the masthead** (four names became "three et
  al."). The facts' words and order now have one home, `mastheadFactsAsWords` in `Masthead.tsx`,
  with `collapsedAuthorNames` in `AuthorNames.tsx`; the reminder draws that list.
- **P3, reduced motion.** The reminder joined the list of chrome whose slide is switched off.

Gates after it: typecheck clean; the touched suites, the masthead and glossary suites (555 tests)
and doc-links green; the browser check below was run before these three fixes and none of them
changes what it looked at, beyond "+ N more" for five or more authors.

### In a browser

A Sonnet subagent, Playwright against system Chrome on the box, all seven checks passed: the bar at
390×844 and 844×390 comes with a scroll back and goes with reading on, clears the spine, stays left
of and under Marginalia's column with `?margin=1`, is gone after a crumb jump and after *Back to*,
never draws at 1280×800, and is legible in dark mode; the chip's two stacked buttons send a new
phrase to the band's box (one `POST …/ask`, no highlight) and open an existing entry with no ask;
the fresh box's link removes the highlight, opens Glossary, and is absent for a 100-character
selection. The look-up itself failed with the box's over-limit key, as expected.

### Deferred

- **Wider screens**: [q-t2p2s7](../user-feedback/questions/q-t2p2s7.md) asks whether the reminder
  should also appear on a full-screen iPad or a laptop. Built the recommended way meanwhile.
- **A real look-up from a selection** waits for the box's key to reset on 1 November, or the deploy.
