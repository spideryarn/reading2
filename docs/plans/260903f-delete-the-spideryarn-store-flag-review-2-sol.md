## Verdict: ready with changes

The overall shape is now sound, but three concrete corrections should land in the plan before D′/E.

1. **Move F before E.** F is required before G, but doing it before the hinge proves all six CLIs against Postgres while the old path still exists. Also, the stated dependency is inaccurate: several CLIs write files directly rather than through `artifacts-fs`—for example [blocks.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/blocks.ts:1612) and [hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/hierarchy.ts:1771)—so G would not mechanically break them. Stage F needs a short contract covering slug/owner selection, draft/session handling, reruns, and what each command prints.

2. **D′ is safe except for `guardDbStore`, as currently described.** Double wrapping is not harmless. I probed it: one rejected call produced two error log entries, `inner.fail` and `outer.fail`. The wrapper at [db-errors.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/db-errors.ts:411) does not return an already guarded object unchanged. Make it idempotent first and test that one failure produces one diagnostic; then moving guards to adapter exports is safely additive. Split D′ into separate reviewed commits—guards, readiness, glossary—because they share no failure mode.

3. **The readiness half of E is still underspecified and risks making the hinge large.** There are 82 files actually calling `pgReady`; merely building a global preflight in D′ leaves E needing widespread suite edits to satisfy the required “no `reachable ? describe : describe.skip`” invariant. Before E, migrate callers behind one central suite-registration abstraction with unchanged optional behaviour. E can then activate mandatory preflight and remove the skip branch centrally.

Stage A is useful as a migration ledger, but its test cannot validate semantic classification. It can prove that every mechanically discovered candidate has an entry and reason; it cannot prove that “store-agnostic” was the correct verdict. That is exactly a guard that can agree with the bug if discovery and policing use the same predicate. Add two independent witnesses:

- generate the candidate universe independently from the manifest, preferably including transitive imports;
- dynamically run with filesystem selection/methods instrumented or throwing a sentinel, recording which suites actually touch them.

The assertion inventory and mutation evidence in B/G remain the real protection against wrong classification.

I would first produce the lightweight manifest, then build the smallest vertical slice of C: two parallel test scopes plus a crashed subprocess, proving committed ledger tests remain separate. C is the least mechanical assumption and can move before B. Before committing to all of F, spike `blocks` as the representative rerunnable Postgres CLI.

One thing not to do: do not force all 28 `.insert(articles)` sites through the new direct-row helper. Many are database integration tests deliberately constructing unusual revisions, ownership, transactions, or malformed rows. Consolidate only the repeated “one ordinary article row” setup. The corpus loader remains worthwhile because `db:seed-dev` needs it.

The hinge should also adopt a sharper invariant: after E, the tombstone is the only executable code allowed to read `SPIDERYARN_STORE`. The current 19-site inventory excludes live consumers such as [db-seed-dev.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-seed-dev.ts:390) and [ai-cost.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/ai-cost.ts:1091). Their obsolete behaviour must disappear in E, not wait for I.

Count check:

- 19 executable comparisons outside `store/index`: correct.
- 14 test files plus `load-article.ts` calling `createFsArtifactStore`: correct.
- 15 centrally guarded Postgres seams: correct.
- 28 `.insert(articles)` test files: correct.
- `fs.ts` at 576 lines: correct.
- **`pgReady`: 82 callers, not 83.** Eighty-three files mention the name; `store-seams-have-two-implementations.test.ts` contains only prose.

No files changed. I ran one read-only `node --import tsx` probe for the double-wrapping behaviour; no test suite was run.