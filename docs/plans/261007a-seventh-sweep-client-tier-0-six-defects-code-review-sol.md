**Verdict: ship with these fixes applied.** Changes are uncommitted.

- **C1 — P1: identical Illustrated refusals still missed re-asks.** Two refused starts with identical wording produced two Sketch reads instead of three, leaving changed readiness undiscovered. **Reproduced and fixed** with a local refusal counter shared by all three start verbs. The Illustrated regression failed first, then passed.

- **C2 — P2: Metadata retries repeated error reporting.** Five identical failed opening reads made five reporting calls. **Reproduced and fixed:** consecutive identical failures reuse their description; success, another slug or a different failure starts fresh reporting. Metadata tests cover both deduplication and changed/authored failures. Actual Sentry deliveries were not measured.

- **C3 — P2: U7’s derived inventory guard was missing.** **Fixed:** the refresh test now derives slug-taking hooks inside `OwnedReader`, requiring coverage or a named exclusion. Removing Quiz’s row made it fail. Aliases and wrappers hiding the slug remain outside this syntax check.

- **C4 — P3: three Metadata comments overstated their claims.** Source inspection contradicted the blanket “unauthored” description and the claim that the page borrowed pipeline output-presence checks; local latency was unverified. **Corrected**, without changing reader-facing text. No runtime reproduction applies.

- **C5 — P1, wider: deleted crossrefs can return offline.** Sequence: saved links → successful `200 null` clears them → transport failure replays the older cached artefact. **Cache replay reproduced; redraw inferred from the hook. Not fixed:** this is shared API-cache policy, outside the stage.

- **C6 — P2, wider: an open band can double-refresh.** Quiz’s read and band each hear completion, producing two GETs when no read is outstanding. **Reproduced; not fixed:** this is the shared four-read pattern. An outstanding read coalesces both into one trailing GET.

Other checks found no additional stage defect: Crossrefs’ replacement listener is equivalent and its slug/order fences hold; quiz marking uses a separate SSE path. Both converted Metadata sentences are authored reader text. The tag refusal is reachable through a still-visible suggestion during a pending save, established by inspection rather than runtime reproduction. Debate’s held-selection path and visitor boundary passed; deleting each of the three typed keys produced `TS2741`.

Files changed:

- [Metadata.tsx](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/src/web/Metadata.tsx), [useIllustrated.ts](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/src/web/useIllustrated.ts)
- [refresh inventory test](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/tests/always-mounted-reads-refresh.test.tsx), [Illustrated regression](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/tests/illustrated-reasks-the-sketch-after-a-refusal.test.tsx), [Metadata regression](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/tests/metadata-failed-read-says-a-readers-sentence.test.tsx), [held-selection tests](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/tests/selecting-applies-the-highlight.test.tsx)
- [stage plan](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/docs/plans/261007a-seventh-sweep-client-tier-0-six-defects.md), [new root-cause note](/var/tmp/spideryarn-worktrees/sweep7-client-tier0/docs/postmortems/261007a-repeated-reader-failures-need-occurrence-identity.md)

What ran, raw counts:

- Final explicit `npx vitest run`: **12 files, 337 passed, 0 failed**—stage suites plus selection, doc links, deletion and request-shape checks.
- New behavioral regressions before fixes: **2 failed, 5 passed**; afterward with companion coverage: **8 passed**.
- Inventory mutation: **1 failed, 14 skipped**. Held-selection mutation: **1 failed, 1 passed, 50 skipped**.
- Offline replay probe: **1 passed, 69 skipped**.
- Web and test-project `tsc --noEmit`: **both exit 0**. Three key-deletion controls failed as intended.
- Scoped lint: **exit 0, one existing complexity advisory**. `git diff --check` passed.

No network, database, browser, `npm test` or commit. Wider fixes C5/C6 remain unchanged.