Reviewed `git diff 18017a2ec..3666e3979` independently before requesting the root-cause subagent.
The review is bounded to the requested conversions and invariants. Four findings were reproduced
red before narrow fixes; all fixes below are uncommitted. Nothing was restarted.

**F10 — P1 — ESTABLISHED — incomplete health evidence still authorises launch. Fixed.**

`server.ts` stores `collectHealthAsync`'s report and admission passes that report to
`newSessionHealthLevel` in [routes-new.ts](../../tools/fleet/routes-new.ts). The collector preserves
unknown fields, but `computeVerdict` accepts any readable core field as enough evidence for a
display verdict. Refusing `uptime`, `nproc` and `free` while returning healthy swap produces `ok` at
the launch gate. Moving the survey out of the request removed concurrent request surveys, but did
not close F2's partial-refusal case.

My test used the real asynchronous collector with an injected refusing owner. Red:
`expected 'ok' to be 'unknown'` (expected `unknown`, received `ok`). Admission now returns `unknown`
when load, memory or swap is unknown. The display verdict remains useful partial evidence; the
launch decision requires complete core evidence. Known absence of configured swap remains allowed.
Partial-read admission predates the candidate; it is included because the candidate explicitly
undertook to close F2.

**F11 — P1 — ESTABLISHED — two unproven tmux generations carry old waits. Fixed.**

In [attention-cli.ts](../../tools/overseer/attention-cli.ts), two null/null brackets or successive
mismatched brackets (7/8, then 8/9) both produce `tmux-unknown`. `memoryForEpoch` equates those
strings and preserves `waitingSince`. The same handle can belong to different sessions, yet the
operator sees the previous session's duration. My two deterministic-clock cases both failed:
`expected ['2026-10-04T12:00:00.000Z'] to not deeply equal ['2026-10-04T12:00:00.000Z']`.
Every unproven-generation pass now drops waits while retaining cached text verdicts. The null case
is inherited; mismatched brackets are newly introduced by this conversion.

**F12 — P2 — ESTABLISHED — the guard misses a value-import form. Fixed.**

The scanner in [no-sync-child-in-long-running.test.ts](../../tests/no-sync-child-in-long-running.test.ts)
returned `[]` for `import cp = require("node:child_process")`. Babel represents this as
`TSImportEqualsDeclaration` / `TSExternalModuleReference`, neither a normal import declaration nor
a call expression. The guard scans `.cts` files, so this is within its supported language.
Red: `expected [] to deeply equal ['*']`. It now recognises this form under both module spellings,
with paired type-only controls. No existing offending import through this form was found.

**F13 — P1 — ESTABLISHED — abort skips a fold but continues consuming buffered payloads. Fixed.**

`takeProbed` returned on abort, but its caller in [daemon.ts](../../tools/overseer/daemon.ts) checked
only `halted()` and requested the next source message. The real `readStream` has an inner buffered
frame loop without an abort check. More accepted frames can therefore start more probes after
shutdown was requested; a non-probed frame can still enter `take`. My source-cleanup regression
failed with `expected true to be false` for `askedForNext` (12 passed, 1 failed).
The consumer now checks the signal before handling a message and after the awaited operation,
breaking before requesting another frame. The test verifies generator cleanup and exactly one probe.

**F14 — P3 — ESTABLISHED — the cache-age comment understates the admission window. Advisory.**

[server.ts:463](../../tools/fleet/server.ts) says the gate sees a reading “up to a minute old”,
but `HEALTH_TOO_OLD_MS = nextWaitMs(REFRESH_MS, true) + 2 * REFRESH_MS` permits **420,000 ms**
at the default cadence. The implementation follows the explicitly chosen backoff allowance;
the comment should describe that allowance. No behavioral change made for this prose defect.

The requested plan findings:

| Finding | Candidate closure | Reviewed result |
|---|---|---|
| F2 | **No** | Closed by F10's admission fix; caching alone did not close partial refusal. |
| F3 | **Yes, fold coherence** | Probe before `take`; no await inside the mutation stretch. F13 additionally fixes abort termination. |
| F7 | **Yes** | One lazy process owner; admission reads memory rather than starting a competing survey. |
| F8 | **Yes** | No async `relate` or duplicate relation cache added. |
| F9 | **Yes** | Resolve refs first; build both counts from immutable SHAs. Verified with moving refs. |

The intended work and invariants hold with F10–F13 applied, within the expressly deferred scope:
the flat equality guard now covers the missed TypeScript form; the converted sites use the owned
runner and shared process owner; work-probe's timeout diagnostic quotes elapsed time; `take` stays
synchronous; failed probe outcomes remain uncertainty; admission refuses critical and unknown; and
rename, readiness collection and payload folds each exclude overlap. The guard remains a file list,
not proof that call counts or reachability inside exception files cannot grow.

Additional checks of the supplied suspicions:

- `diff`'s only `held` return is `unplaceable(nextSnapshot)`, before reading previous/known inputs.
  The preview's held decision is therefore valid. Fold-time execution attribution is read afresh.
- Overlapping action scans deliberately refuse. A successful sequential scan has released its
  child keys before returning, so the kill flow's own second scan is not refused by its first.
- Startup health is intentionally unknown. The age budget follows failure backoff; see F14 for
  the comment's understatement of the actual window.
- The synchronous readiness helper's additional ref resolution preserves tuple consistency and
  remains on the exception list for scripts.
- Clock bounds have scheduling slack, but do not constitute a guarantee on an arbitrarily loaded
  machine. I found no new bounded-scope correctness defect in those assertions.

File-by-file review edits:

| File | Change / red evidence |
|---|---|
| `tools/fleet/routes-new.ts` | Refuse incomplete core health; update its explanation. F10 red above. |
| `tests/fleet-new-route-health.test.ts` | Real partial-refusal collector regression, known-no-swap control, updated message assertion. |
| `tools/overseer/attention-cli.ts` | Drop waits on every unproven generation, preserving verdicts. F11 red above. |
| `tests/overseer-attention-cli.test.ts` | Two consecutive-failure regressions with controlled clocks. |
| `tests/no-sync-child-in-long-running.test.ts` | Scanner fix and value/type controls for import-equals. F12 red above. |
| `tools/overseer/daemon.ts` | Abort checks at both consumer boundaries. F13 red above. |
| `tests/overseer-daemon-work.test.ts` | Observe no subsequent payload request, iterator cleanup and probe count on abort. |
| `docs/postmortems/261004c-a-partial-reading-cannot-authorise-the-action-it-failed-to-observe.md` | Root causes and origins of F10/F11. |
| `docs/postmortems/261004d-a-syntax-guard-can-walk-the-whole-tree-and-miss-a-whole-import-form.md` | Root cause and origin of F12. |
| `docs/postmortems/261004e-skipping-an-aborted-fold-does-not-stop-its-consumer-loop.md` | Root cause and origin of F13. |
| This review | Evidence, scope, closure and verdict. |

Verification performed by this reviewer:

- Required three-suite command before edits: **3 files, 39 tests passed**.
- Final eight-suite run (required three plus new-health, attention-probe, attention-cli,
  actions-list-processes and usage-auth-status): **8 files, 84 tests passed**.
- All ten supplied suites were attempted together: **143 passed, 11 failed** before the final
  no-swap control. Eleven failures were synchronous subprocess `EPERM`: three scratch-git cases
  in readiness-async and eight synchronous work-probe cases. Repeating those two files with the
  forks pool produced the same failures. A standalone Node `spawnSync("git", ["--version"])`
  returned status 0 and git-version stdout **with error `EPERM`**, independently establishing the
  sandbox limitation. These suites are not reported green.
- F9 separately passed a real scratch-repository ref-movement proof with asynchronous fixture
  setup: named SHAs retained, `primaryBehind=1`, `trunkGap=2`. Script:
  `/tmp/sweep-c11-readiness-proof.mts`. No remote operation.
- The existing typecheck script passed all four projects and source-coverage checks through
  `node --import tsx scripts/typecheck.ts`. `npm run typecheck` itself was blocked by the `tsx`
  CLI's local IPC socket (`listen EPERM`).
- Scoped Biome lint ran: 4 errors, 1 warning, 26 informational diagnostics; the hard findings are
  existing test-export/control-character rules. No unrelated lint cleanup attempted.
- `git diff --check` passed. No Postgres, server, network or loopback tests run. No full `npm test`.

Peer edits to the daemon ordering, restart and general test files appeared during review. Those are
outside this candidate's scope; I did not edit or include them in my changes. Nothing committed.

**LAND AFTER FIXES (F10, F11, F12, F13 — all applied here, uncommitted; synchronous-fixture suites
need confirmation outside this sandbox).**

Up: [The plan](261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md).
