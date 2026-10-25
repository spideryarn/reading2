# Code review: an arXiv DOI's OpenAlex record with another title (investigation 261025a)

You are reviewing a small change in a TypeScript repo, in this worktree. Read `CLAUDE.md` first for
the house rules. You may fix what you find inside the change's scope (edit `src/citation-index.ts`
and `tests/citation-index.test.ts` only); report anything wider rather than fixing it.

## The bug

Sources' *Cited by* (and the `situate` step's citers, via `confirmedWorkOf`) asks OpenAlex for the
record of the article's DOI and refuses it unless the record carries the article's whole title and
one of its authors (`isThisArticle`). For arXiv 2308.08708, *Consciousness in Artificial
Intelligence* (Butlin, Long et al.), OpenAlex's record W4386113651 has the right DOI, the right
authors (Butlin, Long, Elmoznino, Bengio, Birch, …), 196 citers that are plainly this paper's
(*The Edge of Sentience*, *Tests for consciousness in humans and beyond*, …), and Zenodo deposits
merged into its locations — and its title is a Zenodo deposit's, *Cheap Correlate or
Discriminating Property? …*. So the check refused it and the article showed no citers.

## The change

Run `git diff -- src/citation-index.ts tests/citation-index.test.ts` in this worktree. For an arXiv
DOI only (`doi:10.48550/arxiv.…`, the form `citersIdOf` returns), a record whose title is not the
article's is accepted when two different people among its authors are the article's
(`agreeingAuthors`, the title search's own counting). Every other DOI keeps the title rule. The
same function is used on a cache hit and a stale fallback, so those are checked by the same rule.
The new test was red before the change and is green after.

## What to check

1. Is this safe against the failure the file header names — a second article carrying the DOI by
   mistake being handed the first one's citers? In particular: an article whose *address* is an
   arXiv page but whose stored DOI is someone else's arXiv DOI; an author's own later paper or blog
   post carrying their earlier paper's arXiv DOI; a single-author paper.
2. Is `agreeingAuthors >= 2` the right bar, given how `registryAuthorIsOurs` and `sameNamedPerson`
   behave with initials and duplicated spellings?
3. Is the test a real test of the behaviour, and does it cover the negative cases enough?
4. Anything in `src/situate-citers.ts`, `src/situate.ts` or Reception's panel
   (`src/web/ReceptionAndClaimsPanel.tsx`) that shows or prompts with `target.title` for a DOI
   route and would now carry the wrong title.

Write your findings, each with a severity and file:line, then what you changed, to the answer
file. Run `npx vitest run tests/citation-index.test.ts` after any edit.
