**Verdict: stands with corrections.** The recorded quality comparisons support further work on B, but several accounting claims and conclusions need correction. No files were edited and no paid calls were made.

I completed all seven checks:

- **1:** Every judge-table entry matches, in **Opus then Sol** order. Cell-table calls, rejected answers, costs, parts and sections match; one time needs rounding correction.
- **2:** **4/14**, **9/14**, and **9/12 agreement** are correct for the recorded completed cells. The spending totals need qualification below.
- **3:** All four terminal failures involved answer validation after two attempts; three were per-part failures. None was transport failure or model refusal.
- **4:** B and C use the identical first-request builder and book input; both recorded **265,091 input tokens**. Their top levels really differ: 15 versus 8 parts.
- **5:** Quoted fragments match the indicated pair results except one grammatical alteration.
- **6:** Blinding and spoiled-tree gating work. Candidate names never enter the materials; counts follow shuffled X/Y seats. Passage selection uses only document blocks. Recomputed hashes reproduce **9/12 first-named arms in X**: an unbalanced hash draw, with no identified arm-selection bias.
- **7:** Blocks, generation model, effort and common final build/`checkTree` match. Eight-wide concurrency is production’s `SLICE_CONCURRENCY`, not an invented advantage. Important qualifications follow.

**F1 — P1 — Incorrect total and incomplete smoke pricing.**  
Read: [smoke ledger](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/evals/results/long-structure-2026-10-05/smoke/ledger.jsonl), matrix ledger.  
Correction: replace “$32.42 … $2.29 … both from the ledger” with **“The ledgers record $32.3145679: $2.1843665 smoke and $30.1302014 matrix. Smoke Sol attempts lack upstream pricing, so complete spend is unknown.”** The claimed $32.42 is not reproducible from those files. Correct the plan’s repeated total too.

**F2 — P1 — The seventh document was bought, partially.**  
Read: [matrix ledger](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/evals/results/long-structure-2026-10-05/matrix/ledger.jsonl).  
Correction: **“The joined document’s C cell made 21 paid attempts costing $3.726994 before being capped without a saved cell.”** Consequently, $8.336760/$22.3692424 correctly describes **all staged ledger spending, including that unfinished cell and a top-call retry**. For the twelve tabled staged cells, use **$6.795698/$18.6422484**. Reserve “4/14” for completed cells; it excludes the capped run.

**F3 — P1 — The proposed schema fix cannot explain most failures.**  
Read: failed cells; [arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/evals/long-structure/arms.ts:367); `prompts.ts`.  
Correction: **“Removing B’s required verdict targets seven rejected answers and one terminal cell. C already uses strict schemas; its failures require separate diagnosis.”** Seven of sixteen rejected staged answers were missing-verdict failures—neither most rejected answers nor most terminal failures. The smoke failure was `not-an-expansion`, which the current `oneSectionIsNone` explicitly handles. Report that harness change before combining smoke and matrix as evidence about “as built” robustness.

**F4 — P2 — C’s rejection is confounded by different top levels.**  
Read: book B/C cells, C-versus-B judge files, investigation and plan result.  
Correction: replace “Summaries later do not pay” / “C is dropped” with **“Deprioritize C under this pilot’s decision rule; separate summaries have not been isolated experimentally.”** C loses two of three completed direct comparisons, but its book loss comes largely from a different first-call outline. Share a frozen outline to isolate later summaries. Preserve the inconvenient positives: C wins the paper comparison unanimously, and succeeds on Origin where B fails. “Failed more” is an observed count, not an established rate.

**F5 — P2 — Scope the B conclusions and implementation decision.**  
Read: investigation’s six short-answer bullets; plan § Result: stage 2.  
Correction: **“Both judges preferred B on both variants of one story collection.”** These are not two independent books. Replace “it should not be built yet” with **“This pilot supports fixing recovery and measuring first-call variability before production adoption.”** Prioritizing stage 1a follows; requiring stage 1b is not established by this eval. Scope the 18–62-second and 32–108-second claims to B’s observed successful cases; C reaches 69 seconds top and 124 seconds done.

**F6 — P2 — Caching and checks need accurate qualification.**  
Read: ledger, `structure-expand.ts`, `arms.ts`.  
Correction: **“B’s expansion calls used prompt caching: 24 matrix calls recorded 112,712 cache-read tokens. Caching policy was not normalized across arms.”** Delete “this harness did not” use caching. Common final checks are shared, but A additionally checks seams and label askability; all successful recorded cells nevertheless have zero unaskable label batches. Timing excludes document loading and delivery, so it measures generation rather than full reader latency.

**F7 — P2 — Follow-up budget arithmetic.**  
Read: investigation § What it means, bullet 3; plan result.  
Correction: **“Three draws × four documents × two prompts = 24 calls; at $0.70 each, budget $16.80, plus retries.”**

**F8 — P3 — Small factual corrections.**  
Read: paper B cell, book B proposal, `pair.book.B-vs-A.run1.opus.json`.  
Correction: paper B done is **78.454 seconds**, hence **78 seconds** at nearest-second precision. Describe B’s 15 parts as **12 stories plus front matter, introduction and concluding essay**, not 15 stories. Quote **“Y cuts Human Readable into three top-level parts”**; the stored judge says “cuts,” not “cut.”