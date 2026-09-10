# Review: a plan to put the existing test-admission decision on the fleet dashboard, read-only

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree of
the spideryarn2 repo), branch `worktree-admission-visibility`. TypeScript + ESM throughout, run with
`tsx`, tested with vitest. This is a plan review: **no code has been written yet.**

## The candidate

Live pre-commit; the candidate is one new document and nothing else.

- base: `b341a8c4` (the tip of `origin/dev` this worktree contains)
- scoped paths: none tracked yet
- untracked: `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md`,
  and this prompt file
- (not durable — I will record the resulting commit SHA in the plan once it lands)

**Start with the plan doc itself.** The code it describes does not exist. The files it proposes to
reuse do, and they are where the plan can be checked against reality:

- `vitest-admission.ts` — the gate, at the repo root. Its header is long and is the authority on
  what the gate is and is not.
- `tests/vitest-memory-admission.test.ts`, `tests/vitest-worker-caps.test.ts` — its tests.
- `vitest.config.ts` — the one place the gate is enforced.
- `tools/fleet/health.ts` — the box's health collector (`parseMemory`, `parseAttribution`).
- `tools/fleet/health-history.ts`, `tools/fleet/routes-health-history.ts`,
  `tools/fleet/health-wiring.ts` — the on-disk 24h history, its route, and its composition root.
  These are the structural exemplars the plan says it copies.
- `tools/fleet/readiness-loop.ts` and `scripts/readiness-loop.ts` — the only other caller of
  `decideAdmission`.
- `docs/project/fleet-dashboard-modes.md` — the house rules for adding anything to this dashboard.
- `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md`, the section
  "Stage: Admission visibility — reuse the gate already present" (search for it) — **this is the
  spec the plan must satisfy**, and the stage after it ("Enforced launch admission") is the boundary
  the plan must not cross.

That reading list is where to begin, not the limit of scope.

## What it is meant to do

The box (a shared 16-core Hetzner machine running a dozen agent sessions) already refuses test runs
it has no memory for: `vitest-admission.ts`, evaluated inside the process that is about to run
tests. Nobody can see that decision — it lives for milliseconds and then either tests run or a
paragraph is printed into one tmux pane.

The plan adds a **read-only** explanation of the *same* decision to the existing "Box health" tab of
the fleet dashboard: what would be admitted / reduced / refused / not-applicable / unknown right
now and why, what heavy work is running, and when over the last 24 hours the box would have refused.

**The invariant that must not break, and it is the whole thing:** this feature must not make any
claim of enforcement, reservation or coordination that does not exist. Nothing in this repo today
reserves capacity, locks, or queues; the only enforcement anywhere is the gate refusing a run from
inside that run's own process. Every sentence on the page has to remain true when read strictly.

**Deliberately out of scope:** the next roadmap stage — an admission owner with atomic reservations,
recorded launches, and enforcement across `run-codex` / `run-claude` / browser jobs. The plan may
prepare types for it but must not build it, and must not imply it exists.

Constraints the plan is working under, from the dispatch brief:

- `vitest-admission.ts` may be read and may be changed **only** to export its decision and policy
  revision — never its thresholds. (The plan currently proposes changing it not at all.)
- New code goes in a new `tools/fleet/routes-*.ts`, one new client module and one section in the
  dashboard client, types-only additions to `tools/fleet/wire.ts`, plus tests.
- Off limits, because other sessions own them: `tools/overseer/`, `scripts/gjd-remote.ts`,
  `scripts/claude-accounts.ts`, `tools/fleet/collect.ts`, `tools/fleet/routes-actions.ts`,
  `tools/fleet/routes-new.ts`, and the readiness files.
- The live dashboard on port 8787 must not be restarted, killed or reconfigured.

## What you can and cannot run, and what you may change

**The tree is read-only. Do not change any file.** This is a plan review.

`/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can
build a throwaway harness under `/tmp`. There is no network. Postgres-backed suites will not run;
none of the files above needs one.

You are on the machine the plan is about, so `/proc/meminfo`, `free -b`, `ps` and
`~/.config/spideryarn/` are real and readable, and `~/.fleet-health/` holds the real history the
plan proposes to replay. Reading any of those is fair game and probably the fastest way to check
several of the plan's factual claims.

## Attack it

Independently, before you read my questions below.

**The invariant to break: find a sentence the plan proposes to put on screen, or a name it proposes
to use, that would be false or that a reader would reasonably misread as a promise of enforcement,
coordination or record-keeping that does not exist.** The plan is one long argument that it is
careful about this; test that.

Second, and equally: **check the plan's factual claims about the tree against the tree.** It asserts
things about what `decideAdmission` returns, about what is and is not recorded on disk, about what
`health.ts` measures, about what the dashboard already pushes to the browser, and about costs. Any
of those being wrong changes the design, not the wording.

For each finding give:

- an ID (`F1`, `F2`, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract (a file in this
  repo, or the roadmap stage above) that it contradicts — with the path and line
- (b) the smallest change that closes it — exact replacement wording for the plan, or the design
  change it needs

A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A defect in this plan that will cause a P1 to ship is not a P3 because it is made of prose. Note
that "user-visible wrong behaviour" here includes **a true number under a false label**, which is
this feature's characteristic failure mode.

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. **§6, "no admission refusal is durably recorded anywhere on this box".** This is the load-bearing
   premise of the whole "last refusal" design, and I established it by grepping rather than by
   proving a negative. If there *is* a durable record — in `~/.fleet-readiness/`, in a tmux-log
   parser, in the Overseer's checkpoint, anywhere — then §6 should read it instead of replaying, and
   the plan is wrong in an expensive way. **Is the statement accurate?**

2. **§6's replay, stated at its true strength.** The claim I want checked is not "is the replay
   sound" but this exact sentence: *"replaying `decideAdmission` over `~/.fleet-health/` samples,
   using today's reserve and today's policy, yields for each sample the decision the gate would have
   returned at that moment, except that the swap figures inside a refusal message are
   reconstructed rather than recorded."* Is **that statement** accurate? I measured the
   `free -b` ↔ `MemAvailable` equality on this box (0.005% apart) and wrote the measurement into the
   plan; I have not checked what a `sample-omitted` or `collector-failed` line, or a `memory`
   reading of `kind: "unknown"`, does to the replay's arithmetic, and I think that is where it
   breaks.

3. **The `refused` / `unknown` split.** The plan insists that an unreadable `/proc/meminfo` on an
   opted-in Linux box renders as **refused**, not unknown, because that is the gate's own choice.
   I believe following the gate is right even though "we could not measure" instinctively reads as
   unknown. Is there a reading under which this misleads someone into thinking a *run* was refused
   when in fact nothing tried to run? (Note the panel is describing a hypothetical, not an event.)

4. **The policy-version mismatch mechanism.** A literal `EXPLAINED_POLICY_VERSION` in my module
   compared against the gate's `ADMISSION_POLICY_VERSION`. My worry is that it is a check nobody
   will ever satisfy correctly: the person bumping the gate has no reason to look at my file, so the
   mismatch banner will appear and then be cleared by somebody who just makes the numbers equal
   without re-reading the prose. Is there a version of this that fails usefully rather than
   ceremonially — or is the ceremonial one still worth having?

5. **§4, reusing `health.ts`'s `ps` attribution instead of building an admission-aware census.**
   I chose reuse plus a stated gap ("a codex review is indistinguishable from any other node
   process"). The roadmap checkbox asks to "show active heavy tests/reviews/browser jobs", and
   under my design **reviews are not shown at all** — only named as unshowable. Is that inside the
   acceptance sentence ("an agent and Greg can find out why work should wait") or short of it?

6. **Scope.** Three stages, two of them delegated to you to implement. Is there a stage here that
   should be dropped entirely — something that is ceremony rather than value — given that the next
   roadmap stage may replace parts of it?

Do not change any file.
