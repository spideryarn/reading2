# Review: a plan to make Summary's length follow the length of the piece

Repo: this worktree, branch `worktree-fbgttwhn-summary-length-follows-text`. TypeScript, ESM. A
reading app; Summary is a mode that writes a few plain-words paragraphs about an article at two
lengths, Brief and Fuller, one model call each.

## The candidate

Live pre-commit: base `27c7ded9` (origin/dev as merged here); scoped paths:
`docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md`; untracked: that file, this
prompt, and `evals/results/simple/high-none-len0a/` (three result files, the "today" table in the
plan). Not durable; the commit SHA is recorded in the plan's ledger once it lands.

Start with: the plan, then `src/simple-summary.ts` (the prompt, `PITCH`, `simpleSystem`,
`ANSWER_TOKENS`, `buildLevel`, `generateSimpleSummary`), `src/types.ts` § `SIMPLE_LIMITS` and
`isSimpleParagraphs`, `src/pipeline.ts` § `simple`, `tests/simple-two-levels.test.ts`,
`tests/simple-summary.test.ts`, `evals/simple/probe.ts`, `docs/project/summaries.md`,
`docs/project/prompting-guide.md` § Measuring a prompt change. That is where to begin, not the
limit of scope.

## What it is meant to do

An admin's request, quoted at the top of the plan: a book should get a somewhat longer summary than
a short article, not linearly, by a tweak to the prompts. The plan picks one of four length bands
from the body's word count and builds each level's system prompt for that band; the standard
band's prompts must stay byte-identical to today's; the stored limits rise once so the book band
fits. Nothing stored is rewritten. Simplest version first is an explicit requirement from the
requester.

Out of scope: any UI change, streaming, the fidelity guard's design, the profile rules.

## What you can and cannot run, and what you may change

The tree is read-only for this review. /tmp and the node_modules caches are writable. You can run
one test file (`npx vitest run tests/simple-two-levels.test.ts`) and a script. You have no
network, not even loopback, so anything needing Postgres or a model will not run; the one paid run
so far is the three JSON files named above.

## Attack it

Independently, before you read my questions below. The statements to test are the plan's own:

1. "The standard band's two prompts do not change by a byte", and everything that pins or reads
   `SIMPLE_SYSTEMS` keeps working with the shape the plan describes.
2. Raising `SIMPLE_LIMITS` breaks no reader of a stored summary, no visitor payload check, no
   export, and no token budget; and the rollback paragraph is accurate.
3. The band is computed from something every caller of `generateSimpleSummary` has, and it cannot
   disagree with what the pipeline's stamp or staleness checks compute (they must not need the
   band).
4. The article's cache entry (shared with other steps) is not split or lost by a per-band system
   prompt.
5. The measurement would actually detect a bad outcome: a padded long summary, a short one that
   lost something, a write failing on a limit.
6. Is there a simpler design that gets most of the value that the plan missed or dismissed wrongly?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the contract in the code it contradicts
  - (b) the smallest change that closes it: exact replacement wording for the plan
A finding with no (a) goes last.

Severity: P0 data loss, security, wrong charging, service unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design or maintainability risk with no wrong
behaviour today; P3 prose. Refuse only on an established P0 or P1, and name what established it.
End with one line: APPROVE or REFUSE.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether the thresholds and numbers are sensible is a product call I am putting to the requester;
  I would still like to hear if any row is plainly wrong (for instance a Brief of 140 words at a
  twelve-year-old's pitch with "every sentence under 18 words").
- Whether one cap per level rather than per band is too loose.
- Whether the extra "cover the whole of it" sentence belongs in this change at all.
- `MAX_SENTENCES_ASKED` and the per-paragraph sentence ask ("two to five") are unchanged, so 900
  words in seven to ten paragraphs of at most five sentences under 30 words is feasible, but only
  just at the low end; is the shape self-consistent in every band?

Do not change any file.
