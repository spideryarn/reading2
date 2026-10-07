# UI sweep K2: keys pressed while composing Japanese or Chinese text

Cluster K2 of [the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k2-keys-pressed-while-composing-japanese-or-chinese-text),
which is the plan and was reviewed there. This doc records what landed, what the umbrella got
wrong, and what was left. The rule itself now lives in
[keyboard.md § A key an input method is using is not ours](../project/keyboard.md#a-key-an-input-method-is-using-is-not-ours).

## What it is for

A reader typing Japanese or Chinese presses Enter to accept a candidate word and Escape to dismiss
the candidate list. Until this stage about fifteen text boxes and two shared listeners answered
those keys as their own: a chat draft was emptied, a rename was saved half-typed, a panel closed
around the reader. `isImeComposing` in `src/web/key-chord.ts` is the one test for "this key is the
input method's"; four callers used it and the rest did not.

## The census

Every `Enter` / `Escape` handler on an input, textarea or contenteditable under `src/web`, and every
document- or window-level Escape listener, found by grepping `"Enter"`, `"Escape"`, `onKeyDown`,
`addEventListener("keydown"`, `<form`, `contentEditable`, `.code ===`, `onEscapeKeyDown` and
`useDismiss` on 2026-10-07. There is no `contenteditable` and no `e.code` Enter or Escape test in
`src/web`. "Before" is what a composing key did at the audited tree.

### Shared listeners

| Listener | Before | Verdict |
|---|---|---|
| `useEscapeToClose.ts` (Chat, Comment and Annotate dialogs; `window`, bubble) | a composing Escape closed the panel | **fixed**, centrally |
| `Dock.tsx`, the drawer's listener (`window`, capture) | a composing Escape closed the drawer, before any box could object | **fixed**; the guard is after `stopImmediatePropagation`, so the key is still contained |
| `Dock.tsx` `useMetadataEscape` | already refuses a composing key and any key while typing | leave |
| `Dock.tsx` `useMetadataChord` (`window`, bubble) | modified Enter opens Metadata, but already refuses composition and typing through `isModChord` and `isTyping` | leave |
| `Dock.tsx` `useCommandBarChord`, `fold.ts`, `keynav.ts`, `DockQuickSearch`'s `/`, `TermJump`'s G | not Enter or Escape, and each already refuses composition or typing | leave |
| `BlockGutter.tsx` (`document`, bubble) | a composing Escape shuts the "…" disclosure | leave: not K2's file; costs a disclosure, never text |
| `useHoverCard.ts` (`document`, capture) | a composing Escape shuts an open hover card | leave: not K2's file; costs a card, never text |
| `BlockLinkCard.tsx` (`document`) | the same for a link's hover card | leave: the same |
| `TermJump.tsx` `onEscape` (`document`) | sends focus back to the paragraph, but only while focus is in the glossary list after a G jump; no text box is in that list | leave: not reachable while composing |
| Floating UI `useDismiss` (`Tooltip`, `ProfilePanel`, Search's colour picker) | the installed library tracks `compositionstart` / `compositionend` and refuses Escape until composition settles, with a 5ms grace on WebKit | leave; browser behaviour not measured, see § Left |
| Radix `Popover` in `ShelfTags.tsx` (`onEscapeKeyDown`) | **a composing Escape can close the tag popover when suggestions are hidden**: Radix hears Escape on `document` before `TagEditor` can; its existing expanded-list check already prevents dismissal while suggestions are shown | **not fixed: `ShelfTags.tsx` is in no cluster's manifest.** One composition check there closes it, see § Left |
| `ModeHerald.tsx` (`document`, capture) | any key inside the band, including composing Enter or Escape, dismisses the introductory herald | leave: outside K2's manifest; its existing first-use behaviour |
| Native `<dialog>` (Lightbox, Feedback, command bar, Sketch, Illustrated) | the platform's close request | leave: not a listener |

### Text boxes

| Box | Before | Verdict |
|---|---|---|
| Chat composer (`ChatPanel.tsx`) | Escape stopped the answer, or emptied the draft, or blurred. Enter was already `isSendEnter` | **fixed** (Escape), after the `stopPropagation` |
| Chat rename box (`RenameRow`) | Enter saved the name; Escape cancelled | **fixed**, after the `stopPropagation` |
| Chat question editor (`EditQuestion`) | Escape cancelled the rewrite. Enter was already `isSendEnter` | **fixed**, after the `stopPropagation` |
| Annotate's textarea | Escape emptied the box | **fixed** |
| Comment's note (`CommentBody`) | Escape put the stored words back | **fixed** (`CommentDialog.tsx`, key handler only) |
| Comment's follow-up box | Escape emptied it; it sits in a form whose submit asks the AI | **fixed**: Escape ignored, a composing Enter `preventDefault`ed |
| Masthead rename (`TitleEditor.tsx`) | Escape cancelled; it sits in a form whose submit saves | **fixed**: Escape ignored after its `stopPropagation`, a composing Enter `preventDefault`ed |
| Search mode's box (`SearchPanel.tsx`) | Enter already guarded; Escape cleared | **fixed** (Escape) |
| Dock quick search (`DockQuickSearch.tsx`) | Enter already guarded; Escape cleared and blurred | **fixed** (Escape) |
| Shelf search (`Library.tsx`) | Enter blurred; Escape cleared | **fixed** |
| Help's search (`HelpPage.tsx`) | Enter went to the first result; Escape cleared | **fixed** |
| Contents search on /profile and Metadata (`PageContents.tsx`) | the same | **fixed** |
| `TagEditor.tsx` | read only `nativeEvent.isComposing`, so an engine that sends `keyCode` 229 saved a partial tag | **fixed**: the helper |
| `CommandBar.tsx` | read only `nativeEvent.isComposing`, after `preventDefault`; its arrows moved the selection while the input method's own list was open | **fixed**: the helper, first, before any `preventDefault` |
| Debate's lens box, Candidates' box | already right (`isImeComposing`, `isSendEnter`) | leave |
| Quiz, Feedback, ProfileBox, the Add page: ⌘/Ctrl-Enter | a modified Enter is not how a candidate is accepted | leave (the umbrella's own example) |
| Annotate's and Comment's ⌘/Ctrl-Enter | the same; both preserve their conditional Escape containment before returning on a composing key | covered by the guard above |
| Sign-in email, new-password first box: Enter moves focus | a focus move, in boxes nobody composes in | leave (the umbrella's own example) |
| Glossary's "ask a term" box (`GlossaryPanel.tsx`) | no key handler. `type="search"`, so Chrome empties it on a composing Escape; in a form whose submit runs a model call | **not fixed: K4 owns the file.** See § Left |
| Criteria's two one-line boxes (`CriteriaPanel.tsx`), the Add-article URL box, the voucher forms | no key handler; each in a form | leave: not K2's files, and implicit submit on a composing Enter is a hypothesis, see § Left |
| `OutlinePanel`, `SketchView`, `DiagramPanel`, `TableView`'s cross-reference Enter | not text boxes | leave |

### What the two central guards cover on their own

With no per-box edit at all, the guards in `useEscapeToClose` and the drawer keep the surface open
for: every box in the three dialogs that has no Escape handler or passes the key on when it has
nothing to clear (Annotate's box when empty, Comment's follow-up when empty, Comment's note when
unchanged); any press made outside a box while a dialog or the drawer is open; and every box at
all while the drawer is open, since its listener runs first. What they cannot cover is a box whose
own handler acts before the key reaches `window`: the clears, cancels and saves in the table above.
Those require per-box guards, after any conditional or unconditional propagation stop.

## What landed

- The two shared listeners and the fourteen per-box handlers above use `isImeComposing`.
- **Found in the browser, not in the plan: a `type="search"` box is emptied by Chrome itself on
  Escape.** With the handler's guard alone, Help's and the shelf's boxes still lost their text on a
  composing Escape, because the handler used to `preventDefault` the key and no longer did. So the
  five search-type boxes in this cluster (`SearchPanel`, `DockQuickSearch`, `Library`, `HelpPage`,
  `PageContents`) cancel a composing Escape and do nothing else with it. jsdom has no such default,
  so the unit tests can only assert the flag. The drawer cancels the same default for a composing
  Escape targeted at a search input: its capture listener prevents the input's handler from running.
- `PageContents.tsx`'s entries: `outline-none` replaced by a 2px outline at offset −2px in
  `--highlight-text`, the idiom `BackLink.tsx` uses plus the negative offset. The colour change on
  focus stays.
- `tests/eager-client-graph.test.ts` gains `src/web/key-chord.ts` on its shared list: `TitleEditor`
  and `TagEditor` are reachable from `/admin` or `/design` and now import it. The reader already
  downloaded it through the Dock; it has no imports of its own.
- [keyboard.md](../project/keyboard.md#a-key-an-input-method-is-using-is-not-ours) states the rule.

## Evidence

**Red, then green** (jsdom, native `KeyboardEvent`s dispatched at the real mounted element, once
with `isComposing: true` and once with `keyCode: 229`):

- `tests/one-escape-closes-one-surface.test.tsx`: 20 of the 25 new cases red before any fix
  (`expected ['annotate'] to deeply equal []`, and the same for `comment`, `chat`, `drawer`; the
  drafts emptied; `defaultPrevented` false). 12 went green on the two central guards alone, the
  other 8 on the per-box guards. The 5 green throughout are the controls: an ordinary Escape still
  closes, clears and cancels.
- `tests/chat-composing-keys.test.tsx` (new): 10 red, 5 controls green.
- `help-page`, `metadata-contents-reveal`, `shelf-search-clear`, `quick-search-panel`,
  `dock-quick-search`, `tag-editor`, `command-bar-pick`: 11 new cases red, then green.
- Mutation: 25 mutations, one per guard plus "guard moved before the stop" for the composer, the
  masthead rename and the command bar, and the focus classes. Each removes or moves one line, runs
  the one test file, and puts the text back (`k2-mutate.py` in the session scratchpad). 23 were
  noticed on the first run. Two (Annotate's guard, Comment's follow-up guard) reported green in
  that run and red when each was re-run alone; the cause of the first result was not found, and a
  stale transform cache is only a guess.

**In Chrome** (headless system Chrome through Playwright, this worktree's dev server, a real
composition opened with CDP `Input.imeSetComposition` and the key sent with
`Input.dispatchKeyEvent` while it was open; the page saw `isComposing: true` with `keyCode` 27 or
13, so this exercises the flag, and only the unit tests exercise 229). Scripts:
`k2-ime.ts` and `k2-focus.ts` in the session scratchpad.

| Box | Composing key | Result on the fixed build |
|---|---|---|
| Chat composer (`?mode=chat`) | Escape | draft "a draft にほん" kept, panel open, caret kept. Control: an ordinary Escape then emptied it |
| Chat rename box (a stored conversation on the fixture) | Enter, then Escape | box still open with its text, no write request. Control: an ordinary Escape cancelled it |
| Help's search | Enter, then Escape | no navigation (hash empty, scroll 0), text kept. Control: an ordinary Enter went to `#spine` |
| Shelf search | Enter, then Escape | focus and text kept. Control: an ordinary Escape cleared it |
| /profile contents search | Enter, then Escape | no scroll, text kept. Control: an ordinary Escape cleared it |
| Search mode's box (words matcher only) | Escape | text kept. Control: an ordinary Escape cleared it |
| Annotate's box (Referee, by selecting prose; discarded afterwards) | Escape | draft kept, box open; no write request |

The browser "before" is partial and honest about it: on the build with the handler guards but
without the search-type cancel, the same script showed Help's and the shelf's boxes **emptied** by
a composing Escape. No browser run was made against the wholly unfixed tree; the unit tests are the
red for that.

Not driven in a browser, and why: the dock's quick search and Search's quick matcher (typing there
asks a model after a pause); Comment's note (an edit commits on blur, which would change a stored
comment); Comment's follow-up box and the masthead rename's Enter (the first asks the AI, the
second writes a title, if the fix were wrong). All four are covered by the unit tests.

**The contents list's focus mark**, /profile at 1440 wide, after real Tab presses, both themes:

| | Before | After |
|---|---|---|
| outline | `none` | `solid 2px`, offset `-2px` |
| mark colour, dark | none (text colour only) | `rgb(219, 138, 69)`, 7.29:1 on the page |
| mark colour, light | none | `oklab(0.5075 0.0487 0.0798)`, 5.70:1 on the page |
| drawn outside the button | 0px | 0px, so the scrolling list clips nothing |

## What the umbrella got wrong

- **The drawer does not hold the chat.** The umbrella puts the drawer's listener "above all of
  these" boxes, and comments in `ChatPanel.tsx` still speak of Escape reaching the drawer. The
  drawer has one panel, Questions, a list of comments with no text box (`PANELS` in `params.ts`).
  The drawer guard is still right, since a composing Escape anywhere on the page closed it. But the
  chat that had to "stay open" is the band or the floating dialog, and the composer stops every
  key, so `useEscapeToClose` never heard a press made in it: there the per-box guard is the fix.
- **"Where a form would submit implicitly … as Debate does"** reads as an observed defect. It is a
  precaution. No browser was seen to submit a form on a composing Enter, and none was made to: my
  understanding, not measured here, is that implicit submission follows the `keypress` an Enter
  produces and a key an input method consumes produces none. The two forms in this cluster cancel a
  composing Enter as told.
- The search boxes' Escape was described as only our handler clearing. The browser clears a
  `type="search"` box by itself, which is why a guard alone was not enough (§ What landed).

## Left, and why

- **`ShelfTags.tsx`: a composing Escape can close the tag popover when suggestions are hidden**
  (C: Radix listens on `document`, and `onEscapeKeyDown` there protects only an expanded suggestion
  list). With suggestions shown, the existing check already prevents dismissal. Not in any
  cluster's manifest, so not edited. The fix is one test in that callback:
  `preventDefault` when the event is composing.
- **`GlossaryPanel.tsx`'s "ask a term" box**: `type="search"` with no key handler, so a composing
  Escape empties it in Chrome, as Help's did. K4 owns the file.
- **Forms outside this cluster** (`GlossaryPanel`'s ask box, `CriteriaPanel`'s two one-line boxes,
  the Add-article URL box, the voucher forms, sign-in): implicit submit on a composing Enter is H,
  not reproduced, for the reason above.
- **The new-password form** (`SetNewPassword.tsx`): the first box's Enter moves focus as listed
  above; the second can submit implicitly. Composing submission remains unmeasured, like the
  other forms outside this cluster.
- **`ProfilePanel`'s popover** holds a text box and closes through Floating UI's `useDismiss`.
  The installed implementation tracks composition events and protects Escape; browser behaviour
  was not measured.
- **`ModeHerald.tsx`** dismisses its introductory card on any key inside the band, including a
  composing Enter or Escape. Outside K2's manifest; no change made.
- **The four `document` listeners** (`BlockGutter`, `useHoverCard`, `BlockLinkCard`, `TermJump`):
  a composing Escape can still shut a hover card or a disclosure. None loses text.
- `DockQuickSearch.tsx` § `isQuickSearchKey` and `TermJump.tsx` spell the composition test out by
  hand (`e.isComposing || e.keyCode === 229`). They are equivalent to the helper for a native
  event, so they were left.

## Review status

[GPT Sol code review](261007a-ui-sweep-k2-code-review-sol.md) of `67ce4c833`, one round, all three findings kept and none overruled. It found two defects, fixed red-first in this worktree:

- **Early-return guards bypassed conditional event ownership.** Seven handlers (Annotate,
  Comment's note and follow-up, TagEditor, Library, Help and PageContents) returned before their
  existing conditional `stopPropagation`. The drafts survived but composing Escape reached
  `document` where an ordinary Escape was contained. Fourteen cases, one per handler and flag,
  failed on that propagation difference. The stops now precede the composition guards under
  exactly their old conditions. TagEditor's native-flag bypass predates this candidate; the
  candidate extended it to 229. The other six bypasses were introduced here. The original tests
  checked draft state and panel closure without watching the intermediate listener tier.
- **Capture swallowed native-default protection.** With a real `DockQuickSearch` mounted beside
  the drawer, both composition spellings reached the drawer's capture stop but left
  `defaultPrevented` false, because the input handler never ran. The drawer now cancels this
  default only for a composing Escape targeted at a search input. These tests establish the
  missing cancellation; the consequent Chrome clear follows from the browser measurement above,
  and was not remeasured during review.

The census also gained the Metadata Enter chord, the herald's dismissal listener and the
new-password form, and qualified ShelfTags' hidden-suggestion case and Floating UI's existing
composition tracking. Wider behaviour was left alone.

Final validation: 330 tests passed across eleven single-file runs (the ten touched candidate
test files and `doc-links`). Typechecking passed for all four projects and covered 3338 source
files. `npm run typecheck` could not create tsx's IPC socket in the review sandbox, so the same
script was run as `node --import tsx scripts/typecheck.ts`. Scoped lint checked twelve files with
no errors and three informational complexity notices. `git diff --check` passed. No browser,
whole-suite run or commit was made. Verdict: **ready with these fixes**.
