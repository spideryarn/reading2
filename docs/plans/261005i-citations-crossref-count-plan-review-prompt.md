# Plan review: Crossref's citation count on a Citations row (261005i)

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

- Commit `d6673bebc` on branch `worktree-q-crossref-count`, one file:
  `docs/plans/261005i-citations-show-crossref-citation-count-with-source-and-date-read.md`.
- (The same commit also restores `docs/plans/261003m-…-fills-it-in.md` from a 22 MB corruption. That
  is not under review, beyond one question at the end.)

## What it is for

Greg decided on 2026-10-04 that a Citations row whose work has a DOI should show Crossref's
`is-referenced-by-count` as the number itself, with its source and the date it was read, beside the
model's `influence`. The constraints handed down with the decision: reuse the existing Crossref
client (`lookupWork`, its cache, the `bibliographic_records` table, the suite's fetch guard); store
when it was read; an additive migration only; the threshold bar and the orders do not change
([Q-bar-on-relevance] is still Greg's to answer).

## Where to start (this does not limit scope)

- `src/bibliographic.ts` — `parseCrossref`, `lookupWork`, `BibliographicStore`, `FRESHNESS`
- `src/store/pg-bibliographic.ts` — `freshSql`, `read`, `claim`, `write`
- `src/db/schema.ts` § `bibliographic_records`
- `src/citation-registry.ts` — `registryFor`, `attachCitationRegistry`
- `src/registry-work.ts` — `readCitationRegistry`; `src/public/dto.ts` § `publicCitationRegistry`
- `src/web/CitationsPanel.tsx` — the row's quiet line; `src/chat-tools.ts` § `article_citations`
- Other callers of `lookupWork` that the freshness change reaches: `src/article-registry.ts`,
  `src/debate-registry.ts`, `src/backfill-registry-facts.ts`, `src/citation-investigate.ts`,
  `src/paper-evidence.ts`
- `docs/project/citations.md`, `docs/project/sql.md`, `docs/project/database.md`

## What I am asking

An independent pass first. Is this plan accurate about the code it describes, and will building it
as written produce wrong behaviour, a contract violation, or a migration that is not additive?
Name anything the plan says exists that does not, and any caller it does not know about.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse the plan only on an **established** P0 or P1 (direct evidence, no unresolved material
inference); mark anything else *reasoned*. Give every finding an ID, `F1`, `F2`, …, and for each say
what you would change in the plan. End with one line: **build as written**, **build after changes**
(list the IDs), or **do not build**.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. **The freshness rule.** The plan makes a `found` Crossref row with a null
   `cited_by_count_read_at` not fresh, so old cached records are re-asked once. `freshSql` is used
   by both `read` and `claim`. Is the statement "this re-asks each old record at most once, and
   cannot loop" accurate, including when the refresh fails (`release` on a row with `state` not
   null), and when a DOI that Crossref used to hold now 404s and DataCite answers?
2. **Other callers.** Does making old rows stale change behaviour anyone would notice in the other
   `lookupWork` callers — a press of *Dig deeper* (it has its own deadline), the import path, the
   backfill's dry run?
3. **`write` returning the stored moment** instead of a boolean, against simply using the process
   clock. Is the interface change worth it?
4. **Two timestamps** (`fetched_at` and `cited_by_count_read_at`) against the alternatives the plan
   names. Is there a simpler correct design?
5. **Zero.** Crossref returns 0 for many real, cited works (books, old papers). The plan words zero
   as *no citations recorded · Crossref*. Would hiding zero be more honest, or less?
6. **Stage 2.** `normaliseDoi` in `src/paper-metadata.ts` and `doiOfUrl` in `src/doi-url.ts`: is
   the plan's description of the double-encoding accurate, and is there a legacy-escape ambiguity
   that makes decoding there wrong for some real DOI?
7. **The restored doc.** `git show d6673bebc --stat` shows 261003m shrinking by 297,736 lines. The
   claim is that removing every copy of the pasted block yields the last good version (commit
   `ac9b5bfcf`) plus appended sections. Spot-check it:
   `git diff ac9b5bfcf d6673bebc -- docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md`
   should show additions only.
