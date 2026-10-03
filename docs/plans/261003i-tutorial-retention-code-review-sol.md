Found six issues; no P0 or P1 regression confirmed. Fixes are uncommitted in the working tree.

1. **CR-1 — P2, fixed: the quotation screen accepts invented short words.** At `b34ad2d3c`, `evals/remember-tutorial.ts:279` discards ellipsis pieces shorter than four characters. Thus `"not … an intelligent data pattern"` passes against a block without “not”. The regression test failed first. The fix checks every nonempty piece with strict whitespace matching.

2. **CR-2 — P2, fixed: terminal punctuation hides genuine unlinked quotations.** The [retained Entropy output](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/evals/results/remember-tutorial.261003i-entropy-after-1.md:25) repeats `"facilitates its own transformation,"` without an ID in that sentence. The screen misses it because of the comma. A test failed first; the fix removes only closing punctuation and preserves internal punctuation.

3. **CR-3 — P2, fixed: passage precedence was untested.** Removing `marks.length === 0` left all 77 flash tests green. Added a fixture supplying both a drawn passage and a different matching quote. That mutation now fails one test.

4. **CR-4 — P2, fixed: the jump test did not prove quote forwarding.** `tests/begin-jump-flash.test.ts:201` asserted a fallback paragraph wash with no Highlight API and empty prose. Dropping the quotes produces exactly that outcome. Added matching prose and assertions on registered ranges for both jump branches. Discarding quotes now fails both tests.

5. **CR-5 — P2, evidence remains unavailable: the main measurement cannot be audited.** The original blind input, key and labels are absent from the tree. The eight conversations cannot establish the reported classifications or borderline sensitivity calculation. Qualified the investigation and reference doc accordingly. Recover the original artifacts to make those numerical claims reproducible.

6. **CR-6 — P3, fixed: prose overstates the evidence.** The investigation claimed the quotation-link gate was met, overlooked the example in CR-2, described consecutive own-view tasks as permitted, and said length did not worsen despite one ceiling breach. Corrected these claims and the inconsistent “quarter/160 turns” comments.

All requested mutations were restored:

| Mutation | Before fixes | After fixes |
|---|---:|---:|
| Remove sentence-break rule | 3 tests fail | Already defended |
| Remove footnote skip | 1 test fails | Already defended |
| Remove passage precedence | All green | 1 test fails |
| Discard forwarded quotes | Fallback assertion cannot distinguish | 2 tests fail |

The investigation’s original sums are correct:

| Screen | Old | New |
|---|---:|---:|
| Over 140 words | 0 | 1 |
| Uncited turns | 5 | 1 |
| Article quotations | 80 | 99 |
| Unlinked quotations | 6 | 9 |
| IDs later in sentence | 8 | 9 |
| IDs naming another block | 1 | 8 |
| Not found as quoted | 8 | 4 |

Historical result files remain unchanged.

Final verification passed **257 tests in nine files**, typechecking, and lint with one existing complexity note. The `npm` typecheck launcher hit sandbox IPC restrictions; the same script passed via `node --import tsx`.

Forgiving-match offsets are correctly mapped back; the added whitespace/Unicode test passes. I found no current callback path dropping the second argument. Offscreen quote visibility remains the accepted unchanged-scroll limitation; browser colour verification remains separate.

**VERDICT: land with the fixes above** — depends on CR-1–CR-4’s fixes and CR-5–CR-6’s corrected evidence claims.