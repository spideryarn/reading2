# Review: Questions mode Stage 2, as it actually landed

You are reviewing built code, not a plan. Be adversarial. A finding you reproduced outranks one you
reasoned to.

## What to review

In the worktree `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`:

- **`git show 3ac70cc2`** — Stage 2: the panel, the answering, the six registrations.
- **`git show 9efbdecf`** — the merge with a concurrent session's ninth mode. Review **only the
  conflict resolution** in `tools/fleet/web/src/Dock.tsx` and `tools/fleet/web/src/mode.ts`;
  everything else in that commit is the other session's work and is not in scope.

Durable revisions, not a working tree — the tree may move under you.

**An earlier review of an earlier state is at**
`docs/plans/260909e-questions-mode-stage2-review-sol.md`. Its P1 was fixed before `3ac70cc2`. Do not
re-report it as open without checking; do check whether the fix is complete.

## The binding context

- The plan: `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`.
  Read § Half one of design-a-screen.md § 3 (*What the screen must never do* — six rules, each from a
  real incident), § The item arms, § The prose card, § What the empty list has to prove, and
  § Stage 2 including its five decisions and the two defects recorded there.
- Stage 1, already on `dev` and **not in scope except where Stage 2 misuses it**:
  `tools/fleet/questions.ts`, the QUESTIONS VIEW block in `tools/fleet/wire.ts`, and
  `parseQuestions` / `resolveQuestionReferences` / `questionsAtTime` in
  `tools/fleet/web/src/types.ts`.
- `docs/project/fleet-dashboard-modes.md` § Absence is stated, never drawn.

## What this tab is for, in one paragraph

Greg asked for a tab showing everything that needs his input, answerable in place. A **dialog** item
is a live `AskUserQuestion` menu read off a pane — mechanical, and answerable with a button that
sends `row.rawQuestion` verbatim to `POST /api/steer/answer`. A **prose** item is inferred from a
pane tail by the Overseer's ranked inbox — it gets no write control at all in v1, because the pane
handles that identify it survive one Claude process exiting and another starting, so the address
cannot be proved to belong to the execution that wrote the excerpt. The panel must never say
*nothing needs you* when it means *nothing was observed*.

## Severity scale, and give every finding an ID

- **P0** — a wrong answer reaches Greg, or a keystroke reaches the wrong agent.
- **P1** — the panel makes a claim it has not established, or a control does something other than
  what it says.
- **P2** — a real defect that misleads nobody.
- **P3** — style, naming, comment accuracy.

For each: `ID | severity | file:line | the claim | how it fails | what you would do`. Say plainly
whether each is **reproduced** or **reasoned**.

## What you may run

The sandbox has **no network, not even loopback**. These need nothing outside the tree and are yours
to run:

```
npx vitest run tests/fleet-questions-panel.test.tsx
npx vitest run tests/fleet-questions.test.ts tests/fleet-questions-client.test.ts
```

Do **not** run `npm test` or `npm run typecheck` — the sandbox stops them, and a red inside your
sandbox is more likely to be the sandbox than the code. Both were run outside it: **seven suites,
509 tests green, and `node --import tsx scripts/typecheck.ts` at `EXIT=0` over all four projects**,
on the merged tree at `9efbdecf`.

## The questions I most want answered

1. **Can any path put an enabled option button on a card whose row cannot be answered?** The action
   boundary is `canAnswer` in `QuestionsPanel.tsx`. The earlier review found one such path; I want to
   know whether the class is closed, not just that instance.
2. **Can the panel say *Nothing needs you.* when it has not established that?** Trace every way
   `view.kind === "complete"` with `items: []` can reach the renderer, including after
   `questionsAtTime` re-runs on the ticking clock.
3. **Does anything on a prose card write, now or by an easy later edit?** The card is a
   `role="button"` div. v1's whole prose decision rests on nothing there sending.
4. **Is the receipt ever compared against a row other than the one that was tapped?** `sentTarget` is
   snapshotted before the await; check that it cannot be defeated by a re-render or by the card's
   React key changing mid-flight.
5. **Does the merge resolution drop either side's intent?** Both sessions edited the dock. I kept
   their overflow-fade classes and my `--dock-mode-count` property.

## My own suspicions, which may be wrong — treat them as leads, not findings

- **The answering notice may be noise when there are no dialog cards.** It explains why cards have no
  buttons; with only prose items, or an empty list, it explains nothing. During a declared hold it
  would be permanently on screen. I suppressed it when there is no view at all, but not when there
  are no dialogs. Is the narrower suppression right, or is the banner still earning its place because
  it also tells the reader that answering in Sessions would fail?
- **`repeatUnsafe` may be too broad or too narrow.** After a *successful* send the card's buttons go
  dead until its key changes. If the answer did not actually take, the reader cannot retry from here.
  Is that the right trade against the half-sent-text hazard `SteerReceipt` exists for?
- **`waitAge` treats a future `waitingSince` as unreadable.** Clock skew between the box and the
  browser is measured elsewhere on this page (`clockSkew`) and is not applied here. Could an
  ordinary skew make a fresh item read as *waiting, since when is unreadable*?
- **Dialogs-first ordering is inherited from `composeQuestions`, not enforced here.** The plan
  requires dialogs before prose and forbids re-sorting. Is anything holding that, or is it an
  accident of the composer's statement order that a later edit could silently reverse?
- **Gap sentences are rendered with an index key and may duplicate.** `downgradeQuestions` dedupes
  structurally, but the server and the client can each produce a gap for the same underlying failure
  with different fields. Can the reader see the same failure twice?
- **`executionKey` returns the constant `"unverified"` for every row without a verified token.** That
  is a deliberate decision (plan § Stage 2, decision 5). Does it have a consequence I have not seen —
  in particular, can two different items collide on one React key?

Check each of these yourself rather than agreeing with me. If one is wrong, say so — that is as
useful as a finding.
