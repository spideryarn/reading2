# Review: making prose into an agent's terminal a narrower capability than answering its dialog

You are reviewing a **plan, before it is built**, for a tool that types keystrokes into other
people's live coding-agent terminal sessions. Be adversarial. The failure mode I most want you to
hunt is a guard that reads strong and does nothing.

## What the tool is

`tools/fleet/` is a dashboard on a Linux box running ~20 concurrent Claude Code sessions in tmux
panes. It renders their state and lets one person (Greg, from his phone, over a private tailnet)
either answer a permission dialog one of them is blocked on, or type a free-text steering message
into one. Delivery is `tmux send-keys` into the pane's tty. There is no authentication; reachability
is the access control. A keystroke that arrives is indistinguishable, in the target session's
context, from Greg sitting at that keyboard.

The whole module is written to refuse rather than degrade. Every entry point returns
`{ok:true,...} | {ok:false, reason}`.

## The plan

Read `docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md` in full. It is the
subject of this review. Short version: `sendMessage` today establishes that a pane will take a typed
message from (a) `parsePane` did not recognise a dialog, (b) there is a `❯` prompt character, (c) it
has a box border above it and another within four lines below. It never reads what is IN the box. I
measured every pane on this box read-only and found three live sessions with a half-typed draft
sitting in the input box, which `inputSurface` accepts — so our text is appended to theirs and our
Enter submits the concatenation.

The proposal: move `inputSurface` from `steer.ts` into `pane.ts` and widen it into a four-arm
`PaneSurface` union with an explicit `drafted-input` arm; make `sendMessage` require the
`empty-input` arm and `answerQuestion` require the `dialog` arm, both with a `never` default.

## The code as it stands

Read these, they are the ground truth and the plan may misdescribe them:

- `tools/fleet/steer.ts` — `inputSurface` (and its own comment, which already names this defect and
  declines to fix it), `sendMessage`, `answerQuestion`, `verifyTarget`, `sameQuestion`,
  `sameMaterial`, `RefusalCode`, `SteerResult`, `no()`.
- `tools/fleet/pane.ts` — `parsePane`, `materialAbove`, `PaneMaterial`, `PaneGate`, `classifyGate`,
  `cleanLines`, `isInputPrompt`, `DECORATION`, `DASHED_RULE`.
- `tools/fleet/routes-steer.ts` — `REFUSAL_STATUS`, `parseQuestion`, the dispatch.
- `tools/fleet/drain.ts` and `tools/fleet/queue.ts` — read only; the plan claims the new refusal
  lands on the existing put-back path without changing either. **Check that claim.**
- `tests/fleet-steer.test.ts`, `tests/fleet-pane.test.ts`, `tests/fixtures/fleet-panes/*` (23
  captures).
- Background on the tool's direction: `docs/project/orchestrator-direction.md` § "The backlog,
  after the wide review" (rows A9, A10, A11) and `docs/plans/260907e-agent-fleet-dashboard.md`
  §§ "Stage v0.2b", "Stage v0.2e".

## What I want from you

1. **Is the emptiness test sound, or is it a string-matching problem wearing a structural
   disguise?** It reads: the prompt line trims to nothing after the `❯`, and every line between it
   and the closing border trims to nothing. Tell me the pane state that defeats it in the dangerous
   direction — a box that reads empty and is not. Note that `cleanLines` blanks a set of decoration
   characters, and an empty box's prompt line is `❯` followed by U+00A0.

2. **Does the narrowing actually narrow anything, or is it a check bolted on?** The plan's claim is
   that after this, prose requires strictly more evidence about the screen than answering does, and
   that this is enforced by which arm of a union each entry point accepts rather than by discipline.
   Is that true of the design as written? Where could a caller reach the send without the arm?

3. **The move of `inputSurface` from `steer.ts` to `pane.ts`.** `pane.ts` is documented as
   READ-ONLY BY CONSTRUCTION — "nothing here sends a keystroke; it works out what *would* be sent".
   Does putting the function that decides whether a pane may be typed at into that file weaken that
   property, or is it the right home because it is a screen reader? Argue the other side if you
   think I got it wrong.

4. **What I have decided NOT to build**, in the plan's own section. Two items: a `clipped` signal
   for a dialog whose top border is on line 0 of the capture, and any check on which process is in
   the tty's foreground. For the second I measured that Claude, the pane's bash and any child all
   share one process group (`pgrp` = `sid` = `tpgid` = `pane_pid` on three sampled panes), so no
   kernel signal distinguishes them. **Check that reasoning and check the conclusion.** If either
   omission is wrong, say so plainly — I would rather be told now than build a plausible-looking
   guard.

5. **The refusal's HTTP status.** The plan says 409 rather than 400 for `input-not-empty`, on the
   grounds that the request was well-formed and the box is not what the client thought. `drain.ts`
   and any client retry loop read these. Is 409 right here?

6. **Anything the plan does not mention that a person could do with this feature that they should
   not be able to do.** The stage boundaries are: I own `pane.ts`, `steer.ts` for today, and the
   approval-rendering components; I do not own `queue.ts`, `drain.ts` or the delivery-receipt work.

Answer with findings ordered by severity, each naming the file and the specific failure sequence.
If you think the plan is right, say which part you checked hardest and what would have changed your
mind — a review that returns "looks good" is indistinguishable from one that did not run.
