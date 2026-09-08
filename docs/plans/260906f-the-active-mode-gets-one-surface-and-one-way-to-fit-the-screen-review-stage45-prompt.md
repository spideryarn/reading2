# Review: stage 4's reframe and its trace reader (built), and stage 5's plan (not built)

You are reviewing work on `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md`,
which you have reviewed six times already — twice on the plan, twice on stage 1's code, twice on
stage 2's, and twice on stage 3's. Stages 1–3 are on `dev`. Your findings F1–F14 shaped the plan and
F15–F33 plus stage 3's eleven shaped the code; all were accepted except the half of F6 that was not
mine to act on.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface` (a git worktree).

**This is a mixed review and the two halves want different weight.**

- **Half A, code:** `scripts/read-viewport-trace.ts` is **built and committed to the index**. Review
  it as code.
- **Half B, plan:** stage 5 is **specified and not built**, and its supporting inventory is
  `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md`.
  Review it as a plan. You have said before, correctly, that a plan-stage review cannot find the
  bugs a code review finds — so spend your effort on whether the plan is aimed at the right thing
  and whether its stated facts are true, not on imagining its code.

## What to read

1. The plan, `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md` —
   the status table near the top, § *Stage 4* including its new **Step 3½**, and § *Stage 5*.
2. `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md` —
   the new inventory, and the authority stage 5 rests on.
3. `scripts/read-viewport-trace.ts` — the built code. Run it: `npx tsx scripts/read-viewport-trace.ts --self-test`.
4. For context on the sibling half already shipped:
   `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md`
   and `tests/one-escape-closes-one-surface.test.tsx`.
5. `src/web/ViewportProbe.tsx`, whose output the script parses. **The `Sample` type in the script is
   a hand-copy of the one in the probe.** That is a seam worth your attention.

Both new files are **tracked** — verified with `git ls-files --error-unmatch`, not asserted, because
you caught the same misdeclaration twice on this plan (F27, F30).

## What changed in stage 4, and the claim I most want checked

Stage 4 was recorded **blocked** on "a trace from a real iPhone, which no machine here can produce".
A Fable arbitration pointed out that the instrument is **already deployed** — I verified it by
fetching `https://www.spideryarn.com/assets/main-dDOSrXXx.js` and finding the probe's marker string
in it — so the trace is one ask of the person holding the phone, not missing hardware. The status is
now *waiting on a requested trace*, and the ask is written into the plan verbatim.

**Check the conclusion, not only the reasoning.** Specifically:

- Is *waiting on a requested trace* honest, or is it "blocked" with better manners? A5 stays marked
  incomplete either way — but if you think the reframe lets the job be read as nearer done than it
  is, say so. You wrote F13 against exactly that failure mode.
- Step 3½ now cites the 2026-09-04 user report as a **real-device observation of the mechanism**
  while insisting it does not promote the band's composer from hypothesis to defect. Is that
  distinction actually held, or does citing it quietly do the promoting? Read
  `docs/user-feedback/260904_1723-mobile-keyboard-done-send-button.md`.
- Step 3½ rejects a Chromium/CDP pinch experiment and a CSS characterisation test, with reasons. The
  second reason is that with no keyboard `--kb-inset` is `0px` and `max(x, 0px) = x`, so such a test
  passes before and after any correct fix. **If either rejection is wrong, that is a finding**: it
  would mean local evidence was available and I talked myself out of it.

## On the script

It computes, per sample: whether the head or composer falls outside the visible strip; whether the
keyboard **shrank** the strip (`bottomInset` moved) or **panned** it (`offsetTop` moved) — your F1,
still unresolved, and the thing that decides whether a `bottom:` rule is even the right shape; and
`max(base, inset)` against `base + inset` side by side, your F2.

Things I would attack if I were you:

- **The `Sample` type is duplicated from `ViewportProbe.tsx` with no check that they agree.** If the
  probe's tuple order changes, this reads garbage confidently. Is that worth a guard, and what kind?
- **Array index access.** `noUncheckedIndexedAccess` is on for `src/`; check whether the tuple
  reads (`s.win[1]`, `vv[2]`, `band[3]`) are actually safe or merely type-checked.
- **The self-test.** Two synthetic traces and four assertions; I mutated two things and watched them
  fail (emptying the must-reach list; dropping the clearance term from the anchor check). Is there a
  wrong implementation that still passes all four? That is the question that has caught me three
  times on this plan — an assertion satisfiable by something other than the behaviour.
- **The `max vs +` verdict.** When no sample collapses the band, it prints that `+` is "not
  disproved by this trace" and to prefer `max` on your F2 reasoning instead. Is that the right
  handling of an inconclusive result, or is it a column that will be read as an endorsement?
- **`--self-test` exits 0/1 but is wired to nothing.** No suite runs it. Should it be, given this
  repo's rule that a check nobody runs is not a check?

## On stage 5

The inventory's headline finding is that **eleven of sixteen surfaces have no focus trap, and for
nine of them that is correct and already argued in their own docstrings** — the app is deliberately
modeless, `aria-modal` appears nowhere as an attribute, `inert` nowhere in the UI. So stage 5 does
**not** add traps; it states each surface's contract and checks it against its own.

Measured on this box before designing any of it: jsdom implements no Tab traversal, no
`showModal`/`show`/`close`, and no `inert`.

What I want from you:

- **Is the scope right, or is it the small half?** Stage 5 pins five untested backdrop handlers,
  repairs a fixture whose comment names a route it does not take, pins `outsidePress` in two
  consumers, writes the contract down, and fixes one missing focus call. It **defers** the one
  substantive defect — the two hover cards are `role="dialog"` with a link and a button inside,
  portalled to the end of `<body>`, keyboard-*openable* via `focusable: true` and keyboard-unusable,
  because Tab goes to the next link in the article instead. I deferred it because the three
  available fixes are not equivalent and because a card you can Tab into is a card you must Tab out
  of on every hyperlink, which is a product change A5 forbids a refactor from making quietly.
  **Is that deferral honest, or is it the F6/F13 move of leaving the hard part out and calling the
  stage done?** I would rather you push here than anywhere else in this prompt.
- **Is any factual claim in the inventory wrong?** It was built by a subagent and I verified the
  three load-bearing ones by hand (the five backdrop handlers; `reopen()`'s body; the hover card's
  portal and its `role="dialog"` comment). The rest I did not. The inventory records two things it
  is explicitly unsure of — `TitleEditor`'s `select()`-as-focus, and Floating UI's `returnFocus`
  behaviour on an outside press. If you can settle either from the source, that is worth more than a
  style finding.
- **Given jsdom has no Tab, is there a check worth writing that I have not listed?** The existing
  model is `tests/the-dock-drawer-is-not-a-modal.test.tsx`, which tests the two mechanisms a trap
  would need rather than traversal. If the honest answer is that Tab needs a real browser and this
  repo has no browser-test harness, say that plainly — I would rather be told the stage cannot fully
  discharge its checkbox than ship a green suite that proves nothing.

## How to answer

A table of findings, each with a severity, what is wrong, and what you would do. Say which findings
you would refuse to build without. If you think a decision recorded above is wrong rather than
merely unargued, say so in those terms — three of your findings on this plan have been decisions
rather than bugs and they were the most useful ones.
