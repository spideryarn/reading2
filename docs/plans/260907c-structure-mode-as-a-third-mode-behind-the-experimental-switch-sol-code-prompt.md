# Review the code, having reviewed the plan

You reviewed this plan a few hours ago and the code is now written. **This review is weighted
higher than that one**, because a plan-stage review reads prose and cannot find a component that
renders the wrong thing.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode`, branch
`worktree-structure-third-mode`, one commit ahead of `origin/dev`.

- The plan, **revised in response to your review**:
  `docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md`
- Your plan review, kept beside it:
  `docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch-sol-plan-review.md`
- The scoped diff: `/tmp/claude-1000/-home-greg-code-spideryarn2/bff7ea9b-8d76-4f9c-815b-1865eaecf336/scratchpad/sm/stage1.diff`
  (also `git diff origin/dev...HEAD`)

## Still settled and not up for review

Greg decided on 2026-09-06 that Structure is a **third** mode — Hierarchy stays, Outline stays —
and that it goes behind the Experimental Features switch. Do not re-argue that.

## What I did with your eight findings

Six changed the design. Two I did **not** take as recommended, and I want you to push back if you
still disagree:

- **Finding 1 (scroll preservation).** I corrected the mechanism claim and wrote the reflow risk up
  honestly, but I did **not** build viewport anchoring. It is measured in the browser first, on the
  grounds that it is pre-existing behaviour between Hierarchy and Outline, is shared machinery for
  all fifteen modes, and might not be a real defect. Plan § What must be good.
- **Finding 5 (corpus maxima).** I did not adopt your measured numbers: `data/` in a worktree is
  the *fixture* cut copied by `npm run worktree:setup`, not the corpus, so those are numbers about
  fixtures. The plan now cites 260903b's documented figures and claims no measurement of its own.
  **Check whether I am right about that** — `scripts/worktree-setup.ts` and
  `tests/fixtures/data-root/`.

The other six: `GENERATES` and the count in `page-head.test.ts` are done; the stages are recut so
the mode registered with **both** columns; paragraph counters are gone in favour of an honest total
(`src/web/structure.ts` § `PARAGRAPHS_HAVE_NO_CENTRE`); `paragraphLabelsReady` is applied; the
wells and one-selection-model are argued in the plan and the *selection model* is built though the
**wells are not yet** (stage 2); decisions 2 and 5 are declared deviations; and finding 8 got a new
test file rather than a widened shared fixture.

## What I most want from you

1. **`src/web/structure.ts` — is the projection right?** It is the whole of the mode's logic. In
   particular: does anything in it decide "what is current" more than once; is `windowed()` correct
   at both ends and when nothing is current; is the rung ladder actually monotonic (a higher rung
   must never draw *less*); and does the supplement handling match what `outline.ts` and
   `buildArcColumn` do.
2. **`src/web/StructurePanel.tsx` and the CSS.** The container query at 364px, the `flex: 1 1 auto`
   on `.struct-grid` inside a `min-height: 0` flex band, and the `.struct-line` grid. Will this
   overflow the band in a real browser at `MODE_MIN` 288 with a long part list? What breaks first?
   Note I have not run a browser yet — that is happening in parallel.
3. **The tests, adversarially.** `tests/structure-projection.test.ts` and
   `tests/structure-panel-draws-both-columns.test.tsx`. **Which of these assertions cannot fail?**
   I mutation-checked two of them by hand (`contains`, and deleting column B) and both went red,
   but I did not check the rest. Name any that would pass over a broken implementation.
4. **The tables I edited in other people's tests.** `visitor-gaps.test.ts`, `page-title.test.ts`,
   `page-head.test.ts`, `styles-entry-is-imports-only.test.ts`, `command-bar.test.tsx`,
   `dock-experimental-modes.test.tsx`, `every-mode-draws-its-surface.test.tsx`,
   `public-network-trace.test.tsx`, `every-mode-says-which-passages-it-marks.test.ts`. **Did I
   weaken any of them?** Specifically: replacing `expect(MODES.length).toBe(14)` with
   `toBeGreaterThan(5)` in `page-head.test.ts` — is that a real loss, and did I remove a canary I
   did not understand?
5. **Anything an ordinary reader could now see that they could not before.** This whole design
   rests on the claim that a reader without the switch is unaffected. Is there anywhere the mode
   leaks — the command bar, the shared-inventory dialog, a page title, the metadata or tweets
   pages, a visitor's band?
6. **Anything in the prose comments that is now false of the code.** I wrote a lot of them; several
   make claims about other files.

## How to work

The tree is read-only to you and there is no network — not even loopback — so nothing touching
Postgres or a dev server works. You **can** run a single test file with
`npx vitest run tests/<one>.test.ts` and a script with `node --import tsx <script>`, as long as it
needs nothing outside the tree. `tests/structure-projection.test.ts` and
`tests/structure-panel-draws-both-columns.test.tsx` both run in isolation; please actually run them,
and please try mutating the source and re-running to see which assertions bite. `npm test` and
`npm run typecheck` will not work.

## Output

Findings ordered by cost if missed. For each: what is wrong, evidence with file and line, and what
you would do instead. Say plainly where the code is fine. I am much more interested in "this looks
right and is subtly false" than in style.
