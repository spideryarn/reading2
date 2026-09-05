# Review prompt — the gutter "?" plan

You are reviewing a plan BEFORE it is built, for a TypeScript/React reading app called Spideryarn.
Repo root for this review: `/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button`

Read the plan: `docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md`

Then read, at minimum, the code and docs it cites:

```
src/web/BlockGutter.tsx           the gutter component; its header comment is the design rationale
src/web/styles.css                § the gutter, ~9355-9575; and td.text ~1010-1035
src/web/App.tsx                   chatAboutBlock ~2411; the AnnotateDialog -> chat handoff ~2795-2880
src/web/ChatDialog.tsx            the draft target, ask(), and the header Cancel control ~229-253
src/web/useChat.ts                the controller, detach, and the recovery scan
src/web/chat/effects.ts           runTurn / drainTurn
src/routes.ts                     streamChat ~2140-2650; the disconnect comment ~2130
src/converse.ts                   buildConverseMessages ~1016-1150; anchorSection; webSearchTool ~244
src/web/chat-handoff.ts           askAboutBlock
docs/plans/prose-gutter-icons.md  the previous gutter work, its measurements, its open questions
docs/project/comments.md          what a comment is; the model-decides-web-search decision
docs/project/prompt-caching.md    why SYSTEM must stay byte-identical
```

You may run tests. Relevant ones:

```
npx vitest run tests/spine-width.test.ts
npx vitest run tests/chat-unmounted-turn.test.ts
npx vitest run tests/messages.test.ts
```

A finding you reproduced outranks one you reasoned to. Please actually run at least one.

## What the feature is

Beside every paragraph is a narrow gutter with three icons. The owner (Greg) asked for:

1. more vertical space between them, because they are hard to tap on an iPad;
2. a new "?" button that, in **one click**, sends a canned "I don't understand this" question to the
   LLM about that block, streaming, and which he can walk away from while it generates.

Greg made three explicit calls, recorded in the plan's table. Two of them went **against** the
product advice he was given, which is his right; do not re-litigate them, but **do** tell me if
either is technically unworkable as specified, or if the plan has mis-implemented what he chose.

## What I want from you

Be adversarial and specific.

1. **The 2 × 2 gutter arithmetic** (§ The arithmetic that forces the layout). Four 24px targets do
   not fit a vertical column beside a 39px row, so the plan turns the gutter into a 2 × 2 pad and
   widens `--text-pad-l` from 2.1rem to 3.7rem. Check this arithmetic against the actual stylesheet.
   Is the 2 × 2 the right answer, or is there a better one I have missed? What breaks when
   `--text-pad-l` changes — I know about `tests/spine-width.test.ts` and the 731px media query, but
   look for JS that assumes the gutter width: geometry in `TableView.tsx` / `position.ts` /
   `layout.ts`, the search-hit bar, `fitView`, anything measuring the prose cell. The previous gutter
   work claimed *"Nothing in JavaScript had to move"* for a **narrowing**; this is a **widening** and
   that claim may not survive the reversal.

2. **The row-height floor.** Today `td.text.has-marks` floors only commented rows at three slots. The
   plan says the floor must now apply to every row because four slots are always occupied. Is that
   right? Does `height` on a `<td>` still behave as a minimum here? What happens to `kind-heading`'s
   bottom-anchoring rule, and to the commented-heading case that the previous work found only after
   a review flagged it?

3. **The silent-failure trap** (§ The one thing that can fail silently). I claim that on the first
   answer of a new thread the panel's header control is **Cancel** (`cancelAndDiscard` + `onDropped`),
   not Close — so a reader who taps X to go back to reading **destroys** the answer the "?" just
   bought. Verify against `ChatDialog.tsx` and `routes.ts`. Is my reading right? Is the fix ("a `kind`
   check in one component") actually sufficient, or does close-and-keep-running have consequences
   elsewhere — an orphaned pending row, the sweep, the recovery scan, an empty thread in the list?

4. **"Keep scrolling while it generates."** I claim this is nearly free because the server does not
   abort on disconnect and the client recovers a pending row. Check that hard. What actually happens
   on: closing the panel mid-stream; navigating to another article; a background tab; a phone
   locking; the reader pressing "?" on a second block while the first is still streaming? Is there a
   concurrency limit, and should there be?

5. **The `help` ThreadKind.** What is the blast radius of adding a value? Find every exhaustive
   switch, every `Record<ThreadKind, …>`, every server-side validator, every DB constraint or stored
   value, and the summary endpoint. Will `noUncheckedIndexedAccess` and the exhaustiveness checks
   catch the misses, or are there string comparisons that will silently accept it and behave as chat?

6. **The prompt addendum.** It goes in `anchorSection`, below the cache breakpoint, never in
   `SYSTEM`. Confirm that is the right seam and that it cannot invalidate the cache. The plan claims
   tool definitions must not change at all — check whether adding a thread kind touches the tool
   array in any way (note `webSearchTool(kind)` branches on kind).

7. **The one-click spend.** Greg accepted that an accidental tap costs a model call. The mitigation
   is that a second press on a block with an existing help thread **opens** it. Is that enough? What
   about a press on a block whose help thread is still streaming? Two presses in the same 200ms? Is
   there an existing double-submit guard to reuse rather than invent?

8. **Anything the plan does not mention that it should**, and anything in it that is simply wrong.
   Also: is the staging sensible — can stage 1 ship on its own without looking broken, and is stage 3
   too big?

Rank findings by severity, and say plainly which would make you refuse to let this be built as
written. Where you disagree with a decision Greg made, say so once and move on.
