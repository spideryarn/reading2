# Second review: the built code for "prose needs an empty input box"

**You reviewed the plan for this a few hours ago and its verdict was "do not build Stage B exactly
as written."** This is the code that came out of that. Weight this pass higher than the first: a
plan-stage review cannot find a route that parses one field and reads another, and this repo has
four features that were built, tested, routed, shipped and dead.

Your first answer is at
`docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box-review-sol.md`. **Check whether
each of your seven findings was actually addressed, or only appeared to be.** I have a specific
worry about finding 1: I now read occupancy off `raw` rather than `text`, and I would like you to
try to defeat that, not confirm it.

## What the tool is

`tools/fleet/` is a dashboard on a Linux box running ~30 concurrent Claude Code sessions in tmux
panes. It lets one person, from a phone over a private tailnet, answer a permission dialog one of
them is blocked on or type a free-text message into one. Delivery is `tmux send-keys` into the
pane's tty. A keystroke that arrives is indistinguishable, in that session's context, from the
owner sitting at that keyboard.

## The change

Scoped diff: `/tmp/claude-1000/-home-greg-code-spideryarn2/d52c2cb3-49b9-4460-b104-cff73856b0fb/scratchpad/ab-scoped.diff`
(also reproducible as `git diff origin/dev...HEAD` in this worktree). It is only my work; the merge
with everybody else's is excluded.

Read the files themselves, not only the diff — `tools/fleet/pane.ts` (`paneSurface`,
`boxLineIsOccupied`, `materialAbove`), `tools/fleet/steer.ts` (`sendMessage`, `answerQuestion`,
`shelledOut`, `SteerIo`, `RefusalCode`), `tools/fleet/routes-steer.ts` (`REFUSAL_STATUS`),
`tools/fleet/web/src/SessionParts.tsx` and `SessionDetail.tsx`, and the tests.

The revised plan, including a section on what your first review changed, is
`docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md`.

## Evidence, so you are reviewing what happened rather than what I claim

The defect was reproduced end to end before it was fixed, on a throwaway session created for it:

```
box before:   ❯ DRAFT-ALPHA
sendMessage(target, "OMEGA-SENT-BY-DASHBOARD", …)  →  { ok: true, verified: {…}, sent: [2 calls] }
box after:    ❯ DRAFT-ALPHAOMEGA-SENT-BY-DASHBOARD
```

and the agent then answered a user turn neither half of which anybody wrote.

Live classification across all 30 panes with the new code: 13 `empty-input`, 5 `occupied-input`,
12 `unrecognised`, 0 dialogs (none open at that moment). All 14 real captured dialog fixtures still
return `material.kind === "read"`; the only `unreadable` is the one built to be.

`npm run typecheck` is clean. The fleet suites pass. One unrelated red test in
`tests/fleet-web.test.tsx` belongs to another session and is a hard-coded timestamp.

## What I want from you

1. **Try to defeat `boxLineIsOccupied`.** It returns "occupied" when the ANSI-stripped `raw` line,
   minus the `❯`, does not `trim()` to empty. Find the pane state where a real draft still reads as
   empty. I know about a box holding only spaces and have a test admitting it; I want the ones I
   have not thought of. Consider what `stripAnsi` removes, what a wide character or a combining mark
   does, what happens when the terminal is narrow enough to wrap, and what `cleanLines` does to the
   line indices the scan uses.

2. **`shelledOut` is fail-open and I want that challenged, in both directions.** A `shell` status
   refuses; a missing file, unparseable JSON, an unknown status or a read that throws all proceed.
   My argument is that it is another application's undocumented private state, so refusing on its
   absence would stop every message on the box the day the format changes, and a guard that only
   ever ADDS a refusal cannot break anything. Is that argument right? And separately: does
   `status: "shell"` actually mean what I have assumed — that a program of Claude's is in front of
   the tty — or could it be set while Claude is still the reader, making this a source of confusing
   refusals? Say if you think this should not have been built at all.

3. **Check the joins, which is the thing this repo keeps getting wrong.** The new refusal code
   `input-not-empty` is minted in `steer.ts`, given a status in `routes-steer.ts`, carried over the
   wire, and special-cased in `SessionDetail.tsx`'s `Outcome`. Does the string match at every hop?
   Is there any path where the client renders the generic "Refresh and look again" for it anyway?
   Same question for the `Handoff` component and its `sessionName` prop.

4. **Did my `materialAbove` line-0 guard break anything real?** It refuses a dialog whose topmost
   rule is the first line of the capture. I checked the 14 captured dialogs and none regressed, but
   the corpus is a corpus. What live shape would this refuse that it should not?

5. **The `never` in `sendMessage`'s switch and the arm each entry point accepts.** You said last time
   the union gives exhaustive routing rather than an unforgeable capability, and I have changed the
   plan to say that rather than fixing it. Was that the right call for today, or is there a cheap
   version of the stronger property I have missed?

6. **Anything in the tests that passes for the wrong reason.** In particular
   `tests/fleet-pane-surface.test.ts`'s corpus table and its per-arm counts, and the drain-level
   put-back test you asked for — does that one actually prove `release` was called with retention at
   the head, or have I written a test that would survive the mutation you described?

7. **Anything I have made worse.** The `inputSurface` → `paneSurface` move touches the function that
   decides whether to type into somebody's terminal. If the move lost a check, or reordered two in a
   way that matters, that is the finding I most want.

Order findings by severity, naming the file and the failure sequence. **And check my conclusions,
not only my code** — where I have written "this is a known limit" or "this cannot be closed", say if
I am wrong. If you think the change is sound, say which part you attacked hardest and what would
have changed your mind; a review that returns "looks good" is indistinguishable from one that did
not run.
