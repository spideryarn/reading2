# Code review: 261004j, shelf topic pills take in more articles

You are reviewing built code before it is pushed to `dev`. **Fix what you find inside this stage's
files** (listed below), run the tests named at the end, and report anything wider for me to decide.
Do not commit. Do not touch `evals/shelf-topic-clusters/hier.ts` or
`evals/shelf-topic-clusters/model-topics-v1.tmp.ts`: a paid eval is running that loads them; report
instead. Do not edit anything under `src/public/`, `src/store/public-library.ts` or
`src/web/PublicLibraryPage.tsx` (listed defences; Part 2 of the plan is deliberately not built).
If you edit a doc, do not write or alter any quotation attributed to Greg.

Read:

1. `docs/plans/261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md`: the
   plan, including "What the review and the measurements changed" (your plan review's findings and what
   was done about each).
2. `docs/plans/261004j-shelf-topic-pills-code-review.diff`: the scoped diff against `b1d0734a`.
3. The files themselves: `src/shelf-terms/model-topics.ts` (`BELONGS`, `fileMessages`, `rethink`,
   `widen`, `filedInto`, `fileWorks`), `src/shelf-topic-sets.ts` (`RETHINK_DEADLINE_MARGIN_MS`, the
   `deadline` passed to `rethink`, `termsFromSet`, `whatIsDue`, the drain), `src/web/shelf-narrow.ts`,
   `src/web/ShelfTerms.tsx`, `src/web/ShelfTermChip.tsx`, `src/web/ShelfTermsDetail.tsx`,
   `tests/shelf-topic-model.test.ts`, `tests/shelf-topics-route.test.ts`, `docs/project/shelf-terms.md`.

**The design changed after your plan review, so weigh this most.** The plan you reviewed kept "a work in
a finer topic is in every topic above it". The built code drops that for works added from outside a
parent: `filedInto` takes a whole-tree filing answer as it stands, and adds ancestors only when the work
would otherwise be under no broad topic. Reason, measured on Greg's real shelf (45 articles): with
ancestors added, *AI & Computing* went from 23 articles to 36 and 34; without, 23 to 26. And the filing
prompt now shows the topics as one flat list, because shown an indented tree the model would not put a
psychology paper about memory into *Memory & Learning* under *AI* (0 of 2 runs; flat list 2 of 2).

Measurements (all on GPT-6 Luna through `rethink`/`fileWorks`; v1 is `b1d0734a`'s module):

| | v1 | v2 (this code) |
|---|---|---|
| Greg's shelf re-thought: topics per article | 1.76, 1.80, 2.29 | 2.89, 4.18 |
| Greg's shelf: articles in no topic (of 45) | 4, 6, 2 | 2, 3 |
| Greg's stored tree, every article filed into it: AI & Computing | 23 | 26, 26 |
| …Memory & Learning | 5 | 10, 9 |
| …does the Levin memory paper gain Memory & Learning | (not in it) | yes, yes |
| greg-wide synthetic (96): topics per article | 2.17, 2.26 | 3.17, 3.13 |
| …share of intended topics an article is in | 0.82, 0.80 | 0.85, 0.89 |
| …share of specific placements that are intended (nothing forgiven) | 0.34, 0.37 | 0.22, 0.29 |
| …mean best-topic F1 per intended category | 0.76, 0.82 | 0.82, 0.84 |
| …share of placements wrong (forgiving), re-think | 0.05, 0.05 | 0.13, 0.09 |

Results files: `evals/shelf-topic-clusters/results/hier-greg-wide-v1a.md`, `-v1b.md`, `-v2a.md`, `-v2b.md`.

Questions, most important first:

1. **Does anything rely on a finer topic's works all being in its parent?** Server (`termsFromSet`,
   `applyStoredSet`, `whatIsDue`, `unplaced`, the drain, the store), client (narrowing, counts,
   `withinChosenFirst`, `topicDepth`, hues, the paper card, More detail, any tooltip sentence that is now
   false), tests, docs. Find what I missed.
2. **Is `widen` correct?** The union, the dedupe, the order of `members`, the `SAME_AS_PARENT` restore
   (is "shared with the parent" the right thing to measure now, and does clearing a topic's additions
   always restore the bound?), the retry, `RethinkOutOfTime`, a work the batch answer omits, the `pooled`
   failure path.
3. **Is `filedInto`'s exception right** (ancestors only when no broad topic)? Cases: a depth-2 topic
   named with a broad topic that is not its ancestor; a work with a broad topic from naming; a new arrival.
4. **The deadline**: `started + TOPIC_SET_LEASE_MS - RETHINK_DEADLINE_MARGIN_MS`. Is the arithmetic right
   against where the claim is taken, and is failing the re-think the right outcome? Can a shelf get stuck
   never reaching version 2?
5. **Prompt version 2 re-thinks every reader's tree once.** Anything that makes that unsafe (allowance,
   backoff, the 150 cap: a shelf over the cap keeps a v1 tree and files with the v2 flat prompt; is that
   coherent)?
6. **The tests**: is any new test unable to fail? Is a behaviour above untested?
7. **The conclusion**: do the numbers support "more inclusive at a real but acceptable cost in
   sharpness", or am I explaining away the strict-precision drop (0.35 to 0.25)? Say what you would tell
   Greg.
8. Anything in `docs/project/shelf-terms.md` now false.

Gates to run after any fix: `npx vitest run tests/shelf-topic-model.test.ts tests/shelf-topic-sets.test.ts tests/shelf-topics-route.test.ts tests/shelf-topic-sets-pg.test.ts tests/doc-links.test.ts`
and `npm run typecheck` (six errors in `src/backfill-registry-facts.ts` are already on `dev` and not
this stage's).

Answer with findings numbered and ranked P0/P1/P2: what, where, and whether you fixed it (name the files
you changed). End with one line: `VERDICT: ship`, `VERDICT: ship with the fixes I made`, or
`VERDICT: do not ship`.
