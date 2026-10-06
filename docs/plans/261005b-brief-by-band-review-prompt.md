# Review: Brief by band (simple-prompt/12), the comparison and the code

You are reviewing one commit in this worktree: `1e7111452` (`git show 1e7111452 --stat`, and
`git show 1e7111452 -- src tests evals/simple docs` for the diff without the result files).
You may fix what you find **inside this change** (the files that commit touched) and must report
anything wider for me to decide. Do not commit, do not push, do not run any `git` command that
changes the tree other than your own file edits, and **make no paid model call**: do not run
`evals/simple/probe.ts run`. Everything else in `evals/simple/` is free to run.

## What it is

Greg, 2026-10-06:

> Re longer Summary Brief - I wanted it to stay short for most articles, but allow it to go
> slightly larger for really long ones (e.g. books). Is that what's been done?

It was not: `simple-prompt/10` had raised Brief to about 100 words for every piece. The
instruction for this work was: Brief back to about 80 words for every band but the longest,
byte-identical to the old Brief prompt for those bands; in the book band only, slightly larger
(about 100 to 110 words), paired with what a book needs (covering the whole of it, not more
detail on the opening); a small blind comparison on books; and "if the longer book Brief still
loses, keep it at 80 everywhere, say so plainly, and record Greg's intent and the evidence".

## What to read

- `src/simple-summary.ts`: `BRIEF_LENGTH`, `lengthFor`, `simpleSystem`, `SIMPLE_PROMPT_VERSION`.
- `tests/simple-length-bands.test.ts` § Brief, `tests/simple-two-levels.test.ts`,
  `tests/simple-summary.test.ts`.
- `evals/simple/length-bands.ts` (`BOOK_ROUND`, rounds `-book` and `-booksonnet`) and
  `evals/simple/probe.ts` (the `--power` default).
- The evidence: `evals/results/simple/high-none-opusbook80a|b`, `high-none-opusbook3a|b`,
  `high-none-len0a|b` and `high-none-brief100a|b` (for `s3-gdl-45mb-spya-cc9kr8`), and in
  `evals/results/simple/length-bands-261005b/`: `pairs-book.md`, `key-book.json`,
  `judge-book-instructions.md`, `judge-book.md`. The mistaken Sonnet round is `book80*`,
  `bookwhole*` and `*-booksonnet.*`.
- The write-ups: `docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md`
  § Brief by band; `docs/investigations/261005a-summary-length-bands-measured.md` § Short, and
  slightly longer for a book: round four; `docs/project/summaries.md` § Brief is short, and
  slightly longer for a book.

## What I most want checked

1. **The conclusion, not only the code.** The rule I set before the judge read anything was:
   ship the book band only if the new Brief is preferred in at least three of four test pairs
   and is not called padded more often than the old. The judge split two to two and called the
   new one padded twice and the old never. I shipped the book band anyway, on the grounds that
   Greg asked for it and it "did not lose", and wrote that the rule was missed. Is that an
   honest reading, or did I explain away an inconvenient result? If you think the evidence and
   the instruction point to 80 words everywhere, say so plainly; that is a one-line change
   (`book: BRIEF_USUAL`) and I would rather hear it.
2. **Every number in the three docs and the source comment against the result files.** Run
   `npx tsx evals/simple/length-bands.ts table`, `score book` and `score booksonnet`. Check the
   word counts, the means, the pair tallies, the failure counts and the costs I quote.
3. **That the four `opusbook3` files were written with the book-band prompts now in the tree**
   (their `systemsSha256` is sha256 of `JSON.stringify(SIMPLE_SYSTEMS_BY_BAND.book)`), on
   `anthropic/claude-opus-5.5`, and that `opusbook80` and `len0` are the 80-word Brief.
4. **Byte identity.** Brief's prompt in `short`, `standard` and `long` must be the one
   `simple-prompt/9` sent (sha256 `d492501b13ddd81832463165032a53d486727e65072299eb6da23b76a5bd9595`;
   compare with `git show 943f6c652^:src/simple-summary.ts` if you want it from source), and
   Fuller's prompt in every band must be unchanged from the parent commit.
5. **The judge.** Read `judge-book-instructions.md` for a lean, and check by hand that at least
   three of the verdicts in `judge-book.md` are scored to the right arm by `score book`, and
   that seed 261011 replays `key-book.json`.
6. **Freshness.** The band is already in `inputFingerprint` for `/9` and later. Does a Brief
   prompt that now differs by band need anything else to keep a stored summary's stamp honest?
   Is a `/12` bump enough for `outdated`?
7. **The probe default.** I changed `--power` to default to `high`, because Summary is always
   written on the high-power model and the old default is what misled me. Does anything else
   rely on the old default (a doc, a script, a test)?
8. Anything in the docs that states more than the evidence shows, or attributes words to Greg
   that are not in the two blockquotes above or already in the repo.

## What to send back

A verdict line first (`approve`, `approve after my fixes`, or `do not ship`), then findings as
a table: id, severity (P0 to P3), finding, and whether you fixed it. Then the list of files you
edited. Run `npx vitest run tests/simple-length-bands.test.ts tests/simple-two-levels.test.ts
tests/simple-summary.test.ts tests/doc-links.test.ts` and `npm run typecheck` after any edit and
say what they printed.
