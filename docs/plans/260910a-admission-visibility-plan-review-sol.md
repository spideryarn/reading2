Verdict: **REFUSE as written.** F1–F5 are established P1s; no P0s. Reviewed candidate SHA-256 `369db4f9…26443`.

### Findings

**F1 — P1 — established: the panel labels a forecast as enforcement**

(a) The plan sends `enforcement: "enforced"` for a dashboard request ([plan:216](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:216)), but this request stops nothing. Enforcement happens only when an actual Vitest process evaluates the config and throws ([vitest.config.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/vitest.config.ts:114)). Worse, `reduced` is only a config default: `--maxWorkers` can override it ([vitest.config.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/vitest.config.ts:97)). Thus “reduced · enforced” is a true number under a false label.

`resolveParallelWorkers()` also consumes `VITEST_MAX_WORKERS` by deleting it ([vitest-admission.ts:353](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/vitest-admission.ts:353)). A dashboard service started with that variable could answer differently on its first and second GET, while neither answer necessarily describes a future shell’s environment.

(b) Replace the visible contract with:

> **Gate forecast — this panel admitted or refused nothing.** For the memory reading taken at `<time>`, the gate returned `<outcome>`. A test using this repo’s Vitest config asks again when it starts; only that run’s in-process refusal stops it. A reduced worker count is the config default and `--maxWorkers` may override it.

Carry a server-side evaluation timestamp, poll or refresh it, and do not name the forecast’s enforcement field `"enforced"`.

---

**F2 — P1 — established: review/browser advice uses the wrong workload model**

(a) Review and browser requests are passed through Vitest’s fixed-plus-worker model ([plan:218](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:218)), while the plan simultaneously establishes that neither has a measured cost and that `cost` is ignored ([plan:223](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:223)). A small review and a large browser job therefore receive the same “wait” or “proceed” advice based on a test-suite cost.

“Advisory” says nobody enforces the answer; it does not make the answer relevant.

(b) Keep the typed categories if the roadmap requires them, but return this for non-test kinds:

```text
unknown / not-modelled — no measured cost model or launch gate exists for this kind
```

Do not call `decideAdmission` for review/browser until their costs have been measured. The current route only needs to answer the default test forecast.

---

**F3 — P1 — established: the proposed census does not satisfy “show active heavy jobs”**

(a) The authoritative stage requires active heavy tests, reviews and browser jobs ([roadmap:1128](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1128)). The chosen data instead reports process counts grouped by a keyword anywhere in argv. Its own contract says this deliberately misclassifies Chrome-flavoured commands as browsers ([health.ts:300](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health.ts:300)). The plan explicitly says reviews cannot be shown and counts are not jobs ([plan:163](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:163)).

Consequently the heading “What heavy work is already running?” promises information the section does not have.

(b) Either:

- add the bounded, on-demand job-aware census in the new route, reporting only confidently classified job roots plus explicit uncertain/unclassified arms; or
- rename this to “Recent process-group memory attribution,” and mark the roadmap’s heavy-jobs checkbox unmet pending a spec change.

A caveat beneath the wrong heading is insufficient.

---

**F4 — P1 — established: historical replay is not exact for every stored sample**

(a) The plan says every sample carries memory and swap values and that the reconstructed decision is exact ([plan:243](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:243)). The durable contract says otherwise:

- samples may be `collector-failed` or `sample-omitted` ([health-history.ts:137](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health-history.ts:137));
- persisted reports are deliberately only `Record<string, unknown>` across version boundaries ([health-history.ts:152](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health-history.ts:152));
- memory itself has an `unknown` arm ([health.ts:65](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health.ts:65)).

A failed `free` command does not establish that `/proc/meminfo` would have failed. Converting that case into the gate’s `broken` snapshot would manufacture a refusal.

The current file happens to contain 1,822 readable memory samples, but the design must obey the stored union rather than today’s contents.

(b) Specify a replay union:

- finite stored `memory.availableBytes` → replayable decision;
- collector failure, omitted sample, missing/unknown/new memory shape → `admission-unknown`;
- absent history/corrupt holes → unobserved.

Use separate totals for “health observed” and “admission replayable.” Replace the proposed copy with:

> For samples containing a readable stored memory value, this applies today’s policy to that recorded value. Other samples are admission-unknown. These are sampled counterfactuals, not decisions made by a run.

Intervals must reuse one canonical coverage calculation; duplicating `coverageMs` and hole subtraction from [history-series.ts:507](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/history-series.ts:507) would let the history chart and refusal totals disagree.

---

**F5 — P1 — established: a durable refusal exists, while the roadmap’s actual “last refusal” is replaced**

(a) The statement that no refusal is durably recorded is false ([plan:233](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:233)). There is a real refusal at [grfd-check3…log:80](/home/greg/code/spideryarn2/logs/tmux-jobs/grfd-check3-0934-2389191.log:80). This is not accidental: `tmux-job.ts` opens a log before running the command specifically so output survives the pane ([tmux-job.ts:24](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/scripts/tmux-job.ts:24)). Refusals also survive in Claude/Codex transcripts.

Those traces are scattered, incomplete and disposable, so they are not an authoritative journal. But the plan cannot claim they do not exist. It also substitutes “latest would-refuse interval” for the roadmap’s “last refusal.”

(b) Replace the premise with:

> No complete, centralized admission-refusal journal exists. Some refusals survive incidentally in tmux-job logs and agent transcripts, but those sources are incomplete and are not a stable fleet API.

Rename this output “Would-refuse history.” Either amend the roadmap checkbox accordingly or mark actual “last refusal” deferred until a centralized writer is authorized. Do not present the replay as satisfying that checkbox.

---

**F6 — P2 — established: the cost claim is disproved on this box**

(a) The plan calls the scan “well under” the roughly 7 ms ceiling ([plan:271](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:271)). Twenty reads of the current 1.8 MiB store measured:

- median: **18.85 ms**
- worst: **26.65 ms**
- returned samples in the 24-hour window: **1,346**

The store can read both 8 MiB files and repeat both reads if rotation occurs during the scan ([health-history.ts:776](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health-history.ts:776)). Opening Box health would also trigger the existing history request, creating two scans.

(b) Remove “well under.” Benchmark a synthetic maximum-sized store, including the rotation retry. If it remains above the dashboard’s ceiling, avoid a second scan through a cached/in-memory projection or move the work off the request event loop.

---

**F7 — P2 — established: the future request shape discards the identity and clock contracts already present**

(a) `AdmissionOwner.pid` is weaker than the existing `ExecutionToken`, which includes boot identity and process start ticks specifically because a PID alone is reusable ([wire.ts:1698](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/wire.ts:1698)). The next roadmap stage explicitly requires process-start identity ([roadmap:1142](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1142)).

The proposed `requestedAtMs` is the caller’s clock and is intended for future queue sorting ([plan:203](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:203)). Existing route design explicitly uses the server’s clock because browser clocks drift ([routes-health-history.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/routes-health-history.ts:97)).

(b) Reuse `ExecutionToken | null`; do not introduce a raw-PID ownership vocabulary. Rename caller time to `requestedAtClientMs` and make it diagnostic only, or omit it. Any future ordering field must be stamped by the admission owner as `receivedAtMs`.

### Answers to the six suspicions

1. “No durable record anywhere” is false; “no complete, centralized journal” is accurate.
2. The replay sentence is false for non-reading, omitted, unknown and older-schema samples, and “exact at that moment” is too strong.
3. `refused` is faithful only as “the gate would refuse this snapshot.” It becomes misleading when paired with an `enforced` label or phrased as an event.
4. The mismatch literal is still a useful tripwire, but not a meaningful guard. Prefer an explicit version-indexed explanation map that fails closed on an unrecognised policy, plus semantic tests; do not rely on somebody thoughtfully incrementing two numbers.
5. The generic process census is short of the roadmap’s heavy-jobs requirement.
6. Keep browser verification and the corrected replay. Drop review/browser scoring and the speculative query/owner machinery; types-only preparation is enough until the next stage has real costs and an admission owner.

No files were changed. The focused Vitest file could not start because the sandbox would not create the absent `node_modules/.vite-temp` directory; the direct gate probe succeeded and currently returns `admit`, nominal 2, capacity 52.