# Review and fix: stage 2 of 261004h — a script that writes to the production database

Repo: this worktree, branch worktree-paper-year-visitor-backfill. TypeScript, ESM, Postgres.

## The candidate

Committed: commit af716df39
    git diff af716df39^..af716df39
    changed paths: git show --stat --format= af716df39

Start with: src/backfill-registry-facts.ts, scripts/backfill-registry-facts.ts, the two functions
added to src/pdf.ts (frontPageRecord, frontPagesWithStamps). That is where to begin, not the limit.

The plan: docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md
§ "Stage 2", as overridden by § "GPT Sol's plan review, and what changed" (your F1 to F5).
Stage 1 (commits 698c9052d, 7b20138de) is already reviewed; your F7 fix is in.

## What it is meant to do

There is one production database, with real readers' articles in it, and no staging copy. This
script will be run against it: first as a dry run, then, by a person, with --apply.

1. No flag: a dry run. BEGIN READ ONLY, never a commit. For each article with a current revision
   it finds identifier candidates without a model (a PDF's first two pages' text layer; a web
   page's raw HTML meta tags; plus ids in a fetched article's own addresses), asks Crossref and
   DataCite through the shipped `lookupWork` with an in-memory store, lets the unchanged
   `withRegistryFacts` decide (title and author must agree), and saves a plan file.
2. `--apply <plan.json>`: asks no registry and writes exactly the plan. One transaction. Per
   article: lock the article row, require the plan's revision to still be current, refuse an
   article with an unfinished draft, fill only empty columns, and fill a day or a year only when
   both date columns are empty. Three outcomes a row: written, already, refused.
3. `--prod` is the only way to the production database; with no flag the target must be local.
   A `Target:` line is printed before anything else.

The guarantee I want checked, stated at its true strength: **apply never changes a column that
held a value, never writes a revision that is not the article's current one at commit, never
leaves a day and a year on one row, and never exits zero having written nothing and found nothing
already written.** Is that statement accurate? And: **the dry run cannot write to the database it
reads.** Is that accurate?

## You may fix

You have write access. Fix what is inside this stage, narrowly, with a failing test first. Report,
do not fix, anything wider. Do not commit. Do not run the script with --prod. Do not write any
sentence attributed to Greg.

You have no network and no Postgres. These were run by the author and passed (raw tails):

    typecheck: ✓ all 2997 source files are covered by some project
    pdf-front-pages, backfill-registry-facts, backfill-registry-facts-pg, doc-links, fixture-ids,
      paper-metadata:  Test Files 6 passed (6)  Tests 100 passed (100)
    store-migration-registry, unit-lane-has-no-database:  Tests 18 passed (18)

tests/backfill-registry-facts-pg.test.ts needs Postgres, so it is mine to run; tell me what to
re-run after your fixes. Run tests/backfill-registry-facts.test.ts and tests/pdf-front-pages.test.ts
yourself.

The author's own report says: only the PDF reader's tests were seen red before the code existed;
the plan builder and apply were proven by mutation afterwards (dropping the current-revision
check, the `for update`, the draft refusal, the F2 guard, `begin read only`, the rollback: each
turned a test red). Treat the pg tests' strength as unproven and read them.

## Independent pass first

Attack it. In particular:
- The lock order and the draft check against src/store/pg-revisions.ts: can a publication, a new
  draft, or a re-extraction land between the checks and the write, or deadlock with the app?
- parsePlan: can a hand-edited or stale plan file make apply write something a dry run would not
  have listed (another column, another table, SQL through a value)?
- The target: can any environment or flag combination reach production without --prod, or reach
  local while saying production? Is the password ever printed or saved in the plan file?
- The dry run holds one read-only transaction while it asks the registries for every article.
  Is that sound against Supabase's pooler, and does a dead session lose the plan?
- Candidates from `final_url` and `requested_url` are wider than what import uses. Is the
  title-and-author agreement still the only thing between a wrong DOI and a written row, and is
  that enough here?
- Does writing `published_at` change anything besides Timeline's freshness (a stamp, a hash, a
  cached shelf value, a paid step that re-runs by itself)?
- frontPagesWithStamps: sideways text is appended after the upright text of its page. Can that
  manufacture an identifier from two unrelated fragments?

Findings with IDs continuing at F9, P0 to P3:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

For each: what you found, whether you fixed it, the test. End with a one-line verdict.

## My own suspicions, worth less than yours

- `rollback` errors are swallowed in the dry run.
- A conflict on one column refuses the whole row.
