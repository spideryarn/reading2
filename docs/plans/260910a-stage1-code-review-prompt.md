# Review: Stage 1 of admission visibility — the gate's forecast on a read-only route

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest. Node 22.

**You implemented this stage.** Treat it as unreviewed code written by someone else — that is the
house rule and it is the point of this round.

## The candidate

Committed: **`e4a38579`**, then merged with `origin/dev` at `975be09d` (a clean merge; the merge is
not part of the candidate).

    git show e4a38579 --stat
    git show e4a38579 -- tools/fleet/routes-admission.ts tools/fleet/admission-wiring.ts

Changed paths in the candidate — the complete manifest:

    docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md
    docs/plans/260910a-stage1-build-answer.md
    docs/plans/260910a-stage2-client-task.md
    tests/fleet-admission-explain.test.ts
    tests/fleet-admission-route.test.ts
    tools/fleet/admission-wiring.ts
    tools/fleet/routes-admission.ts
    tools/fleet/server.ts          (two lines: an import + composition, and the mount)
    tools/fleet/wire.ts            (types only, appended)

**Do not scope by a merge-base range** — this branch now contains other sessions' work through the
merge, and a range would sweep in 27 files that are not mine.

Start with `tools/fleet/routes-admission.ts`. That is where to begin, not the limit of scope.

## What changed since you built it

I found and fixed one defect in your implementation, red-first, and you should check the fix as
carefully as the rest:

`parseAdmissionRequest` took a `nowMs` and filled `requestedAtClientMs` from it; the route passed
`deps.nowMs()`. So over HTTP that field held the **server's** clock under a name the wire documents
as the **caller's**. It is now `null` over HTTP, `parseAdmissionRequest` no longer takes a clock, and
`tests/fleet-admission-route.test.ts` § *"the caller's clock"* pins it — asserting specifically that
it is not the server clock, rather than only that it is null.

## What it is meant to do

The plan is `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md`, and
**§§1, 2, 3 and 5 are this stage's contract**. Read its two "Review dispositions" sections: they are
your own F1–F16, and they record which words were banned and why.

The invariant, which is the whole feature: **this route must make no claim of enforcement,
reservation, coordination or record-keeping that does not exist.** It forecasts. Nothing it returns
stopped, reserved or queued anything. The gate (`vitest-admission.ts`, unchanged and not to be
changed) remains the sole owner of the arithmetic.

Deliberately not in this stage: the census (§4), the refusal journal (§6b), the repeating task and
its caches (§7), and all client code (Stage 2).

## What you can and cannot run, and what you may change

**You may edit this worktree.** Fix what is inside this stage — each finding red-first, with the
test that reproduces it — and leave anything wider as a finding for me to decide. **Do not commit.**
List every file you changed at the end.

**Do not touch** `vitest-admission.ts`, `vitest.config.ts`, `tools/fleet/collect.ts`,
`routes-actions.ts`, `routes-new.ts`, `health*.ts`, `actions.ts`, anything under `tools/overseer/`
or `tools/fleet/web/`, or the readiness files.

Runnable here: `npx vitest run tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts`
(29 passing), and the two guard suites `tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts`
(25 passing). `npm run typecheck` may exit 1 in the sandbox because tsx's IPC socket is denied — use
`node --import tsx scripts/typecheck.ts`, which exits 0 on the current tree. Do not run the full
`npm test`; I run it. **Do not touch the dashboard on :8787** — it is live and the Overseer reads it.

## Attack it

Independently, before my questions below.

**The invariant to break: find a value this route puts on the wire that is true of something other
than what its field name says, or a field a Stage 2 renderer would reasonably draw as a stronger
claim than the data supports.** That is the defect this feature has produced at every stage — twice
in plan review, once in your implementation — so it is the thing to hunt rather than a thing to
check off.

Second: **state each of these as a sentence and tell me whether it is accurate.** Each has a floor,
so answer the sentence rather than "is it sound":

1. *"No threshold, ratio, byte figure or arithmetic rule from the gate is written down a second time
   in `routes-admission.ts`, `admission-wiring.ts`, or the wire types."*
2. *"After any call to `admissionPayload`, `process.env.VITEST_MAX_WORKERS` is exactly what it was
   before — present with the same value, or absent — on every path including a thrown reader."*
3. *"A request whose `kind` is `review` or `browser` cannot reach `decideAdmission`, on any path."*
4. *"Every way the gate can fail to be asked reaches the wire as `unknown` with a reason, and no such
   failure can reach it as a blank, a zero, or a healthy-looking value."*

For each finding: an ID continuing from **F17** (F1–F16 are the two plan rounds), a severity, whether
it is **established** or **reasoned**, (a) the input or mutation that shows it fails its own claim,
and (b) the smallest change that closes it. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

"User-visible wrong behaviour" includes **a true number under a false label**. Refuse only on an
established P0 or P1, and name what established it.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than what you find yourself.

1. **`caveat` is attached to every outcome, including `not-modelled` and `not-applicable`.** On those
   the sentence *"a reduced worker count is the config default; `--maxWorkers` overrides it"* is a
   non-sequitur, and a renderer that prints the caveat unconditionally will show it under an answer
   about a browser job. Should the caveat be part of the outcome rather than the payload?
2. **The 404 body is `{schema, kind: "unknown", why}`, which is not an `AdmissionPayload`.** Stage 2
   has to parse it. Is that shape a trap for the client parser — a body that looks enough like the
   real one to be parsed as an `unknown` *outcome*, when it is actually a routing error?
3. **`AdmissionOutcome` groups `would-refuse`, `not-applicable`, `unknown` and `not-modelled` into
   one `{kind, why}` arm.** They are four very different facts sharing a shape, and the shape is
   what a renderer reaches for. Does that invite Stage 2 to draw them alike?
4. **`explainAdmission` computes `policyFor(...)` and then discards it on the non-test path**, where
   `notModelledExplanation` recomputes it. Harmless, or a sign the two paths should not be in one
   function?
5. **The composition test.** `tests/fleet-admission-route.test.ts` greps `server.ts` for the mount
   and counts `makeAdmission(`. I checked the comment-stripped guard goes red by commenting the
   mount out. Is there a mutation to `admission-wiring.ts` itself that would leave every test green
   while production wired something different?
