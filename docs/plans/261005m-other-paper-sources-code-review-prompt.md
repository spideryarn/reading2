# Code review: seven more paper sources (plan 261005m, stage A)

You review **and fix**. Fix what is inside this stage, narrowly and red-first (a failing test before each fix). Report, do not fix, anything wider you noticed. Do not commit; do not run any git command that changes state. Work only in this worktree: `/var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources`.

## The candidate

Exactly one commit: `00edb215e`. `git show --stat 00edb215e` lists its paths; `git show 00edb215e -- <path>` shows each. Its files:

- `src/paper-sources.ts` — two arXiv mirror shapes inside `arxivIdIn`, and five new sources (`acl`, `pmlr`, `neurips`, `cvf`, `jmlr`). Start here.
- `src/pipeline.ts` — `fetchFromPaperSource` (a wrapper round the unchanged `fetchFirstCandidate`), display names.
- `src/messages.ts` — `FETCH_PAPER_MISSING`, `[fetch-paper-missing]`.
- `src/citations.ts` (`keysOf`), `src/cited-in-spideryarn.ts` (`identityOf`), `src/paper-text.ts` (`arxivPdfUrl`) — each now asks `arxivIdOf`.
- tests: `tests/paper-sources.test.ts`, `tests/fetch-candidates.test.ts`, `tests/citations.test.ts`, `tests/cited-in-spideryarn.test.ts`, `tests/paper-text.test.ts`.
- `evals/paper-sources/resolve-live.ts` and its output `docs/plans/261005m-evidence/resolve-live.txt` (23 real links through the step's loop and the real `fetchDocument`; you have no network, so this file is the evidence).
- docs: `docs/project/fetching.md`, `ingest-queue.md`, `copy.md`, and the plan.

That is where to start, not a limit on scope.

**What it is built on is not yours to review or fix:** the parent commit chain includes `0f63486a2`, part 1 of the same report by another session (the registry, `fetchFirstCandidate`, `urlKey`/`slugFromUrl` asking the registry, an `enqueue` hand-back). It is not yet on `dev` and has open findings of its own (F14–F16, in `enqueue` and an over-long arXiv slug). Leave its code alone except where this stage's lines touch it; if this stage is wrong *because* of something there, report it.

The plan is `docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md`: § Design is the spec, § Reviews has your own two plan reviews (G1–G14) and what was done with each.

## First, the fix your plan review never saw

**G11** was fixed after your round-2 snapshot. Check it first and say closed / still open: does a work an article cites by `https://huggingface.co/papers/1706.03762` (or alphaXiv) now get the arXiv work key in `keysOf`, and match an article whose stored address is `https://arxiv.org/pdf/1706.03762` through `matchOf`? Is anything stored under the old `url:` key orphaned by the key change (comments, read state, lookups keyed by a work's id)? The implementer says a stored row keeps its id through the `workKey` fallback (`inheritedBy`) and that this was **inferred, not tested**. Trace it; if it is wrong, that is a P0/P1.

Also check G12 and G13 as built: the failure sentence, its kind, when it is raised (only when the *last* address asked was absent; a 404 followed by a wrong-kind document is not "absent"), what is logged (no address), and that an ordinary address's 404 is byte-for-byte what it was.

## Then an independent attack

Yours to choose. Things I would want a reviewer to have tried, without limiting you:

- For each source's regex: an input that resolves and should not, or should and does not; anything that lets a character outside the intended class into a candidate URL; ReDoS; case handling (the ACL id is re-cased; CVF/PMLR/JMLR names keep their case in key and candidate — is a key then stable for the same paper pasted with different case, and does the server care?).
- The invariants: every recognised shape of a paper gives one `key`; every candidate's own address resolves back to that key; `slug` always passes `isSlug`; no two sources recognise one address.
- `paperAt` derives `key` from the landing URL as `hostname + pathname` — is that always exactly what `urlKey` would have answered for the landing page before (so an article imported earlier from the landing page is found), and is that what we want? What does `urlKey` do with `www.`, case, a trailing `.html`?
- `arxivPdfUrl`'s new shape test (`ABOUT_A_PAPER` on the first path segment) and every caller of it; `identityOf`'s character-class guard before it rebuilds a URL.
- `fetchFromPaperSource`: the `lastWasAbsent` bookkeeping across candidates, aborts, a thrown non-`FetchFailure`, and whether a success path changed at all.
- The eager client bundle: `src/paper-sources.ts` is loaded by the browser's first bundle (`tests/eager-client-graph.test.ts`); did it grow anything it should not?
- The docs added to `fetching.md`, `ingest-queue.md`, `copy.md`: do they say what the code does?

Run the tests yourself: `npx vitest run tests/paper-sources.test.ts tests/fetch-candidates.test.ts tests/citations.test.ts tests/cited-in-spideryarn.test.ts tests/paper-text.test.ts tests/messages.test.ts tests/ingest.test.ts` and `npm run typecheck`. They need nothing outside the tree. A finding you reproduced outranks one you reasoned to. Do not run the whole suite.

## Severity, and the form of a finding

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Number findings `H1`, `H2`, …; each *established* or *suspected*, with the concrete input or sequence, and whether you **fixed** it (name the test you wrote and saw red) or are **reporting** it.

End with a list of every file you changed, and one line: `VERDICT: ship` / `VERDICT: ship with the fixes I made` / `VERDICT: do not ship`.

## My own suspicions (already mine, worth less)

- The `workKey` inheritance claim above.
- An article imported from a landing page before this change shares the new key, so its owner is told they already have the paper and holds a stub until they refresh. Part 1 made the same choice for arXiv.
- CVF workshop paths and names containing a dot do not match and import as before.
