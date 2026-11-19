# GPT Sol code review: plan 261031d

Review the uncommitted changes in this worktree (`git diff HEAD` plus the untracked `docs/plans/261031d-*`
files). The plan is
`docs/plans/261031d-sources-digest-acting-on-greg-s-answers-principles-readers-that-search-again-layout-choices.md`;
read it first, then the plan it follows, `docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md`.

The change is small:

1. `docs/project/principles.md`: two principles, Greg's wording, which he approved (option A of
   question q-v03wmh, `docs/user-feedback/questions/q-v03wmh.md`). Check the wording matches the
   question's proposal exactly, and that the surrounding text adds nothing that reads as a rule he
   did not approve.
2. `src/sources-digest.ts`: one sentence in the writer prompt (a `says-it` citation does not go under
   `check`) and `PROMPT_VERSION` to `sources-digest/4`. Check: does the bump do what the file's
   staleness logic expects (`isOutdated`), is anything else keyed on the version string (tests,
   fixtures, the step-run row), and is the sentence consistent with the reader's verdict vocabulary and
   the rest of the prompt (`says-it`, `partly`, `does-not`, `could-not-tell`)?
3. `src/web/styles/reception.css`: the digest's sections parted by a rule and space, headings a step
   darker. Check the cascade: `.digest-head` is also `.rcp-group-head` and `.where-head`, defined
   earlier in the same file; does the later rule win as intended, and does anything else use
   `.digest-section` or `.digest-head` (tests, other modes)?
4. `docs/project/sources.md`: the readers-search-again line now states the decision. Check the anchor
   in its link resolves to the plan's heading (`tests/doc-links.test.ts` is the house check).
5. The decision in § 2 of the plan (A now; a constrained B′ later, gated on measurement): you were
   consulted on it already (`docs/plans/261031d-q2-consult-sol.md`). Check the plan states your answer
   and Opus's faithfully.

You may fix what you find inside this scope (workspace-write). Report anything wider without changing
it. Run `npm run typecheck` and `npx vitest run tests/sources-digest.test.ts tests/doc-links.test.ts`
after any fix. End with a verdict line: `VERDICT: approve`, `VERDICT: approve with changes` or
`VERDICT: revise`, and list each finding with an id (D-01, …), what you changed if anything, and why.
