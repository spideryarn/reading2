# Review: Summary's Fuller is asked for a length that follows the length of the piece

Repo: this worktree, branch `worktree-fbgttwhn-summary-length-follows-text`. TypeScript, ESM.
Summary is a reading mode that writes plain-words paragraphs about an article at two lengths,
Brief and Fuller, one model call each (`src/simple-summary.ts`).

## The candidate

Committed: commit `de2eb5bb9` (its parent `ec32200e2` is the plan you reviewed before; the base is
`27c7ded9`).

    git diff ec32200e2..de2eb5bb9
    git diff --stat ec32200e2..de2eb5bb9      # the complete manifest

Start with: `src/simple-summary.ts` (`SIMPLE_BANDS`, `bandFor`, `FULLER_LENGTH`, `lengthFor`,
`simpleSystem`, `SIMPLE_SYSTEMS_BY_BAND`, and the band lookup in `generateSimpleSummary`),
`src/types.ts` § `SIMPLE_LIMITS`, `tests/simple-length-bands.test.ts`,
`tests/simple-summary.test.ts` § the request, `evals/simple/length-bands.ts`,
`evals/simple/probe.ts`, then the prose:
`docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md`,
`docs/investigations/261005a-summary-length-bands-measured.md`,
`docs/project/summaries.md` § Length follows the piece, and
`docs/user-feedback/261004_2034-summary-length-follows-the-length-of-the-piece.md`.
That is where to begin, not the limit of scope.

## What it is meant to do

Fuller's system prompt is built for one of four length bands, picked from the word count of the
body-evidence blocks the request sends. The band changes three values in Fuller's LENGTH section
and nothing else. The standard band's Fuller prompt, and Brief's prompt in every band, are the
bytes `simple-prompt/8` shipped. Fuller's stored limit rose to 13 paragraphs and 1,400 words;
Brief's did not move. Nothing stored is rewritten. The prompt version is `simple-prompt/9`.

**It is smaller than the plan you reviewed**, on evidence: the plan banded Brief too and added a
"cover the whole of it" sentence to the long bands. Both were built, measured with a blind judge
and removed. The plan's § What changed between the plan and what shipped, and the investigation,
say why. Part of this review is whether those two conclusions follow from the result files.

Your five plan findings (F1 to F5) and what was done with each are in the plan's § Ledger. Number
new findings from F6.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this change, narrowly, each finding red-first with
the test that reproduces it, and leave anything wider as a finding for me to decide. Do not
commit. List every file you changed at the end.

You have no network, not even loopback: nothing that needs Postgres or a model will run. You can
run `npx vitest run tests/simple-length-bands.test.ts`, `tests/simple-summary.test.ts`,
`tests/simple-two-levels.test.ts` (they need neither), and
`npx tsx evals/simple/length-bands.ts table`, `… score` and `… score sentence`, which read only
the result files under `evals/results/simple/` and print every number the investigation quotes.
`… pairs` needs the database; its outputs are committed under
`evals/results/simple/length-bands-261005b/` (pairs, keys, and the two judges' answers).

What I ran: those three test files (155 passed), `tests/doc-links.test.ts` and
`tests/plain-words-coverage.test.ts` (passed), `npm run typecheck` (passed). The full `npm test`
is running and I will not push on a red one.

## Attack it

Independently, before you read my questions below. The statements to test:

1. Brief's prompt and the standard band's Fuller prompt are byte-identical to before, and nothing
   that reads `SIMPLE_SYSTEMS` breaks.
2. The band lookup cannot disagree with the request it is sent with, and no caller, stamp,
   staleness check or cache key needs the band.
3. The raised Fuller limit breaks no reader of a stored summary, visitor payload, export or token
   budget (`ANSWER_TOKENS`, `budgetFor`), and the test that holds each "never" under the cap means
   what it says.
4. The new tests would go red on a real regression. Mutate and see: a threshold off by one, Brief
   banded again, a band's numbers swapped, the band counted over all blocks instead of evidence.
5. **Every number and every conclusion in the investigation and the plan matches the result
   files.** Run `table`, `score` and `score sentence` and compare. In particular: "preferred the
   banded Fuller in all eight pairs where the prompt differed", "old Brief preferred in six of
   eight", "in all four short-essay pairs the 60-word Brief left out a point" (read
   `judge.md` for those four), and that the sentence showed no effect. Say if a conclusion is
   stronger than its evidence, or if I have explained away an inconvenient result.
6. `evals/simple/length-bands.ts` § `score` parses the judge's free text by each answer's first
   word. Does it misread any of the 35 sections?
7. The docs say what the code does, and no doc elsewhere still states the old limits or a length
   that is now wrong.

For each finding give:
  - an ID (F6, F7, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run, or the result file and line a claim contradicts
  - (b) the smallest change that closes it
A finding with no (a) goes last.

Severity: P0 data loss, security, wrong charging, service unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design or maintainability risk with no wrong
behaviour today; P3 prose. Refuse only on an established P0 or P1, and name what established it.
End with one line: APPROVE or REFUSE.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The control pairs show the judge prefers one of two writes of the same prompt about as often
  as not, so the Brief verdict (6 to 1) leans on the four quoted omissions more than on the count.
  Is the write-up honest about that?
- One cap per level means a standard-band Fuller could now be stored at up to 1,400 words.
- The stand-in book is a mathematical survey, not a narrative book like the one the report came
  from.
- A reviewer that edits docs can put words in Greg's mouth: do not add or alter any quotation
  attributed to Greg.
