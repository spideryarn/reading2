No blocking findings. F10–F13 hold. One prose finding:

**F15 — P3 — ESTABLISHED:** The [pass-counter comment](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tests/overseer-daemon-restart-no-double-dispatch.test.ts:75) overstates “one verdict line per definition per pass.” A failed start acknowledgement produces both `dispatched` and `NOT DISPATCHED`; the helper counts both. Supersession can also add reports. The count **is exact on the paths these restart tests count**, including held and not-due; the deliberate lock-loss run does not use it. Advisory wording: “For this fixture’s successful-store paths, each pass logs one verdict line.”

| Fix | Result |
|---|---|
| **F10** | Holds. Empty or header-only `swapon` output becomes `none`, which admission accepts. Unknown load, memory or swap refuses admission. |
| **F11** | Holds. Every unproven generation starts with empty waits while preserving cached verdicts. This covers consecutive null readings and mismatched brackets. |
| **F12** | Holds. The scanner recognises value import-equals under both module spellings and excludes type-only forms. |
| **F13** | Holds. Abort or halt during the probe prevents folding its inventory and requesting another payload; breaking closes the iterator. |

For F10, a healthy minimal container **could** remain refused if required commands are missing or their output does not match these Linux parsers. That follows from the explicit unknown-reading contract. No configured swap, by itself, does not cause that problem.

For F13, no shutdown path depends on a message being processed after abort. There is no source-ended message arm. Timer cleanup, settlement of outstanding work, the final `daemon-stopped` note and lock release occur outside the source-message switch. The default arm detects an unsupported message; it performs no shutdown work.

The Stage 5 timing claims hold for the assertions concerned:

- The watchdog runs synchronously inside the heartbeat callback.
- Recovery is **started** there, runs asynchronously and skips overlapping passes. Heartbeats therefore do not generally prove completed recovery passes. In the converted held-request test, however, the initial announcement has already arrived; subsequent held-index passes perform no further awaited inbox count, so the counted ticks exercise the relevant branch.
- Between these scripted yields, payload folding cannot increment the checkpoint counter; recovery-view writes use `tick: false`. Thus `tickAfter` identifies the heartbeat opportunities these tests need.

All five retained sleeps have valid purposes:

| Sleep | Reason checked |
|---|---|
| General daemon, 40 ms | Allows heartbeat detection of lock loss; the outcome assertion fails if detection never happens. |
| Restart daemon, 40 ms | Same lock-loss case; further scheduler passes cease once halted. |
| Recovery stat, 20 ms | Deliberately makes the evidence operation slower than the configured heartbeat interval. |
| Recovery deadline, 3000 ms | Bounds the shutdown regression test; it is not evidence that a callback ran. |
| Recovery after-stop, 100 ms | Checks that the previously demonstrated report timer stays stopped after return. |

**No converted test drops a behavioral assertion.** The predicates retain the original outcomes and make callback execution explicit. Removing the three 20-second test overrides uses the repository’s 30-second default; it does not weaken a shutdown-bound assertion.

Validation: **8 files, 143 tests passed**. `npm run typecheck` hit the known `tsx` IPC `listen EPERM`; `node --import tsx scripts/typecheck.ts` passed all four projects and source-coverage checks.

Changes: **none**. Red output: none—no behavioral fix was needed. No commits or postmortems written.

**LAND**

---

Up: [the plan](261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
