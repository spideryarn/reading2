# Code review: the line Structure shows on a headings-only tree, and its Try again

You are reviewing finished, uncommitted code. You may fix what you find **inside this change**
(the files listed below); anything wider, report and leave. Do not commit, and run no git command
that changes the tree or the index. Do not touch anything under `evals/` or any
`docs/plans/261005j-long-document-*` file: another agent is working there.

## What it is for

A long document whose table of contents could not be made by the model gets one built from the
author's own headings, marked `Tree.provisional: "headings"` (`src/types.ts`,
`src/heading-tree.ts` § `buildBoundedHeadingTree`, `docs/project/structure-step.md` § The
fallback). Nothing told the reader. Greg asked for one line in Structure saying so, and that
trying again may give the fuller version.

## The change (see `git diff HEAD` and the two untracked files)

- `src/web/StructureNotice.tsx` (new): the line, keyed on `provisional` by an exhaustive switch;
  for the owner only, a Try again that starts a `structure` job forced by name through
  `useStepJob`, then says to reload; and, when that job finishes, an unforced `arc` job.
- `src/web/modes/structure/StructureMode.tsx`, `src/web/reader/Reader.tsx`,
  `src/web/styles/structure-mode.css`: where it is mounted and drawn.
- `src/web/useStepJob.ts`, `src/rerun-steps.ts`: comments only.
- `tests/structure-headings-notice.test.tsx` (new), `tests/structure-mode-faces.test.tsx`,
  `tests/labels-land-after-the-shelf.test.ts`.
- `docs/project/structure.md`, `docs/project/structure-step.md`,
  `docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`.

## Claims to check against the code, not the prose

1. A job `{ steps: ["structure"], force: ["structure"] }` on a published article is accepted,
   costs the reader no import slot, publishes a new revision, and queues the `labels` successor.
2. A visitor (not the owner) sees the line and mounts no queue hook, sends no POST and no poll.
3. The unforced `arc` job after it buys a call only when the tree changed, and is safe when the
   structure run fell back again, was stopped, or failed. Is it started in any case where it
   should not be (for example on a job this component did not start, or twice)?
4. Every other extra made from the old tree (glossary, quotes, ideas, timeline, quiz, FAQ,
   relations, sketch, debate, citations, cross-references, thread, simple summary) survives a
   tree swap without breaking its mode: stale is acceptable, a crash or silently wrong content is
   a finding. Check at least two of them properly and say which.
5. The line does not overflow or push rows off in the two-column face, which never scrolls.
6. `onFinished` fires for this slug's structure job only, and "Finished. Reload" cannot appear
   for a job that failed or was cancelled.

## What I most want attacked

- Anything that reports success while doing nothing: a press that starts no job, a finished state
  shown for the wrong job, a test that would pass with the feature removed.
- The quoted words attributed to Greg in `docs/project/structure.md`: they must be exactly

  > B yes add an indication. Although I'm not delighted by falling back to the original headings. I feel like it should be possible to do this robustly, progressively and fairly low-latency, e.g. just the top-level headings first, then the lower-level headings within each of those? then do the summaries later in parallel? or something like that. Run evals etc.

  and nothing else in the diff may be presented as Greg's words. Do not add any.
- The wording on screen: plain, true in both causes of a headings tree (slices failed; a model's
  tree with a section too long to label), no jargon.

## Gates you may run

`npm run typecheck`; `npx vitest run tests/structure-headings-notice.test.tsx
tests/structure-mode-faces.test.tsx tests/labels-land-after-the-shelf.test.ts
tests/visitor-gaps.test.ts tests/doc-links.test.ts tests/client-imports.test.ts`. Not the whole
suite. Any fix you make: see its test red first.

## What to return

A verdict (ship / ship with the fixes made / do not ship), findings numbered F1…, each with a
priority, established or reasoned, file and line, and whether you fixed it. List the files you
changed. Under 900 words.
