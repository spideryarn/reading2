No P0 findings. The diagnosis and overall widening approach are sound, but I would fix four Part 1 issues before shipping.

1. **P1 — Widening can recreate a finer topic that narrows nothing.**  
   Where: [`rethink`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:515>). `SAME_AS_PARENT` is enforced while naming at line 567, before the proposed filing pass. Widening can subsequently grow a child to 90–100% of its parent and store a pill the current invariant says should be dropped.

   I would perform a true set union, then validate `SAME_AS_PARENT` again. If a node becomes redundant, remove it and promote its children to its parent, recomputing depths and ancestor memberships; at minimum, fail the rethink instead of storing an invalid tree. Also test that overlapping old/new memberships are deduplicated—plain array concatenation would duplicate slugs in [`termsFromSet`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-topic-sets.ts:199>) and inflate chip counts.

2. **P1 — The synthetic “wrong placement” measure misses the main over-inclusion failure.**  
   Where: [`hier.ts`’s `score`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/evals/shelf-topic-clusters/hier.ts:213>), especially lines 229–234. It considers any descendant of a true broad topic correct. Therefore, if every neuroscience article is placed in every neuroscience subtopic, those false finer placements are counted as fine—the exact failure this change could introduce.

   I would add **precision of direct/final placements**: remove ancestors implied by a finer assignment, then count what share of the remaining specific topics match the article’s intended categories. Do not forgive a finer topic merely because one of its ancestors is true. Also report the maximum child/parent membership ratio after widening; that directly exposes a broken `SAME_AS_PARENT` invariant.

3. **P1 — “When unsure, include” is too permissive without a negative boundary.**  
   Where: the proposed replacement for [`nameMessages` and `fileMessages`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:203>).

   “Has something real to say about” plus “when unsure, include” can encourage the model to file broadly related articles everywhere. I would use wording such as:

   > Include an article when its title or summary shows meaningful discussion, evidence, or a claim about the topic, even if the topic is secondary. Do not include it for a passing mention, an analogy, general background, or merely because it belongs to the topic’s broader field. When the evidence is borderline but substantive, prefer inclusion.

   For naming, also say not to pad a topic merely to reach the minimum article count; omit that topic instead.

4. **P1 — The added work probably fits in practice, but it is not bounded by the ten-minute lease.**  
   Where: `TOPIC_SET_LEASE_MS` in [`shelf-topic-sets.ts`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-topic-sets.ts:109>) and the 150-second per-call deadline in [`model-topics.ts`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:402>). Vercel permits 800 seconds, but the claim lasts 600.

   Four filing batches run concurrently, so normally this is cheap: the measured 104-second rethink plus one filing wave fits comfortably. But a failed batch may consume two 150-second attempts, and the preceding recursive naming has no whole-job deadline. A slow successful run can therefore outlive the claim, allowing duplicate work before the 800-second function limit.

   I would give the job an absolute deadline below the function limit, propagate cancellation into calls, and make the claim outlive that deadline. At least refuse to begin or retry widening when insufficient lease time remains.

5. **P1 — Part 2 option A names the wrong allowlist and leaves its trigger ambiguous.**  
   Where: plan Part 2, option A; [`src/public/routes.ts`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/public/routes.ts:220>).

   The public library does not pass through `src/public/dto.ts`; `COLLECTION_READS.library` returns `pgPublicLibraryReader.listPublic()` directly. Its wire allowlist is the explicit projection in `src/store/public-library.ts` plus [`PublicLibrary`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/public-library-types.ts:83>). The option should name those files and tests instead.

   Also, “the next signed-in reader’s request” cannot mean `/read/public`: [`security-map.md`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/docs/project/security-map.md:223>) requires that page to make the same single anonymous request signed in or out. Name a separate authenticated trigger and payer. The missing variant is that the owner whose share/unshare made the tree stale pays for refreshing it, rather than an unrelated next reader.

6. **P2 — The diagnosis is structurally right, but one sentence is too absolute.**  
   Where: [`rethink`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:552>) and plan lines 47–50/94–95.

   Yes: a finer naming call receives only `f.works`, its parent’s current members. Once Levin is absent from *AI & Computing*, that call cannot put it in *Memory & Learning*. Wording alone cannot fix that run.

   Wording could, however, cause the top-level call to put Levin in *AI & Computing* first, after which the finer call would see it. So say wording alone cannot **reliably or generally** fix the example, rather than cannot possibly fix it.

7. **P2 — The remaining widening and failure-handling contracts are fine.**  
   `fileWorks` calls [`withAncestors`](</home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:614>), so an article entering a finer topic also enters its broad parent. Consequently:

   - `termsFromSet` and the client’s AND narrowing remain correct.
   - A broad topic is visible and contains an article that joined only through its child.
   - `withinChosenFirst` and `topicDepth` remain correct because structure is unchanged.
   - `unplaced` should be calculated after widening, as planned.
   - `whatIsDue` and the post-rethink arrival drain remain correct.
   - Retrying a batch once and failing the whole rethink after the second failure is right. Do not store the narrow result as prompt version 2: that would declare incomplete work current and suppress the retry.

   The whole-tree filing pass is the simplest robust fix for this class of error. A wording-only change may sometimes move Levin into the parent but cannot remove the structural blind spot; merging similar topics across parents is substantially more machinery than this report needs.

For Part 2: yes, every implementation that actually adds pills to `/read/public` must edit at least `PublicLibraryPage.tsx`, which is a listed defence. C builds nothing, and D is a different page. Option D’s “no listed defence touched” claim is plausible: the owner shelf already reads the anonymous public listing, and filtering its `ShelfPublicSection` can be driven through authenticated owner-topic machinery without changing the public page or query. It still needs its own plan because today `termsFromSet` projects only the owner’s works. “No stranger involved” should be tightened to “no anonymous request triggers model spend”; the classified titles remain stranger-authored input.

VERDICT: build with the P1 changes