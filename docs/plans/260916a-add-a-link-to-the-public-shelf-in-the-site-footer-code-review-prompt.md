# Review the code, and fix what you find

You reviewed the plan for this change and found five things; all five were accepted and acted on.
This is the second review, of the code that came out of it. Weight it higher than the first: a
plan-stage review cannot see what the diff actually did.

You are in the worktree `.claude/worktrees/footer-public-shelf-link`, with `--sandbox
workspace-write`. **Fix what you find inside this change's scope** and report anything wider for me
to decide. Write your findings to the `--output` file first, then fix, so I can read both.

## The request

A user feedback report from the product owner, verbatim:

> Add a link in all the footers to the publicly readable shelf alongside, you know, feedback and
> pricing etc

## What to read

- `docs/plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer.md` — the plan, including the
  table at the foot recording what changed because of your first review, and the § *Stage 3, as
  measured* section at the very end.
- `docs/plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer-review-sol.md` — your own
  first review, so you can check whether each finding was actually honoured rather than acknowledged.
- The scoped diff: `git diff HEAD` in this worktree. Eleven files changed plus three new docs.

## The evidence, so you are not reviewing prose

- **Gates.** `npm run typecheck` exits 0 (checked by exit code, not by reading its last lines, which
  are always ✓). `npx vitest run tests/site-footer.test.tsx tests/command-bar.test.tsx
  tests/public-shelf-page.test.tsx tests/public-showcase.test.tsx
  tests/reserved-article-address.test.ts tests/client-imports.test.ts tests/page-title.test.ts` →
  7 files, 156 tests, all passing. `tests/doc-links.test.ts` passes. The full suite is still to run.
- **The test was red first.** Before any source change, the eight updated row arrays plus the new
  Pricing case failed 9/18, printing `"undefined → /read/public"` where the label should be.
- **The narrow-window numbers** are in the plan's § *Stage 3, as measured* and in the rewritten
  comment in `SiteFooter.tsx`: 33 cells, all zero, measured in headless Chrome against this
  worktree's own dev server (verified by `/proc/<pid>/cwd` and by the served constant).

## What I would least like to be wrong about

1. **The `here: "public-library"` entry is inert and the comment saying so is precisely worded.** The
   comment claims no page draws this row while `useRoute()` returns `public-library`, and explicitly
   does *not* claim the row is never drawn under `/read/`. Check both halves against `App.tsx` and
   `ArticlePage.tsx`. If either is overstated, fix the comment.
2. **The rename from the heading-specific name to `PUBLIC_SHELF_LABEL` is complete.** Sweep for the old name
   in code, tests, docs, plans and fixtures — a rename here is never one edit. The only intended
   survivor is one historical mention inside the constant's own docblock.
3. **Nothing else in the tree still says "Public shelf" as a navigation label**, and the descriptive
   prose on `/privacy` that does say "our public shelf" is correctly left alone.
4. **The comments I wrote are true.** I have written a lot of prose into `SiteFooter.tsx`,
   `CommandBar.tsx`, `messages.ts`, `PublicLibraryPage.tsx` and `SiteBits.tsx`. Several sentences
   make factual claims about other files — which links `SiteNav` carries, what `App.tsx` does, why
   `/contact` stayed out of the nav, what the old comment said. **Check each claim against the file
   it is about**, not against the sentence next to it. A false comment is the failure mode this
   change was supposed to be fixing, so shipping a new one would be the worst outcome here.
5. **The new Pricing self-drop test actually tests something.** It is new coverage for a
   pre-existing gap. Confirm it fails if the `pricing` entry's `here` is wrong.
6. **`tests/site-footer.test.tsx`'s `SHELF` token is built from the constant while every other token
   is a literal**, with a comment arguing why. Is that argument right, or does it make the suite
   blind to something a literal would have caught?

## Also

- Anything in the diff that is more than the request needed. You cut two cleanup edits at plan stage;
  say if more should go.
- Anything that will go stale next time somebody touches this row — I have removed two counts and I
  would rather not have left a third.
- The full test suite has not run yet. If you see a suite this change could plausibly break that is
  not in the list above, name it.

## Output

Findings ranked by severity, each with file:line and what you checked it against. Then fix the ones
inside this change's scope and say what you changed. If something is right, one line is enough.
