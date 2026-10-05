Approve the amended worktree. The original candidate had one established P1, now fixed. Nothing committed; Greg’s quotations are unchanged.

- **F6 — P1, established, fixed: different bands could share a fingerprint.**  
  **(a)** A `<pre>` containing 2,498 words plus `\n\nspya-bbbbbb: word` renders identically to a 2,498-word `<pre>` followed by a separate one-word paragraph. The real splitter counts 2,500 versus 2,499 words: different Fuller prompts, identical original fingerprints. The [regression](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/tests/simple-summary.test.ts:1067) went red.  
  **(b)** Include the selected band in new fingerprints; retain the original algorithm for legacy freshness and unforced stamps. Implemented and tested.

- **F7 — P2, established, fixed: the long-band paragraph ask was not pinned.**  
  **(a)** Changing “Six to nine” to “Eight to eleven” passed all original 155 tests.  
  **(b)** Add a literal assertion for the complete long-band LENGTH wording. That mutation now fails.

- **F8 — P2, established, unresolved provenance gap.**  
  **(a)** Early `len1a` Identity, Haters and Scaling files all record hash `89945d81…` at line 14. Scaling’s unchanged standard pair actually hashes to `0653f349…`. See [Scaling’s record](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/results/simple/high-none-len1a/scaling-hypothesis.json:14).  
  **(b)** Recover the exact source/request snapshots or repeat those writes. I documented the limitation and corrected F1’s ledger; I did not fabricate replacement hashes. The preference tally remains verifiable against the saved prose.

- **F9 — P3, reasoned, corrected: “no effect” exceeded the sentence trial’s evidence.**  
  **(a)** The judge favored sentence coverage in [P03](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/results/simple/length-bands-261005b/judge-sentence.md:23) and [P04](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/results/simple/length-bands-261005b/judge-sentence.md:30); Race also grew from 607/620 to 690/698 words.  
  **(b)** Say the trial did not establish an overall preference benefit. Leaving the sentence out remains defensible; claiming no effect does not.

- **F10 — P3, established, corrected: documentation contradicted the recorded history.**  
  **(a)** The evaluator said `len2` shipped; the plan claimed two Scaling baseline writes and no Brief sentence measurement, despite one recorded baseline and the documented `len1whole` exception. Some range endpoints also overlapped.  
  **(b)** Correct those statements and endpoints. Done.

The scorer misreads none of the 35 sections. The 8/8 Fuller preference, 6/8 old-Brief preference and four quoted Brief omissions match the judge files. The investigation acknowledges control variability and the mathematical-survey stand-in honestly. I found no additional limit, visitor/export or token-budget defect: `ANSWER_TOKENS` is 8,999 and the request allowance is 48,999.

Validation: **214 tests passed**, typecheck passed, requested mutations failed as expected. Lint reported existing advice only. The full database suite was not run here.

Files changed:

- [src/simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/src/simple-summary.ts)
- [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/src/pipeline.ts)
- [src/types.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/src/types.ts)
- [tests/simple-length-bands.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/tests/simple-length-bands.test.ts)
- [tests/simple-summary.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/tests/simple-summary.test.ts)
- [tests/simple-two-levels.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/tests/simple-two-levels.test.ts)
- [tests/stage-stamp-agreement.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/tests/stage-stamp-agreement.test.ts)
- [evals/simple/length-bands.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/evals/simple/length-bands.ts)
- [Investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/docs/investigations/261005a-summary-length-bands-measured.md)
- [Plan](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md)
- [Summaries reference](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/docs/project/summaries.md)
- [Feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/docs/user-feedback/261004_2034-summary-length-follows-the-length-of-the-piece.md)
- [New postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbgttwhn-summary-length-follows-text/docs/postmortems/261005b-derived-instructions-must-participate-in-the-request-fingerprint.md)

APPROVE