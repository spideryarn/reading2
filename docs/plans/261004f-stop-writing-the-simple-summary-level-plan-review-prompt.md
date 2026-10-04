# Plan review: stop writing the Simple summary level

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- Base: `1698c6448` (dev). Worktree: this directory.
- One untracked file is the candidate:
  `docs/plans/261004f-stop-writing-the-simple-summary-level.md`. Read it first.
- Nothing is built yet. The code it describes is as it is on the base.

## Start with (does not limit scope)

- `src/simple-summary.ts` (the writer; the whole file)
- `src/types.ts` from `SIMPLE_LEVELS` to `SimpleSummaryFound` (the stored contract and its guards)
- `src/public/dto.ts` § `publicSimpleSummary`, `src/public-types.ts` § `PublicSimpleSummary`
- `src/store/pg.ts`, `src/store/artifacts.ts`, `src/store/export-bundle.ts`: every caller of
  `isUsableSimpleSummary`
- `src/web/SimplePanel.tsx`, `src/web/useSimple.ts`, `src/web/params.ts` § `SUMMARY_VIEWS`
- `docs/project/summaries.md`

## What to attack, independently

The decision is Greg's and is not under review: the middle level is removed, not kept dormant, and
no stored summary may be rewritten, migrated or made to read as absent.

1. Is there any reader of a stored or public summary that will misbehave on an **old row** (three
   levels, and `check.levels` with three) or on a **new row** (two)? Name the exact path.
2. Is keeping `simple/2` and `simple-prompt/7` right? Find anything that compares, hashes or
   stamps something this change moves (the pipeline stamp, `outdated`, `stale`, Metadata, the
   export/import round trip, the store-migration witness, shared inventories, generated catalogues).
3. The writer after the change: Fuller first, Brief waiting on its stream. Is there any path in
   `generateSimpleSummary` that only worked because there were two waiters, or an off-by-one in
   anything indexed by level position?
4. Anything outside `src/` that names the level and will break a gate: tests, evals, scripts,
   fixtures, generated JSON.
5. Is anything the plan calls unchanged actually changed by it?

Run one test file yourself if it helps: `npx vitest run tests/simple-summary.test.ts` needs nothing
outside the tree. You have no network and no Postgres.

## Output

Findings with stable IDs `F1`, `F2`, …, each graded by consequence:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Say for each whether it is **established** (direct evidence, an exact source path) or **reasoned**.
End with a verdict: approve, or refuse (only on an established P0 or P1).

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The loosening in § Stored rows: an old row with an over-limit Simple level becomes usable.
- `tests/public-dto.test.ts` pins the public key list; other pinned inventories may exist.
- `evals/simple/probe.ts` records `words` and `paragraphs` from the Simple level; I plan to drop
  those two fields from new result files.
