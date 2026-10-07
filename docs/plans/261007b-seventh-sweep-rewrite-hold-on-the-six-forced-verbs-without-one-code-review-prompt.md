# Code review (write-capable): the rewrite hold on six more forced verbs

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** on branch `worktree-sweep7-rewrite-hold`: `8720c3af3` (the hold on Illustrated,
Quotes, Timeline, FAQ, Debate, Citations, with their docs), `4ff47b145` (a membership guard),
`84801f0fc` (a signpost in `mode.md`), `b1119c161` (comment corrections), `35b242733` (merge of
`origin/dev`), `4909f5f1b` (plan update). Read each with `git show`. The plan:
`docs/plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md`. The
umbrella: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C10 and § What the
review changed (U6, U14, U22). The finding: WCO3 in
`docs/investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md`, and
your family's review of it (`…reader-client-review-sol-on-opus.md` § WCO3). The rule being applied:
`docs/project/mode.md`, the section on forced verbs and `rewriting`; the machinery:
`src/web/rewrite-hold.ts` (logic unchanged by this stage, by the builder's account).

**The defect being closed:** after a forced re-run's job finishes and before its completion GET
lands, the old result is on screen and the forced control is live; a press there is a second paid
run. The builder reproduced two forced POSTs from two clicks in one tick in all six.

**Try to break it rather than confirm it.**

1. **A hold that never releases is worse than the bug**: a mode with a permanently disabled
   button. For each of the six, find a sequence that leaves `rewriting` true for ever: the job
   fails; the job is stopped; the completion GET fails, then *Try again*; the answer comes from the
   offline copy; the server answers the SAME artefact identity (a re-run that changed nothing —
   Quotes' *Find more* that adds nothing re-stamps `generatedAt`, but do Timeline, FAQ, Debate and
   Citations always change the identity the hold watches? Debate uses `searchedAt`); the slug
   changes mid-hold; the band unmounts and remounts (Citations is an always-mounted read: its
   bookkeeping was copied from Glossary); two forced verbs in one mode (Quotes has three controls:
   *Find more*, and *Choose them again* in two places, plus the command bar's row).
2. **A control that does not honour the hold**: every forced control for each mode must. The
   builder found more than the investigation listed (the foot button after a refused start, the
   command bar's *Run again* rows). `grep` for every place a `force` reaches `start` for these six
   and check each against `rewriting`. The builder notes, unfixed and unreproduced: **`JobProgress`'s
   Retry is not taken through the hold in any of the twelve modes**, so after a retried run
   finishes the same gap is open. Reproduce it or refute it. If it is real and the fix is inside
   the shared `JobProgress`/hold seam and small, fix it for all twelve red-first; if it needs a
   design decision, report it.
3. **The membership guard** (second half of `tests/rewrite-hold.test.tsx`): it parses files under
   `src/web` and requires any file that writes a `force` property into an object literal to be a
   row's hook or a named exclusion (six exclusions). What forced request can be added that it does
   not see? Is each exclusion right — in particular `CommandBar.tsx`: if the command bar can force a
   run of one of the twelve modes, does that press go through the mode's hold, or around it?
4. **New reader-facing sentences.** The builder added four, each following the existing pattern
   used by the six earlier hold users (*The new … hasn't loaded yet.*): quotes, timeline, search
   (Debate), citations. Check they match the existing six in grammar, punctuation and where they
   are drawn, and that nothing else new is shown. Do not write any further sentence.
5. **Typed fixture fields** were added to 18 other test files (`rewriting`, `refresh`, `fresh`).
   Any place a test's fake now hides the behaviour it was testing?
6. Every rewritten comment and doc sentence is a claim; check each against the code, including the
   one extra sentence changed in `mode.md` ("which nothing checks you added" → what the guard
   checks) and the corrections to `citations.md` and `faq.md`.

You may run `npx vitest run tests/<file>` (jsdom; nothing outside the tree) and
`node --import tsx <script>`. A red in the sandbox may be the sandbox: say so. No `npm test`, no
network.

**Fix what is inside this stage**, narrowly, each finding red-first. **Report, do not fix,
anything wider.** Do not touch `useSkim.ts`, `modes/skim/*`, `useIdeas.ts`, `IdeasPanel.tsx`,
`modes/ideas/*`, `marginalia/*`, `useComments.ts`, any server file. The loaded branches of
`SketchView.tsx` / `IllustratedView.tsx` were deliberately NOT moved onto `JobProgress` (the plan
says why): do not build that. Do not commit. Do not attribute any decision to the product owner in
docs: the choices here were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; P0 (data loss) / P1 (a reader sees wrong behaviour: a dead
button, a second paid run) / P2 / P3; the input; reproduced or reasoned; fixed or not (and the
test). Then files changed, what you ran with raw counts, a verdict (ship / ship with these fixes
applied / do not ship), and wider notes.
