# Review: Stage 3 of admission visibility — the refusal journal

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest.

**You implemented this stage.** Treat it as unreviewed code written by someone else.

## The candidate

Committed: **`154e084f`**.

    git show 154e084f --stat
    git show 154e084f -- admission-journal.ts vitest.config.ts scripts/readiness-loop.ts

Complete manifest:

    admission-journal.ts                        (new — the whole mechanism)
    vitest.config.ts                            (one call, plus hoisting two readings)
    tools/fleet/readiness-loop.ts               (optional `cause` on the skip arm)
    scripts/readiness-loop.ts                   (one call, plus the same hoisting)
    tools/fleet/routes-admission.ts             (journal field + failure arm)
    tools/fleet/admission-wiring.ts             (production reader)
    tools/fleet/wire.ts                         (journal types)
    tools/fleet/web/src/admission-client.ts     (journal parsing)
    tools/fleet/web/src/AdmissionSection.tsx    (journal block)
    tests/admission-journal.test.ts             (new)
    tests/fleet-admission-{explain,route}.test.ts, tests/fleet-admission-panel.test.tsx
    docs/plans/260910a-stage3-{journal-task,build-answer}.md

Stages 1–2 are on `dev`. **Do not scope by a merge-base range.**

## What changed since you built it

**One defect, and it was in both writers.** `RefusalInput.snapshot` accepted a reader as well as a
value, and `vitest.config.ts` and `scripts/readiness-loop.ts` both passed `readMemorySnapshot` and
`readReserveBytes` themselves — so the journal **re-read `/proc/meminfo` at record time** and wrote a
later sample under the refusal's name. The gap between the two readings is largest under exactly the
memory pressure that produced the refusal, which is the one circumstance the record exists for.

I deleted the thunk from `RefusalInput` so the compiler refuses a reader everywhere, then hoisted
the readings in both callers so each hands over what its own decision was made on. Two tests pin it:
one on the call sites, one asserting a supplied snapshot is what gets written. **Check that repair as
carefully as the rest** — in particular whether hoisting the two reads in `vitest.config.ts` changed
anything about *when* they happen relative to the rest of that function.

## What it is meant to do

Plan: `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md`, **§6 and
§6b**. Its two "Review dispositions" sections carry F1–F35, yours.

The invariants, in order of how badly they fail:

1. **The journal may never break what it observes.** A refusal is already a bad moment; a throw here
   turns "your test run was refused" into "your test run crashed in the config".
2. **It may never lose a line, and may never write an unparseable one.** Many writers, no lock: the
   whole story is one `appendFileSync` under `PIPE_BUF`. A line over the cap is refused, not
   truncated. Pruning is by rename, never rewrite.
3. **Empty means "nothing was recorded", never "nothing was refused."** The panel says what the
   journal cannot see, and absence of evidence is never rendered as evidence of absence.
4. **It records the readings the decision was made on** — see above.

## What you can and cannot run, and what you may change

**You may edit this worktree.** Fix inside this stage, red-first. **Do not commit.** List every file
you changed.

**You are editing `vitest.config.ts`, which every test run in this repo evaluates.** A mistake there
does not fail one suite — it fails all of them, for every agent on this shared box, and the symptom
looks like the admission refusal this feature is about. Any change there must be followed by running
a focused suite to prove the config still evaluates.

Do not touch `vitest-admission.ts`, `tools/fleet/collect.ts`, `routes-actions.ts`, `routes-new.ts`,
`health*.ts`, `actions.ts`, `tools/overseer/`, or the readiness files beyond the two lines already
changed. **Do not touch the dashboard on :8787.** Do not create or write to `~/.fleet-admission/` —
it is the real journal on this box and a test entry there would be a fabricated record.

Runnable: `npx vitest run tests/admission-journal.test.ts tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts tests/fleet-admission-panel.test.tsx`
(94 passing). Typecheck via `node --import tsx scripts/typecheck.ts`. Not the full `npm test`.

## Attack it

Independently, first.

**The invariant to break: make a writer lose a line, write a line the reader cannot parse, throw
into its caller, or record a number that is not what its decision saw.** Concurrency, rotation and
the failure paths are where to spend the run. Real interleaving, not reasoning about it.

Then state each of these and say whether it is accurate:

1. *"No call to `recordRefusal` can propagate an exception to its caller, on any path, for any
   input, including one whose serialisation throws."*
2. *"Concurrent appends from separate processes cannot interleave into an unparseable line, and a
   prune concurrent with an append cannot lose either."*
3. *"The panel never renders an empty or unreadable journal as a claim that nothing was refused."*
4. *"Both writers record the readings their own decision was made on, and no later reading can be
   written under a refusal's name."*

Findings continue from **F36**. Severity by consequence; P1 includes a true number under a false
label. Refuse only on an established P0 or P1.

## My own suspicions — read last

1. **`MAX_REFUSAL_FILE_BYTES` is 64 KiB and pruning keeps one `.prev`.** So the journal holds
   roughly the last 1,200 refusals and silently drops older ones. Is that loss stated anywhere a
   reader would see, or does the panel imply it shows everything?
2. **The reader runs on the request path.** Measured at 2.03 ms median over 620 entries, which is
   fine — but the file is bounded by bytes, not by entry count, and the reader parses every line.
   Is the worst case stated correctly?
3. **`entry.source.replace("-", " ")` in the panel** turns `test-run` into `test run` and
   `readiness-precheck` into `readiness precheck`. Is a reader able to tell those two apart, and
   does "test run" read as *a test run was refused* — which is true — rather than as something
   vaguer?
4. **Nothing prunes if the dashboard never runs.** Writers never rotate by design. Is unbounded
   growth on a box with no dashboard a real risk, or is the write rate low enough that it is not?
