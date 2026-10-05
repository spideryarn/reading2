The measured improvement for the profiled reader is real, but the chosen arm does not follow the pre-declared simpler-arm rule. I would ship the two-bullet arm.

## Findings

### R1 — P1 · reasoned — the section is rescued by a post-hoc comparison

The plan says: if two bullets do as well as the section, two bullets ship ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:133)).

The direct evidence says they did:

- Section versus two bullets: 5–5.
- Profiled audit: section 0.6; two bullets 0.6 and 0.8.
- No-profile direct comparison: two bullets preferred 4–1.
- Two bullets versus old: 6–4, from a round designed after the direct tie was known.
- Section versus old: 9–1, from the pre-declared round.

Applying the section’s old-prompt threshold of seven to the two-bullet arm was not declared, and the two old-prompt comparisons used different later rounds and judges. It does not overturn the direct comparison. “[The section] buys the rest of the preference” is unsupported ([investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md:215)).

Smallest closing change: make `NOT_READ.fuller` the recorded two-bullet variant—its first and fifth bullets, no heading/opening/check—while retaining `AFTER_PROFILE.fuller`.

Replace the investigation’s conclusion with:

> Directly compared, the two-bullet arm and the section split 5 to 5. Their profiled audit counts were 0.7 and 0.6 respectively. A later exploratory comparison preferred the section over the old prompt 9 to 1 and the two-bullet arm 6 to 4, but no old-prompt threshold was declared for choosing between them. Under the pre-declared simpler-arm rule, the two bullets ship.

Replace “did less well” in [the source comment](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/simple-summary.ts:499) with:

> A two-bullet cut met the pre-declared simpler-arm rule and is what ships.

### R2 — P2 · reasoned — the grounded “pass” hides a distinct new distortion

One new ViT summary says ViT overtook ResNets “only with JFT-300M.” No old summary made that claim; one old summary got the same comparison wrong in a different way. That is not literally “no new distortion,” although it can reasonably be judged too small to block shipping.

The plan ledger currently reports an unqualified pass and mentions omissions but not this distortion ([ledger](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:327)).

Replace that profiled cell with:

> Every omitted finding was also omitted by an old summary of the same piece. One new ViT summary made a distinct error about where ViT overtook ResNets; it was judged not major enough to fail the gate. Nothing the reader claimed to know was explained. **Passes under that materiality judgment.**

### R3 — P2 · established — the feedback note overstates fidelity

The note says “no main finding was lost” ([note](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/user-feedback/261005_0742-fuller-summary-written-for-someone-who-has-not-read-the-piece.md:39)). The grounded tables recorded five omission findings across 25 new-prompt judgments. The supported claim is comparative: each omitted finding was also omitted by an old summary of that piece.

Exact replacement:

> for a reader with a profile, a blind judge preferred the new Fuller in 9 pairs of 10. Every main finding omitted by a new summary was also omitted by an old summary of the same piece. It is about 40 words longer.

### R4 — P2 · established — “25 summaries” counts repeated judgments

“25 summaries of each of old and new” ([investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md:147)) is 25 judge exposures covering 20 distinct outputs in each prompt family. Five `none-new0a` and five `none-new1a` outputs were judged again in round two.

Exact replacement:

> **Against the piece**, both rounds: 25 judgments each of old and new, covering 20 distinct outputs in each prompt family; 15 judgments of 15 two-bullet outputs:

The totals—old 9/6/0, new 5/2/0, two bullets 1/3/0—are correct.

### R5 — P2 · established — two reader-facing descriptions are too absolute

The actual rule exempts a coined term when the profile names that term explicitly. Therefore “no profile can claim a term the paper coins” is false ([summaries.md](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/project/summaries.md:444)).

Replace it with:

> The report came from a reader whose profile claims the paper’s field; that alone does not make the paper’s own names familiar.

Likewise, replace the note’s “profile no longer covers a term the piece itself coins” with:

> the reader’s profile no longer covers a term merely because it claims the piece’s field.

Also replace “Not shown” in summaries.md, the plan ledger, and the note with:

> **Mixed for a reader with no profile; no improvement claimed.**

The no-profile treatment is otherwise honest. The 7–3 preference for old is a real regression signal, not something the controls erase; the replicated audit movement in the opposite direction makes “mixed” fair. It is not enough by itself to hold the two-bullet arm.

### R6 — P2 · established — one judge exceeded its brief

The round-one information-decomposition judge listed nine main findings despite being told to list five to eight ([answer](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/results/simple/new-reader-261005h/grounded-judge-entropy-24-00930-spya-pywwkq.md:3)). Its omission finding was independently reproduced in round two, so this does not change the conclusion.

Smallest change: add under “What it cannot show”:

> One round-one grounded judge listed nine main findings despite the brief’s limit of eight. Its only omission finding was independently reproduced by the round-two judge.

### R7 — P2 · established — the branch still needs the planned merge

At inspection time:

- `origin/dev` is `838416e69`.
- The merge base is `447c3164b`.
- `origin/dev` is not an ancestor of `HEAD`.
- `git log origin/dev..HEAD` contains `482c4f756` and merge commit `ce5f4ab72`, not one commit.

A push now will be rejected as non-fast-forward. `git merge origin/dev` is required, as planned; do not force-push. Recheck `git diff origin/dev..HEAD` afterward so current `dev`’s three newer documentation changes are not reverted.

If the Brief work lands first, more than the Fuller hash must change:

- Brief owns `simple-prompt/10`; the combined prompt is `/11`.
- Keep both version-history and changelog paragraphs.
- Update the current-version pins in both summary tests and candidate references in the plan and `summaries.md`.
- Preserve the result JSON and investigation hashes as historical `/10` evidence. Add:  
  > The Fuller bytes evaluated as `simple-prompt/10` ship unchanged in the combined `simple-prompt/11`; `/10` is the separate Brief change.
- Replace “Brief is unchanged, byte for byte” with:  
  > This Fuller change did not alter Brief. Brief was byte-for-byte `/9` during this eval; its separate length change is recorded above and ships in the combined prompt version.
- Take the incoming Brief hash and verify the Fuller hash from the merged tree. The Fuller system bytes should remain `d38d5742…`; the historical combined prompt hash `2ef1eb6f` must not be rewritten.

## Checks that stand

All other published figures reproduced: 55 writes, $9.6114, four retries, word ranges and means, wait-median ranges, audit means, pair counts, grounded totals, and prompt/source hashes.

“Passes, narrowly” is accurate for the declared audit rule: 0.7 improvement against 0.6 control-arm variation, with one audit item separating pass from fail.

Round one retains its arms, seeds, filenames, blind-ID chain, and criterion calculations. The new arm mapping is correct. Missing runs are refused while constructing inputs; wrong blind IDs, reordered/repeated sections, repeated answer lines, and forbidden answers are refused during scoring. I found no verdict/reason contradiction or evidence that an audit judge used another summary.

`tests/simple-two-levels.test.ts` and `tests/doc-links.test.ts`: 32/32 passed.

Fix first: R1, then R3.

VERDICT: ship the two-bullet arm instead