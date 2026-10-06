approve after my fixes

The original decision explained away an inconvenient result. The book variant failed both shipping conditions. Brief now asks for **about 80 words in every band**.

| ID | Severity | Finding | Fixed? |
|---|---|---|---|
| F1 | P1 | Shipped despite winning only 2/4 pairs and receiving two padding flags versus zero. | Yes: `book: BRIEF_USUAL`. |
| F2 | P3 | Non-book statistics included books. Correct means are 96 words at the 80-word ask and 108 at 100, over nine and ten writes respectively. | Yes |
| F3 | P3 | Plain 100 lost two book pairs, not four; four combines the 90 and 100 arms. Both book controls preferred draw `a`. | Yes |
| F4 | P3 | Claims excluding chance, establishing the sentence’s causal effect, or declaring the variant “not worse” exceeded the evidence. | Yes |
| F5 | P3 | Sonnet accounting blurred ten candidate writes with two baselines; quoted account balances lacked supporting result files. | Yes: clarified counts and removed unsupported balances. |

Verification:

- All four `opusbook3` files match the candidate’s book prompt hash and name `anthropic/claude-opus-5.5`. Both 80-word baselines match their historical prompts.
- Final Brief prompts match `/9` byte for byte in all bands; Fuller matches the parent in all bands.
- Seed 261011 reproduces all eight key entries. Hand checks agree with scoring: P03 old, P05 new, P06 old, P08 new. No obvious arm preference in the judge instructions.
- Recorded costs match: **$3.600336 Opus**, **$4.2570361 Sonnet**, plus five unpriced Sonnet failures.
- The band fingerprint and `/12` bump suffice for freshness. The probe default is appropriate; no dependent assumption requiring correction was found.

Files edited:

- [simple-summary.ts](/var/tmp/spideryarn-worktrees/brief-by-band/src/simple-summary.ts)
- [simple-length-bands.test.ts](/var/tmp/spideryarn-worktrees/brief-by-band/tests/simple-length-bands.test.ts)
- [simple-two-levels.test.ts](/var/tmp/spideryarn-worktrees/brief-by-band/tests/simple-two-levels.test.ts)
- [length-bands.ts](/var/tmp/spideryarn-worktrees/brief-by-band/evals/simple/length-bands.ts)
- [Plan](/var/tmp/spideryarn-worktrees/brief-by-band/docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md)
- [Investigation](/var/tmp/spideryarn-worktrees/brief-by-band/docs/investigations/261005a-summary-length-bands-measured.md)
- [summaries.md](/var/tmp/spideryarn-worktrees/brief-by-band/docs/project/summaries.md)

The requested Vitest command printed **4 files passed, 178 tests passed**; regression assertions failed before the fix. `npm run typecheck` failed with sandbox IPC `EPERM`; the equivalent `node --import tsx scripts/typecheck.ts` passed all four projects and confirmed coverage of **3,237 source files**. The free table/scoring scripts also passed through that workaround.

No commits, pushes, or paid calls.