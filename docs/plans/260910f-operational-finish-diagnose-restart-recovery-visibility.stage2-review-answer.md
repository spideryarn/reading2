## Findings

- **F40 — P1 — established:** unreadable job definitions can still render **“the same list this checkout builds.”** In `3c69ddcd:tools/overseer/diagnose.ts:592-600`, `standingJobs(...).problems` and `ruleJobs(...).problems` are discarded. Against an empty checkout, both builders reported missing files but `diagnose` hashed the resulting empty list as `711bf371ba7e`; a daemon preview containing that empty hash then printed “the same list this checkout builds.” This violates the no-match-from-an-unreadable-read contract.  
  **(a)** Reproduction output: `{"emptyHash":"711bf371ba7e","diagnoseBuilt":"711bf371ba7e","equal":true}` followed by the false “same list” sentence.  
  **(b)** Carry a discriminated built-list result containing either a revision or the builders’ problems; prohibit comparison and render “this checkout’s list could not be built” whenever either builder reports a problem.

- **F41 — P1 — established:** a valid legacy `cli-state.json` is reported as a schema mismatch. `parseCliState` deliberately accepts `{mine:[], paused:[]}` without a schema as legacy schema 1, but `fileRow` at `diagnose.ts:340-346` treats every `none-declared` value as a mismatch.  
  **(a)** The real parser returned `{"kind":"read","state":{"mine":[],"paused":[]}}`; diagnose printed `no schema declared ✗ MISMATCH — this build reads 1`.  
  **(b)** Add per-file metadata for accepted undeclared legacy formats and render this one as “no schema declared; accepted as legacy schema 1.” Do not make undeclared schemas match globally.

- **F42 — P1 — established:** the “every store file” census is a fixed, incomplete allow-list. `STORE_FILES` at `diagnose.ts:83-100` omits real files including `armed.json`, `usage.prev.jsonl`, `reconcile-occurrences.json`, `cli-state.lock`, `decisions.lock`, `queue.lock`, and the `.created` loss markers.  
  **(a)** A scratch store containing `armed.json` and `decisions.created` produced no row for either.  
  **(b)** Probe the union of the known schema catalogue and actual directory entries. Unknown names should still receive size/age/type rows with no claimed known schema.

- **F43 — P1 — established:** a checkpoint dated arbitrarily far in the future is classified as `RUNNING`. `daemonStanding` only tests `ageMs > STALL_AFTER_MS`; a negative age passes as healthy.  
  **(a)** With `now=2026-09-10`, `writtenAt=2036-09-10`, and `alive=true`, it returned `state: "running"` and `last written in the future ago`.  
  **(b)** Treat a future checkpoint clock as `cannot-tell`/clock anomaly before the liveness classification; apply the same explicit anomaly treatment to the displayed tick and snapshot clocks.

- **F44 — P1 — established:** a boot mismatch overclaims that “the daemon has not run since the reboot.” `bootOf` compares only `recovery.json` with the host boot, while that recovery boot is advanced only after an accepted collection. A newly started daemon can already have written a fresh checkpoint on the new boot while recovery still names the old boot.  
  **(a)** A current `new-daemon` start/checkpoint plus old recovery boot and new host boot rendered exactly that false sentence.  
  **(b)** Say only that `recovery.json` has not yet recorded the current boot and may predate the first accepted collection. Do not infer whether the daemon has started.

- **F45 — P1 — established:** `RUNNING` proves only that some process currently owns the checkpoint’s PID. Neither the lock nor process start identity is checked; PID reuse therefore turns a killed daemon’s fresh checkpoint into a running verdict.  
  **(a)** A one-second-old checkpoint for PID 4242 with `alive=()=>true`, no lock reading, and no stopping note returned `RUNNING`.  
  **(b)** Until process identity is verified, render “PID present, checkpoint fresh” rather than `RUNNING`; alternatively record and compare a process-start identity from `/proc`, not merely PID existence.

Verdict: **request changes** on the established P1s.

The store path is otherwise read-only: importing `daemon.ts` has no module-scope action; `readNotes` does not call the torn-tail repair; checkpoint, recovery, schedule, and note readers take no locks and perform no writes. The 64-KB JSONL case also fails safely: a final line larger than the tail window produces unknown schema/`lastLineAt`, not a fabricated older value.

The successful-read job construction exactly matches `schedulerWiring`; F40 is specifically the discarded failure side-channel. The candidate snapshot’s own focused suite passed **21/21**. No repository file was changed, and the requested findings file could not be created because the repository is read-only.