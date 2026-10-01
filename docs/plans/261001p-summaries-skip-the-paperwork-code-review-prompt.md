You are reviewing code before it is pushed, and you may FIX what you find inside this change.

Read first:
- The plan: docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md
- Your own plan review of it: docs/plans/261001p-summaries-skip-the-paperwork-plan-review-sol.md
  (P1-1 to P1-5 and P2-6 to P2-9). Check each was handled as the code claims, or was declined
  with a reason. I declined: adding a generation-only Brief cap (a failed level loses the whole
  three-level press, so the ask moves and the guard stays; the measurement decides); and adding
  BLOCK_ID_NOTE to the hierarchy at this bump (its first line does not fit the hierarchy's
  numbered lines; src/article-prompt.ts now says so).
- The scoped diff: docs/plans/261001p-summaries-skip-the-paperwork-code-review.diff
  (everything since this branch's base, in src/, tests/ and evals/paperwork/).

Things to check hardest:
1. The new Simple prompt stamp (`promptVersion` on SimpleSummary, `SIMPLE_PROMPT_VERSION`,
   `simplePromptVersion`): every reader of the old `SIMPLE_VERSION` that meant "the prompt"
   now reads the prompt stamp, and every one that meant "the stored shape" still reads the
   shape. Grep for all uses, including src/web, src/public, the export bundle, and the
   carry-forward / artefact-copy paths. Is a legacy row (no field) usable but outdated
   everywhere? Does anything copy or rebuild a SimpleSummary field by field and drop
   `promptVersion` (which would make every copied summary read as outdated)?
2. Metadata's Tweets arm in src/store/pg.ts now uses `sameStamp` with promptVersion AND
   model. Is `model: CAPABLE_MODEL` right for a thread written at the article's high power
   setting, or does it now call every high-power thread not current? Look at how the
   neighbouring arms (quotes, simple) handle power, and at `sameGenerator`.
3. The prompts' wording in src/paperwork.ts, src/simple-summary.ts and src/tweets.ts: any
   contradiction with the rest of each prompt (e.g. Tweets' "Attribute every contested claim",
   Summary's "why THE PIECE says it matters", hierarchy's QUESTIONS block that requires a
   question on every depth-1 node, the expand prompt's ASK QUESTION ON CHILDREN).
4. The tests: does each new test go red without the change it guards? (I checked the Tweets
   Metadata test and the Simple stamp test by hand-reverting; check I did not miss one.)
5. evals/paperwork/run.ts: is the pairing/blinding sound (blindCoin, balance count), and is
   anything in it likely to mislead a reader of its output?

Then run, and report the result of: `npm run typecheck`, and
`npx vitest run tests/simple-summary.test.ts tests/tweets.test.ts tests/store-tweets-stale.test.ts tests/hierarchy-expand.test.ts tests/hierarchy-prompt-hoist.test.ts tests/hierarchy-structure-request-parity.test.ts tests/profile-prompts.test.ts tests/plain-words-coverage.test.ts`.

Do not make paid model calls. Do not touch the production database, .env files, or git
history (no commits, no resets, no stashes).

Report: a numbered list, most important first, tagged P0–P3, each saying what you changed (with
file:line) or why you left it for me. End with the gate results.
