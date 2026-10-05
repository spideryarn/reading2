# Code review: Mirror stops its model call when the referee leaves

You are reviewing one small, committed change in this worktree. Read
`docs/plans/261005i-mirror-stops-its-model-call-when-the-referee-leaves.md` first; it is short.

The change is the last commit: `git show HEAD`. It touches

- `src/routes.ts` — `runMirror` passes `sse(res).gone` to `mirrorStream` as `signal`, skips
  `captureFailure` when `gone.aborted`, and the census in `sse()`'s doc comment is updated;
- `tests/referee-mirror-route.test.ts` — one new case at the foot of the file;
- `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § For Greg 4 — a decided note.

## What to check

1. **Is the fix right and complete?** Follow the signal from `sse()` through `mirrorStream`
   (`src/referee-mirror.ts`) into `openRouterStream` (`src/ai-call.ts`). Does a referee's
   disconnect stop the upstream fetch in every phase — before the fetch resolves, mid-body, and
   between the last chunk and the parse? Is anything left that could throw past `sse(res)` or leave
   the response un-ended?
2. **`if (!gone.aborted) captureFailure(...)`.** Can this hide a real failure — one that happens
   while the referee has gone but was not caused by their leaving? `streamAskedTerm` makes the same
   trade; say whether it is acceptable here or whether a tighter test (the error being
   `READER_LEFT`) is worth it. Fix it if you judge it a defect.
3. **Does the new test test what it says?** It was seen red before the fix. Is there a way it
   passes with the fix removed or broken differently? Is the ledger assertion
   (`outcome: "aborted"`, `cost_source: "none"`, null credits) a true statement of what an aborted
   call records, and is the plan's sentence about OpenRouter possibly still billing accurate as far
   as the code can show?
4. **Two claims I made that I have not traced, please trace them.** (a) The plan and the `sse()`
   comment now say *every stream that runs on stores its answer* — `answer`, `streamTermLookup`,
   `streamCitationInvestigation`, `runRefereeCriterion`, `runRefereeClaims`, and `search` for a
   meaning run. Check each of the six in the code; if any does not store, correct the comment and
   the plan. (b) The plan says Mirror stores nothing and that `src/web/useMirror.ts` aborts its
   fetch when the panel goes. Confirm both.
5. Anything in `docs/project/` that now states the old behaviour (Mirror running on after a
   disconnect) — `referee-mode.md`, `cost-tracking.md` — should be corrected.

## How to work

- Fix what is inside this change, narrowly, each code fix red-first with the test that reproduces
  it. Report, do not fix, anything wider.
- You can run one test file: `npx vitest run tests/referee-mirror-route.test.ts`. Do not run
  `npm test` or `npm run check`.
- Do not commit, and do not run any git command that discards work.
- Do not write or alter any quotation attributed to Greg. His only words on this are already in the
  plan.
- End with a verdict line: `VERDICT: ready` or `VERDICT: ready with these fixes` or
  `VERDICT: not ready`, then the list of findings with file and line, and what you changed.
