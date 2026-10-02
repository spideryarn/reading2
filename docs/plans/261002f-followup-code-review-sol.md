Review complete. No P0 or P1 findings.

1. **P2 — empty overrides made search disagree with every other title surface.** [pg-shelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-title-voice-and-gutter-test/src/store/pg-shelf.ts:636) used non-nullness, so a stored `''` produced a blank, reader-voiced search title while `titleFor` showed the extracted title. Both SQL expressions now use `nullif(..., '')`. Added an integration regression at [store-shelf-pg.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-title-voice-and-gutter-test/tests/store-shelf-pg.test.ts:546).

2. **P2 — `useArticleRename` could retain the previous article’s written flag when reused across slugs.** [TitleEditor.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-title-voice-and-gutter-test/src/web/TitleEditor.tsx:206) now stores the slug with the flag. `ArticlePage`’s key already prevented this in the current production path, but the hook no longer depends on that. The regression test was observed red before the fix and is now green at [article-rename.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-title-voice-and-gutter-test/tests/article-rename.test.tsx:530).

3. **P2 — the unread-paper test covered only the author branch.** A hard-coded author face would have passed. Added the renamed/reader branch at [minimal-paper-ui.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-title-voice-and-gutter-test/tests/minimal-paper-ui.test.tsx:318).

The `0dd643f10` claim checks out. The test was stale after `220d1723a`; the new assertion is stronger than the old intent because it checks the house-card source (`data-tip`), the screen-reader name (`aria-label`), and prohibits a duplicate native `title`. The delegated card’s actual use of `data-tip` is independently exercised by `gutter-control-card.test.tsx`. No visitor-facing “your” path remains for the gutter mark.

The privacy audit was clean: no rename flag or rename fact reaches `PublicArticle`, public DTOs, the public shelf, SSR head, or visitor JSON. Dig Deeper also strips the new `LibraryHit` field before storing passages. Owner exports still contain the owner’s rename by their existing, intentional design.

Gates:

- Typecheck: passed via `node --import tsx scripts/typecheck.ts`; normal `npm run typecheck` hit the sandbox’s tsx IPC `EPERM`.
- Targeted Vitest: 8 files, 225 tests passed, including all requested non-Postgres tests plus public DTO and gutter-card coverage.
- `store-shelf-pg.test.ts`: blocked before collection because the sandbox cannot reach local Postgres at `127.0.0.1:54362`; the new regression remains to run in a database-capable environment.
- Targeted lint: passed; `git diff --check`: passed.
- No commits made. The pre-existing untracked review prompt was untouched.
- Nothing wider needs a product decision.

**Verdict: sound after three P2 fixes; only the Postgres regression awaits a database-capable run.**