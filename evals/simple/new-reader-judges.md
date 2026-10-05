# The three judges' briefs for `new-reader.ts`

The measurement for
[plan 261005h](../../docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md).
Each brief goes, word for word, to a **fresh subagent that is told nothing else**: not which prompt
wrote what, not what the change is, not what is hoped for. The file it reads is built by
`npx tsx evals/simple/new-reader.ts audit | pairs | grounded`, and the file it writes is what
`score` reads. All paths are under `evals/results/simple/new-reader-261005h/`.

## 1. The audit: one summary at a time

> Read `audit.md` and nothing else in the repository. Do not open any other file, and do not use
> the web.
>
> It holds summaries of pieces of writing, one to a section, each with a line saying who the reader
> is. You have not read the pieces. Several sections summarise the same piece: judge each section
> as if it were the only one you had seen, and never use one section to understand another.
>
> For each section, be that reader, reading the summary from the top with nothing else to go on.
> List every place where you could not follow it from the summary alone:
>
> - a word, abbreviation or name that is used without the summary saying what it is, and that this
>   reader would not already know;
> - a phrase in quotation marks that does not make sense on its own;
> - a reference to something the summary has not introduced ("the second experiment", "the earlier
>   model", "this effect") where you cannot tell what is meant;
> - a number given without what it counts or what it is being compared with;
> - a step that does not follow because something needed to follow it was never said.
>
> Do not list a term the reader's own description says they know, or one any such reader would
> know. Do not list something the summary explains, even briefly, where it first appears. Do not
> list matters of style.
>
> Write `audit-judge.md` in the same directory. For every section, in the same order and under the
> same heading (`## S01`), one line for each place, starting with `- `, quoting the words and
> saying in a few words what was missing; then a line `count: N`, where N is the number of `- `
> lines in that section. A section with nothing to list has only `count: 0`. Use `- ` at the start
> of a line for nothing else.

## 2. The pairs

> Read `pairs.md` and nothing else in the repository. Do not open any other file, and do not use
> the web.
>
> It holds pairs of summaries. Each pair is two summaries of the same piece, A and B, in a random
> order, with a line saying who the reader is. You have not read the pieces. Judge each pair on
> its own.
>
> Be that reader, who has not read the piece. For each pair answer five questions. Each answer
> starts with one of `A`, `B`, `same`, `both` or `neither`, then a short reason.
>
> - `follow:` which could you follow more easily from the summary alone? (`A`, `B` or `same`)
> - `more:` which tells you more of what the piece did, found and admits? (`A`, `B` or `same`)
> - `padded:` does either spend words saying little? (`A`, `B`, `both` or `neither`)
> - `down:` does either explain what this reader plainly knows, or talk down to them? (`A`, `B`,
>   `both` or `neither`)
> - `prefer:` which would you rather be given before reading the piece? (`A`, `B` or `same`)
>
> Write `pairs-judge.md` in the same directory: for every pair, in the same order and under the
> same heading (`## P01`), those five lines, each starting with the question's word and a colon.

## 3. Against the piece

One subagent a piece, each given one file, `grounded-<slug>.md`, and writing
`grounded-judge-<slug>.md`.

> Read `grounded-<slug>.md` and nothing else in the repository. Do not open any other file, and do
> not use the web.
>
> It holds one piece of writing in full, a list of what one reader says they already know, and
> then several summaries of the piece, each under its own heading, with a line saying who it was
> written for. The summaries are in a random order.
>
> First read the piece and write down, for yourself, its main findings or claims: the five to
> eight things a careful summary of several hundred words could not leave out. Then check each
> summary against the piece and list its faults, of three kinds only:
>
> - `- omitted:` one of those main findings or claims is missing from the summary altogether;
> - `- bent:` the summary says something the piece does not say, or says it with more certainty,
>   a different direction or a different number, or so loosely that it no longer says what the
>   piece says;
> - `- known:` only for a summary written for the reader described: it stops to explain something
>   on that reader's list of what they already know.
>
> A detail left out is not a fault; a summary cannot hold everything. Hold every summary to the
> same list of main findings.
>
> Write `grounded-judge-<slug>.md` in the same directory. Begin with your list of main findings,
> as a numbered list. Then, for every summary, in the same order and under the same heading
> (`## G01`), one line a fault, starting with `- omitted:`, `- bent:` or `- known:` and saying
> which finding or which words; then a line `faults: N`, where N is the number of `- ` lines in
> that section. A summary with no fault has only `faults: 0`. Use `- ` at the start of a line for
> nothing else.
