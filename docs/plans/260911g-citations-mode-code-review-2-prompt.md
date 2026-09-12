# Review: Citations mode, second code review — the fixes, and whether it can ride the next deploy

Repo: this worktree (spideryarn2), branch `worktree-citations-review-2`, which is `origin/dev` plus
one commit of mine. TypeScript + ESM, `tsx`, one Node server (`src/routes.ts`), Postgres via Drizzle
(`src/db/schema.ts`, migrations in `drizzle/`), a React client under `src/web/`.

This is the **second** code review of Citations mode. The first, this morning, was yours:
`docs/plans/260911g-citations-mode-code-review-sol.md` (its prompt is beside it). It said *do not
ship* on F11–F14. Some of those have been fixed since, by me and by another agent. **Treat those
fixes as unreviewed code written by someone else, and spend most of the run on what changed since
the first review** — but the question at the end is about the whole mode.

## The question I most want answered

**Is Citations mode now safe to sit on `dev`, behind the experimental switch, and ride the next
production deploy together with its four migrations?** Check that conclusion, not just the code. The
finding I would least like to be wrong about is one that makes that answer *no*: a way for a caller
to spend without bound, to read or write another owner's data, to get a model-written URL presented
as a work's own address, or a migration that is unsafe on a populated production database.

## The candidate

All on `dev`, each self-contained (`git show <sha>`, `git show --stat <sha>` for its manifest).
Do not use a merge-base range — `dev` is shared and a range sweeps up other people's work.

    85631f9b  Citations stage 1: the artefact, the step and the read route
    abde65f7  Citations stage 2: the mode, behind the experimental switch
    1e54a7f8  Citations stage 3: Find it on the web, per searched row
    8d523739  Citations stage 3: the four reds the full suite found
    f391929b  Citations: the owed GPT Sol code review, and its two fixes      ← new since review 1
    ba7b6f48  Citations: a late Find no longer draws a web page over a DOI    ← new since review 1

I checked `git log` for every later commit touching the Citations files, the four migrations, the
Citations tests and the Citations parts of `src/routes.ts`, `src/store/pg.ts`,
`src/store/article-rows.ts`, `src/db/schema.ts`, `src/types.ts` and `src/pipeline.ts`: there are
none besides these six (the rest are plan and decision-log prose).

The four migrations that will ride the deploy:

    drizzle/20260911220212_citations.sql
    drizzle/20260912000232_citation_finds.sql
    drizzle/20260912000251_citation_finds_owner_fk.sql
    drizzle/20260912091147_citation_find_rate_bucket.sql      ← new since review 1

## What it is meant to do

The plan is `docs/plans/260911g-citations-mode.md` — read it in full, including its Progress, both
ledgers, § Owed reviews and § For Greg. What is built is `docs/project/citations.md`. Briefly: one
model pass finds the works an article cites, code verifies every quote, expands footnotes, mints and
inherits ids by a dedupe key, and **derives every link itself** (DOI → arXiv → unique title-matching
anchor → unique mention anchor → Scholar search). *Find it on the web* is one owner-pressed POST per
`search` row that makes one Exa-backed chat call and keeps a page only if the model's pick is one of
the call's own `url_citation` URLs and that result names the work.

Invariants:

1. No URL a row presents as the work's own came from a model's text (stage 1 or stage 3).
2. Only the article's owner can read the list or spend on *Find it*; nothing about another owner's
   article is readable or writable through these routes; a visitor or public-readable share does
   not get the list.
3. A write happens only for a kept find, only on a `search` row, only for the owner; a failure is
   never drawn as found.
4. Every press of *Find it* is bounded — per owner at once, per hour, per day, and globally.
5. The four migrations are safe to apply to a populated production database.
6. Block ids are the addressing contract (`docs/project/block-ids.md`); nothing addresses text by
   offset.

Out of scope (the plan's "not built" list): *Find more* past the 80 cap, `?cite=` selection, real
influence counts, batch search, visitors.

## The first review's findings, and what was done about each

| ID | Sev | State now |
|---|---|---|
| F11 | P0 | **Fixed in f391929b.** New `citation-find` bucket in the shared per-owner allowance (`FetchAllowanceStore`, `src/store/pg-rate-limit.ts`), migration `20260912091147_citation_find_rate_bucket` widening the CHECK, `FIND_RATE_POLICY` 2 at once / 20 an hour / 60 a day / 600 global a day, taken after the 404 and 409, `finish` in `finally`, 429 / 429 / 503. Tests in `tests/citation-find.test.ts`. |
| F12 | P1 | **Not fixed — a product call for Greg**, recorded in the plan § For Greg; default: leave as built for v1 (owner-only, experimental, the host drawn on the row). If you think this changes the ship answer, say so plainly and why. |
| F13 | P1 | **Fixed in f391929b.** The 80-cap moved from `toDrafts` to `keepLeanedOnMost`, after both dedupe folds. Test in `tests/citations.test.ts` § the cap. |
| F14 | P1 (we rated P2) | **Client half fixed in ba7b6f48**: `useCitations.find` patches only a row that is still `search`; `tests/citations-find-late-reply.test.tsx`, red first. **Server half not changed**: `save` still writes unconditionally after the call; we judged it safe because `attachFinds` only upgrades `search` rows at read time, so a stale `citation_finds` row is never drawn over a DOI. Check that judgement — e.g. does a stale row resurface if a later re-run turns the work back into a search, and is that wrong? |
| F15 | P2 | Open: link-producing HTML is not in the freshness fingerprint. |
| F16 | P2 | Open, latent: `citation_finds.owner_id` not tied to the article's owner; no ownership transfer exists. |

Also in f391929b: `tests/models.test.ts` was red on `dev`; `SPIDERYARN_CITATIONS_FIND_MODEL` was
restored and inventoried.

## The security surface, named

- `POST /api/citations/:slug/:id/find` in `src/routes.ts` and `src/citation-find.ts` — who reaches
  it, the owner check, the 404/409 before the limiter, the limiter take and its `finally`, what is
  spent, what is written. How its auth/CSRF treatment compares with the other owner-only POSTs
  (`tests/authenticated-api-route-contract.test.ts`).
- The new limiter: `FIND_RATE_POLICY`, the `citation-find` bucket, its CHECK widening, whether a
  thrown error, an abort at the 60 s deadline, or a client disconnect can leak a lease or skip the
  count; whether the bucket name matches in code, CHECK and tests.
- `GET /api/citations/:slug` — the owner-only gate, what a visitor / public-readable share receives.
- Table `citation_finds` (`src/store/pg-citation-finds.ts`, `loadCitations` / `attachFinds` in
  `src/store/pg.ts`, the export in `src/store/article-rows.ts`): keys, foreign keys and ON DELETE,
  what reads join on.
- The experimental switch and owner-only gate — is either only in the client?
- Everything that writes: the pipeline step's artefact write, `save`, the export put-chain, id
  inheritance on a re-run.

## Evidence

- `docs/plans/260911g-citations-mode-code-review-2-test-results.txt` — 14 Citations-related test
  files run in a normal shell against the local database at `ba7b6f48`. Read it; anything touching
  Postgres cannot run in your sandbox's network either way, so treat that file as the result for
  those.
- `docs/plans/260911g-citations-mode-owed-review-test-results.txt` — the first review's run.

## What you can run, and what you may change

**This run can write, and the house rule since 2026-09-09 is that you fix what you find inside this
stage.** Scope:

- **Fix** a finding that is inside Citations mode (the files in the six commits' manifests): narrowly,
  **red first** — add or extend a test that fails on the current code, make the fix, show it green.
  Keep each fix small and say in your answer which files it touched.
- **Do not fix, only report**, anything wider you noticed — other modes, shared infrastructure, the
  glossary routes' missing limiter (already known), docs outside this mode. I will decide those.
- Do not touch `.env.local`, `infra/`, systemd, fleet config, or any database. Do not commit, do not
  run git commands that change state. Do not edit the plan or the doc files; I will fold your answer
  into them.
- You can run one test file (`npx vitest run tests/<one>.test.ts`) and a script
  (`node --import tsx <script>`); not `npm test` or `npm run typecheck`. Anything needing Postgres
  will skip or fail in the sandbox — **a red test there is not yet a finding**; say which you could
  not run and I will run them.

## What to write

**Findings first, to a separate section at the top of your answer, before any fix.** For each:

- an ID — this chain has used F1–F16, so **start at F17** (refer to F11–F16 by their IDs if you
  revisit them) — a severity, and established or reasoned
- (a) what shows it fails its own claim — the input or mutation I can run
- (b) the smallest change that closes it, and whether you applied it (and the test that was red)

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Then: a line per F11–F16 saying whether its current state is right. Then a section **Wider,
reported not fixed**. Then **the verdict on the question at the top**, in one line — *safe to ride
the next deploy* / *safe after the fixes applied here* / *not safe* — and the one thing that decided
it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The limiter is taken *after* the 404 and 409 so a refusal is free. Can a caller make the POST spend
  money on a path that never reaches the take — or reach the take, fail, and not release?
- The F14 server half: is "`attachFinds` only upgrades `search` rows" really enough, given a work can
  go search → DOI → search across re-runs with the same id?
- `20260912091147_citation_find_rate_bucket.sql` widens a CHECK on a shared table. On a populated
  production table, is the drop-and-re-add safe and does the new list include every value code
  writes today?
