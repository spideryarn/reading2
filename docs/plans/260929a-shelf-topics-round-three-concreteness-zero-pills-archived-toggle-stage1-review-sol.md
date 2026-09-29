## Findings

**S1-1 — P1, reasoned — SUBTLEX redistribution permission is not established**

The cited `wordfreq` notice says permission applies to “wordfreq and code derived from it.” This project instead processes the original SUBTLEX-US download directly. Ghent documents free availability, but not a general redistribution licence. Therefore the cited evidence does not clearly permit shipping this derived list. [Local attribution](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/data/ATTRIBUTION.md:31), [wordfreq notice](https://raw.githubusercontent.com/rspeer/wordfreq/master/NOTICE.md), [Ghent source page](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus).

Changed: none—the existing caveat remains honest. Wider resolution requires direct permission or a clearly licensed replacement dataset.

**S1-2 — P2, established — `-ing` lookup could select an unrelated word**

`staring` tried `star` (6.2) before its actual lemma `stare` (4.1), incorrectly granting the ordinary density threshold.

Changed [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/choose.ts:169) to try dropped-`e` forms first. Added a regression test at [shelf-terms-choose.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/tests/shelf-terms-choose.test.ts:404). Test was red before the fix.

**S1-3 — P2, established — `admit` replacement could defeat adjacency**

A later superset could replace an earlier topic in-place, creating shared-stem neighbours after the adjacency decision had already run.

Changed [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/choose.ts:495) to reapply the same deterministic fresh-coverage rule over the final selected list. It only reorders selected topics; membership and coverage are unchanged. Added a red-first replacement regression at [shelf-terms-choose.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/tests/shelf-terms-choose.test.ts:463).

**S1-4 — P3, established — attribution/documentation inaccuracies**

The attribution said phrases were dropped and misstated the Glasgow paper’s title. The generator also did not explicitly say the downloaded Glasgow CSV must be renamed.

Changed [ATTRIBUTION.md](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/data/ATTRIBUTION.md:3) and [build-word-lists.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/scripts/build-word-lists.ts:10). Glasgow attribution now supplies authors, source, licence link, and transformations, matching the publisher’s CC BY statement and attribution requirements. [Springer source](https://link.springer.com/article/10.3758/s13428-018-1099-3), [CC BY 4.0 conditions](https://creativecommons.org/licenses/by/4.0/legalcode.en).

## Checks without findings

The density rule matches the final plan: vague single words require `max(4, 2 × words/1000)`; phrases, concrete words, and rare words retain the ordinary threshold. Common Glasgow-missing words remain vague.

The generated modules total 66,470 bytes. `npm run build` passed and placed both tables directly inside the 4.80 MB API bundle, with no runtime word-list file reads.

The generator is deterministic from the two named downloads, though the upstream inputs are not checksum-pinned.

## Test tail

```text
Test Files  3 passed (3)
Tests       76 passed (76)
Duration    9.88s
```

Production build, scoped lint, `git diff --check`, and typecheck passed. Plain `npm test` could not start its database lane because local PostgreSQL/Docker was unavailable. No commit made.

**Verdict: code fixes are ready, but Stage 1 should not ship until SUBTLEX redistribution permission is established or the dataset is replaced.**