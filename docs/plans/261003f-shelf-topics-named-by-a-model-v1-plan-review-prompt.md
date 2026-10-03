# Plan review, round 2: the v1 design for model-named shelf topics (261003f)

Read-only. Do not edit any file. You reviewed the first proposal of this plan earlier today
(`docs/plans/261003f-shelf-topics-named-by-a-model-plan-review-sol.md`). Since then Greg answered,
asked for a coarse-to-fine tree and automatic inclusion of new articles, and said to build. The
build is under way: the pure core is written and measured, the store and client are being built by
other agents now, and the orchestration is next. **Your findings will be applied before anything
is pushed, so be concrete about what to change.**

Read:

1. `docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md` § "Greg's answer,
   and v1" (his words, the design, the measurements, the cost, what is deferred).
2. `src/shelf-terms/model-topics.ts` — the prompts, the parsers, `rethink`, `fileWorks`. This is
   what ships and what the eval ran.
3. `evals/shelf-topic-clusters/hier.ts` and its results `evals/shelf-topic-clusters/results/hier-expert.md`
   and `hier-greg-wide.md`; the shelf `evals/shelf-topic-clusters/shelves/expert.json`.
4. The new contract in `src/store/contracts.ts` (`topicShelf`, `readTopicSet`, `claimTopicSet`,
   `writeTopicSet`, `fileIntoTopicSet`, `failTopicSet`, `releaseTopicSet`, `TopicShelfArticle`,
   `StoredTopicSet`, `TopicSetResult`) and the wire change in `src/types.ts` § `LibraryTermsResponse`.
5. What it replaces and must coexist with: `src/shelf-topics.ts`, `src/store/pg-shelf-terms.ts`,
   the route `GET /api/library/terms` in `src/routes.ts`, `src/web/useShelfTerms.ts`,
   `src/web/shelf-narrow.ts`, `docs/project/shelf-terms.md`.

Questions, most important first:

1. **Does the design do what Greg asked, in his priority order** (new articles always included;
   then cost; then latency; little thought from the reader; clear)? Where does it fall short?
   In particular the state machine in the plan's "How it runs": the order "re-think if due, else
   file"; the two re-think triggers and their thresholds; whether any state loops (a re-think that
   leaves the same works unplaced and so is due again at once; a version bump storm; a shelf that
   shrinks); what a reader sees between adding an article and its filing landing; what happens to
   an article added while a re-think is running; archived and deleted articles; a shelf that
   crosses eight works.
2. **`rethink` and `fileWorks` in `model-topics.ts`**: correctness bugs; the one-pill-per-name rule
   and its first-come-first-kept order (it runs across parallel siblings: is the outcome
   deterministic, and is dropping right?); `SAME_AS_PARENT`; `spread` plus batch filing above 150
   works per level (unmeasured: say what could go wrong); a failed sub-call being swallowed;
   memberships always including ancestors (is that actually guaranteed on the re-think path, given
   a finer topic's works are a subset of the works the parent call was given?); ids `t1…` changing
   on every re-think while `?topics=` uses keys; label and key cleaning; prompt-injection surface.
3. **The store contract**: is one row per owner with `members` as one jsonb map right at 3,000
   articles and 150 topics? Is the fence enough for filing racing a re-think? Is anything missing
   that the orchestration will need (for example knowing which works were unplaced at the last
   re-think)?
4. **The eval**: is "filing judged against intended categories" sound as built in `hier.ts`
   (`bestTopics`, the F1 ≥ 0.6 gate, the bar)? What do the two result files not show? Recompute the
   cost table in the plan's "What v1 costs" from the result files.
5. **Latency and the platform**: a re-think of one to two minutes awaited after the response inside
   a request handler (`vercel.json` `maxDuration` is 800); the claim lease; the client's ask-again
   loop (every 8 s, at most four times) against a 126-second re-think.
6. **What is deferred**: is anything on that list actually needed for v1 to be correct?

Report findings numbered, most serious first, each P0 (wrong for Greg's ask, or a correctness bug
that ships), P1 (a real gap), or P2. For each: the evidence (file and line), and the change you
would make. End with one line: with the P0s and P1s dealt with, is v1 sound to ship to dev?
