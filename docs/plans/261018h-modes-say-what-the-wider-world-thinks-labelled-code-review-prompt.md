# Code review (reviewer may fix): modes say what the wider world thinks, labelled

Repo root is your working directory (a git worktree). You MAY edit files to fix what you find **inside
this stage**, narrowly and red-first where a test can show it. Report — do not fix — anything wider.
Do not commit, do not run git commands that discard work (no checkout --, restore, stash, reset, clean),
do not push.

## The candidate (committed, durable)

Base: `d4f62ce65`. Commits: `578e00716`, `3a4fbb7ec`, `80943a93c`, `438aa1548`, `52fbdee6f`, `7cdda9a6c`.
Diff: `git diff d4f62ce65..7cdda9a6c`. Changed paths: `git diff --stat d4f62ce65..7cdda9a6c` (start with
`src/wider-world.ts`, `src/converse.ts`, `src/quiz-mark.ts`, `tests/wider-world.test.ts`,
`tests/web-reach-every-kind.test.ts`, `evals/wider-world.ts`; this list does not limit scope; skip the
bulky JSON under `evals/wider-world/out/` except as evidence).

Read first: the plan `docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md` (including
§ Revised after GPT Sol's plan review — your round-1 plan review is
`docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled-plan-review-sol.md`), and the
investigation `docs/investigations/261018c-modes-say-when-the-piece-is-wrong.md`. **Read the investigation
as a reviewer of its conclusions, not only of the code.** The raw arms, pairs, keys and judge verdicts are
in `evals/wider-world/out/` (before1, before2, after3, after4; judge-*.json; key-*.json).

House rules: `docs/project/prompting-guide.md` (shared prompt sections, measuring a prompt change),
`docs/project/learn-mode.md` § The prompt is the feature, `docs/project/quiz.md` § What a mark says.

You can run tests that need nothing outside the tree: `npx vitest run tests/wider-world.test.ts
tests/web-reach-every-kind.test.ts tests/quiz.test.ts tests/plain-words-coverage.test.ts` and `npm run
typecheck`. You have no network; do not run the evals (they call a paid model).

## Attack independently first

1. Does the rendered prompt text for each of the four kinds read coherently in place — e.g. "as above"
   references in widerWorld's labels resolve to a block-id rule above it in each prompt; Recall's
   entitlement bullet says "below" and the section really is below; no contradiction with Recall's
   "ONE nudge per reply ... exactly one interrogative sentence", Tutorial's "one question last", Quiz's
   "NO INVENTORY" / "If nothing is missing ... say so in one sentence and stop"?
2. Chat: `origins: "claim-origins"` — does the Chat variant still carry the privacy rule for search and
   the "check, don't hunt" rule? Is there any other prompt kind (guide, explore, candidates, referee)
   that now accidentally gets or loses the section?
3. Is the investigation's reading of the judge verdicts honest (e.g. the claim that two of the four
   remaining Q4 losses contradict the prompts' own rules)? Is any number in it wrong against the raw
   files? Is "never against the reader" actually supported by the data?
4. Tests: do they pin the right things, and would they fail on a plausible regression (section moved
   after the hint rule, section dropped from one kind, search variant swapped)?
5. evals/wider-world.ts: any bug that would make an arm silently wrong (wrong case pairing, the
   no-overwrite guard, the dirty-src flag, the marker regex)?

## My suspicions, worth less, last

(a) The marker regex missed a "from my memory rather than the piece" phrasing, so screen counts
undercount; (b) the Recall "THE WORLD IS NOT THE ARTICLE" bullet may weaken the entitlement section's
ranking; (c) `tests/wider-world.test.ts` duplicates the `systemOf` helper from
`tests/web-reach-every-kind.test.ts`.

## Output

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or authoritative
contract violated; P2 design/maintainability risk; P3 prose. IDs F1, F2…, each with severity, evidence
(file:line), and either "FIXED: <what you changed>" or "REPORTED: <proposed fix>". List every file you
edited. End with one line: APPROVE, APPROVE WITH CHANGES (meaning: approve once my fixes land), or REVISE.
