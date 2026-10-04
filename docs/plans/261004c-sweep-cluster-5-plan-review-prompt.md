# Review: the plan for sweep cluster 5 — failed artefact reads get a retry and a reader's sentence; Regenerate is held until the replacement is read

Repo: this worktree, branch `worktree-sweep5-c5-failed-read`, TypeScript + ESM, React client under
`src/web/`. This is a **plan review, read-only**: change no file.

## The candidate

Live pre-commit: base `ab8289e2a`; untracked:
`docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md`
(the plan). Nothing else is changed yet.

Start with: the plan; `src/web/useFaq.ts` and `src/web/FaqPanel.tsx` (the existing `retryRead`);
`src/web/useQuiz.ts` (the `held` / `rewriting` hold and `readMark`); `src/web/lib/describe-failure.ts`;
`src/web/lib/sse.ts § readAnswerStream`; `src/web/lib/opening-read.ts`; `src/web/useSourceScan.ts`;
`src/web/useOrderedRead.ts`; `src/web/useStepJob.ts`. Not a limit on scope.

Background: `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § The clusters (row 5 and the
paragraph numbered 5), and the evidence docs it links (`docs/investigations/261003b-fifth-sweep-web-client.md`
W2, W4; `…-deploy-scripts-and-cross-zone-leads.md` X9, X11, X13k). You reviewed that audit.

## What it is meant to do

The plan's § What a reader gets. Invariants: a retry of a read never starts a paid job; a failed
revalidation never takes a loaded artefact off screen; no generic artefact-read hook or hook factory;
only a sentence written for a reader reaches the reader (docs/project/copy.md § The same seam in the
browser).

## What I want from you

An independent pass on the plan first: is each stage buildable as written against today's tree, is
anything in it false about the code, is anything missing that would make a stage ship a P0/P1, and
is anything in it more machinery than the defect needs?

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design or maintainability risk; P3 prose.
Refuse only on an **established** P0 or P1 (direct evidence, no unresolved inference). Give every
finding an ID `F1`, `F2`, …. End with a one-line verdict: PROCEED, PROCEED WITH CHANGES, or REFUSE.

## My own suspicions (already mine; spend most of the run elsewhere)

1. Stage 2a: is the small `useRewriteHold` extraction worth its keep, or should each hook carry the
   lines? And is "hold on the read half where the read outlives the band; band-local for Simple,
   Thread, Sketch" right, given postmortem 261002f? Is `generatedAt` a usable identity for Simple,
   Ideas, Glossary, Tweets and Sketch (Glossary's is re-stamped by *Find more*)?
2. Stage 1a: routing the read catch through `describeFetchFailure` in a file whose stream catches
   still use bare `Error` throws from `readAnswerStream` — does `tests/describe-fetch-failure.test.ts`
   force more than the plan says, and is making `readAnswerStream`'s `error` frame a
   `ReaderFacingError` correct?
3. Stage 2b: is giving `openingRead` an optional deadline and message the right reuse, and is 60 s
   right for the scan?
4. Stage 1d: is the static half of the matrix test (find hooks that pair `useOrderedRead` with an
   `error` state) a sound way to catch the next mode, or a tautology?
