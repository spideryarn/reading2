No established P0 or P1. The band design is reasonable, with five changes worth making to the plan.

Review scope: the original plan, now committed as `ec32200e2`, against base `27c7ded9`. Implementation files changed concurrently; those changes are outside this review. I changed no files. The permitted test passed all 12 cases using `--configLoader runner`.

1. **F1 — P2, established: the probe would hash the wrong prompts.**

   **(a)** [probe.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/simple/probe.ts:170) hashes `SIMPLE_SYSTEMS` once, before loading individual articles. Under the proposed design that remains the standard pair, while short, long and book requests use different pairs. Their recorded `systemsSha256` would therefore describe prompts they did not send. The source hash still provides useful provenance, but does not make this field accurate.

   **(b)** Add to stage 1:

   > Update `evals/simple/probe.ts` to record each article’s selected band and hash the exact pair of system prompts selected for that article. Move `systemsSha256` into the per-article calculation. Test that the recorded pair matches the request’s prompts.

2. **F2 — P2, established: unchanged prompt bytes do not justify excluding standard articles from measurement.**

   **(a)** Raising the shared limits changes standard requests too. Using the existing formula, `ANSWER_TOKENS` rises from **5,508 to 8,594**, and `max_tokens` from **45,508 to 48,594**. Their validation boundaries also change. A standard Fuller of 1,000 words can now succeed where it previously failed—the plan explicitly acknowledges this. Thus “most summaries are written exactly as they are now” and “measurement only has to cover the three new bands” overstate what byte preservation guarantees.

   **(b)** Replace that bullet with:

   > The standard band’s two system prompts remain byte-identical to today’s, pinned by the existing hashes. Its answer budget and validation limits change, so measurement includes one standard-band article, before twice and after twice, alongside the three changed bands.

3. **F3 — P2, reasoned: the short-summary judge lacks the evidence needed to judge important omissions.**

   **(a)** Suppose the shorter Fuller drops an essential qualification but remains fluent. A judge seeing only the two summaries can notice the difference, but cannot establish whether the omitted detail matters to the essay. Preference before reading the essay can reward precisely that loss. The guard does not close this gap: its prompt explicitly permits omissions and judges only contradictions against cited passages.

   **(b)** Replace the final short-band measurement bullet with:

   > For the short essays, give the judge the complete body evidence alongside the shuffled summary pairs, without arm labels. Ask separately which summary better orients the reader and whether either omits an essential claim or qualification; require a supporting source passage for each reported omission. Preference alone does not establish that the cut preserved what mattered.

4. **F4 — P2, established: the whole-piece sentence conflicts with Brief’s retained selection rule.**

   **(a)** Brief’s existing `NOTCH_UP` asks for the goal, finding and importance, with **“At most one other key idea.”** Giving every main part its share is a different instruction. On a book with several distinct main parts, the model cannot reliably satisfy both. This introduces a coverage change alongside the length change.

   **(b)** Replace the coverage-sentence bullet with:

   > This first change adjusts length and paragraph counts only. If measurement finds opening-heavy Fuller summaries, measure the whole-piece coverage sentence separately for Fuller. Brief retains its existing selective orientation rules.

   This is also the simpler version I would choose first. I do not see a materially simpler alternative to numeric bands that preserves their explicit, testable targets.

5. **F5 — P3, established: the book’s measured body count is misstated.**

   **(a)** The supplied [book result](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/results/simple/high-none-len0a/s3-gdl-45mb-spya-cc9kr8.json:9) records **47,957 body words**, while the plan uses 49,462. Both select `book`, so this does not alter the decision.

   **(b)** Replace both occurrences of `49,462` with:

   > 47,957 body words

The remaining contracts look compatible: every production caller supplies blocks with word counts; the existing article fingerprint and prompt-version stamp need no band field; band instructions remain after the article’s cache breakpoint; readers and visitor projection share the raised limits; exports retain the stored JSON.

The rollback paragraph is broadly accurate, but regeneration produces a **new paid summary**, rather than restoring the original wording. Keeping the raised reader limits while rolling back the prompt would preserve readability.

All proposed shapes are feasible. Book Brief is tight: three paragraphs of at most three sentences under 18 words allow at most 153 words, so a 140-word target needs nearly the full allowance. That merits measurement, not refusal.

APPROVE