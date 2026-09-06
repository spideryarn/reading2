# Counting the lines in a repo, honestly

"How big is this thing now" should be a command, not an argument — and the answer should be the same
one every time somebody asks. The tool is gjdutils'
[`count-lines.ts`](https://github.com/gregdetre/gjdutils/blob/main/src/ts/scripts/count-lines.ts),
which wraps [cloc](https://github.com/AlDanial/cloc) (`brew install cloc`; without it the script
still runs and says so).

**Nothing should gate on this number.** It is a description, not a target — the moment a line count
is something to keep down, the categories start being gamed and the number stops describing
anything.

This page is the *design* of a line count you can trust, and the four ways one goes quiet on you.
The port into a given repo is that repo's own doc.

## Two decisions worth copying

**Take the file list from git, not from a hand-kept exclude list.** The obvious shape is to hand cloc
a directory plus a list of things to skip — `node_modules`, `dist`, build output, vendored copies.
That list is a second copy of `.gitignore`, and a second copy drifts: every repo ignores a few things
that appear in no generic list, and the day somebody ignores a fifth thing a hard-coded list starts
counting it without saying anything. `git ls-files` already knows, so make it the input, and let
`.gitignore` be the only place an exclusion is ever written.

The cost is real and worth stating out loud: **a file you have written but not `git add`ed is not
counted.** Offer an `--untracked` flag for the way out. In a tree several agents share, a big number
that moved for no reason is usually somebody's new directory arriving in the index.

**Break it down by what a file is for, not what language it is in.** cloc groups by language, which
in a TypeScript repo means one enormous row. The interesting question is how much is product code,
how much is tests, and how much is prose. So: path rules, in order, and a file belongs to the
**first** category that claims it. Two ordering judgements carry most of the weight:

- **Put `docs` first, so a `.md` is prose wherever it sits.** Machine-written output and
  hand-written write-ups of what that output meant end up side by side all the time; a rule that
  claims a whole directory will file the essays as generated output.
- **Put `fixtures`, `generated` and `assets` above `tests`.** Otherwise committed pipeline output —
  there so a test has something to run against — counts as a test somebody sat down and wrote.

Keep those three listed but out of the headline, under a `— nobody wrote` heading. A total that
includes a lockfile and a few dozen migration snapshots is measuring npm, not you.

Anything matching no rule lands in `other`, which is **printed with a note rather than dropped**. If
`other` is growing, the rules need one more line.

**And print a comment column.** A repo whose house style asks for the reasoning to sit next to the
code can be half comments, and that is the style working rather than a lint failure. Any "lines of
code" figure that folds comments in, or silently drops them, is describing a different repo.

## The four ways it goes quiet

Each of these was found by running the thing, and none of them raises an error.

**A symlink makes a file disappear.** `git ls-files` lists symlinks. Hand both a symlink and its
target to cloc and it counts one and drops the other as a duplicate — and it is free to drop the
*real* one, filing the lines under a name that is not a file. Nothing warns; the total is simply
short. Drop symlinks from the list before cloc sees them, on the grounds that a symlink has no lines
of its own.

**cloc silently omits extensions it has never heard of.** `.jsonc`, `.gitignore`, `.env.example`,
`.vercelignore` and friends are *absent* from cloc's output, not zeroed. Count those yourself,
without a comment split, and say in the output how many files and how many lines. A count that
quietly depends on which extensions a third-party tool recognises is a count that shrinks when you
rename a file.

**Binary files have no lines at all.** PDFs, PNGs, favicons, certificates. Name them in the output
rather than folding them into a total, because "counted files" and "files in the repo" being
different numbers should be visible.

**And account for every uncounted file by name — not by subtraction.** The tempting last line is an
arithmetic check: *counted + binary must equal listed, or the script has a bug.* It is worth having,
but only if the binary list is built by **testing each file**. Define it as "everything that did not
get counted" and the identity is true by construction: a file that vanished between `git ls-files`
and the read, or that threw on open, is quietly reclassified as binary and the arithmetic still
balances. The check then catches double-counting and nothing else, which is not what it looks like
it is doing. Classify each uncounted file as a *verified* binary or a *named* read failure, and print
both. [silent-success.md](silent-success.md) is the family this belongs to.

## See also

- [silent-success.md](silent-success.md) — the family this page's second half belongs to.
- [counting-lines.md](../project/counting-lines.md) — this repo's port, its categories, and what the
  number says today.
