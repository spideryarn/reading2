# Stage 3c narrow check findings

## Findings

### WR-S3C-1 — P1 — `tools/overseer/reports.ts:1273`

The follow-up removes pruning, but `refuseItem` still atomically renames every refusal to
`report-refused/<eventId>.json`. Refusing a second, different submission with the same event id therefore
replaces and destroys the first refusal record. That contradicts the follow-up's rule and the reader-facing
documentation that the daemon never deletes a refusal record.

Fixed red-first. `tests/overseer-reports.test.ts:1136` failed with one refusal file where two were expected.
The first refusal keeps the compatible `<eventId>.json` name; a later refusal under that id gets a UUID
suffix, without listing the directory, and the capped reader recognizes both names as the same event id.
The focused test then passed, as did the scoped suite and typecheck.

## Verdicts

- WR-S3-4: **approved** — quarantine is only a bounded, names-only read outside the daemon loop; the loop
  only renames into it, and the capped size and oldest-seen age are explicit in the route, panel and CLI.
- WR-S3-5: **approved** — inbox, processing, refused and quarantine enumeration is lazy and capped; file
  parsing is separately capped; every exposed count retains its `exact` or `atLeast` arm through schema 2.
- Overall: **approved to land**.

## Checks

- New same-event-id refusal test: failed first (`expected length 2, got 1`), then passed.
- Scoped Stage 3c/route/client/panel/doc suite with the two sandboxed subprocess cases excluded: 9 files,
  235 passed, 2 skipped, exit 0.
- `node --import tsx scripts/typecheck.ts`: all four projects and 1,993 covered source files, exit 0.
- `npm run build:fleet`: exit 0. Scoped Biome lint: exit 0 (pre-existing informational advice only).
  `git diff --check`: exit 0.

Outside this narrow verdict: the unrestricted run also hit `spawnSync mkfifo EPERM` and the brief's
expected `spawnSync git EPERM`. `tests/fleet-attention.test.ts` has one unrelated failure introduced by
the later `c68a7e25` merge's schedule imports; neither requested Stage 3c commit changes that guard.
