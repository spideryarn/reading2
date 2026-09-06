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
  This repo ignores `api-dist/`, `scratch-bakeoff/`, `output/` and `*.activity.log`, none of which
  appear in any generic skip list — and the flip side is that a file written but not `git add`ed is
  not counted. `--untracked` counts it.
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

**What the 2026-08-27 run turned up**, as dated observations rather than current counts: seven files
and 400 lines in extensions cloc does not recognise (`.jsonc`, `.gitignore`, `.env.example`,
`.vercelignore`), 14 binary files with no lines at all, and — the reason generated material is kept
out of the hand-written headline — an 8,629-line lockfile plus 48 drizzle snapshots.

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

A dated example, not a fact — re-run the command rather than trusting it. Three of those numbers are
worth saying out loud:

- **53% of `src/` is comments.** That is the house style working, not a lint failure —
  [CLAUDE.md](../../AGENTS.md) asks for the reasoning to sit next to the code, and this is what it
  costs. Hence the `% cmt` column.
- **Tests are 43% of the code.** Source and tests are the same order of magnitude, which is the
  shape [testing.md](testing.md) is aiming for.
- **Two thirds of a line of prose per line of code.** `docs/` is the largest single category in the
  repo, and `docs/plans/` alone is larger than `src/web/`. That is deliberate and it is worth being
  able to see.

## See also

- [count-lines-in-a-repo.md](../reusable/count-lines-in-a-repo.md) — the design and the traps.
- [testing.md](testing.md) — what the `tests` row is made of, and `evals/`
- [static-analysis.md](static-analysis.md) — the checks that do gate, and why this one doesn't
- [linting.md](linting.md), [typechecking.md](typechecking.md) — the other two commands in this
  family; `scripts/check.ts` runs those and deliberately not this one

---

Up: [code-quality-overview.md](code-quality-overview.md)
