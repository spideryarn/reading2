# Stage 1 code review: Remember's identifiers become `learn`

Candidate: `8c36c5caa`, reviewed at `da4082a8f`. Scope is the candidate's 283
paths, not the unrelated changes brought in by the merge. Review and fixes were
performed in `/var/tmp/spideryarn-worktrees/learn-rename`. No commit, database
command or network operation was run.

The brief, rename table, kept-word list, accepted plan findings and landing
record are in [the plan](261006a-remember-identifiers-become-learn-all-the-way-down.md).
The preceding review is [the plan review](261006a-plan-review-sol.md).

## Findings

All findings below are established. There are no P0, P1 or P2 findings.

| ID | Severity | File and symbol | Finding and disposition |
|---|---|---|---|
| CR-1 | P3 | `src/similar.ts:265`, `similarBlocks` | The cache comment was changed to say that `learn` evicts the first key. The actual cache helper remains `remember`; it uses the ordinary English verb. **Fixed** by restoring the helper's name in the comment. |
| CR-2 | P3 | `src/web/useComments.ts:990`, `useComments` / `noteThread` | The rename changed the ordinary instruction “Remember, locally” to “Learn, locally”. This comment describes retaining a comment-to-thread association, not Learn mode. **Fixed** by restoring the original verb. |
| CR-3 | P3 | `tests/chat-kind-reaches-the-server.test.tsx:6`, suite header | The historical account now said that the September Candidates bug forwarded only `kind: "learn"`. That literal did not exist then; the candidate's parent says `"remember"`. **Fixed** by restoring the historical literal and mode name, with a parenthetical giving the current literal. Assertions remain on today's kinds. |
| CR-4 | P3 | `tests/store-export-bundle.test.ts:648`, `keeps a Candidates thread's kind, and so does the rollback now` | The description of the pre-October-2 export bug was rewritten to say it special-cased `learn`. The historical literal was `remember`. **Fixed** by restoring that literal and noting its current name. The test body is unchanged. |
| CR-5 | P3, wider | `docs/project/learn-mode.md:618`, `kind belongs to the thread` | The document still says both stores normalize a missing stored kind to `chat`. Stage 0 removed that behavior from `pg-chat.ts`: `storedThreadKind` refuses an unknown value; only the fixture-file normalizer remains lenient. This sentence was already stale before the candidate. **Reported, not fixed**, because it belongs to stage 0 rather than the rename. |

The four fixes change comments only, so no behavioral red-first test was needed.
No attributed sentence was changed, and no project documentation was edited.

## Independent audit

The independent recursive `git grep -i remember` over `src`, `tests`, `evals`,
`scripts` and `package.json`, along with candidate diff inspection, found no
remaining live identifier that needed to move. Separate read-only agent sweeps
checked residue and documentation. Remaining old words belong to English prose,
reader search aliases, historical records, stored eval results, old-link tests
or migration fixtures. CSS selectors and their markup, nuqs keys, command ids,
thread-kind comparisons, prompt identifiers and mode tables agree on `learn`.

The SQL drops the old CHECK and partial index, changes only `kind`, creates the
new unique index over `kind = 'learn'`, and validates the new CHECK. It does not
write identities, titles, timestamps, messages or pointers. Its transaction
boundary is the existing migrator's. A structural comparison of the new snapshot
with its predecessor found only the intended CHECK/index changes and snapshot
identity fields; it agrees with `src/db/schema.ts`.

`modeFromParam` serves the client parser, server tab title and Dock's carried
mode. Help derives its anchor aliases from `RETIRED_MODES`; feedback canonicalizes
through the same table. The old mode word is filtered before last-view storage
and replay. `remember` remains an article-state key in `NEVER_REMEMBERED`, so an
old sub-mode link wins over both a stored view and the first-open default.

The specific suspicions resolve as follows:

- The migration test takes table-wide DDL locks and rewrites existing lane rows
  inside its rolled-back transaction. The private Postgres lane uses
  `fileParallelism: false` and `maxWorkers: 1`, so parallel chat files cannot
  overlap it in that lane. The update adds no inter-suite deadlock path under
  that configuration. A fresh full database run remains unverified here.
- The hand-edited fixture's kind and two message strings match the edited
  generator. No fixture discrepancy was found.
- `ChatDrafts.learn` / `setLearn` use memory-only Maps; there is no persisted
  draft key to migrate. `ChatPanel`'s boolean consistently selects the layout
  shared by Recall, Tutorial and Explore.
- `kind must be chat or learn` correctly names wire values. The whole-article
  refusal still interpolates the kind as it did before the rename; lower-case
  `learn` is a minor copy convention, not an incorrect destination or contract.
  No additional copy change was made.
- The docs audit checked HTML hrefs and code-span references as well as Markdown
  links. Live targets moved; historical code examples retain their old names.
  No rename-induced present-tense documentation defect was established.

Accepted compatibility decisions and the deferred picker measurement were not
reopened.

## Validation

- Selected offline unit run: **24 files passed, 367 tests passed, 2 skipped**.
  It includes `learn-name`, `stored-eval-results`, `doc-links`,
  `command-pick-catalogue`, fixture corpus, last-view, Learn panel/URL/prompt/chip
  suites, thread sources, Help, Dock URLs, chat drafts, kind forwarding and cache
  tests. Machine-readable results: `/tmp/learn-review-final-unit.json`.
- Comment-hook verification: **2 files passed, 26 tests passed**:
  `use-comments-load-state` and
  `use-comments-create-waits-for-the-opening-read`.
- Direct offline assertion: a feedback diagnostic with `article.mode =
  "remember"` returns `article.mode = "learn"`.
- Typecheck: `npm run typecheck` could not start because the sandbox refused
  tsx's Unix-socket listener. Running the **same script** with
  `node --import tsx scripts/typecheck.ts` passed all four projects and the
  coverage check for all 3,264 source files.
- Lint of the four changed source/test files passed; it emitted two pre-existing
  complexity information messages in `useComments`. `git diff --check` passed.
- An initial selected run passed 360 tests but failed one registry test at
  `spawnSync .../node_modules/.bin/tsx EPERM`; its other 12 tests passed. This
  is an environment limitation, not a successful registry verification. The
  provided green registry result remains the available evidence for that test.
- No Postgres tests or full suite were run. In particular, the comment-only
  edit to `store-export-bundle.test.ts` was not executed: that file belongs to
  the private Postgres lane. The two migration suites and stage-0 refusal suites
  retain the supplied results, not fresh results from this review. Browser
  checks and paid evaluations remain the next stage.

## Verdict

**Approve stage 1 with the four comment fixes applied.** No runtime defect was
established. This is not a fresh full-suite or Postgres validation.

Every file changed by this review:

- `src/similar.ts`
- `src/web/useComments.ts`
- `tests/chat-kind-reaches-the-server.test.tsx`
- `tests/store-export-bundle.test.ts`
- `docs/plans/261006a-code-review-sol.md` — this answer
