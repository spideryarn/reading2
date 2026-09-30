Verdict: **build with changes**. No P0 findings. The merge is sound in principle, but the plan currently has six P1 design gaps.

## Findings

**P-1 — P1 — “The merged press”: the stated lookup core would lose the verdict and verified quotes**

The plan calls step 1 `findWorkPage + judgeLookup` ([plan:36](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md:36>)). But `findWorkPage` sends the URL-only `FIND_SYSTEM` request and does not return the raw JSON needed by `judgeLookup` ([citation-find.ts:496](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-find.ts:496>)). The real Look it up path uses `lookupRequest`, retains the raw answer, then calls `judgeLookup` ([citation-find.ts:591](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-find.ts:591>)).

Concrete change: extract a `runCitationLookup` core from the body of `makeFindCitation`; do not build it on `findWorkPage`. Pin in tests that it sends `LOOKUP_SYSTEM`, returns the assessed state and verified quotes, and saves the same `CitationFind`.

---

**P-2 — P1 — “only if no current reading”: failed lookup states would become permanent**

A “current lookup” can be `assessed`, `no-extract`, `not-identified`, or `unreadable` ([types.ts:3912](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/types.ts:3912>)). Only `assessed` is a completed reading:

- `no-extract` returns before strict identity is even checked.
- `not-identified` explicitly failed strict identity.
- `unreadable` passed identity but lost the verdict and all verified evidence.

Today, Look it up again is the recovery path. Removing that button while skipping step 1 for any attached lookup means the merged button can never improve those rows.

Concrete change: skip step 1 only for a fresh, current `assessed` lookup. At minimum, rerun for `no-extract` and `not-identified`; I recommend rerunning `unreadable` too because “best of both” includes the verdict and verified evidence, not identity alone.

---

**P-3 — P1 — “computed after step 1”: recomputation is not enough without a fresh read**

The plan does not say that the row and article are reloaded after step 1. That leaves two real races:

- The citation list can be remade during lookup, preserving the entry id but changing `why`, the passage, or its link.
- An initially attached lookup can make step 1 skip, while its underlying `citation_finds` row has since disappeared; `matchedPageOf` then returns `null`.

Concrete change: after step 1, reload citations and the article, re-resolve the entry id, load the current find, and only then build `matched`, the investigation request, allowed quote texts, and fingerprint. If the entry disappeared, stop.

The client rule also needs spelling out. The old response did **not** apply the lookup directly: it patched only safe link fields and refreshed so the server could fingerprint and attach the lookup ([useCitations.ts:419](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/web/useCitations.ts:419>)). The new `lookup` frame must preserve that rule; otherwise a rerun can transiently show a verdict judged against the old claim.

---

**P-4 — P1 — Failure semantics now allow a partial commit and can lose the previous investigation**

A step-1 save failure should fail the press: agreed.

But the inverse also needs specifying. If step 1 saves and step 2 later fails, the lookup/link remains stored. Moreover, if the previous investigation was made in the unconfirmed branch, the newly matched page changes its fingerprint. The old investigation will correctly stop attaching ([pg.ts:3649](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/store/pg.ts:3649>)), so the shipped promise that a failed “Investigate again” keeps the old answer ([260930a:167](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/plans/260930a-citations-investigate-one-work-on-demand.md:167>)) is no longer always true.

Concrete change: document and test this partial-success state. The reader should see the new lookup plus: “The longer investigation failed; the lookup was kept.” If the prior investigation was invalidated, do not claim it is still shown.

A related copy conflict is possible: the row can show a code-matched lookup while the investigation says “We could not confirm that any result is this work itself” because its separate search did not return the same URL ([CitationInvestigation.tsx:90](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/web/CitationInvestigation.tsx:90>)). Change that to: “The first check matched X; the longer search did/did not return that page among its own extracts.”

---

**P-5 — P1 — “provider error continues”: this does not deliver the identity guarantee the plan claims**

The plan says the merge resolves the open call to have code identify the work first, but then continues unconfirmed after either no-match or provider failure ([plan:47](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md:47>)).

A genuine no-match can reasonably continue in a clearly labelled degraded branch. A provider failure is different: the identity step did not complete at all, and proceeding spends the larger call after the smaller call’s infrastructure failed.

Concrete change:

- No-match: show the existing no-match sentence, then continue as explicitly “unconfirmed.”
- Provider/timeout failure: preferably stop and let the reader retry. If continuation is retained, show “The quick identity check failed; the investigation continued without it.”
- Catch only classified provider/network failures. Store failures and programming errors must still fail the press.

---

**P-6 — P1 — “bucket unchanged”: the lease and dollar fuse no longer cover the operation**

One bucket per press is the right model, but its unchanged policy is not.

The current lease is 120 seconds plus 30 seconds ([citation-investigate.ts:115](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-investigate.ts:115>)). The merged operation can take 60 seconds for lookup plus 120 seconds for investigation, so its concurrency lease may expire 30 seconds before the combined work ends.

The $20 claim is also too tight: 60 × $0.33 = $19.80, while the lookup’s 2.9¢ figure is a measured average, not a maximum ([260929g:174](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:174>)).

Concrete change: set the lease to `FIND_TIMEOUT_MS + INVESTIGATE_TIMEOUT_MS + margin`, and either measure/budget a conservative lookup maximum or lower the global fuse—roughly 55 presses at the stated $0.33 estimate leaves meaningful headroom.

---

**P-7 — P2 — Removing `/find` breaks already-open clients**

The grep supports the plan’s runtime claim: the web client is the only production caller of `/find`; uploaded-paper guessing uses `findWorkPage`, not the route. However, an already-open tab running the previous JavaScript will POST `/find` and receive a 404 immediately after deployment.

Concrete change: retain the authenticated `/find` compatibility wrapper for at least one deployment while removing the button. The related route contract and route tests then remain useful. If removal is intentional, update:

- `tests/citation-find-route.test.ts`
- `tests/authenticated-api-route-contract.test.ts`
- `tests/store-migration-registry.ts`
- route/docs/type comments

---

**P-8 — P2 — The product trade-off is stated in cents but omits the capacity loss**

The assumption is broadly fair given Greg’s explicit request for amalgamation, so I would not block for another product decision solely over 12¢. But it is more than a price change: the cheap path currently permits 20/hour and 60/day; the merged bucket permits 8/hour and 20/day ([citation-find.ts:159](</home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-find.ts:159>)). A reader can inspect only one-third as many works in a long bibliography.

Concrete change: record that capacity reduction beside the cost. I would not add “Just find it” now—it recreates two actions immediately after Greg asked for one—but leave it deferred based on use, as planned.

## Recommended simplest contract

Use one button and one allowance, with this sequence:

1. Resolve the current row and a fresh stored find.
2. Reuse only a current `assessed` lookup.
3. Otherwise run the actual Look it up core.
4. On success, save it and emit the lookup outcome.
5. Reload the current row/article.
6. Build and stream the investigation from that fresh state.
7. Preserve `/find` temporarily as an old-client compatibility wrapper.

That keeps the code-checked identity, verified evidence, link upgrade, and streamed reading without introducing another visible control.