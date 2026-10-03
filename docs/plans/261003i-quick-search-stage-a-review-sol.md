The recall gains reproduce, but the original “no worse” conclusion overstates the evidence. I corrected comments and prose in three stage files; runtime behavior is unchanged. **No commit made.**

Independent recomputation used the saved scores, query definitions, fixtures and locally available private scratch corpus, without printing article text.

| Measure, after cap 20 | Old wording | “Mention or discuss” |
|---|---:|---:|
| Short-set literal opportunities missed | 109/141 | 17/141 |
| Held-back opportunities missed | 15/27 | 0/27 |
| Old sixteen: mean reference recall | 0.70154 | 0.78046 |
| Short-set mean hits kept | 0.59 | 3.15 |
| Old sixteen: mean hits kept | 9.83 | 11.46 |
| Old set: maximum before cap | 56 | 94 |
| Absent-topic hits | 0 | 0 |
| Absent-topic top-score range | 0.04–0.14 | **0.04–0.11** |

The denominators represent **47 and 9 distinct query/block targets, each tested three times**. Floor-sweep recall also reproduces: 0.822 at 0.65, 0.761 at 0.75, 0.652 at 0.8. [Recomputation script](/tmp/review_quick_search.py).

Findings:

- **A1 — P1 — “The old set is not hurt” is unsupported. Fixed the claim.** [Investigation](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md:282). Known wrong displayed-hit occurrences rise **35 → 54**, while **114 → 116 remain unjudged**. Only top-five results were pooled. “Did any of the agents blow the whistle?” gains four known wrong occurrences across its three runs. “Evolution” returns 20/20/18 hits, with **7/6/5 judged wrong**. The cap limits count, not pollution.

- **A2 — P1 — Production prose was committed. Fixed in the working tree.** The investigation contained a seven-word, 45-character excerpt from `spya-p2wrn0` and a two-word, 15-character excerpt from `spya-nrvjwg`. Both are removed. The candidate’s raw results and scripts contained no production excerpts. The original commit still contains them.

- **A3 — P3 — Greg’s zero-hit cause was asserted without reproduction. Partially fixed.** [Investigation](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md:113). All 29 capital-B runs clear the floor; rejected production scores were not saved. Saved probabilities are hundredths, and production filters before rounding confidence. Greg’s run and the eval name the same model snapshot. Noise below the floor remains plausible, not established. Corrected the investigation and comments; the plan’s “cause was the question’s verb” remains outside the permitted edits.

- **A4 — P3 — LLM cost and speed summaries overstate the disadvantage. Fixed.** [Investigation](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md:328). Nothing supports 15× cost. Cached DeepSeek calls were cheaper than Jev; its long-article first hit arrived sooner. Retaining Jev is supported by typical-article completion speed and the junk trade-off, rather than universal superiority. LLM retrieval figures reproduce.

- **A5 — P1 — “A lower floor finds nothing more” incorrectly supports retaining 0.7. Fixed.** [Floor analysis](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md:202). At 0.5, misses fall **17 → 14**, while known wrong occurrences rise **20 → 32**, plus 24 unjudged. The statement holds only for 0.6 and 0.65. Also corrected the absent-score range, repeated-target denominators and representative score comments.

- **A6 — P2 — Declaration chronology is unverifiable. Limitation documented; evidence gap remains.** The committed artifacts lack a dated target manifest or pre-confirmation choice record. I found no affirmative leakage evidence, but cannot verify predeclaration or independence of the held-back choice. Literal coverage also favours “mention” by construction; it cannot establish general semantic precision.

- **A7 — P3 — Existing timeout arithmetic is wrong. Reported, outside stage edits.** [Comment](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/quick-search.ts:91): 20 seconds is about 22× the quoted 0.9-second slow case, not 40×.

The aggregate old-set recall gain exceeds observed repeat variation: plain **0.677–0.716**, mention **0.774–0.790**. Three repeats still cannot establish broad non-regression.

Requested tests: **107 passed across quick-search, AI-call and doc-links**. The spend-guard suite could not start because `spawnSync git` returned `EPERM`; a retry failed identically. Biome and diff-whitespace checks passed.

**Verdict: Yes—the evidence supports shipping “mention or discuss” at floor 0.7 as a recall/precision trade-off, with the corrected claims.**