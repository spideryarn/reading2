# A refusal with no voice

Report `spya-f3b6ab` (Greg, admin, 2026-10-01T18:41:50Z, production build `43be719`):

> I tried editing a previous message in Recall mode, hoping that it would then trigger a response to
> that modified message, but it didn't.

**The reported bug did not reproduce**, on current `dev` or against the code in the build he was
on. What this file records is the one weakness the hunt turned up, which is a **candidate** for what
he saw and nothing more. That weakness is now fixed. It reached a reader only if it is the cause,
and that reader was Greg.

## What was tried

- **On the client, end to end in jsdom**, using the real Remember band, `useChat` and `ChatPanel`:
  press the pencil, rewrite the question, press the tick. The edit request goes out with the right
  body (`{threadId, edit, question, at, expectedTailId}`) and the new answer streams in under the
  rewrite. It also works on a question asked earlier in the same tab, under the ids the server gave
  it. `tests/remember-edit-asks-again.test.tsx`.
- **On the server, against Postgres**, with the same body sent to a stored Remember thread. The
  result is a 200 and a `begin` frame, the question rewritten with `editedAt` set, a fresh pending
  answer. `tests/remember-route.test.ts` § *an edit
  in a Remember conversation is answered*.
- **In a real browser**, with Playwright against a local dev server. The run covered Recall after
  Start over and after a reload, the first message and the last, and both the tick and Enter. Every
  edit came back 200 with `begin`/`delta`/`done` and a finished answer, and plain chat behaved the
  same way.
- **The build itself.** Nothing that touches the edit path changed between `43be719` and `dev`
  except chat's visible-blocks list (261001q), which Remember deliberately does not send. The prime
  suspect, [261001m](../plans/261001m-remember-is-its-own-single-thread.md), is in the build and in
  every run above.

## The production evidence, and why it settles nothing

All of it was read inside `BEGIN READ ONLY`:

- **Thread `spya-jxcxj7` no longer exists.** The article's only Remember thread is `spya-uv286k`,
  created at 18:44:41Z, three minutes after the report. That is consistent with a Start over, which
  deletes the old conversation and its messages. The rows the failed edit would have left behind
  went with it.
- **The report carries no diagnostics and no screenshot** (`consented: false`).
- **Vercel's runtime logs for that window were refused** with `ExceedsBillingLimitError`, so the
  window is past what the plan keeps.
- **Sentry has nothing on the chat route** between 18:20 and 18:50.

## The candidate

An editor that is already open when an answer starts arriving cannot ask again until the answer
finishes, because the edit would discard the row being written into. That rule is right. The way it
refused was not: **Enter in the editor did nothing at all**, and the tick only greyed out, with its
reason in a hover `title` that a keyboard user never sees. A reader who pressed Enter saw the
editor sit there, with no answer and no sentence saying why.

It is only a candidate because it needs a specific order of events. The pencil is hidden while an
answer is arriving, so the editor has to be opened first and an answer started afterwards, from the
composer or by a recovery or a refetch that brings back a `pending` row. Remember answers are long,
and a Vercel stream that stalls leaves its row `pending`, so the window is real. Nothing shows Greg
was in it.

## The class: a refusal with no voice

**A control that declines an action without saying so.** The guard is correct, and the press still
looks exactly like a bug: the reader cannot tell "not now" from "broken", so they report broken.

It has relatives in this tree. The composer's Send was fixed for the same shape: its comment reads
"a button the guard would refuse must not look pressable, or the reader presses Send while talking
and nothing at all happens", and it uses `aria-disabled` so the press still lands.
[260915b](260915b-live-conversation-stalls-silently.md) is the same shape applied to a whole state
rather than one press. Review briefs here already ask about "a press that does nothing visible",
which is this class under a description rather than a name.

## Which commit introduced it

`51d3c31ad` (2026-08-26, *Refuse a stale turn before it costs somebody else their answer*), found
with `git log -S'if (canAsk) onDone(value)'`. That commit added `canAsk` to stop an open editor from
discarding a streaming row, following a GPT-5.6 review. It got the rule right and gave the refusal
no words. Remember did not create the weakness; its long answers make the window wider.

## The fix

In `EditQuestion` (`src/web/ChatPanel.tsx`), a refused press, whether Enter or the tick, now shows
*"An answer is still arriving. Ask again once it has finished — your rewrite is kept."* beside the
editor, as `role="status"`. The editor stays open with its text, and the sentence clears itself once
asking is possible again. The tick uses `aria-disabled` rather than `disabled`, so its press still
arrives and can be answered. `.chat-icon[aria-disabled="true"]` keeps the dimmed look
(`src/web/styles/mode-band.css`). The tests are in `tests/remember-edit-asks-again.test.tsx` § *an
editor that cannot ask again yet says why*, and two of them were red before the fix.

A better long-term fix would be to queue the edit and send it when the answer finishes. That is
worth doing only if readers keep hitting this, and it adds a pending-intent state to the
controller. Not done.

## What would settle it

- If Greg can make it happen again: the URL, whether he pressed **Enter or the tick**, and whether
  an answer was **still arriving** (a spinner or text still growing) when he did. With diagnostics
  consented, the report carries the network trail that is missing here.
- A sentence on screen. If the fix's sentence appears, that was the cause. If he still sees nothing
  at all, the cause is somewhere else and this file is about a neighbour.

## What would catch the class, ranked by ease against value

1. **Every guard on a press answers the press.** That means a sentence, or `aria-disabled` with a
   reason the reader can reach, and never a silent `if (ok) do()`. A rule like this belongs in
   [copy.md](../project/copy.md), which owns what a reader is told. Not written there yet; proposed
   here.
2. **A test per refusal that presses anyway**, as the new ones do: put the control in its refused
   state, press it, and assert that something visible changed. Cheap, and it fails on exactly this.
3. A lint for `disabled={…}` on buttons. Rejected: most disabled buttons are fine, and the bad
   handlers here were the `onKeyDown` guards, which no lint rule could tell apart from a good one.

## The thing I would tell myself

I spent most of this proving that something works, which is the right first move when a report will
not reproduce. But the only thing I could change was the one place where the code declines the
reader without a word. When a report says "it didn't" and nothing is broken, look for the refusal
that kept quiet.
