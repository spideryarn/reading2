Verdict: **build with changes**.

No P0s. The product split is good, and the existing keyed-draft/latch design can support it safely. The plan needs one predicate correction, a visible Copy exception, corrected Referee reasoning, help-page coverage, and several sharper tests.

## Findings

**D1 — P1 — An implicit exit must require both predicates, not merely `isTouched`.**

The plan says `isTouched` gates implicit exits, but also expects choosing “No colour” and then unmounting to store nothing ([plan:88](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:88), [plan:111](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:111)). If selecting No colour sets `isTouched`, an implementation following the prose literally sends an empty, uncoloured bookmark on the next implicit exit.

Concrete plan change: specify the actual gates:

```ts
hasSomething =
  body.trim() !== "" || colour !== null || mark.criterionId !== null;

implicitIntent =
  body.trim() !== "" || mark.criterionId !== null || colourInteracted;

implicit exit: hasSomething && implicitIntent
explicit close: hasSomething && !(copyIntent && !implicitIntent)
```

Preserve the current ordering: test the gate before changing `fate`; the current `flush` does that at [AnnotateDialog.tsx:401](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/AnnotateDialog.tsx:401).

**D2 — P2 — A press on the already-selected Yellow cannot currently mark the box touched.**

The plan says a “press on the colour row” sets the touch boolean via `onChange` ([plan:89](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:89)). But `HighlightSwatches` calls `onChange` only when the pressed colour differs from the current one ([HighlightSwatches.tsx:62](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/HighlightSwatches.tsx:62)). Pressing the default Yellow and then making another selection would therefore store nothing.

Concrete plan change: either define “touch” as a colour *change*, or add an `onInteract`/`onPress` callback used only by `AnnotateDialog`. Do not make `onChange` unconditional: `CommentDialog` would issue redundant PATCHes when its selected swatch is pressed.

**D3 — P2 — The Copy exception is justified, but hidden and contradicts the promised copy.**

The plan says both “Discard is the one way to make nothing” and “Closing this saves the highlight” ([plan:24](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:24), [plan:37](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:37)), then makes Copy followed by close another way to save nothing ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:52)).

The exception is worth its boolean: the Copy button exists specifically because selection often means copying, not highlighting ([comments.md:333](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/project/comments.md:333)). But it must become visible.

Concrete plan change: after Copy is pressed, change the hint to something like: “Copied. Close leaves no highlight; press Save to keep the yellow highlight.” Rename `onCopied` to `onCopyIntent` or `onCopyPressed`.

“At the press” is correct. Waiting for the promise would let a quick close save an unwanted highlight, and failed Clipboard API access would unpredictably change the save rule.

**D4 — P2 — The reader-facing Help page is omitted and would become false.**

The plan’s documentation list omits Help ([plan:121](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:121)). Help currently says an empty Save is a bookmark and an untouched box saves nothing ([help-topics.tsx:670](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/help/help-topics.tsx:670), [help-topics.tsx:681](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/help/help-topics.tsx:681)). Both become false for ×, Escape and Save outside Referee mode.

Concrete plan change: include `src/web/help/help-topics.tsx` and update its existing test to assert the yellow-default, explicit-close, implicit-exit and Copy rules.

**D5 — P2 — Referee’s exception is right, but the stated Quotes rationale is false.**

The plan says default colour would turn “every placement” into a Quotes row ([plan:57](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md:57)). Quotes deliberately excludes any comment with `criterionId` ([quote-band-rows.ts:59](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/quote-band-rows.ts:59), [quotes.md:627](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/docs/project/quotes.md:627)).

Concrete plan change: retain the exception, but say why accurately: Referee selection primarily records evidence against a criterion; silently adding an unrelated yellow reading highlight conflates two meanings. A coloured Referee comment without a placement could enter Quotes; one with a placement cannot.

**D6 — P2 — Three lifecycle tests are missing.**

Add:

- Untouched `pagehide → pageshow`: no replay, no close; a subsequent explicit close stores one yellow highlight. This proves the untouched `pagehide` did not set `fate = "left"` before checking its gate. Current replay is at [AnnotateDialog.tsx:432](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/AnnotateDialog.tsx:432).
- Type text, first Escape clears without saving, second Escape stores yellow. The current test stops after the clear ([annotate-dialog-keeps-a-draft.test.tsx:288](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/tests/annotate-dialog-keeps-a-draft.test.tsx:288)).
- Press Copy while its clipboard promise remains unresolved, then close immediately. This proves the Copy rule is attached at the press, not at resolution; the write currently settles asynchronously at [AnnotateDialog.tsx:693](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/AnnotateDialog.tsx:693).

Also add the already-selected Yellow press from D2.

Several listed tests can pass unchanged today and therefore need paired positive controls: untouched unmount/pagehide/another selection, Copy then ×, No colour then ×/unmount, Discard, Referee ×, Copy-type-×, and pink-then-yellow unmount. The proposed yellow-on-×/Escape/Save assertions provide much of that control, but each test should pose the interaction it claims rather than relying on another case.

## Direct answers

1. **Yes, the reading is faithful and sensible.** Explicit closes save what is visibly selected; implicit exits protect copying, corrected selections, navigation and StrictMode. “Every exit except Discard” is simpler as prose but would leave marks from mis-drags and development remounts. “Only Save” would make × and Escape discard a visible yellow choice, repeating the surprise 261003i removed.

2. **The keyed instance, immutable anchor, draft id and `fate` remain correct once D1 is made explicit.**

   - No wrong-passage path: Reader keys by `annotateKey` and stores the draft’s anchor, not current selection state ([Reader.tsx:3186](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/reader/Reader.tsx:3186), [Reader.tsx:3220](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/reader/Reader.tsx:3220)).
   - A touched `pagehide → pageshow` deliberately makes two POST attempts with the same id, not two rows. Postgres serialises the conflict and accepts only an identical retry ([pg-comments.ts:186](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/store/pg-comments.ts:186), [pg-comments.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/store/pg-comments.ts:261)).
   - StrictMode remains safe if the untouched gate is checked before mutating `fate`.
   - With CommentDialog or ChatDialog in front, `escapeEnabled=false` registers no listener ([useEscapeToClose.ts:57](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/useEscapeToClose.ts:57)); the underlying box neither closes nor saves.
   - The textarea’s first Escape stops propagation and clears its words ([AnnotateDialog.tsx:522](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/AnnotateDialog.tsx:522)); the second is the explicit close.
   - An untouched `pagehide` must leave `fate` open, so `pageshow` does nothing. D6 should pin that.

3. **Keep the Copy exception, expose it in the hint, and record intent at press time.**

4. **No default colour in Referee is right.** Correct its rationale as in D5. The default is chosen when the box mounts; changing mode while it remains open should preserve the draft rather than silently recolour it.

5. **Ask AI should store the yellow shown and the plan is right to ask Greg.** Quietly dropping it would make the persisted result disagree with the control. If Greg chooses no colour later, the UI should express that explicitly rather than secretly stripping it.

6. **No downstream code change is required, but the plan should record the effects:**

   - Drawer: all rows remain; wordless coloured rows say Highlight, written ones Comment, linked/answered ones Comment + AI.
   - Marginalia: wordless highlights stay omitted; coloured notes and AI comments remain.
   - Quotes: every coloured, non-Referee selection becomes an owner-only row and increments `+ N yours`, never the model quote count or threshold.
   - Public sharing: colour crosses the public projection, so visitors see the wash and drawer dot; visitors still do not get those rows in Quotes.
   - Export already includes colour.
   - Search overlap: the yellow fill wins on the exact words, while the search outline, stripes and paragraph bar remain ([annotations.css:81](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/styles/annotations.css:81)).
   - ✳: a wordless highlight has none; a body or AI involvement restores it through `commentKind`/`earnsMarker` ([comment-nav.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/src/web/comment-nav.ts:231)).

7. **Tests need D6; several listed refusal cases are baseline-passers and need positive controls.** The existing one-Escape pair tests are adequate for CommentDialog/ChatDialog being in front because an accidental underlying close would also call `onCancel` and appear in their `closed` array ([one-escape-closes-one-surface.test.tsx:287](/home/greg/code/spideryarn2/.claude/worktrees/fbur8kum-highlight-yellow-and-saved/tests/one-escape-closes-one-surface.test.tsx:287)).

8. **There is no materially simpler version that satisfies both halves of Greg’s sentence.** Preselecting yellow alone gives a one-click Save but does not make closing default to saving. The smallest faithful mechanism is the two-gate design above. Dropping the Copy exception would remove one boolean, but would regress the specific copy-only case that caused the button to exist.