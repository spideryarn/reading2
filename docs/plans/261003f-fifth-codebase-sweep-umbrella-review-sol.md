The findings are strong, but the umbrella is not yet a reliable dispatch brief. It drops accepted work, contradicts several reviewer corrections, and understates file overlaps. I reviewed it read-only against today’s tree, `9561a1526`; no files were modified.

**Counts and fidelity**

Re-adding the investigations’ tier assignments gives:

| Investigation | T0 | T1 | T2 | T3 | Product |
|---|---:|---:|---:|---:|---:|
| SR | 1 | 10 | 2 | 1 | 2 |
| WC | 3 | 7 | 5 | 0 | 2 |
| DP | 2 | 2 | 2 | 0 | 2 |
| DF | 3 | 6 | 1 | 0 | 1 |
| KN | 0 | 27 | 2 | 0 | 0 |
| XZ | 4 | 20 | 0 | 0 | 2 |
| **Total** | **13** | **72** | **12** | **1** | **9** |

These match the [umbrella’s table](../../docs/plans/261003f-fifth-codebase-sweep-umbrella.md:124), with qualifications:

- R12 appears under both T2 and T3: those count a first slice and the wider programme, rather than distinct findings.
- KN’s unnumbered heading-anchor finding adds another T1 if the count includes *every finding*. The reviewer confirmed it, but the umbrella gives it no explicit disposition.
- SR’s conditional `admitJob` extraction is another unnumbered T2 proposal needing a disposition.

The review counts also mostly reconcile:

| Review | Independently re-added |
|---|---|
| Sol, SR/WC | **26: 15 confirmed, 11 overstated** |
| Opus, DP | Six numbered findings confirmed; broader table has **11 rows**, including three new findings, one overstated lead and one unverifiable hypothesis |
| Sol, KN/XZ | **54: 39 confirmed, 11 overstated, 2 unverifiable, 2 wrong**, excluding two product rows; including those gives **56: 40/12/2/2** |
| Opus, DF | All ten numbered mechanisms confirmed, with qualifications to tier, count, value or fix; its “nine of ten” headline contradicts its own table |

The **15 T0 calculation is correct**: `13 − 1 duplicate − 2 downgrades + 2 promotions + 3 reviewer discoveries`. Its scheduling is inconsistent: AccessSharing’s copy failure is one of those three discoveries, yet sits in **T1 cluster 18**.

Other counts need correction:

- The frozen-control census is **163 source files, 94 vocabulary candidates**, not 66.
- Memory coverage is **77 files**, not 78; KN’s categories sum to 77.
- The seven postmortem-family counts sum to **56**, not 64. Neither investigation explains the remaining eight.
- Cluster 13 has **13 dependency diagnostics across 11 files**, not 13 client files.

The most consequential lost or altered findings are:

- **XZ-X13k:** the finite browser deadline for `useSourceScan` disappears, despite the summary explicitly restoring it to T1.
- **WC-W4:** reuse of the existing SSE reader in Quiz/Mirror has no disposition.
- **SR-R8:** the narrowed decoding leaf supposedly “survives”, but has no cluster.
- **DF’s fold-twin parity test:** omitted.
- **DF-F2:** the live `TOC10_SYSTEM` rename and separation of the production expectation from the historical fixture are omitted.
- **DF-F5:** the reviewer recommends hashing the **rendered system prompt** in harnesses that will run again. Cluster 9 substitutes a “before-and-after source check”; that is a different defence.
- **DF-F9:** the review summary correctly says keep twelve and freeze/delete the `260930a` pair, while cluster 13 still says keep all fourteen.

**File ownership and ordering**

The five stated first-wave manifests—1, 2, 3, 4, 9—are mutually disjoint as written. The wider claim that file sets are disjoint unless `After` says otherwise is false:

| Clusters | Unsequenced shared file | Why |
|---|---|---|
| **14 ↔ 1 and 16** | `scripts/deploy.ts` | Reviewer-added K13 explicitly includes its two migration-table queries |
| **14 ↔ 17** | `src/types.ts` | K12 removes the obsolete synchronization comment; 17 edits cache-group comments |
| **6 ↔ 17** | `src/db/schema.ts` | Criteria-style Claims fencing needs persisted attempt fields; 17 changes column types |
| **13 ↔ 20** | `src/web/BlockGutter.tsx` | Dependency suppressions and clipboard migration both edit it |
| **9 ↔ 19**, after restoring F2’s rename | `src/structure.ts` | Live-base rename and Messages-result migration both touch it |

Sharing a predecessor does not order siblings: 13 and 20 remain unordered. Consequently, [“cluster 14 can run at any time”](../../docs/plans/261003f-fifth-codebase-sweep-umbrella.md:528) must go.

Several manifests also omit necessary files:

- **4:** `src/web/search-hits.ts` for the one-character ligature case.
- **6:** `schema.ts`, plus Chat/Comments adapters and callers if it really includes all DP-D3 contracts. Otherwise explicitly defer that remainder.
- **8:** citation-find route tests and auth/security documentation pointing at `isAllowed`.
- **11:** `tools/fleet/readiness-git.ts` and `routes-new.ts`; the latter still calls synchronous `collectHealth`.
- **13:** the floating-promise baseline fix in `scripts/changelog/release-notes.ts`, and the required red control in `tests/biome-config-is-live.test.ts`. The configuration is **`biome.jsonc`**, not `biome.json`.
- **18:** `Dock.tsx`, whose private `withPanel` must become reusable.

**Scores, tiers and first wave**

Most scores are plausible, but several tiers or priorities contradict the evidence:

- AccessSharing’s small confirmed T0 repair should come out of cluster 18.
- Cluster 21’s **initial agreement test is T1** according to the DP reviewer; only a subsequent extraction is T2.
- F5 remains T2 under the reviewer’s cheaper rendered-prompt-hash fix.
- Async steering was corrected to **T2/L/high**, conditional on a recorded stall. The umbrella silently changes it to T3 and loses that condition.
- DF-F10 is corrected to T2, while its equivalent XZ-X13i remains T1. Either choice needs an explicit arbitration.
- Cluster 4’s value is understated by its accented-word headline: straight-versus-curly apostrophes make this common in English prose.
- Cluster 6’s data-loss and stale-overwrite defects deserve at least as much priority as the reader polish. Splitting its immediate SQL/fencing repairs from broader contract tightening would make the work easier to dispatch.

Starting cluster 1 satisfies the literal “first stage addresses the highest confirmed tier” rule. However, putting **T1 cluster 9 ahead of available T0 work** needs a stated risk veto or a revised order. Keep 1–4 early, bring forward 6, 7 and 10, and separate R1’s tiny decoding repair from cluster 8’s cleanup bundle so it need not wait for the whole Referee programme.

**The five code spot-checks**

All five underlying defects survive inspection:

| Claim | Today’s evidence |
|---|---|
| **1: deploy mode parsing** | [Parser](../../scripts/deploy.ts:177) recognizes flags by inclusion. Extracted probes leave both safe modes false for `--verify-onyl`, `--dryrun`, `--host …`, and empty arguments. [Main](../../scripts/deploy.ts:1669) then reaches migrations and the production push when gates pass. No deploy was invoked. |
| **2: source-scan charset** | [Storage](../../src/fetch.ts:273) normalizes HTML to UTF-8, but [scan](../../src/source-scan.ts:185) sniffs again. My real-function probe lost the invisible-character finding without UTF-8 metadata; ASCII hidden text remained detectable. |
| **6: Referee persistence** | [Claims finish](../../src/store/pg-referee-claims.ts:226) updates by article ID without attempt or pending guards. [Criteria trim](../../src/store/pg-referee-criteria.ts:233) excludes the new ID but has no pending filter in selection or deletion. These are code proofs; I did not run concurrent database requests. |
| **4: shelf links and offsets** | Real `libraryHitHref → findLiteral` probes gave **zero hits** for café, curly apostrophes and ligatures, versus one for the plain control. `foldWithMap("😀 café")` yields a source slice of **“afé”**. |
| **8: malformed decoding** | The actual extracted [part body](../../src/routes.ts:5025) throws `URIError` for `%E0`; the catch maps it to 500 and reports it. |

Cluster 4 needs one further regression case: **combining marks before the match**. `foldWithMap("a\u0301 café")` produces **“ caf”** for the intended café slice because an empty folded character fails to advance the source position. Fixing only astral output indexing leaves that defect alive.

Cluster 6 also overstates the marker-lifetime lead. The DP reviewer calls its Criteria consequence effectively unreachable and the repair symmetry-only; the umbrella says it was dropped, then retains it among “four related holes”. Keep the small consistency repair if desired, but distinguish it from demonstrated answer loss.

**“For Greg”**

Items 1–3 explain the visible change and cost reasonably well. Item 3 should retain the reviewer’s requirement to demonstrate Debate’s string levels, reset wording, counts and accessibility before promising one slider serves everything.

The remaining items need adjustment:

- **4:** “seven streams omit cancellation” does **not** mean seven save results for a return visit. Mirror stores nothing, Search cancellation is conditional, and glossary Ask stores a result while cancelling. The reviewer explicitly rejected this stored/ephemeral division. Explain the proposed policy using the actual route behaviours.
- **5:** ordinarily just do this tiny wording consolidation under Greg’s stated authorization. At minimum separate cataloguing the existing sentences, already accepted in cluster 12, from changing their wording.
- **6:** “it deletes data” is insufficient for approval. Explain that it removes abandoned intermediate copies older than six hours, referenced by no job, never published/current revisions, at most ten per new job. Give the measured candidate count, storage benefit and loss of those intermediate outputs.
- **7:** this is an approval queue, not one product decision. “Three delegation lessons” and “a provenance warning” are opaque without proposed wording. Preserve the required before/after procedure and avoid generalizing one historical failed-merge incident into a universal claim.
- The “none is urgent” introduction contradicts the obsolete Overseer rule that already stopped this sweep.

A missing decision is **whether the historical eval arm will run again**. The DF reviewer explicitly offers deleting it and retaining the saved October 2 baseline instead of maintaining a frozen fixture. Surface that alternative.

**“Considered and rejected” and “One level up”**

The restraint is generally right. Three corrections matter:

- The attribution about `types.ts` is wrong. DP explicitly lists **six active reasons to change**; it rejects splitting because no measured benefit supports it and dependencies are largely type-only—not because it has one reason.
- The guard decision is unresolved: KN’s reviewer wants a composition-root walk; DF’s reviewer recommends a simpler flat `tools/` allowlist. The cluster chooses the walk, while the summary calls it a flat allowlist. Choose and explain.
- Record the missing alternatives and dispositions: historical-arm deletion, the two probe scripts, moving the four `scripts/eval/` CLIs, and the fold parity test. A summary mentioning a finding does not allocate its work.

The overall architectural conclusion is defensible **within the stated scope**. The ownership/snapshot exceptions are useful. Add the KN reviewer’s aggregate-rejection and consolidation postmortem lessons: draining descendant work and preserving the survivor’s failure states matter directly to these proposed deletions.

**Verdict: ready with these fixes.** Required fixes, most important first:

1. Expand the file manifests, add the missing ordering edges, and remove “cluster 14 can run at any time”.
2. Restore or explicitly dispose of dropped accepted findings, especially X13k, W4, the decoding leaf and fold parity.
3. Carry the actual eval corrections: live-base rename, independent historical expectation, rendered-prompt hashes, and twelve-kept/two-freeze-or-delete scripts.
4. Move AccessSharing’s repair into T0, prioritize confirmed defects ahead of cluster 9, and reconcile the disputed tiers and marker-lifetime claim.
5. Correct the census/count errors and counting scope; remove the false implication that both families independently verified the full frozen-control census.
6. Preserve gate landing conditions, including the floating-promise red control, and include combining-mark coverage in cluster 4.
7. Rewrite the cancellation and draft-deletion decisions plainly; surface historical-arm retention versus deletion.
8. Correct the `types.ts` attribution and reconcile the guard design and missing rejected/held alternatives.