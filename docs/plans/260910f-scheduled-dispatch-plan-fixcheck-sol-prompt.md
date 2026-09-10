# Narrow check: Scheduled dispatch plan — do the P1 dispositions close F1–F8?

You are GPT Sol. This is a **narrow, read-only check**, not a fresh review. Spend no more than
twenty minutes.

Your round-1 review refused the plan
`docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md` with
F1–F8 (P1) and F9 (P2). The full record is in
`docs/plans/260910f-scheduled-dispatch-plan-review-sol-findings.md`.

The plan now has a section, **"Review dispositions — Sol, plan round 1"**, which overrides D1–D8
where they differ. Some dispositions depend on protocol changes that the `launch-protocol` session
has agreed to make but not yet committed: `launchingAt` on `AttemptRef`, `origin`/`plannedAt` on
`CarriedEntry`, `endedAt` on the terminal arms, `prompt.md` bound in `intent.json`, and SIGHUP
finalisation in `runChild`. Take them as promised, and judge whether the plan uses them correctly.

For each of F1–F8, answer **closed**, **closed if the promised protocol change lands as
described**, or **not closed**. For anything not closed, give the evidence (file:line) and the
smallest remaining fix. Say whether any disposition introduces a **new** P1. Do not re-review D1–D8
beyond what a disposition touches.

**The finding I least want to be wrong about:** F1. Check that `resume` with the existing origin
really continues a `waiting-admission` occurrence through the protocol's `plan()` / `drive()`,
using `git show worktree-launch-protocol:tools/overseer/launch-protocol.ts`. Also check that
superseding on a moved hash cannot leave two occurrences of one job both able to launch.

The sandbox is read-only. **Put your whole answer in your closing message**, starting with a table
of F1–F8 and their status, and ending with a verdict: *proceed* or *not yet*.
