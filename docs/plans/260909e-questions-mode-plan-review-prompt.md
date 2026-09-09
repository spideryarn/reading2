# Review this plan before it is built: a "Questions" mode for a fleet dashboard

You are GPT Sol, doing a **cross-family plan review**. The plan is written and nothing has been
built. Your job is to find what is wrong with it *now*, while changing it is cheap.

Please be adversarial and specific. Rank findings **P0 / P1 / P2**, and for each, say what you would
do instead. If you think the whole shape is wrong, say so — that is the most valuable finding a
plan-stage review can produce. **Also state explicitly whether you think the plan is fit to build**,
because a review that returned nothing looks exactly like one that found nothing.

## What to read, in this order

Repository root: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

1. **The plan itself**:
   `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`
2. `docs/project/fleet-dashboard-modes.md` — the checklist for adding a tab to this dashboard, and
   in particular § "Absence is stated, never drawn" and § "Where the panel's data comes from".
3. `tools/fleet/wire.ts` — the shared cross-boundary types. Lines ~690-1030 are the attention inbox
   and its envelope; ~925-960 is `Delivery`; ~2840-3040 is the queue.
4. `tools/fleet/web/src/steer-client.ts` — especially its header, which states the rule that the
   client's identifying claims must come verbatim out of the row and never be refetched.
5. `tools/fleet/routes-steer.ts` — the answer route, its `sameQuestion`/`sameMaterial` checks, and
   the long comment around line 995 about why dialog answering is narrow rather than off.
6. `tools/fleet/web/src/AttentionPanel.tsx` lines 1-75 — the three agreements, the first of which
   this plan deliberately reverses.
7. `tools/fleet/web/src/MessageOverseerCard.tsx` — the template the new panel is modelled on.
8. `tools/fleet/state.ts` and `tools/fleet/attention.ts` — where the new composition would be wired.

## Context you need

This is an internal tool. One human (Greg) runs ~20 Claude Code agent sessions in tmux on a box; a
web dashboard shows them and can type into their panes. He reads it on a phone. His complaint:

> The main thing I really want from this web dashboard interface is to have a very easy way to see
> answers to questions like: Is anything needed from me? Is anything blocked? Where do things
> stand? And right now, it is very hard to see those things!

The dashboard is held to a higher standard than the rest of the repo, because it is the thing you
reach for when something else is broken.

## The specific things I would most like you to attack

1. **The join.** The plan composes each question from two readings of the same fact — a ~2-minute-old
   judged inbox and a ~73-second-old mechanical payload row — and says the inbox supplies "why it
   matters" while the row supplies "what may be clicked". Is that split right? What goes wrong when
   the two disagree in a way the plan has not listed? I have listed three consequences (item with no
   row; `dialog` evidence with no live question; row with a question and no inbox item) — **what is
   the fourth?**

2. **Reversing `AttentionPanel`'s agreement (a).** That agreement says no answer control on any card,
   because a `prose` item is inferred and a past producer bug quoted Greg's own last message back as
   an agent's question. Greg has now asked for answering in place. The plan's defence is that option
   buttons bind to the live row and never to the inbox, and that a `prose` item never gets an option
   button. **Is that defence sufficient, or is there still a path by which a control acts on text
   nobody wrote?** Note especially that the free-text box IS offered on prose cards.

3. **The decision not to build a rule detector.** The brief instructed one; the plan (on Fable's
   advice, checked against the producer) builds none and ships a canned reply chip instead. The
   argument is that `dialogText()` in `tools/overseer/attention-pass.ts` is
   `prompt + material + option labels`, so the agent's explanation is not in the evidence by
   construction, and any length threshold would measure the harness's widget. **Please verify that
   claim in the code yourself rather than accepting the plan's reading of it**, and say whether
   dropping the detector is right, or whether the brief's instruction should have been followed with
   the narrow `no-explanation-on-screen` arm the plan records as the fallback.

4. **The wire types.** `QuestionAsk`, `QuestionAnswerHere`, `QuestionItem`, `QuestionsView`. Are the
   arms named after what was *observed* rather than what it implies, per this repo's house rule? Is
   there a state the union cannot express, or one it can express that cannot happen? Is
   `inbox-unavailable` carrying `rowsOnly` right, or is it a half-answer that will read as a full
   one?

5. **Cost on the refresh path.** The plan claims the composition is free because it is pure over
   things `statePayload` already holds. Check that against `state.ts` and `attention.ts`. Is the new
   required field on the pushed payload a size problem at ~20 sessions?

6. **What is missing.** Name anything a reviewer would expect in a plan for this and cannot find —
   including any state the screen can be in that § 3 ("what the screen must never do") does not
   cover.

Finally: the plan claims to reuse rather than rebuild. **Is there anything in it that duplicates
machinery already in the tree?** That is the failure this repo pays for most often.
