Implemented all in-scope fixes. No P0 findings or wider issues.

### Findings

1. **P1 — old writer could violate the new database constraint**  
   [migration:14](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/drizzle/20261025121700_citation_web_note_old_writer_compat.sql:14), [test:250](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/citation-web-notes-pg.test.ts:250)  
   An old upsert omitting `page_kind` could retain a newer `looks-like` value. That either mislabeled a strict `/3` note or made note→none fail the CHECK. Fixed with a compatibility trigger that clears `page_kind` for `/3` writes and all negatives, plus a forward repair and faithful old-writer tests.

2. **P1 — uploaded-file privacy rule could be bypassed during a race**  
   [citation-web-note.ts:705](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/citation-web-note.ts:705), [test:837](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/citation-web-note.test.ts:837)  
   If an article changed from a public URL to an upload while waiting for allowance, an unchanged citation row retained title-search permission. Fixed by tracking and rechecking the article’s title-search eligibility before any paid call.

3. **P1 — the committed change failed typechecking**  
   [citation-web-note-client.test.tsx:41](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/citation-web-note-client.test.tsx:41), [public-dto.test.ts:1583](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/public-dto.test.ts:1583)  
   Two fixtures omitted the newly required `pageKind`. Fixed with non-vacuous `own` and `looks-like` values.

4. **P2 — reader-facing text claimed more than the checks establish**  
   [Sources help:53](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/web/help/pages/modes/sources.md:53), [PrivacyPage.tsx:500](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/web/PrivacyPage.tsx:500), [messages.ts:7299](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/messages.ts:7299)  
   Help implied all shops, reviews and encyclopedias were excluded; Privacy implied every search included an identifier; the refusal message incorrectly said every refused row lacked one. Fixed each sentence to describe the checks and data actually used.

5. **P3 — comments and export descriptions documented the old rule**  
   [citation-web-note-shown.ts:39](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/citation-web-note-shown.ts:39), [export-bundle.ts:680](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/src/store/export-bundle.ts:680), [database.md:1605](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/docs/project/database.md:1605)  
   They referred to a nonexistent backfill or described every result as the work’s own page. Fixed to document nullable legacy rows, `/3` handling and lookalike pages accurately.

6. **P3 — tests left important behavior unproved**  
   [citation-web-note.test.ts:206](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/citation-web-note.test.ts:206), [citation-lookup.test.ts:311](/var/tmp/spideryarn-worktrees/fbm53cdk-citation-note-looser/tests/citation-lookup.test.ts:311)  
   Added coverage for host normalization, credentials, ports, Amazon country domains, `Reviews of Modern Physics`, free refusal before registry/model/allowance work, and the upload-transition race. The abstract-note prompt remains byte-for-byte unchanged.

### Verification

- Typecheck passed through the equivalent direct runner, covering 4,007 files. Literal `npm run typecheck` was attempted but its `tsx` launcher was blocked by sandbox IPC permissions.
- Non-PostgreSQL requested tests: **283 passed**.
- Additional affected client/DTO tests: **99 passed**.
- Help corpus: **7 passed**.
- Migration snapshots: **28 passed**.
- Migration chain and `git diff --check`: passed.
- The exact requested suite was attempted, but the PostgreSQL test could not connect to the sandbox-blocked local database (`EPERM 127.0.0.1:54362`); no database was started or modified.

**Verdict: fixes applied and all available checks pass; approval remains conditional only on running the PostgreSQL compatibility test in an environment with local database access.**