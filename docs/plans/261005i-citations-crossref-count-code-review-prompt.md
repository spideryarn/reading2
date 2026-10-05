# Code review, with fixes: Crossref's citation count on a Citations row (261005i)

You are reviewing **code**, and you may fix what you find. Your sandbox is this worktree.

- **Fix** anything inside this change, narrowly, with a failing test first.
- **Report, do not fix,** anything wider than this change.
- Do not commit. Do not touch `drizzle/` unless a finding is about the migration itself; if it is,
  report it rather than regenerate.
- Never attribute a sentence to Greg in any doc. The only words of his in this work are
  "Q-crossref-count yes" (2026-10-04).

## The candidate

Commit `83b247bc3` on branch `worktree-q-crossref-count`, alone (its parent `d6673bebc` is the
plan). The changed paths, completely: `git show --stat --format= 83b247bc3`. Read the diff with
`git show 83b247bc3 -- <path>`.

The plan is `docs/plans/261005i-citations-show-crossref-citation-count-with-source-and-date-read.md`;
its review table (F1–F7, your own plan review) overrides its body. IDs continue from **F8**.

## What it is for

Greg decided a Citations row whose work has a DOI held by Crossref shows Crossref's
`is-referenced-by-count` as the number itself, with its source and the date it was read, beside the
model's influence. Constraints: reuse `lookupWork` and its cache; store when it was read; an
additive migration only; the threshold bar and the orders do not change. Stage 2 is separate:
`normaliseDoi` in `src/paper-metadata.ts` decodes an encoded doi.org address once, through
`doiOfUrl`.

## Where to start (this does not limit scope)

- `src/bibliographic.ts`, `src/store/pg-bibliographic.ts`, `src/db/schema.ts`,
  `drizzle/20261005151925_bibliographic_records_cited_by_count.sql`
- `src/citation-registry.ts`, `src/registry-work.ts`, `src/types.ts`, `src/public/dto.ts` (not
  changed; check it needed no change), `src/public-types.ts`
- `src/web/CitationsPanel.tsx`, `src/web/styles/citations.css`, `src/web/help/*`, `src/chat-tools.ts`
- `src/paper-metadata.ts`, `src/doi-url.ts`
- every other caller of `lookupWork` and every other implementer of `BibliographicStore`
- `docs/project/citations.md` against the code

## What I am asking

An independent pass first. Does the code do what the plan and its review table say, and is each of
these statements accurate?

1. A count reaches a reader only from a `found`, title-confirmed, Crossref-sourced record, on every
   surface (owner row, visitor row, chat tool).
2. A pre-feature cached Crossref record is re-asked until one refresh succeeds, and never after.
3. No answer other than a found Crossref record can leave a count or a read moment in its row.
4. The migration only adds: two nullable columns and two CHECKs that every existing row satisfies.
5. The threshold bar, `priorityOf`, the orders and `effectiveInfluence` are unchanged.
6. `normaliseDoi` returns the same value as before for every input that is not an encoded address.

Run the tests that need nothing outside the tree, at least `npx vitest run tests/bibliographic.test.ts
tests/citation-registry.test.ts tests/registry-client.test.tsx tests/paper-metadata.test.ts
tests/citations-panel.test.tsx`. `tests/bibliographic-pg.test.ts` needs Postgres, which you cannot
reach; the implementer's run of it was 24 passed. A finding you reproduced outranks one you
reasoned to.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 left unfixed. Every finding gets an ID and one of
*fixed by me* / *reported*. End with one line: **land**, **land after fixes** (IDs), or **do not
land**.

## Known, not findings

- The migration is not yet applied to the shared local database (a peer's unlanded migration is in
  its ledger), and may be regenerated after a merge; its SQL will not change.
- No browser check has been done yet; it follows this review.
- The day is in the card, not on the line; the day reads "4 October 2026" through the panel's
  existing `dayOf`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- **A deploy where the code lands before the migration**: `read` selects columns that do not exist.
  What does every `lookupWork` caller then do, and is it only "unavailable"?
- **`fetched_at` is now truncated to the millisecond.** Does anything compare it at finer grain?
- **The outage regression** your F4 named: a pre-feature record is `unavailable` to import, Debate
  and *Dig deeper* while Crossref is down. Would returning the stale-but-valid cached record when
  the refresh fails be simple and right, or more machinery than it is worth?
- **`readAt` in chat**: `new Date(readAt).toISOString()` after `Date.parse` accepted it — can a
  parseable string still throw there?
- **Stage 2**: an encoded address whose DOI holds `<` or `>` now returns null instead of the escaped
  string. Is null the better answer?
