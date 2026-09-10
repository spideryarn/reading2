# Stage 3c task — two bounds the Stage 3 review left open (plan 260910e)

You are fixing the two findings GPT Sol's Stage 3 review left open, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. Work only there. Read first:
`docs/plans/260910e-work-reports-stage3-review-sol-findings.md` (WR-S3-4 and WR-S3-5), the plan
`docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md` (design section and the
Stage 3 status paragraphs), and the code: `tools/overseer/reports.ts` (the drain's scan and quarantine,
`readInbox`), `tools/fleet/reports-view.ts`, `tools/fleet/routes-reports.ts`, the `ReportsFeed` block at
the end of `tools/fleet/wire.ts`, `tools/fleet/web/src/reports-client.ts`, the Claims section of
`tools/fleet/web/src/DecisionsPanel.tsx`, and the `reports` command in `scripts/overseer.ts`.

The rule both fixes serve: **nothing on a request path or in the daemon's loop may do work proportional
to what an untrusted writer put in `~/.overseer/`.**

## WR-S3-4 (P0) — the daemon never deletes from quarantine

Today quarantine pruning keeps the newest 200 and removes the rest with `rmSync(…, { recursive: true })`,
so one quarantined directory holding a huge tree can wedge the synchronous daemon. **The decided fix
(orchestrator, 2026-09-10) is the simpler one, not a budgeted cleanup protocol: remove automatic pruning
entirely.** Moving an entry into `report-quarantine/` costs no new disk — it is what the writer already
put there — so there is nothing the daemon needs to reclaim, and deleting someone else's files was never
the daemon's job. Emptying the quarantine is a person's act.

- Delete the pruning code and its constant; the drain only ever `rename`s into quarantine. Keep the
  process-monotonic batch stamps Sol added in WR-S3-3 if they still serve naming; remove them if nothing
  reads the order any more, and say which.
- The drain must not list `report-quarantine/` at all.
- Update the comments and the plan text that promise "newest 200 kept" (in `reports.ts` only; the
  orchestrator updates the plan), and the quarantine sentence in `docs/project/work-reports.md`: the
  quarantine is never emptied automatically; look at it, then delete it.
- **The one cost, made visible (the Overseer, 2026-09-10):** the quarantine grows until someone empties it,
  so growth must show rather than be silent. `readInbox` reports the quarantine's size and the age of its
  oldest entry — read under the same cap as WR-S3-5 below, so the count is `{ exact } | { atLeast }` and
  the age is "oldest seen" when capped (the entry's mtime at the moment it was moved is its name's stamp, so
  read the stamp from the name rather than `stat`-ing anything). The Claims section says it in a sentence —
  "12 entries quarantined, the oldest 3 days ago; nothing empties it automatically" — and `overseer
  reports` prints the same plus the directory's path. Zero quarantined says nothing at all in the panel.
- Tests, red first: a quarantined directory holding many files is still there, intact, after many passes,
  and no pass touches it; the existing "newest 200" test is replaced by one asserting nothing is deleted;
  the quarantine count and oldest age appear in the route payload, the panel and the CLI, and a capped
  count reads "at least".

## WR-S3-5 (P1) — the dashboard's inbox read is bounded, and says when it was

`readInbox` (used by `GET /api/reports` and by `overseer reports`) lists `report-inbox/`,
`report-processing/`, `report-refused/` whole with `readdirSync` and opens every matching file, so a
flood blocks the fleet server before any response cap applies.

- Give `readInbox` a bound: iterate each directory lazily with `opendirSync`, reading at most a fixed
  number of entries per directory (reuse the drain's `scanEntries` default, 1 000), and parse at most a
  fixed number of files per directory (say 200) with the existing bounded no-follow read. It never opens
  `report-quarantine/`'s contents; if it reports a quarantine count at all, that count is capped the same
  way.
- Every count it returns says whether it was capped: a discriminated value such as
  `{ exact: n } | { atLeast: n }` — **never a bare number that is silently a partial count**, and never an
  empty list standing in for "we stopped looking".
- Carry that through: `reports-view.ts`, the `ReportsFeed` wire types (edit the WORK REPORTS block at the
  end of `wire.ts` only), `reports-client.ts`'s strict parser, the panel ("at least 1 000 submitted, not
  yet recorded"), and `overseer reports` ("AT LEAST …", the spelling `status-cli.ts` already uses for a
  capped inbox count).
- Bump the reports payload schema (`schema: 2`), so an older browser refuses the new shape.
- Tests, red first: a flooded inbox (say 5 000 files) makes `readInbox` read no more than the cap and
  report `atLeast`; the route answers promptly with the capped arm; the client accepts both arms and
  refuses a bare number; the panel renders "at least"; the CLI prints "AT LEAST"; an unflooded inbox still
  reports `exact`.

## Gates, then stop

`tests/overseer-reports*.test.ts`, `tests/overseer-daemon-reports.test.ts`, `tests/fleet-reports-*`,
`tests/fleet-decisions-panel.test.tsx`, `tests/fleet-attention.test.ts`, `tests/doc-links.test.ts`,
`npm run build:fleet`, `npm run typecheck` (read the exit code), `npx biome lint <files you touched>`. One
vitest process at a time (the box is short of memory). Not the full suite. **Do not commit.** Files you
may touch: the seven named above, `docs/project/work-reports.md`, and their tests. Anything else: stop
and say so.

Report back briefly: files changed; each test and whether you saw it red first; gate results with exit
codes; decisions you made; anything left undone. Conclusions, not file contents.
