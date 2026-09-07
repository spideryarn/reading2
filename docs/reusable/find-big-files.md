# Finding the big files, and deciding whether to care

> what are the biggest code files? are they a source of concern?
>
> — Greg, 2026-09-06

Two questions, and the second one is the real one. The first is a `wc -l` away and the answer is
usually not interesting; the second is what somebody actually wants, and a list of the ten longest
files does not answer it. This page is how to get from one to the other without proposing a
refactor nobody needed.

[count-lines-in-a-repo.md](count-lines-in-a-repo.md) is the neighbouring question — *how big is this
repo* — and its two decisions (take the file list from git; break it down by what a file is for)
apply here unchanged. Don't restate them; the traps below are the ones specific to ranking
individual files.

## Rank by code, not by lines

`wc -l` is the wrong instrument in any repo whose house style puts the reasoning next to the code,
and it is wrong in a way that reorders the list rather than just inflating it. Here, ranked by raw
lines, [`src/types.ts`](../../src/types.ts) is the sixth-biggest file in the tree; ranked by code it
is not in the top twenty, because it is 81% comment. A file that is mostly prose is a *document*,
and the fact that it is long is a fact about how well it is explained.

So hand the git file list to cloc and sort on its `code` column:

```
git ls-files '*.ts' '*.tsx' '*.css' \
  | xargs npx cloc --quiet --by-file --csv \
  | awk -F, '$1!="language" && $2!="" && $2!~/^SUM/ {print $5, $2}' \
  | sort -rn | head -20
```

Print the comment column somewhere too, even if you don't sort on it. The gap between the two
rankings is itself the finding: files that are long *and* thinly commented are a different problem
from files that are long because somebody wrote down why.

## Size is not the finding. Size × churn × braiding is

A 3,000-line file that nobody has touched in a year is inert — it is not costing anybody anything,
and rewriting it spends real risk to buy nothing. The three multipliers, in the order they are worth
measuring:

**Churn, against a denominator.** "208 commits touched this file" means nothing on its own; "176 of
the last 2,126 commits" means it absorbs 8% of all the work in the repo. Get both numbers from the
same command shape so they are the same measure:

```
git log --since='90 days ago' --oneline --no-merges | wc -l          # the denominator
git log --since='90 days ago' --oneline --no-merges -- <path> | wc -l
```

In a tree several agents share, a hot file is also the merge-collision surface, and that cost scales
with the number of agents rather than with the size of the file. That is usually the strongest
argument for splitting one, and it is an argument nothing in the file itself will show you.

**Braiding — how much the file refers to its own other parts.** This is the cost of splitting it,
and it is measurable before you commit to anything. Grep for whatever your comments use to point
sideways; here that is `§`, and [`src/web/styles.css`](../../src/web/styles.css) carries 279 internal
references, sections that only make sense in the presence of other sections. A long file with none
of these is a stack of independent things and splits in an afternoon. A long file with hundreds is
one thing that happens to be long, and the split is a project.

**Where the size sits.** Find the biggest *span* inside the file before concluding anything about the
file. Ninety small functions in one file is a filing decision; one 700-line function is a design
problem, and only the second is worth anybody's time:

```
awk '/^(export )?(async )?function |^(export )?const [a-zA-Z0-9_]+ = (async )?\(/ {
       if (name) print len "\t" start "\t" name; name=$0; start=NR; len=0 } { len++ }
     END { if (name) print len "\t" start "\t" name }' <file> | sort -rn | head
```

Then cut the top span out with `sed -n 'START,ENDp'` and run cloc on *that*, because the span
lengths this prints are raw lines and inherit the same comment problem as the whole-file ranking.
The worked example here is [`src/routes.ts`](../../src/routes.ts) § `serveAuthenticatedApi`: the
file holds 89 top-level functions, which is fine, and that one function is 684 lines of code and
about 109 branches of a single if/else chain that every new endpoint appends to. The file was never
the thing to fix.

## The traps

**`--follow` quietly returns a smaller number than not using it.** It looks strictly better — it
tracks the file across renames — and it also turns off merge commits, which plain `git log -- <path>`
includes. On `styles.css` here: plain 208, `--follow` 177, and the file has never been renamed. Use
one or the other for every file you are comparing, never a mix, and prefer `--no-merges` on both
sides: a merge commit touching a file is usually somebody else's work arriving, not an edit.

**Generated and vendored files will top the list.** Lockfiles, migration snapshots, committed
fixtures, `dist/`. Taking the list from `git ls-files` handles the ignored ones structurally and
handles the *committed* ones not at all — which is why the categories in
[count-lines-in-a-repo.md](count-lines-in-a-repo.md) put `fixtures` and `generated` above `tests`.
Rank source, tests and generated output separately or the answer is about npm.

**A big file may be deliberate, and the reason is usually written down.** Check the doc that owns the
area before proposing anything. A stylesheet can be one file because of a load-order or cascade-layer
constraint; a schema can be one file because a tool reads it. Being unable to find a reason is not
the same as there not being one.

**Somebody may have already diagnosed it.** Grep the plans and postmortems for the filename first.
It is a bad look to hand over a confident proposal to split a file that was reviewed last week, and
worse to hand over a *different* proposal without engaging with why the first one wasn't adopted.

**A stale line count in a doc reads exactly like a current one.** The doc describing a file's shape
will quote its size, and that number rots silently — the one here said "~12,800 lines" of a file that
had reached 15,926. If you are already holding the real number, fix the doc while you are there.
[written-down-is-not-checked.md](written-down-is-not-checked.md) is the family.

## What to actually say

Report the ranking by code, name the two or three files where size × churn × braiding is genuinely
high, and for each one say what the *specific* cost is — merge collisions, a function nobody can hold
in their head, a cascade that has to be read end to end. Then say plainly which of the others are
fine, because "these six are long and that is not a problem" is most of the value of having asked.

Quote a commit with any of these numbers. A shared tree moves under you: two counts eleven minutes
apart can differ by thousands of lines because other agents were pushing in between.

## See also

- [count-lines-in-a-repo.md](count-lines-in-a-repo.md) — the whole-repo version of the question, the
  design of a count you can trust, and the four ways cloc goes quiet.
- [improve-the-codebase.md](improve-the-codebase.md) — where a finding from this page goes next, if
  it is worth acting on: clustered and prioritised with everything else, not fixed on sight.
- [written-down-is-not-checked.md](written-down-is-not-checked.md) — why the size quoted in a doc is
  believed long after it stopped being true.
- [counting-lines.md](../project/counting-lines.md) — this repo's port of the counting tool.
