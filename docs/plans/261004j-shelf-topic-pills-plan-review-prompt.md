# Plan review: 261004j, shelf topic pills more inclusive

You are reviewing a plan before it is built. Read-only: change no files.

Read, in this order:

1. `docs/plans/261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md` (the plan)
2. `src/shelf-terms/model-topics.ts` (the prompts, `rethink`, `fileWorks`, `withAncestors`)
3. `src/shelf-topic-sets.ts` (what a request does with the tree: `whatIsDue`, the claim, the drain)
4. `docs/project/shelf-terms.md` (what the feature promises)
5. `src/web/shelf-narrow.ts` (how the row narrows; `withinChosenFirst`, `topicDepth`)
6. `evals/shelf-topic-clusters/hier.ts`, `replay-shelf.ts`, `stored-tree.ts` (the measurement)
7. For Part 2 only: `docs/project/security-map.md` § Where the defences physically live, and `docs/project/public-shelf.md`

Evidence already gathered (do not re-run paid calls):

- Production, read-only: Greg's stored tree has *Memory & Learning* (5) inside *AI & Computing* (23) and
  *Memory & Self* (3) inside *Cognitive Science* (13). Levin's "Self-Improvising Memory" is in Cognitive
  Science and Memory & Self only.
- Two control re-thinks of that shelf on the current code: mean topics per article 1.76 and 1.80; 4 and
  6 of 45 articles in no topic. Run 2 produced *Memory & Learning* inside *AI* again, without Levin.
- The public listing in production holds 6 articles.

Questions I want answered, most important first:

1. **Is the diagnosis right**, that a finer topic can only hold articles already in its parent, so wording
   alone cannot fix Greg's example? Check it against `rethink`.
2. **Is the widening pass sound?** After the tree is built, `fileWorks(topics, allWorks)` over the whole
   tree, unioned into `members` with ancestors. Look for: an invariant in `rethink`, `whatIsDue`,
   `termsFromSet`, the `unplaced` count, `SAME_AS_PARENT`, the drain, or the client's narrowing that the
   union breaks; a finer topic growing to equal its parent; anything that makes the row wrong when an
   article joins a broad topic only through a finer one.
3. **Failure handling**: retry a batch once, then fail the whole re-think. Right, or should the narrow tree
   be stored? Does the extra time fit the ten-minute lease and the serverless function's limit at 150 works?
4. **Is there a simpler design** that fixes the named example? Is anything here more than is needed?
5. **Is the measurement able to show the change is too inclusive**, not only that it is more inclusive? What
   number would you add?
6. **The prompt wording** proposed in "What will be built" point 2: any way it invites the model to put
   everything everywhere?
7. **Part 2**: is it right that every option touches a listed defence, so nothing is built unattended? Is an
   option missing? Is option D's claim (no defence touched) true?

Answer with findings numbered and ranked P0 (do not build as written), P1 (fix before or while building),
P2 (worth knowing). For each: what is wrong, where (file and function), and what you would do. Say plainly
if a question above has the answer "yes, it is fine". End with one line: `VERDICT: build as planned`,
`VERDICT: build with the P1 changes`, or `VERDICT: do not build`.
