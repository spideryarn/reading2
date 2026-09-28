Verdict: approve after two in-scope fixes. No remaining blocking findings.

1. [src/meta-authors.ts:131](/home/greg/code/spideryarn2/.claude/worktrees/nature-authors/src/meta-authors.ts:131) — `chooseByline` accepted a surname anywhere in the byline, so `John May` incorrectly preserved a May dateline. Punctuation-only names could also produce an empty matcher. Changed it to require every full folded name and reject empty folded names. Added common-surname, empty-fold, and non-Latin tests at [tests/meta-authors.test.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/nature-authors/tests/meta-authors.test.ts:123).

2. [src/meta-authors.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/nature-authors/src/meta-authors.ts:63) — short organizational authors could still be reversed, such as `University of Oxford, Department of Biology`. Added organizational markers so one such entry preserves the publisher’s ordering for the entire list. Regression test: [tests/meta-authors.test.ts:100](/home/greg/code/spideryarn2/.claude/worktrees/nature-authors/tests/meta-authors.test.ts:100).

Verified:

- Requested Vitest command: 36/36 passed.
- Typecheck passed across all four projects and 2,263 files. The literal `npm run typecheck` hit this sandbox’s `tsx` IPC `EPERM`; running the identical entry point via `node --import tsx scripts/typecheck.ts` passed.
- Saved full pages produced 25 Nature, 8 arXiv, 6 PLOS, and 34 AlphaFold authors. Frontiers remained byte-identical.
- Pages without `citation_author` or repeated DC creators retain Readability’s byline.
- Other consumers accept the longer string: storage uses Postgres `text`, Referee mode splits `;`, UI surfaces render ordinary wrapping text, and prompt consumers interpolate it safely. Link summaries and public shelf cards intentionally cap their display copies at 200 characters; the stored byline remains complete.
- Leaving `authors` out of `readArticleWithProvenance` is appropriate: that eval-only path measures raw Readability extraction/provenance, while author selection affects only `runExtract` metadata.

No commit made.