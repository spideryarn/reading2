# Code review: the enlarged diagram's text column, and Socratic summaries

You are reviewing built code, not a plan. Two unrelated feedback reports from the product owner,
implemented in one worktree because they touch disjoint files.

## How to get the diff

You are in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/feedback-diagram-text-and-socratic`
on branch `worktree-feedback-diagram-text-and-socratic`. The whole change is:

```
git diff origin/dev...HEAD
```

Read `docs/plans/260905e-feedback-diagram-text-column-and-socratic-summaries.md` first — it is the
plan doc, and it states the decisions, the evidence and what was deliberately deferred.

**Run tests yourself.** These need nothing outside the tree:

```
npx vitest run tests/hierarchy-build.test.ts tests/summary-expand.test.tsx \
  tests/illustrated-view.test.tsx tests/public-dto.test.ts \
  tests/hierarchy-structure-request-parity.test.ts tests/hierarchy-prompt-hoist.test.ts
```

A finding you reproduced outranks one you reasoned to. Note that the machine is heavily loaded
(load average ~78), so a timeout is probably contention rather than a bug — re-run a suspicious
file alone before reporting it.

## What was asked for

**SPIDERYARN-READING2-1P**, verbatim:

> For the Illustrated diagram, if I have clicked Enlarge, show the prompt text in a column to one
> side so I can scroll up down independently through that text while looking at the image it refers
> to.

**SPIDERYARN-READING2-1V**, verbatim:

> Tweak the prompt that generates the Summary mode to be a bit more in the form of Socratic
> questions that encourage the reader to read the actual text to get the full answers

## What was built

**1P** — an `<aside className="ill-aside">` rendered as a sibling of `.ill-in-full` inside the
existing `<dialog className="ill-full">` in `src/web/IllustratedView.tsx`, plus a `@media
(min-width: 1080px)` block in `src/web/styles.css` that shows the column and hides the band's
existing `<details className="ill-brief">` inside the overlay. Below the breakpoint the column is
`display: none` and the `<details>` is what the reader gets.

**1V** — the literal request was refused, because there is no prompt that generates Summary mode:
the panel renders the stage-4 `gist`, which is also drawn in ten other surfaces AND fed back to the
later structure waves as context (`chainRung`, `src/hierarchy-expand.ts`). Instead a new optional
`TreeNode.question` is written by the same stage-4 call on the root and depth-1 nodes only, and
drawn only in `SummaryPanel`. `PROMPT_VERSION` `toc/4` → `toc/5`.

## Severity scale — use exactly these

- **P0** — data loss, a security hole, or a reader-visible break on the ordinary path.
- **P1** — a real bug, or a decision that will be expensive to reverse.
- **P2** — a smell, a naming problem, a missing test.
- **P3** — taste.

Give every finding an **ID** (`F1`, `F2`, …), a severity, the **file and line**, and the **smallest
fix**. Say plainly when a finding is speculative. If you think a decision is wrong rather than
buggy, say so as a decision, not as a bug.

## Where I think the risk is (read this LAST, after forming your own view)

1. **`questionFor` in `src/hierarchy.ts`.** It normalises rather than rejects: `?` kept, `.`/`!`
   dropped as a statement, anything else gets a `?` appended. That rule was changed after a real run
   produced a question with no mark. Is the `.`/`!` drop right, or will it discard questions ending
   in an abbreviation? Is appending `?` to arbitrary model text ever unsafe?
2. **The depth guard is in `buildTree`'s `visit`.** I claim `hierarchy-expand.ts` needs no change
   because it only ever writes depth ≥ 2. Check that claim — if an expansion can ever produce a
   depth-1 node, questions would be silently absent there.
3. **`droppedQuestions` threading.** I added it to `BuildReport` as a required field and fixed ~12
   construction sites. Did I miss a merge site, such that a count is summed on some paths and not
   others? `src/hierarchy-cascade.ts` and `src/hierarchy-deepen.ts` are the two merges.
4. **The CSS breakpoint pair.** `.ill-aside` is `display: none` by default and shown only above
   1080px, where `.ill-in-full .ill-brief` is hidden. I claim there is no width at which the prompt
   appears twice or not at all. Check the rules actually say that, including specificity.
5. **The `<details>` hidden by `display: none`** — is it really out of the tab order and out of the
   accessibility tree at wide widths, given it is inside a modal `<dialog>`?
6. **`tabIndex={0}` on `.ill-aside-scroll`.** Does adding a tab stop inside a modal dialog disturb
   the focus order or the focus trap in any way that matters?
7. **The checkpoint key pin** in `tests/hierarchy-prompt-hoist.test.ts` moved from
   `2993e1e4b2aaf1d6` to `18e7504c732c5722`. I claim that is correct and required. Confirm it is not
   masking an unintended change to `renderBlocks` or `EFFORT`.
8. **`src/public/dto.ts`** now passes `question` across the public boundary, and
   `tests/public-dto.test.ts`'s allow-list declares it. Is that the right call for a visitor
   following a shared link?

Do not change any file. Report findings only.
