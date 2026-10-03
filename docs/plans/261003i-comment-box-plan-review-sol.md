Verdict: **build with changes**. No P0s, but the lifecycle, opening-read, dictation, and Ask-AI semantics need tightening before implementation.

## Findings

**D1 — P1 — The proposed anchor-change/unmount design can save the wrong draft or close the new one.**

The dialog is currently **not keyed**; only `CopyQuote` is keyed. A new selection reuses the same component, so the anchor-change effect does run ([AnnotateDialog.tsx:196](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:196), [AnnotateDialog.tsx:261](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:261), [Reader.tsx:3016](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3016)).

A naïve implementation has two hazards:

- The effect runs after rendering the new anchor with the old body. Unless the previous anchor is retained independently, `flush()` can pair A’s body with B’s anchor.
- Flushing and then resetting `sending.current = false`, as the existing transition does at [AnnotateDialog.tsx:204](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:204), can let the unmount cleanup send A again. Same-id creates are server-idempotent, but two callbacks/POSTs still happened; if the snapshot changed between them, the second becomes a 409 rather than idempotent.
- Reader’s current unconditional `setAnnotating(null)` would close B when A’s cleanup lands ([Reader.tsx:3045](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3045)).

Concrete plan change: key the **whole** dialog on `blockId:start:quote`, remove the anchor-reset effect, and say that anchor changes are handled solely by the old keyed instance’s cleanup. Each instance owns one immutable anchor, draft id, and sent/discarded latch. Reader should close conditionally:

```ts
setAnnotating(current =>
  current && sameAnchor(current, savedAnchor) ? null : current
);
```

With that design, the anchor-change effect never handles a transition; old-instance unmount is the hook. Update the Copy test, whose fixture currently deliberately models an unkeyed dialog ([annotate-dialog-copy.test.tsx:44](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/annotate-dialog-copy.test.tsx:44)).

Calling a surviving parent from cleanup is legal in React 19. Calling an unconditional parent state setter is the dangerous part. A stable cleanup must read a current draft ref; an effect depending on draft fields would run cleanup on every edit.

---

**D2 — P1 — Unmount cleanup does not close the reload/tab-close loss path.**

The plan promises that reload and “unmounting for any reason” store the draft ([plan:24](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md:24), [plan:43](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md:43)). React cleanup is enough for an SPA component unmount, but browser teardown does not reliably run it, and an ordinary authenticated fetch need not survive page exit.

The repo already records the required pattern: ordinary save on `visibilitychange`, synchronous keepalive write on `pagehide`, and unmount separately ([useAutosavedText.ts:37](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useAutosavedText.ts:37), [useAutosavedText.ts:233](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useAutosavedText.ts:233), [api.ts:1131](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/lib/api.ts:1131)).

Concrete plan change: add `visibilitychange` and `pagehide`; the latter must issue the comment POST immediately with `leavingFetch` or an equivalent keepalive writer, using the same draft id. The latch must cover handlers, unmount, and pagehide. State explicitly that crashes and browser kills without events remain an unavoidable best-effort limit.

---

**D3 — P1 — `useComments.create` should hold pre-load creates; “flush regardless” reopens a fixed race.**

The opening GET replaces the whole list ([useComments.ts:321](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:321)); `create` currently adds its optimistic row immediately ([useComments.ts:562](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:562)). Sending regardless can therefore display B and then replace it with GET’s A.

The submit gate was an explicit product decision, including failure and timeout ordering ([postmortem:8](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md:8), [opening-read-gates-writes.test.tsx:14](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/opening-read-gates-writes.test.tsx:14)). Accepting the tab-side miss reverses it.

Concrete plan change: make `create` invoked before `loaded` wait behind the opening read’s settlement/invalidation before applying the optimistic row and POSTing. Keep the visible Save gate; removing it is unnecessary scope. Ensure an SPA unmount settles/releases that queued create, while `pagehide` uses D2’s keepalive path.

This is the smaller correct change. Merging snapshots with local writes is the larger alternative the postmortem rejected.

---

**D4 — P1 — “Last settled text” does not currently exist as an API, and the plan’s empty check drops placements.**

`useDictationField` exposes only `dictation`, `readOnly`, and `toggle`. Its current value includes live recogniser text; the private `span` is the only record of which characters belong to the active dictation ([useDictationField.ts:68](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useDictationField.ts:68), [useDictationField.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useDictationField.ts:117), [useDictationField.ts:138](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useDictationField.ts:138)). The authoritative transcript arrives before `onEnd` clears that span ([useDictation.ts:796](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useDictation.ts:796), [useDictationField.ts:223](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useDictationField.ts:223)).

Concrete plan change: extend `useDictationField` with a synchronous settled-value ref/API, defined as “the current value excluding the active dictation span; after the authoritative transcript lands and the session ends, the whole value is settled.” Test armed and transcribing states separately, with and without Chromium live text.

Also fix [plan:68–70](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md:68): “no settled text and no colour stores nothing” omits a Referee placement. It must also require `mark` to be empty. Prefer a structural check such as `mark.criterionId !== null`, not `mark !== NO_MARK`.

---

**D5 — P1 — The plan is ambiguous about whether Ask AI actually spends a model call.**

The plan says both “as the ticked box did” and “the only control that costs a model call” ([plan:38](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md:38)). Those are not the same current behavior.

Today `ask: true` saves and opens a prefilled chat composer. The model call happens only when that composer sends ([ChatDialog.tsx:528](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/ChatDialog.tsx:528), [ChatDialog.tsx:713](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/ChatDialog.tsx:713)). Only the gutter-help path auto-sends, with its own StrictMode latch ([ChatDialog.tsx:594](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/ChatDialog.tsx:594)).

Concrete plan change: choose explicitly:

- Smaller version: Ask AI saves and opens the composer, exactly as the checkbox-plus-Save does now. Remove the claim that the button itself costs a call.
- If it must ask in one press, specify the new auto-send choreography and an independent once-per-draft latch.

In either version:

- `Save` is the sole submit button.
- Plain Enter remains newline.
- ⌘/Ctrl+Enter performs free Save.
- Ask AI is `type="button"`.
- A synchronous latch covers Ask–Ask and Ask–Save double presses.
- Every automatic flush hard-codes `ask: false`.

Greg’s explicit request supersedes the old checkbox rationale; preserve the history in the header, then record why the decision changed.

---

**D6 — P2 — There is a genuine sixth loss path: the create fails after the box closes.**

Reader fires `comments.create` without retaining the draft ([Reader.tsx:3053](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3053)). On failure, `useComments.create` removes the optimistic row and returns `null` ([useComments.ts:613](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:613)). After an automatic close, the words then exist neither in the box nor in Postgres.

Concrete plan change: either retain a recoverable failed-create draft, or narrow the promise and title to “no exit silently discards a draft” and list write failure as an unchanged limit. Literal “never loses” requires the former.

## Direct answers

1. The five broad current loss paths are real. CommentDialog/ChatDialog opening in front is not a sixth: Annotate stays mounted and yields Escape, as tested at [one-escape-closes-one-surface.test.tsx:287](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/one-escape-closes-one-surface.test.tsx:287). Mode and Referee changes preserve the parent draft state. The touch-chip key remounts only the sibling chip; the Copy key remounts only `CopyQuote`. The actual sixth is failed persistence. The plan’s touch-specific “select again and press the chip” wording is doubtful because a suppressed chip unmounts its active listener ([TouchSelectionChip.tsx:116](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:116)).

2. Implementable in React 19, but not safely as currently described. Current dialog: anchor effect runs. Recommended keyed dialog: transition effect does not; unmount cleanup owns A. A naïve build can call save twice or use the wrong anchor. Reader must conditionally clear only the matching anchor.

3. `useComments.create` should hold the create until the opening read settles. Do not accept the race. Keep explicit Save gated for now.

4. No: “last settled text” is not currently exposed or fully defined. Add it to `useDictationField`; include placement in the dirty/empty rule.

5. The button is now Greg’s decision. Guard same-frame double presses, cross-button presses, Enter/⌘+Enter semantics, StrictMode auto-send if one-click asking is intended, and ensure flush always passes `false`.

6. “Saving on the way out gives the same guarantee with one call” is wrong for page teardown and failed writes. The simplest sound version is: key the whole dialog, one immutable draft per instance, one cleanup flush, central pre-load queuing, and a separate page-exit keepalive writer.