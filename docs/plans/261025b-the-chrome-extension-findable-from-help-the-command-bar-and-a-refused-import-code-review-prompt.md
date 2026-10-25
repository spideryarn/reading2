# Code review: the Chrome extension, findable (plan 261025b)

You are reviewing the code built from
`docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md`.
Read the plan first, including its sections "After GPT Sol's plan review" and "While it was being
built". Your own plan review is in `…-review-sol.md`, next to it.

The scoped diff against `origin/dev` is in
`docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import-code.diff`.
The two generated files, `src/help-corpus.generated.json` and
`src/command-pick-catalogue.generated.json`, are left out of it. They are rebuilt by tests and are
checked by them. Read the real files in this worktree for context.

The store id has since arrived on dev (f4d796440) and was merged in, so `PRODUCTION_EXTENSION_ID`
is now set. Greg asked that a change of id be one line, and that every place draws nothing of the
link while the id is null.

What Greg wanted, in his words: "I don't think we want to push it because it's only worth them using
the extension if they need it rather than something that will really help them that much if they
don't." So it should be signalled, not pushed.

## Please check

1. **Correctness.** Is the offer on the add page shown for exactly the failures the extension gets
   round (`SUGGESTS_EXTENSION` in `src/messages.ts`)? Does it stay hidden on a coarse pointer and
   while the id is null? Does the command-bar row behave as an action, typed only, gated in the same
   way? Does Help draw the right thing in both states?
2. **The one-line property.** If `PRODUCTION_EXTENSION_ID` is flipped between null and an id, does
   any test or generated file break? Try it: flip it to `null`, run
   `npx vitest run tests/extension-findable.test.tsx tests/help-page.test.tsx tests/add-page-upload-instead.test.tsx tests/help-corpus.test.ts tests/command-pick-catalogue.test.ts tests/suggests-upload.test.ts`,
   then put it back exactly as it was.
3. **Tests that cannot fail.** Is any test vacuous, or does it share an assumption with the code?
4. **Fit with the codebase.** Does it reuse what is already here (`media`, `helpHref`, the block
   token machinery), and does it read like the surrounding code?
5. **Reader-facing words.** Are they plain and calm, not pushy?

## How to work

You may fix what you find inside this stage, in this worktree. Do not commit, do not push, and do
not touch `.env.local`, `infra/` or systemd. Run `npm run typecheck` and the suites above after any
fix. Then report:

- each finding, with the file and line, and what you changed (or why you left it);
- anything wider, for me to decide;
- a one-line verdict at the end: SHIP, SHIP WITH FIXES (made), or DO NOT SHIP.
