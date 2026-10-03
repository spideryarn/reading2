Done enough to stop here: no P0/P1 findings; all code fixes are green.

1. **P2 — [AuthorNames.tsx:110](/home/greg/code/spideryarn2/.claude/worktrees/fbuvxq8e-citations-authors-links/src/web/AuthorNames.tsx:110): external links used the browser’s low-contrast default blue.** Added the house highlight colour, underline, and hover colour. The new dark/light screenshots show them legibly.

2. **P2 — [AuthorNames.tsx:72](/home/greg/code/spideryarn2/.claude/worktrees/fbuvxq8e-citations-authors-links/src/web/AuthorNames.tsx:72): short affiliation hints retained trailing punctuation.** Normalization now removes terminal search punctuation. Tests confirm the 80-code-point boundary preserves astral characters and safely hard-cuts affiliations without spaces. Quote stripping was already correct.

3. **P3 — [AuthorNames.tsx:88](/home/greg/code/spideryarn2/.claude/worktrees/fbuvxq8e-citations-authors-links/src/web/AuthorNames.tsx:88): the comment guaranteed Scholar profile ranking.** Changed it to the accurate “may surface a matching public profile.”

4. **P3 — [masthead-authors.test.tsx:199](/home/greg/code/spideryarn2/.claude/worktrees/fbuvxq8e-citations-authors-links/tests/masthead-authors.test.tsx:199): interaction and Metadata coverage was incomplete despite the plan’s claim.** Added coverage proving:

   - keyboard access to both links;
   - Escape closes the dialog and restores focus;
   - touch-style hover does not swallow shelf navigation;
   - `noopener noreferrer` remains present;
   - Metadata renders the links inline without opening a card.

The plan’s boundary wording was corrected at [261003f-authors-outside-links-to-find-more-about-each.md:79](/home/greg/code/spideryarn2/.claude/worktrees/fbuvxq8e-citations-authors-links/docs/plans/261003f-authors-outside-links-to-find-more-about-each.md:79).

Checks:

- Typecheck: all four projects clean; all 2,810 source files covered.
- Affected tests: 181 passed across 11 files.
- Final focused run: 29 passed.
- Biome and `git diff --check`: clean.
- Repository-wide `npm test` could not start because Postgres/Docker was unavailable.
- Chrome-backed layout test could not launch Chrome in this sandbox. The separate `phone-metadata` screenshot currently shows the reading view, not Metadata, so it does not substantiate that browser check.

I could not commit or push because this session has read-only access to the worktree’s Git metadata. The fixes remain in the working tree; unrelated untracked browser artifacts were untouched.