# Review: Summary's Brief is asked for about 100 words where it was about 80

Repo: this worktree, branch `worktree-brief-slightly-longer-2`. TypeScript, ESM. Summary is a
reading mode that writes plain-words paragraphs about an article at two lengths, Brief and
Fuller, one model call each (`src/simple-summary.ts`). You reviewed the plan and the code of the
change before this one (plan 261005b, findings F1 to F10 in its § Ledger). Number new findings
from F11.

## The candidate

Uncommitted, in the working tree, against `HEAD`:

    git status --short          # the complete manifest, untracked result files included
    git diff HEAD

Start with: `src/simple-summary.ts` (`BRIEF_LENGTH`, `SIMPLE_PROMPT_VERSION` and the comment
above each), `tests/simple-two-levels.test.ts`, `tests/simple-length-bands.test.ts`,
`tests/simple-summary.test.ts`, `evals/simple/length-bands.ts` (the `-brief` round), then the
prose: `docs/investigations/261005a-summary-length-bands-measured.md` § A slightly longer Brief:
round three, `docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md` § A slightly
longer Brief, and `docs/project/summaries.md` § A slightly longer Brief. That is where to begin,
not the limit of scope.

The evidence: `evals/results/simple/high-none-len0a|len0b` (the before side, written that
morning), `high-none-brief90a|b` and `high-none-brief100a|b` (new), and in
`evals/results/simple/length-bands-261005b/`: `pairs-brief.md`, `key-brief.json`,
`judge-brief-instructions.md`, `judge-brief.md`.

## What it is meant to do

Greg, 2026-10-05, asked whether a book should get a longer Brief: "maybe Brief could be ever so
slightly longer but not much". The brief I was given: make Brief a little longer, roughly an ask
of 80 to 100 and not more; decide from a small blind measurement whether that is for every piece
or only the long and book bands; keep a "not padded" bar; if the judge still prefers the current
Brief, pick the smallest increase that is not judged worse and say so plainly; check the words
actually written, not only the ask.

What I did: `BRIEF_LENGTH` goes from `{words: 80, never: 130}` to `{words: 100, never: 150}`, for
every piece. Nothing else in Brief's prompt moves, and nothing of Fuller's. The prompt version is
`simple-prompt/10`. Brief's stored limit (`SIMPLE_LIMITS.brief`, 240 words) is untouched.

## The conclusion I want you to check, as hard as the code

1. **"Not judged worse, and not judged better."** I say the judge could not tell the 100 from the
   old Brief: 6 to 4 to 1, beside a control of 4 to 1. Is that what `score brief` prints, and is
   that the honest reading? In particular: the judge called the 100 the padded side in 5 pairs
   and the old in 2. Have I explained that away? Greg's bar was "not padded".
2. **"Every piece, not the long ones alone."** For the book the old Brief was preferred in 4 of 4
   pairs; under 15,000 words the 100 was preferred 5 to 2. I shipped one length for all. Is there
   a better-supported choice I passed over (leave Brief alone; lengthen only under 15,000 words;
   ship 90)? Say which you would ship and why.
3. **"100 and not 90."** The 90 arm was preferred less often than the old Brief (3 to 8). I read
   that as noise and still used it to rule 90 out. Is that consistent?
4. **The seed.** The first seed put the new arm on side B in 16 of 22 test pairs, so I took the
   next seed (11 and 11), from the side counts alone, before judging. Is that sound, and is it
   recorded so a reader can see it?
5. **The before side is from the morning, the after side from the evening**, same model, same
   Brief prompt bytes until this change. Does anything in the result files contradict that
   (`version`, `systemsSha256`, `model`)? Do the `brief100` files' `systemsSha256` match the
   prompts now in the tree for their band? (I started a script to check this and it had not
   returned when I wrote this; check it yourself:
   `sha256(JSON.stringify(SIMPLE_SYSTEMS_BY_BAND[band]))` against each file.)
6. Every number in the three docs against the result files and `score brief` / `table`.

## The code statements to test

1. Brief's prompt differs from `/9` in those two numbers and nothing else; Fuller's is the same
   bytes in every band.
2. Nothing else reads Brief's length: no limit, budget (`ANSWER_TOKENS`), validation, staleness
   check or cache key needs to change, and nothing stored becomes unreadable or stale (only
   *outdated*, which is silent).
3. Every test or comment that said "80", "130" or "`simple-prompt/9` is current" is updated or is
   correctly historical.
4. The `-brief` round in `evals/simple/length-bands.ts` pairs and scores what the docs say, and
   the first two rounds still print what they printed (`score`, `score sentence`).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this change, narrowly, and leave anything wider
as a finding for me to decide. Do not commit. Do not use git commands that change the tree. List
every file you changed at the end. Do not attribute any sentence to Greg that is not the one
quoted above.

You have no network, not even loopback: nothing that needs Postgres or a model will run. The box
is under heavy load, so wrap anything you run in `flock /var/tmp/spideryarn-heavy.lock <command>`
and run only: `npx vitest run tests/simple-length-bands.test.ts tests/simple-summary.test.ts
tests/simple-two-levels.test.ts`, and `npx tsx evals/simple/length-bands.ts table|score brief|
score|score sentence`. No full suite, no typecheck: I run those.

A peer session is about to land a Fuller-only change that also takes a prompt version. Whoever
lands second renumbers; do not treat `/10` being contested as a finding.

## Your answer

A verdict (approve, approve after fixes, or do not ship), then findings numbered from F11, each
with a severity (P0 to P3), the evidence, and what you did about it.
