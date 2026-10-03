The plan needs changes, chiefly in fixes 1 and 3. I made no edits. The working tree changed during the review; code references below are against base `451df1f8f`.

For **fix 1**, the report clearly asks for more separation, and increasing the gap universally is a simple response. The proposed threshold arithmetic is correct: two, three and four 24px slots with 8px gaps require **56 / 88 / 120px**, or **3.5 / 5.5 / 7.5rem**. The 6px alternative correctly gives **54 / 84 / 114px**. The problems are capacity and an omitted query.

- **F1 — P1 — plan:65–67. The 6px fallback cannot preserve two slots in a prose-driven two-line paragraph.** At a 16px root, two lines occupy `2 × 17 × 1.6 = 54.4px`. The cell adds two 5.95px pads, but the gutter subtracts those pads plus its 3.2px top adjustment, leaving **51.2px**. Both 56px and 54px exceed that. Another table column can enlarge a particular row, so measuring only Summary mode could conceal this.  
  **Fix:** measure prose-driven rows as well as Summary rows. Either accept the reduced capacity while widening the gap, or explicitly change the gutter geometry to preserve it. Remove the promise that switching to 6px solves this. Sources: [typography tokens:264](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/styles/tokens.css:264), [prose.css:91](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/styles/prose.css:91).

- **F2 — P1 — gutter.css:542; plan:77. There are four query conditions to update, not three.** The negated two-slot query controls the overlapping bookmark mark and ellipsis. Leaving it at 52px while moving the positive query to 56px creates a **52–56px interval** with neither two slots nor the one-slot overlap treatment. A bookmark can disappear at rest.  
  **Fix:** update the negated condition too, including the test’s corresponding landmark at `tests/gutter-target-size.test.ts:401`. Check a marked row immediately below the new threshold. [gutter.css:542](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/styles/gutter.css:542)

For **fix 2**, consolidating the three actions and saying “Open glossary” correctly interprets the report. A single action row is a good default; arbitrary wrapping needs more care.

- **F3 — P2 — plan:93–95; prose-hover-card.css:272. Wrapping four independent items can reproduce the untidy layout and increase its height.** With a host link first, flex wrapping can leave `Hide` separated from `Dig deeper`, or put `Open glossary` alone on another row. The existing `gap: 0.6rem` also becomes a vertical gap between wrapped rows. Applying wrapping to the shared `.prose-card-foot` changes other card types too. The sizing premise is stale: the live cap is **21rem**, not 18rem (`prose-hover-card.css:21`).  
  **Fix:** keep the three action buttons grouped; let an external link occupy a separate row when necessary. Scope this layout to term cards. Compare screenshots with no link, a long host, and “Dig deeper again” before choosing the final arrangement. [prose-hover-card.css:272](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/styles/prose-hover-card.css:272)

For **fix 3**, “send, then reveal the answer” is a plausible reading of Greg’s report, although his words do not prove that sending already worked. The existing key label supports the interpretation. Blurring is simple; reliably deciding when to blur is the difficult part.

- **F4 — P1 — plan:118–121; useVisualViewport.ts:60. Bottom inset is not a sound cross-platform keyboard detector.** On Android Chrome, this app requests `interactive-widget=resizes-content` (`index.html:40`). When both viewports shrink, `innerHeight − vv.height − vv.offsetTop` can be zero **with the keyboard open**. On iOS Safari, the calculation is a useful heuristic for a docked keyboard at normal zoom, but pinch zoom can produce a large inset **without** a keyboard; a floating iPad keyboard need not resize the viewport. Thus it cannot guarantee either dismissal or hardware-keyboard focus preservation.  
  **Fix:** keep the positioning inset separate from keyboard detection. Track viewport shrinkage against an unfocused baseline, including layout-viewport changes, and guard zoom and orientation changes. Describe detection as conservative rather than certain. Add Android resizing and zoom cases to the tests, and validate on actual iOS/Android devices; width emulation does not exercise keyboards. [useVisualViewport.ts:60](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/useVisualViewport.ts:60)

- **F5 — P1 — ConversationModes.tsx:768–778; ChatPanel.tsx:2062–2069. A replacement composer can undo dismissal.** Sending from the conversation list creates a thread and increments `focusNonce`; the newly mounted composer then calls `focus()`. Blurring the old composer alone does not prevent that focus or the keyboard reopening. A standalone composer test misses this path.  
  **Fix:** carry the dismissal decision through the new-thread transition and suppress automatic composer focus for that submitted soft-keyboard turn. Preserve focus when the reader explicitly starts a conversation to type. Test the first send from the list through the replacement composer. [ConversationModes.tsx:768](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/modes/conversation/ConversationModes.tsx:768)

- **F6 — P1 — plan:113–116; touch.md:556–560. The blanket desktop-focus rule contradicts an existing Enter contract.** Words search deliberately blurs on desktop to return arrow keys to article navigation (`SearchPanel.tsx:650`). Library search also already blurs on Enter (`Library.tsx:1204`). Replacing those handlers with a soft-keyboard-only helper would remove established behavior.  
  **Fix:** make desktop focus preservation the rule for new dismissal behavior, with explicit exceptions for existing searches and navigation destinations. Preserve their current blur or focus transfer. [touch.md:556](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/docs/project/touch.md:556)

The box-by-box policy I would use is:

| Boxes/action | Keyboard treatment |
|---|---|
| Chat, **tutorial**, edit-question, Candidates, comment follow-up | Dismiss after an accepted send. Tutorial needs room to read the next response; repeated turns alone are not a reason to exempt it. |
| Glossary lookup, explicit Search submission, Dock quick search | Dismiss after an accepted action. Never dismiss because an automatic search finished while the reader continued typing. |
| Help and page-contents navigation | Let focus move to the destination; avoid redundant dismissal machinery. |
| Library and words search | Preserve existing Enter blur, including desktop behavior. |
| Add URL, committed title/rename edits, submitted dialogs | Closing or replacing the focused field usually already dismisses it. |
| Tag editor; fields labelled “next”; rejected, empty, busy or IME submissions | Keep focus and keyboard. |
| Feedback, comment and quiz textareas on plain Enter | Keep newline behavior. Successful button submission is a separate decision from what Enter does. |

For **fix 4**, the interpretation and proposed solution are sound. A filled default `Button`, placed after the fields, makes creation easier to find; moving the recipient note before the private note gives it the requested emphasis. Preserve `type="submit"`, the busy state, the signature hint and email preview. Swap both table headers and their cells. I found no blocker in this fix.

- **F7 — P3 — plan:53. The history claim is false.** Commit `a0de6acd6` added the term-card action row, and `950e1a33b` added the recipient-note form layout on 2026-10-02.  
  **Fix:** remove the claim that neither layout has been touched since October 1, or replace it with accurate provenance.

The one permitted test run, `tests/gutter-target-size.test.ts`, passed **28 tests**. It verifies declarations, not rendered two-line capacity.

Verdict: **build with changes**.