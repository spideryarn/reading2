I found one established P1 and fixed it in the uncommitted proposal.

- **F4 — P1, established; fixed.** An earlier element with `id="anubis_version"` hid a later valid version script. Modified WineHQ input still contained both required scripts, yet all extraction paths published it. The second branch now checks every version-script candidate. Four regression tests were red before the fix and green afterward.
- **F5 — P2, established; fixed.** Document-relative resolution with an upload fallback passed all 73 original tests. The new `<base>` regression catches it: that mutation produces one failure.
- **F6 — P3, established; fixed.** The postmortem omitted the introducing commit. Added `677404435`.
- **F7 — P3, reasoned; corrected.** The retained evidence does not establish “the same afternoon.” Removed that unsupported detail.

The four statements, assessed against **61b440abd**:

| Statement | Assessment |
|---|---|
| **1** | **Not fully accurate:** F4 defeats “every such document.” Fixed for the second shape. The original first-ID lookup remains unchanged; its equivalent shadowing limitation is wider, inherited behavior. Provenance requires a string address; the proposal tests its addressless DOM using `about:blank`. |
| **2** | **Not fully accurate:** F5 survives. Dropping either half, using containment, disabling the first shape, and resolving directly against the document all made tests red. |
| **3** | **Accurate:** the HAL counterfactual preserves the 1,034-character checks on both paths and successful publication. No earlier assertion was weakened. |
| **4** | **Qualified:** the recorded counts, lengths, fixture hash and dates agree. The afternoon detail is unverified. Discarded response bodies prevent independently rechecking all reported versions and manual classifications. |

The score-file claim is accurate: **501 lines added, none removed; 13 WineHQ rows; every earlier row unchanged**, including byte-identical serialization after removing the new rows.

Validation: **79 tests passed** in the requested file; **272 passed** across the seven extraction suites; typechecking passed via `node --import tsx scripts/typecheck.ts`. Full `npm test` stopped before collection because Docker/database access was unavailable. No real-article collision was established.

Files changed, all uncommitted:

- [src/challenge-page.ts](/var/tmp/spideryarn-worktrees/bot-check-walls/src/challenge-page.ts)
- [tests/extract-challenge-page.test.ts](/var/tmp/spideryarn-worktrees/bot-check-walls/tests/extract-challenge-page.test.ts)
- [Original postmortem](/var/tmp/spideryarn-worktrees/bot-check-walls/docs/postmortems/261006j-a-recogniser-fitted-to-one-sample-of-a-versioned-page.md)
- [New lookup postmortem](/var/tmp/spideryarn-worktrees/bot-check-walls/docs/postmortems/261006k-a-first-id-match-hid-a-later-valid-script.md)
- [Investigation](/var/tmp/spideryarn-worktrees/bot-check-walls/docs/investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md)

Verdict for the candidate including the proposed fixes: *land it*.