# Review prompt: the get-ready-to-deploy sweep of 2026-09-05

Please review a small candidate. It is **live and pre-commit**, so it names a tree, not bytes.

## The candidate

Base commit: `4cafdd38` (the tip of `dev` after today's pull). Repository
`/home/greg/code/spideryarn2`, branch `dev`.

**Modified, tracked** — read with `git diff -- tests/sse-heartbeat.test.ts`:

- `tests/sse-heartbeat.test.ts`

**New, untracked** (a pathspec cannot name these; read them directly):

- `docs/plans/260905g-get-ready-to-deploy-sweep-fixing-the-publish-guard-and-heartbeat-flake.md`
- `docs/postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md`
- `docs/plans/260905g-sweep-review-prompt.md` (this file — ignore it)

Nothing else in the tree is mine. `.tmp-smoke.mts`, `privacy-1280.png` and `privacy-390.png` are
other agents' untracked scratch, deliberately untouched.

Start with the test file; that does not limit your scope.

## What the work was

A [get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) sweep found the `npm run check` test
gate red in two unrelated ways.

**One — `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts`.** Both died in `beforeAll`
with `PublishRefused: … n0054 → n0055: covers its parent's whole range …`. Root cause: both suites
deliberately read the **gitignored** working `data/` directory, and `data/source/tree.json` on this
box was generated 2026-08-26, ten days before commit `c8e2cc7e` added that invariant to
`src/tree-invariants.ts`. The tree was genuinely malformed. **No repository file was changed for
this** — the fix was splicing the redundant rung out of that gitignored local artefact, matching
what `collapseRestatedRungs` (`src/hierarchy.ts`) does at build time. Afterwards
`npx tsx src/validate-tree.ts data/source` prints `✓ structure is sound`, and the two suites pass
**408 tests, 0 failures**. The analysis and the three ranked durable fixes are the postmortem, which
is the main thing I want read.

**Two — `tests/sse-heartbeat.test.ts`.** One test was load-flaky. It ran a 15ms heartbeat for a
fixed 120ms of wall clock and asserted at least 3 pings arrived; inside the full parallel suite a
saturated event loop delivered 2 and the gate went red over a working heartbeat. The change replaces
the fixed window with a condition: beat until N pings have actually been written, then stop, write
the trailing frame and end. A loaded box now takes longer instead of failing; a heartbeat that never
fires still fails, by hanging to vitest's timeout.

## Evidence already gathered

Run `npx vitest run tests/sse-heartbeat.test.ts` yourself — it needs no network, no Postgres and no
local service, and it is the one thing here you can reproduce directly. Please do.

The two Postgres suites are **not** runnable in your sandbox. Their raw result, run by me:

```
$ REQUIRE_POSTGRES=1 npx vitest run --project private-postgres \
    tests/store-parity.test.ts tests/store-roundtrip.test.ts
 Test Files  2 passed (2)
      Tests  408 passed (408)
   Duration  48.53s
```

On the flaky test, measured today:

- Old code, before the change: 5 runs of the file alone, 5 passes — it only failed in the full suite.
- Old code with `everyMs` stretched 15→60 to simulate a starved loop:
  `AssertionError: expected 1 to be greater than or equal to 3` — the same shape as the gate failure.
- New code, same 60ms stretch: passes, just slower.
- New code with `heartbeat` stubbed to write nothing: `Test timed out in 30000ms` — so the loosened
  test still catches a dead heartbeat, which is the failure the file exists for.
- New code: 11/11 passes by a subagent (7 at the box's ambient load ~16/16 cores, 4 with 32 extra
  busy-loops, load 25→41), plus 5/5 by me with 48 busy-loops on 16 cores, load average 41→97.
- `npx tsc --noEmit -p tests/tsconfig.json` exits 0; `npx biome lint tests/sse-heartbeat.test.ts` clean.

## What I want from you

An independent pass. Attack the candidate before reading my doubts below.

Two things matter most:

1. **Is the new test still a real check?** It counts `: ping` frames out of the body the HTTP client
   read, but the server now stops *because* N pings were written. Has the assertion become
   tautological — can it still fail for any reason a person would want to know about? If it has lost
   real power, say what it should assert instead.
2. **Is the postmortem's reasoning sound and are its factual claims true?** Especially its ranked
   item 3, which asserts there is **no repair path for an already-stored tree**, so an article
   published before 2026-09-05 could meet `PublishRefused` on its next deepen or re-extraction with
   no way forward. I could not reach the production database from this box to check incidence.
   Verify the claim against the code (`src/hierarchy.ts`, `src/store/pg-revisions.ts`,
   `src/tree-invariants.ts`, `src/pipeline.ts`) and tell me if I am wrong, or if the consequence is
   worse or milder than I say. A doc defect that would cause a P1 to ship is graded as that P1, not
   as a P3.

Also worth your attention: whether "fix the local data, change nothing in the repo" was the right
call at all, or whether something in the repository should have changed too.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (`F1`, `F2`, …), a severity, and the file and line it is about. Refuse only
on an **established** P0 or P1 — direct evidence with no unresolved material inference. Finish with
an explicit verdict line.

## My own suspicions — these are already mine, and worth less

Spend most of the run elsewhere. But if nothing better turns up:

- The `res.write` wrapper in `beatUntil` narrows the signature to `(chunk: string)` and drops the
  `encoding`/`callback` overloads. Every write in this file is single-argument, so I let it stand.
  Is there a path where Node itself calls `res.write` with more, and would that matter here?
- Ending the response inside `beaten.then(...)` rather than a `setTimeout`. I believe a microtask is
  enough to avoid ending the response from inside its own `write`. Is it?
- The postmortem names two failure classes. Are they the right two, and is the first one — *an
  invariant added without migrating the corpus it will judge* — actually the generalisable one, or
  am I over-fitting to a single stale file on one developer's disk?
