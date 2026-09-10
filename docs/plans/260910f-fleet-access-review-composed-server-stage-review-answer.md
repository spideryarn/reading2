Final verdict: **accept after fixes**. No remaining in-scope P0–P2 findings. Nothing was committed.

Findings F11–F16 are recorded in [the review findings](</home/greg/code/spideryarn2/.claude/worktrees/fleet-access-review/docs/plans/260910f-fleet-access-review-composed-server-stage-review-answer-findings.md>):

- F11 P1: detached server survived its test runner. Fixed with an IPC-watched owner process.
- F12 P1: malformed Host authorities such as `evil.example@localhost` passed. Fixed with strict raw-authority validation.
- F13 P2: duplicate Host fields were normalized before validation. Fixed by counting `rawHeaders`.
- F14 P2: callers could override the helper’s isolation environment. Removed the arbitrary environment option.
- F15 P2: DELETE `/api/actions/cancel` was absent from the Origin matrix. Added.
- F16 P2: malformed `.ts.net` names passed. Added per-label validation and length limits.

`HEAD /api/messages` still performs the bounded transcript read for an existing row. It is unnecessary I/O but read-only, side-effect-free, and compatible with HEAD semantics, so I did not enlarge this stage to change it.

Verification:

- Focused runnable suite: 80 tests passed.
- Full typecheck: all four projects, 2,012 source files.
- Lint exited 0 with existing advisories.
- Independent Sol review: accepted; no additional findings or edits.
- Composed HTTP tests could not bind loopback here (`EPERM`).
- Full `npm test` could not reach the Postgres test service in this sandbox.

The new composed cases therefore still need one unsandboxed run.

Files changed:

- `docs/plans/260910f-fleet-access-review-composed-server-stage-review-answer-findings.md`
- `tools/fleet/server.ts`
- `tools/fleet/origin.ts`
- `tests/fleet-composed-access.test.ts`
- `tests/fleet-origin.test.ts`
- `tests/fleet-decisions-route.test.ts`
- `tests/fleet-reports-route.test.ts`
- `tests/helpers/fleet-child-server.ts`
- `tests/helpers/fleet-child-owner.mjs`
- `tests/helpers/fleet-child-orphan-parent.ts`