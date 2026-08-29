NO-SHIP

1. **High — verified: the new deploy regression test does not prove the `data/` bug is fixed.** Its fake `has()` only matches exact strings; nested reader files do not imply that `"data"` and `"output"` exist. Against the old fixture list, the first test’s actual and derived expected results are both `["data","output"]`, so it passes. A fixture list containing bare `"data"` plus the two output files passes all relevant assertions. The final “every fixture” test is also tautological, and removing a named data sentinel from `GATE_FIXTURES` stays green.

   What breaks: the gate can regress to the exact silent-success condition finding 4 identified.

   Smallest correction: include `"data"` and `"output"` in `readerStateOnly`, and assert the twelve missing paths literally rather than deriving them from `GATE_FIXTURES`. Watch that test fail with bare `"data"` restored.

2. **Low — verified: the stale-reference problem is broader than three comments.** The scoped result also leaves live references in `docs/project/ingest-queue.md`, `docs/project/testing.md`, `docs/project/summaries.md`, `src/web/SummaryPanel.tsx`, and comments inside `src/summarise.ts`. Some now describe `isDone` control flow that no longer exists.

   What breaks: documentation and maintenance guidance, not runtime behaviour.

   Smallest correction: update the live docs/comments in the planned follow-up; historical plan references can remain.

The functional stamp conversion itself checks out:

- `stampOf` maps `sourceHash/version/generator` exactly to `inputHash/promptVersion/model`, and `sameStamp` compares all three.
- `stepIsDone` checks `store.has` first, covering absent or malformed output. Missing blocks make `inputHashFor` return `null`. Empty blocks retain the old empty-array hash behaviour.
- One deliberate difference is that non-`ENOENT` filesystem failures now propagate instead of being swallowed as “not current”; that is safer and cannot serve stale output silently.
- Both generators read `ctx.dir/blocks.json` and hash the parsed blocks they used. In production, `contextPaths` and `fsArtifacts` both resolve through `fsLocations`, while `toc/blocks` maps to that same `data/<slug>/blocks.json`. The comparison is therefore over the same parsed block document.
- The four claimed red stamp tests are credible: the two current-artifact cases and two decoy-directory cases fail with the old `isDone` implementations. Most negative cases pass under a full revert because the decoy directory itself returns false, but they remain useful mutation tests for individual stamp fields.
- The new fourteen-file `GATE_FIXTURES` list is correct for the stated fixture set, all fourteen files exist, and reader-state files are excluded. Its implementation discharges finding 4; its test evidence does not yet.
- The deferred input hole is understated: **tweets also reads and uses `meta.json`**, not only summary. Both stages also read the tree. This remains a pre-existing hole, not a D0 regression, but the later canonical fingerprint must cover blocks, tree, relevant metadata, and the explicit profile policy.
- `FORCE_ONLY_WHEN_NAMED`, `cascadeForce`, and forced-current behaviour are unchanged. I found no route that makes either step always skip or never skip.

Trace: I read the complete scoped bundle, the D plan’s D0/review sections, the earlier seven-finding review, `silent-success.md`, and the relevant baseline pipeline, generators, hash, filesystem/Postgres store, runner, deploy, fixture, and force-cascade code. I ran the three scoped test files: 136 tests passed. I also checked patch whitespace and directly demonstrated that the first deploy regression test passes against the old bare-directory list. I did not edit or revert code, run the full database-writing suite, or independently execute the claimed red-state revision.