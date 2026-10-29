Review complete. I found no production-code defect requiring an in-scope change; I fixed the silent-success gaps and documented two deliberately accepted agreement caveats.

1. C1 — Medium — [route-profile-concurrency.test.ts:107](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/route-profile-concurrency.test.ts:107). The `panelRunKind` unit test did not prove the GET route returned its verdict. Removing `panelRun` from the Explanations route would leave it green. I added a complete Explanations artefact and route assertions for matching, cleared, changed, and legacy profiles.

2. C2 — Medium — [stage-stamp-agreement.test.ts:572](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/stage-stamp-agreement.test.ts:572). Generator tests covered append logic, but not the pipeline passing the stored baseline into it. Passing `previous: null` in `STEPS.explanations.run` would silently make every “Find more” rewrite. I added a registered-stage test proving a stored first pass becomes a zero-add second pass with the original row intact.

3. C3 — Medium — [explanations.test.ts:689](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations.test.ts:689). Append tests did not directly pin cache reuse or the per-pass cap. An append could invalidate the cached article segment or cap the accumulated list while existing tests passed. I now compare the first-pass and append cache segments byte-for-byte and test that a full append gets its own cap.

4. C4 — Medium — [explanations-panel.test.tsx:278](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-panel.test.tsx:278), [explanations-url-wiring.test.tsx:50](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-url-wiring.test.tsx:50). The client test claimed to cover the threshold setter but only pressed an order; its focus test collected the consumed focus without asserting it; parser tests did not prove `ExplanationsMode` used them. A broken slider, landing handoff, or disconnected `?explby=`/`?explbar=` hook would pass. I added all three interaction assertions, including URL history behavior.

5. C5 — Medium — [explanations-layout.test.ts:18](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-layout.test.ts:18). Nothing guarded the full-width list or top-row clearance. Reintroducing `--band-about-room` on `.tl-scroll`, or dropping clearance from an empty/error state, would pass. I added a CSS contract test covering the list, four status states, run row, and order row.

6. C6 — Low — [ExplanationsPanel.tsx:203](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:203). A profile changed in another tab after GET but before the press can make “Find more” rewrite. Not changed because F1 explicitly accepts this one-press race and carrying the expected list identity was deliberately rejected to match Glossary.

7. C7 — Low — [ExplanationsPanel.tsx:103](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:103). A legacy response without `panelRun` can conservatively say “Write a new list” where the list-owned action appends. Not changed because current responses always contain the exact verdict, while the old response lacks enough profile information to resolve every case correctly.

The five builder deviations are sound: profile-panel Regenerate follows Greg’s later request and Glossary; the empty rewrite recovery is coherent; zero-add append follows Quotes; pre-poll disabling prevents a premature paid action; score bars match the shared treatment.

Other checks:

- The first-pass fingerprint remains `37199c283b995cea`.
- An `/1` list remains readable but is intentionally outdated and rewritten, not appended to.
- Score validation drops only the bad field; token budgeting includes both scores.
- Kalam replacement is complete; remaining Shantell references are historical.
- Requested tests: 11 files passed, 780 passed, 19 skipped.
- Route/pipeline seam run: 5 files passed, 100 tests.
- Typecheck passed for all 4,080 covered source files. The literal `npm run typecheck` wrapper hit the sandbox’s Unix-socket restriction, so I ran the same checker through `node --import tsx scripts/typecheck.ts`.
- Touched-file lint passed.

Files edited:

- [tests/explanations.test.ts](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations.test.ts)
- [tests/explanations-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-panel.test.tsx)
- [tests/explanations-url-wiring.test.tsx](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-url-wiring.test.tsx)
- [tests/explanations-layout.test.ts](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/explanations-layout.test.ts)
- [tests/route-profile-concurrency.test.ts](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/route-profile-concurrency.test.ts)
- [tests/stage-stamp-agreement.test.ts](/var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/tests/stage-stamp-agreement.test.ts)