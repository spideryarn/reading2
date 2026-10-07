# Review: the plan for four small sweep clusters (9, 15, 16, 21), before anything is built

Repo: this worktree, branch `worktree-sweep5-clusters-9-15-16-21`, cut from `dev`. TypeScript, ESM,
vitest, Postgres. Nothing in the plan is built yet.

## The candidate

A plan, committed:
`docs/plans/261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md`

It carries out four rows of `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § The clusters
(rows 9, 15, 16, 21; the numbered notes 15 and 16 further down that doc, and "For Greg" 6). The
evidence behind each item id is in:

- `docs/investigations/261003b-fifth-sweep-defences-evals-and-tooling.md` (F2, F5, F6, F7, F10) and
  its review `…-review-opus-on-defences.md` (also M1, M2)
- `docs/investigations/261003b-fifth-sweep-server-request-layer.md` (R13) and
  `…-web-client.md` (W9), reviewed in `…-review-sol-on-server-and-web.md`
- `docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md` (X13 d, f, g, h, i)
- `docs/investigations/261003b-fifth-sweep-data-and-pipeline.md` (D5) and
  `…-review-opus-on-data-and-pipeline.md`

Start with the plan, then the code each stage names. That is where to begin, not the limit.

## What it is meant to do

Each stage should close its items with the least machinery, red test first, inside the cluster's
file set, without changing anything a reader sees. The plan names what it passed over and why.

## What you can and cannot run, and what you may change

The tree is read-only. `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback, so anything needing Postgres will skip.

## Attack it

Is each stage's stated fix accurate against today's code, sufficient for the finding, and the
smallest thing that is? In particular look for: a claim about the code that is false today; a
"red first" that could not actually go red, or that would be green for the wrong reason; a fix
that needs a file outside the cluster's set; a seam the plan assumes that does not exist; a step
that would change production behaviour (the rename in `src/structure.ts` must be a rename only);
and anything the plan passes over that it should not, or builds that it should pass over.

For each finding give:
  - an ID (PF1, PF2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the code it contradicts (file and symbol)
  - (b) exact replacement wording for the plan
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with one line:
`VERDICT: build` or `VERDICT: do not build`, and say whether your conclusion follows from what you
checked.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- A1: is "the commit the pre-registered run used" recoverable, and is toc/10's text at that commit
  really what the run sent? Is there any other consumer of the frozen arm's request that the
  literal would break?
- A3: can `wasRefused` and `truncationFailure` be called from the two harnesses with what they
  hold, and do they together equal production's check in `src/structure.ts`?
- A4: does each named harness actually hold a rendered system string to hash?
- B1: are the three `waitUntilBlockedBy` copies the same function? Can the billing admission's
  blocker be identified by the test's holding backend pid?
- B2: do fake timers work with the tooltip library these tests render (floating-ui) and with the
  tests' other awaits?
- D: can one fixture make every stamped step current and then stale, and can `stepIsDone` be
  called for each step outside a job?

Do not change any file.
