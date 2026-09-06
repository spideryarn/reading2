# Counting the lines

```
npm run count-lines
npm run count-lines -- --by-file          # the biggest files
npm run count-lines -- --category=tests   # every file in one bucket
npm run count-lines -- --by-language      # cloc's own view
npm run count-lines -- --json             # for a script to read
npm run count-lines -- --help
```

[`scripts/count-lines.ts`](../../scripts/count-lines.ts), ported from gjdutils.
**The design, and the four ways a line count goes quiet on you, are in
[count-lines-in-a-repo.md](../reusable/count-lines-in-a-repo.md)** — read that first; this page is
only what is true about this repo in particular.

Nothing gates on this number. It is here so that "how big is this thing now" is a command rather
than an argument.

## What is different here

- **The categories are `CATEGORIES` at the top of the script**, path rules in order, first match
  wins. `evals/results/` is the case that fixes the order: machine-written JSON and hand-written
  write-ups of what that JSON meant, side by side.
- **`.gitignore` is the only exclusion list**, which is the point of taking the file list from git.
  Nothing vendored is counted, and that is structural rather than a rule somebody maintains:
  `node_modules/`, `dist/`, `.vercel`, `api-dist` and `scratch-bakeoff` are ignored, so
  `git ls-files` never offers them and cloc never sees them. The one-line audit, if you want to see
  it hold rather than take it on trust:

  ```
  git ls-files | grep -E '(^|/)(node_modules|dist|\.vercel|api-dist|build|vendor)/'
  ```

  It printed nothing on 2026-09-06. This repo also ignores `output/` and `*.activity.log`, neither of
  which appears in any generic skip list — and the flip side is that a file written but not
  `git add`ed is not counted. `--untracked` counts it.
- **`CLAUDE.md` is a symlink to `AGENTS.md`**, which is the symlink that found the cloc
  de-duplication trap: cloc kept the symlink and dropped the target, so 261 lines were filed under a
  name that is not a file and the total was simply short. If a second symlink to real content ever
  appears, this is the failure to expect.
- **The arithmetic check here is weaker than it looks**, and this is the known hole.
  [`scripts/count-lines.ts`](../../scripts/count-lines.ts) § `gather` defines `skipped` as every
  listed file that did not end up in `counted`, so `total.files + skipped.length === files.length`
  holds by construction: a file that is unreadable, or that vanished between `git ls-files` and
  `readFileSync`, is silently reclassified as binary and the check still passes. It does catch
  double-counting. Closing it means testing each uncounted file rather than subtracting —
  [count-lines-in-a-repo.md](../reusable/count-lines-in-a-repo.md).

## What it says today

As of 2026-09-06, at `39282f8c`:

```
                     files     code   share  comment  % cmt    blank
docs                 1,460  328,535   47.8%    3,492   1.1%   72,601  docs/ and every other .md
  plans              1,077  242,487   35.3%
  project              104   41,120    6.0%
  research              55   14,572    2.1%
  postmortems           86   12,834    1.9%
tests                  789  190,273   27.7%  109,356  36.5%   27,287  vitest suites
source                 488  103,684   15.1%  155,507  60.0%   13,284  the app itself
  client               257   47,598    6.9%
  pipeline + server    167   43,576    6.3%
  storage               59   11,110    1.6%
evals                   86   31,034    4.5%   14,153  31.3%    2,030  model evals, run by hand
scripts                 94   23,449    3.4%   18,777  44.5%    2,893  dev + ops commands
styles                   5    8,688    1.3%    7,613  46.7%    1,378  hand-written CSS
config                  21    1,612    0.2%    1,022  38.8%      188  build, lint, deploy, supabase
— written by hand    2,943  687,275  100.0%  309,920  31.1%  119,661

fixtures               253  142,152       —                          committed pipeline output, eval PDFs
generated              421  661,997       —                          drizzle migrations, eval results, the lockfile
— nobody wrote         711  810,105       —
```

A dated example, not a fact — re-run the command rather than trusting it, and note that the tree
moves under you: two runs eleven minutes apart on 2026-09-06 differed by 93 files and 19,290
hand-written lines, because other agents were pushing to `dev` in between. Quote a commit with a
count or the number means nothing.

Three of those numbers are worth saying out loud:

- **60% of `src/` is comments** (53% in August). That is the house style working, not a lint
  failure — [CLAUDE.md](../../AGENTS.md) asks for the reasoning to sit next to the code, and this is
  what it costs. Hence the `% cmt` column.
- **Tests are 63% of the code**, up from 43% in August: 190,273 lines of tests against 103,684 of
  app and 8,688 of CSS. Tests are now comfortably the larger half, which is the shape
  [testing.md](testing.md) is aiming for.
- **1.09 lines of prose per line of code**, up from two thirds. `docs/` is the largest single
  category in the repo and `docs/plans/` alone — 1,077 files, 242,487 lines — is more than twice
  `src/`. That is deliberate and it is worth being able to see.

**What the 2026-09-06 run turned up**, again as dated observations: 72 files that cloc returned
nothing for, 88 binary files (39 `.png`, 18 `.jpeg`, 13 `.pdf`, 11 `.webm` dictation clips) with no
lines at all, and — the reason generated material is kept out of the hand-written headline — an
11,239-line lockfile plus 78 drizzle snapshots.

Those 72 are not all unrecognised extensions, which is what the August note assumed. **61 of them
are `.json`, and they are byte-duplicates** — repeated-sample eval outputs under `evals/pdf/titles/`,
22 distinct contents between them. This is the same cloc de-duplication that ate `AGENTS.md`: cloc
hashes contents and reports the first file only. Here it costs nothing, because the fallback counter
picks up everything cloc returned no row for and counts it the plain way — but the rescue path is
load-bearing, not a nicety, and without it the total would be short by 31,349 lines while every
column still added up.

## See also

- [count-lines-in-a-repo.md](../reusable/count-lines-in-a-repo.md) — the design and the traps.
- [testing.md](testing.md) — what the `tests` row is made of, and `evals/`
- [static-analysis.md](static-analysis.md) — the checks that do gate, and why this one doesn't
- [linting.md](linting.md), [typechecking.md](typechecking.md) — the other two commands in this
  family; `scripts/check.ts` runs those and deliberately not this one

---

Up: [code-quality-overview.md](code-quality-overview.md)
