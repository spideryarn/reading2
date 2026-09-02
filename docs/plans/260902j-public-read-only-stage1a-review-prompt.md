# Review requested: stage 1a of the public read-only improvements, as built

**Date:** 2026-09-02. **Asked of:** GPT Sol. **Mode:** read-only — do not edit files, do not run
state-changing git commands.

You have reviewed this plan twice already today: the plan itself
([-review-sol.md](260902j-public-read-only-access-audit-review-sol.md), BLOCKED on three points, all
folded in) and two forks found while building
([-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md), both of your calls adopted).
**This is the review of code**, which the house workflow weights higher than the two before it,
because a plan-stage review reads prose and cannot find a handler that writes one field and then
rejects the request.

## What to read

Working tree: the worktree `.claude/worktrees/public-read-improvements`, branch
`worktree-public-read-improvements`, cut from `dev` at `23b3719`. The stage is **one commit**:

    git show a0859a4                      # the whole stage
    git show a0859a4 --stat               # the nine files

Read the diff in full, and the surrounding code where the diff is not self-explanatory —
`src/web/BlockGutter.tsx`, `src/web/TableView.tsx`, `src/web/visitor.ts`, the `Reader` component in
`src/web/App.tsx`, and `tests/public-network-trace.test.tsx`.

The plan is [260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md);
this stage is **Cluster A minus C3** — findings C1, C2 and C4. C3 is being built separately, to the
amended design in that plan's Decisions table, and is **not** in this diff. Do not review it here.

## What was built

- **C1.** The gutter's *"Chat about this paragraph"* button rendered for a visitor on every
  paragraph and `App.tsx` swallowed the press with `if (!owner) return;`. `onChatAbout` is now
  optional through `TableView` into `BlockGutter`, and the button is drawn only where the callback
  is — the pattern you endorsed by name in the plan review (*"`onRenamed` is a capability — a
  function the owner has and a visitor does not"*). The guard inside the handler is gone.
- **C2.** `referee: "Referee"` added to `COSTS` in `visitor.ts`. It had been reaching the
  fail-closed fall-through, which gives the right policy and hands `ownersOnly` the bare mode id,
  so a visitor read *"referee is for whoever added this article"*. A sweep over `MODES` now asserts
  no live mode's sentence carries its own id.
- **C4.** Both mode sweeps in `tests/public-network-trace.test.tsx` were literal lists of seven,
  omitting six modes. They now drive off `MODES` and off the dock's rendered radios, with a total
  `BAND_SAYS: Record<Mode, string | null>` table so a mode that renders nothing cannot pass a
  request-counting check.

## Specific things to attack

1. **Is the capability-as-callback change complete?** `preview-callout.tsx` still passes
   `onChatAbout={() => {}}` and was deliberately left alone. Is there any *other* control in the
   reading view still gated by something other than the capability — a disabled button, a swallowed
   handler, a `!owner &&` that draws a control rather than a boundary? `App.tsx` has a second
   `if (!owner) return;` in `onSelect`, which is deliberate and documented; say if you disagree.
   Grep rather than trust my list.
2. **Does `BAND_SAYS` assert anything false?** Each entry is a literal that must be on screen for
   that mode on the suite's fixture. `null` means *no band of its own* and is asserted as the
   absence of `.mode-close`. I am least sure about `hierarchy`, `outline` and `summary`, which all
   assert the same gist string, and about `quotes`, which asserts a *nobody built one* sentence
   rather than a boundary. Check each against `src/web/visitor.ts` and the fixture, and say which
   would still pass if the band were broken.
3. **The dock sweep was flaky and I fixed it — is the fix right?** It read `location.search` after
   each click. `useQueryState` moves React state with the click and pushes `?mode=` on a throttle,
   so about one run in two it recorded the *previous* mode and reported Hierarchy as a dead button
   — a flake shaped exactly like the finding the sweep exists to make. It now asserts
   `aria-checked` on the pressed button (React state, lands with the click) and polls the URL to a
   deadline in `modeAfterPress`. Two questions: is `aria-checked` genuinely synchronous here, and
   does the poll's deadline-return-anyway behaviour hide a real failure rather than surface it?
4. **Is the visitor's two-slot gutter right in the DOM as well as in React?** `.block-chat` is
   hidden with `opacity` and never `display: none`, so the old button was in the tab order and
   announced even when invisible. Nothing in `styles.css` was changed, on the argument that
   `.blk-gutter` is a flex column with no `nth-child`, no `:last-child` and no sibling combinators,
   and that `td.text.has-marks { height: … * 3 }` cannot match for a visitor because it is applied
   from `cmtsByBlock` and a visitor's comments are `NO_COMMENTS`. Check both claims.
5. **Do the two new sweeps actually fail when broken?** I mutation-tested the `aria-checked`
   assertion (flipped to `"false"`, red on the first press) and the agent that wrote them tested
   three more (`glossary: null`, a reworded `timeline`, `modeRadios().slice(0, -1)`). Name any
   mutation you think would still pass — particularly one where a *visitor* gains a request.
6. **Anything in the diff that is worse than what it replaced**, including comment prose that
   overstates. The house rule is that a comment claiming more than the code does is a bug.

## Evidence

- `npx vitest run tests/public-network-trace.test.tsx` — 28 passed, three consecutive clean runs.
- `npm run typecheck` — clean, all three projects.
- `npm test` — 4 failed of 8958: `db-schema`, `store-jobs-parity`, `store-artefact-manifest`,
  `pdf-bundle-trace`. The first two belong to a jobs-queue migration another worktree has not
  pushed; the last two were red on this branch's parent commit before anything was changed.
- `npm run check` — typecheck, build, cycles, chain, committed all clean; lint/knip/complexity/dupes
  are advisory baselines here.

`file:line`, how you know, ranked. Under ~1500 words. End with a verdict: BLOCKED with the blockers
named, or landed-and-fine with the changes you want.
