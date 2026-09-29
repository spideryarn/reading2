You are reviewing the code for plan docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md
in the repository at the current directory (Spideryarn: TypeScript, Postgres via drizzle, React client).
You reviewed the plan already: your findings are docs/plans/260929d-authors-review-sol.md, and the plan
says, finding by finding, what changed because of them.

The change is one commit: `git show 3f172e52` (run `git show --stat 3f172e52` first). Read the diff,
then the code around it.

**House workflow: you fix what you find, inside this change.** Edit the files directly for anything
that is wrong in this diff, add or adjust tests for it, and keep each fix small. Report anything wider
(a design change, something outside this diff) instead of doing it. Do not commit. Do not run
migrations, do not touch any database, `.env.local`, `infra/`, or `src/public/dto.ts`.

Checks you can run:
- `npm run typecheck` (must stay clean).
- Unit tests: the box's memory guard refuses the normal vitest config right now, so run the unit files
  with the throwaway config: `npx vitest run --config vitest.small-tmp.config.ts <files>`. The files
  this change touches: tests/pdf-authors.test.ts tests/meta-authors.test.ts
  tests/masthead-authors.test.tsx tests/pdf-titles-eval.test.ts tests/pdf-frontmatter.test.ts
  tests/pdf-frontmatter-wiring.test.ts tests/extract-byline.test.ts. Database-backed store tests
  cannot run here (the shared database cannot take the new migration yet); read those paths instead.
- Do NOT run the eval (it spends money). Its result is in the plan; the cached answers are in
  evals/pdf/titles/*/authors-*.json if you want to replay reasoning by reading them.

What I concluded, and want checked:
1. src/pdf-authors.ts — the model proposes names and affiliations; the code finds them on the page
   and stores the PAGE's characters, trimming trailing digit/symbol markers off names and leading ones
   off affiliations. I believe a hostile PDF cannot get text into `meta.authors` or `meta.byline` that
   is not printed in the byline records (names) or on one page of the window (affiliations), and that
   the trimming cannot cut a real name. **This is the finding I would least like to be wrong about.**
   Try to break `findName`/`findAffiliation`/`trimName`/`trimAffiliation`/`wordsOf` (offset mapping
   through NFKD folding, surrogate pairs, combining marks, `ﬁ` ligatures, empty proposals, a name
   whose words appear twice).
2. src/meta-authors.ts `authorsForByline` — `authors` is stored only when it accounts for the whole
   byline. Can it store a list that names fewer people than the byline shows, or reject a correct one
   in a common case?
3. Store plumbing: `authors` written in src/store/artifacts-pg.ts (META_COLUMNS, metaColumns,
   readMeta), carried (src/store/pg-revisions.ts), selected only on the `article` projection and read
   through `decodeAuthors` (src/store/pg.ts), exported in src/store/export.ts. Is any seam missing
   (tests/store-revision-columns.test.ts, tests/store-revision-policy.test.ts, store parity,
   tests/store-export-covers-tables.test.ts expectations)? Read those tests and say whether they will
   pass, since they cannot run here.
4. src/pdf-read.ts `authorsOrNothing` and the byline derivation; src/pipeline.ts wiring.
5. The UI: src/web/AuthorNames.tsx, Masthead.tsx facts line, Metadata.tsx Authors section, the
   `.facts > span + span` selector change in src/web/styles/shell.css (does anything else rely on the
   descendant form?), accessibility of the name trigger and the "+ N more" button.
6. evals/pdf/titles.mts scoring changes (bylineNames, authorsVerdict).

Write your answer as numbered findings, each with severity (P0/P1/P2), file:line, what was wrong, and
whether you fixed it (and how) or are reporting it for me to decide. End with the list of files you
changed.
