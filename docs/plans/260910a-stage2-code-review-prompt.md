# Review: Stage 2 of admission visibility — the forecast section on Box health

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, React, vitest + jsdom.

**You implemented this stage**, and your own nested review could not start (its runner tried to
write outside the sandbox), so this is the stage's first cross-family pass. Treat the code as
unreviewed work by someone else.

## The candidate

Committed: **`fe5d78a9`**.

    git show fe5d78a9 --stat
    git show fe5d78a9 -- tools/fleet/web/src/AdmissionSection.tsx tools/fleet/web/src/admission-client.ts

Changed paths, complete:

    docs/plans/260910a-stage2-build-answer.md
    tests/fleet-admission-panel.test.tsx
    tools/fleet/web/src/AdmissionSection.tsx      (new)
    tools/fleet/web/src/admission-client.ts       (new)
    tools/fleet/web/src/HealthPanel.tsx           (one mount line, one defaulted prop)
    tools/fleet/web/src/App.tsx                   (one injected/defaulted prop)

Stage 1 (`e4206867`, already on `dev`) is the server this talks to: `tools/fleet/routes-admission.ts`
and the `Admission*` types at the end of `tools/fleet/wire.ts`. **Do not scope by a merge-base
range** — this branch contains other sessions' work through merges.

## What changed since you built it

Two things, both mine, and check them as carefully as the rest:

1. **`DATE_LIMIT_MS` was declared twice** — in `admission-client.ts` and again in
   `AdmissionSection.tsx`. It is now exported from the client and imported by the section.
2. **The section's out-of-range-instant branch said *"This browser never got an answer it could
   read"* over a perfectly good `would-refuse`.** The browser *had* an answer; only the timestamp
   was unusable, and the answer was being discarded for it. It is also unreachable through
   `parseAdmission`, which already refuses such an instant into `no-answer` — so nothing had ever
   watched it. An unreadable instant now loses the instant and keeps the outcome, saying the answer
   is undated, and `tests/fleet-admission-panel.test.tsx` § *"keeps the outcome when the instant is
   unreadable"* constructs the view directly to reach it.

## What it is meant to do

The plan is `docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md`;
**§1, §3 and §8 are this stage's contract**, and its two "Review dispositions" sections record which
words are banned and why (F1–F27, yours).

The invariant: **nothing on this section may read as a claim that anything was admitted, refused,
reserved or enforced.** It draws a forecast. In particular `forecastCallMessage` is raw output from
the *dashboard's own* call to the gate — it uses real-run grammar (`REFUSING TO START`, `NO TESTS
RAN AND NOTHING WAS VERIFIED`) and names the *dashboard's* pid, not any test process's — so the
section must introduce it as such rather than presenting it as an event.

The panel's own standing rules, set by the Box health rework at `6e8e28e3`:

- **nothing may be drawn that a reader could take for a healthy zero** — `health-view.ts` refuses to
  build a progress bar with no number behind it, and an unavailable forecast is a *sentence* naming
  which kind of nothing it is;
- the history card's order is record prose → four charts → verdict strip and time axis → legend, and
  this section sits after that card and before the raw-data disclosure.

## What you can and cannot run, and what you may change

**You may edit this worktree.** Fix what is inside this stage, each finding red-first with the test
that reproduces it, and leave anything wider as a finding for me. **Do not commit.** List every file
you changed.

**Do not touch:** `health-view.ts`, `history-series.ts`, `HealthHistory.tsx`,
`health-history-client.ts`, `types.ts`, `mode.ts`, `Dock.tsx`, `tailwind.css`, anything under
`tools/fleet/` outside `web/src/`, `tools/overseer/`, or the readiness files.

Runnable: `npx vitest run tests/fleet-admission-panel.test.tsx tests/fleet-web.test.tsx` (443
passing). Typecheck via `node --import tsx scripts/typecheck.ts` (exit 0); the literal
`npm run typecheck` fails in the sandbox on the tsx IPC socket. Do not run the full `npm test`.
**Do not touch the dashboard on :8787.**

Note `tests/fleet-web.test.tsx` is not optional here: it pins the bars and tile copy that landed at
`6e8e28e3`, and it is what catches a block duplicated or dropped by a clean merge.

## Attack it

Independently, before my questions.

**The invariant to break: find rendered text, or a rendering path, where this section says something
stronger or different from what the payload actually supports.** Six defects of that exact shape
have been found in this feature already — two of them in the last hour, one of them mine — so it is
the hunt, not a checklist item.

Then state each of these as a sentence and tell me whether it is accurate:

1. *"Every arm of `AdmissionView` renders text that names which kind of nothing it is, and no arm
   renders a zero, an empty bar, or a blank where a number would go."*
2. *"A failure that belongs to this browser is never spoken in the server's voice, and a failure
   that belongs to the server is never spoken in the browser's."*
3. *"`forecastCallMessage` is introduced as raw output of the dashboard's forecast call, and no
   reader could take it for a record of a test run that was refused."*
4. *"Mounting Box health issues exactly one forecast request, and unmounting or remounting cannot
   leave a `setState` on an unmounted component or a duplicated request."*

For each finding: an ID continuing from **F28**, a severity, established or reasoned, (a) the input
or mutation that shows it, (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

1. **The `answerTone` mapping.** `would-refuse` is drawn `alarm` and `would-reduce` `needs`. A
   forecast is not an incident — is colouring a *hypothetical* refusal with the same tone the page
   uses for real trouble a claim in itself, given colour is the one carrier a reader takes in before
   any words?
2. **`not-modelled` is drawn `idle`.** Does that read as *nothing to worry about* when the honest
   meaning is *we cannot tell you*?
3. **The loading state** says "Asking the gate for a forecast…". Is that accurate — the browser is
   asking the dashboard, which asks the gate — or is it a small false attribution of the same family
   as everything else on this list?
4. **`policy.explanation ?? policy.whyWithheld`** collapses two different facts into one paragraph
   with no visible difference between *here is how the gate decides* and *this dashboard cannot
   explain this policy version*. Should the withheld case look different?
