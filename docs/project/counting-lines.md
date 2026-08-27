# Counting the lines

```
npm run count-lines
npm run count-lines -- --by-file          # the biggest files
npm run count-lines -- --category=tests   # every file in one bucket
npm run count-lines -- --by-language      # cloc's own view
npm run count-lines -- --json             # for a script to read
npm run count-lines -- --help
```

[`scripts/count-lines.ts`](../../scripts/count-lines.ts). Ported from gjdutils'
[`count-lines.ts`](https://github.com/gregdetre/gjdutils/blob/main/src/ts/scripts/count-lines.ts),
which wraps [cloc](https://github.com/AlDanial/cloc). `brew install cloc`; without it the script
still runs and says so.

Nothing gates on this number. It is here so that "how big is this thing now" is a command rather
than an argument, and so the answer is the same one every time somebody asks.

## What it says today

As of 2026-08-27:

```
docs                   203   52,555   38.0%       13   0.0%  13,683  docs/ and every other .md
tests                  186   34,645   25.1%   14,471  29.5%   5,138  vitest suites
styles                   4    4,588    3.3%    3,100  40.3%     628  hand-written CSS
source                 213   41,879   30.3%   47,284  53.0%   5,277  the app itself
evals                    8    1,812    1.3%      764  29.7%     196  model evals, run by hand
scripts                 15    1,811    1.3%    1,327  42.3%     250  dev + ops commands
config                  17      869    0.6%      445  33.9%     118  build, lint, deploy, supabase
— written by hand      646  138,159  100.0%   67,404  32.8%  25,290
```

Three of those numbers are worth saying out loud:

- **53% of `src/` is comments.** That is the house style working, not a lint failure —
  [CLAUDE.md](../../AGENTS.md) asks for the reasoning to sit next to the code, and this is what it
  costs. Any "lines of code" figure that folds the comments in, or silently drops them, is
  describing a different repo. Hence the `% cmt` column.
- **Tests are 43% of the code.** Source and tests are the same order of magnitude, which is the
  shape [testing.md](testing.md) is aiming for.
- **Two thirds of a line of prose per line of code.** `docs/` is the largest single category in the
  repo, and `docs/plans/` alone is larger than `src/web/`. That is deliberate and it is worth being
  able to see.

## The two decisions

**The file list comes from git, not from a hand-kept exclude list.** The gjdutils original hands
cloc a directory plus a list of things to skip — `node_modules`, `dist`, `data`, `.vercel` and so
on. That list is a second copy of `.gitignore`, and a second copy drifts. This repo ignores
`api-dist/`, `scratch-bakeoff/`, `output/` and `*.activity.log`, none of which appear in any generic
list, and the day somebody ignores a fifth thing a hard-coded list starts counting it without
saying anything. `git ls-files` already knows, so it is the input, and `.gitignore` is the only
place an exclusion is ever written.

The cost is real and worth stating: **a file you have written but not `git add`ed is not counted.**
`--untracked` counts it. In a tree several agents share, a big number that moved for no reason is
usually somebody's new directory arriving in the index.

**The breakdown is by what a file is for, not what language it is in.** cloc groups by language,
which for this repo means one enormous TypeScript row. The interesting question is how much is
product code, how much is tests, and how much is prose. Categories are path rules in `CATEGORIES`
at the top of the script; a file belongs to the **first** category that claims it, and the order
encodes two judgements:

- `docs` is first, so **a `.md` is prose wherever it sits**. `evals/results/` holds machine-written
  JSON and hand-written write-ups of what that JSON meant, side by side. A rule that claimed the
  whole directory would file six essays as generated output.
- `fixtures`, `generated` and `assets` come next, above `tests`. Otherwise
  `test/fixtures/structures.blocks.json` — pipeline output, committed so a test has something to run
  against — counts as a test somebody sat down and wrote.

Those three are listed but kept out of the headline, under `— nobody wrote`. A total that includes
an 8,629-line lockfile and 48 drizzle snapshots is measuring npm and drizzle-kit, not us.

Anything matching no rule lands in `other`, which is printed with a note rather than dropped. If
`other` is growing, the rules need one more line.

## The ways it goes quiet

Every one of these was found by running it, and each is now either fixed or reported in the output.

**A symlink made the repo's largest document disappear.** `git ls-files` lists `CLAUDE.md`, which is
a symlink to `AGENTS.md`. Hand both to cloc and it counts one and drops the other as a duplicate —
and it dropped `AGENTS.md`, so 261 lines were filed under a name that is not a file. Nothing warned;
the total was simply 261 short. The script now drops symlinks from the list before cloc sees them, on
the grounds that a symlink has no lines of its own. If a second symlink to real content ever appears,
this is the failure to expect.

**cloc silently omits extensions it has never heard of.** `.jsonc`, `.gitignore`, `.env.example`,
`.vercelignore` — seven files and 400 real lines here — are absent from cloc's output entirely,
not zeroed. The script counts those itself, without a comment split, and says in the output how many
and how many lines. A count that quietly depends on which extensions a third-party tool recognises
is a count that shrinks when you rename a file.

**Fourteen binary files have no lines at all** (PDFs, PNGs, the favicon, a CA certificate). They are
named in the output rather than folded into a total, because "counted files" and "files in the repo"
being different numbers should be visible.

**The arithmetic checks itself.** Every listed file must end up either counted or in the binary
list. If those do not add up the script prints a warning naming itself, because a silently dropped
category would look exactly like a repo that got smaller —
[silent-success.md](../reusable/silent-success.md) again.

## See also

- [testing.md](testing.md) — what the `tests` row is made of, and `evals/`
- [static-analysis.md](static-analysis.md) — the checks that do gate, and why this one doesn't
- [linting.md](linting.md), [typechecking.md](typechecking.md) — the other two commands in this
  family; `scripts/check.ts` runs those and deliberately not this one
