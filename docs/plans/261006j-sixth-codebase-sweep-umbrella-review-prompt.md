# Review prompt: the sixth codebase sweep's umbrella plan

You are reviewing a plan before anything is built. **Read-only: change no file.**

## What to read

- The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` (committed on this branch).
- The process it claims to follow: `docs/reusable/improve-the-codebase.md`.
- The raw nominations it was written from:
  `docs/investigations/261006j-sixth-sweep-breadth-nominations.md` (unverified nominator output).
- The previous sweep, for what was already rejected:
  `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § Considered and rejected, § Held.

## What I want from you

The plan proposes six clusters (S1–S6) to be built by separate agents, two at a time, and says each
has "no real trade-off". For each cluster:

1. **Re-run its evidence against this tree.** Every "unused", "dead", "never emitted", "nothing
   constructs it" is an absence; grep `src/`, `scripts/`, `tools/`, `evals/`, `tests/`,
   `package.json`, `.claude/`, `infra/`, config files, and say what you found. Pay most attention
   to S1 (deletions): the witness instrument and the files that still name it, whether anything
   reaches `scripts/backfill-raw-manifests.ts`, and whether `ReaderPlan`'s `{ kind: "off" }` arm in
   `src/billing-plan.ts` can be constructed on any request path (billing switched off included).
2. **Say whether the fix is right**, separately from whether the finding is true. In particular,
   answer directly: **does S5's extraction of the five `revision_blocks` row → `Block` mappers earn
   its keep**, or is it indirection? Diff the five copies and say what each does that the others do
   not, including on a malformed or partial row.
3. **Say whether anything in the cluster has a trade-off** that makes it the product owner's call
   rather than "plainly right": a change a reader would see, a schema, a prompt, a defence, the
   wording of a rule doc, added machinery. S3 promotes lint rules to errors and S4 changes a test
   helper's type across ~179 call sites; say if either is more than it looks.
4. **Check the file sets are disjoint** within each wave (S1+S2, S3+S4, S5+S6), naming any file two
   clusters in a wave would both edit.
5. **Say what is missing**: a finding in the nominations doc that deserved a cluster and did not
   get one, or a live defect you see on the way. The plan says no Tier 0 was found; challenge that.
6. Is anything in "For Greg" actually plainly right and buildable now, or anything in a cluster
   actually Greg's?

## Format

A verdict line first: **ready**, **ready with these fixes**, or **not ready**. Then findings, each
with an id (U1, U2, …), a severity from P0 (would cause harm if built as written) to P3 (nit), the
cluster, `file:line` evidence, whether you reproduced it or reasoned to it, and the change to the
plan you want. Keep it under 1,200 words. My own suspicions, last so they do not anchor you: the
witness instrument may have a live dependent; the `off` arm may be reachable; the `pgReady` overload
may not type-check as simply as described.
