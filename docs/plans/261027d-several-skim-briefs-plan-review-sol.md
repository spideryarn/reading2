I would revise the plan before implementation. Keeping the default separate is reasonable, and article-level briefs are defensible. The largest problems are transfer privacy and the lifecycle protections lost by bypassing jobs.

1. **F1 — P0: Ownership transfer would expose the previous reader’s briefs.**  
   Plan lines 71–72 say transfer follows the FK. Changing an article’s owner preserves its children; that would give the recipient the previous owner’s private steering text. Transfer deliberately deletes reader-authored state, including Chat threads. See [pg-article-transfer.ts:12](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/store/pg-article-transfer.ts:12) and [admin-articles.ts:66](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/admin-articles.ts:66).  
   **Fix:** classify `skim_briefs` as reader state, include it in transfer counts with `ownWords: true`, and delete it during an explicitly confirmed transfer. Its presence must also prevent an unattended voucher transfer. Test that neither briefs nor late planning completions reach the recipient.

2. **F2 — P1: The direct POST has no distributed single-flight or completion fence.**  
   Plan lines 46–54 specify “call, then write.” Two tabs can buy two calls; an older response can overwrite a newer route. A deleted brief must also never be resurrected by completion. Jobs already deduplicate atomically across server instances: [jobs.ts:4101](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/jobs.ts:4101).  
   **Fix:** retain jobs, or explicitly design a database claim with attempt token, expiry, conditional completion and owner recheck. Duplicate requests should join or refuse the active attempt. Cover concurrent starts, reversed completions, deletion and transfer during planning. The 12-row limit does not bound repeated planning calls.

3. **F3 — P1: “A default exists” does not establish usable, coherent prerequisites.**  
   The default survives re-extraction, while Quotes and Ideas may be stale or missing. Existing Skim regeneration refreshes those prerequisites first: [useSkim.ts:307](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/web/useSkim.ts:307). Jobs also keep Skim behind Quotes, re-extraction and reset: [pg-jobs.ts:800](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/store/pg-jobs.ts:800). Independent “current article” reads in a direct request can cross a publication boundary.  
   **Fix:** read blocks, tree, Quotes and Ideas from one pinned revision snapshot. Specify what happens when that input changes before completion. Preserve prerequisite recovery, or refuse with a useful recovery action; merely pointing the existing banner at the POST does not preserve its behavior.

4. **F4 — P1: The current rewrite hold cannot simply follow the selected brief.**  
   It is keyed by `(slug, step)`, requires job outcomes, and releases when a fresh read shows a different artifact identity. Switching briefs could therefore release another brief’s hold; a direct request supplies no job outcome at all. See [rewrite-hold.ts:196](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/web/rewrite-hold.ts:196).  
   **Fix:** scope pending work and holds to `(article, default-or-brief-id)`, survive band remounts, and reconcile uncertain POST outcomes before allowing another paid press. Scope ordered reads, errors and dismissal writes the same way. An unplanned added brief must also avoid `useSkim`’s default automatic job path ([useSkim.ts:398](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/web/useSkim.ts:398)).

5. **F5 — P1: Added briefs lose the established place to regenerate a route.**  
   Once a notice is dismissed—or a route is merely outdated—there is no banner button. Regeneration then belongs in Metadata. Its current Skim row posts a forced default `skim` job, regardless of the selected brief: [Metadata.tsx:2114](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/web/Metadata.tsx:2114). That contract is explicit in [skim.md:170](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/docs/project/skim.md:170).  
   **Fix:** specify how Metadata targets added briefs and label the existing row as the default. Putting regeneration in the picker instead would change Greg’s previous product decision and should be presented as such.

6. **F6 — P2: The stated staleness rule is not quite the default’s rule.**  
   Plan lines 58–62 describe an unconditional input-hash comparison. The current loader distinguishes missing input, source staleness and prompt-version obsolescence; it compares hashes only for the current prompt version. Otherwise a changed hashing scheme can announce “the article changed” when only our implementation changed. See [pg.ts:4456](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/store/pg.ts:4456).  
   **Fix:** extract and reuse the complete freshness calculation, including `outdated` and `notOnRoute`, rather than only the hash functions. The proposed profile rendering and `profileNoticeKey` are sound; preserve the existing generated-at conditional dismissal write too.

7. **F7 — P2: Clearing `brief` while retaining route position creates inconsistent restoration.**  
   Plan lines 63–66 clear the brief on leaving Skim, but `stop` and `depth` survive and are remembered. Returning can therefore apply an added route’s position to the default route. See [last-view.ts:130](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/web/last-view.ts:130). Also, `notOnRoute` is a coverage count; missing selected stops fall back through `locate`, not that field.  
   **Fix:** define selection, stop and depth as one coherent navigation state. Prefer remembering the brief alongside its position; otherwise clear its route position when clearing the brief. Test leaving for Glossary, returning, reload and browser history.

8. **F8 — P2: “Export the table” misses the reader’s plain-text export.**  
   Adding rows to the ZIP does not automatically put the sentences in `your-words.md`, which claims to contain everything the reader wrote. Its sections are explicitly assembled: [your-words.ts:70](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/store/your-words.ts:70).  
   **Fix:** include brief text there, add the table to the shared snapshot walk and coverage registry, and explicitly decide its rollback-export representation. Test unplanned briefs too: their text is valuable before any model succeeds.

On the direct-request decision: **Vercel’s 800-second ceiling does not itself require jobs.** An awaited request can work. Cost tracking also works inside `handleApi` with article attribution and `generateSkim`; pass `powerOf(article)` to preserve High-powered AI. There is **no per-reader spend cap to bypass** ([jobs.ts:527](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/jobs.ts:527)). However, direct requests bypass the six-job admission limit and article ordering. They also need an explicit deadline before runtime termination; jobs abort at 740 seconds ([routes.ts:14652](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/routes.ts:14652)). Closing a tab does not, by itself, guarantee cancellation or an empty route.

I would keep **brief text attached to the article**. Default Skim already carries routes across revisions ([pg-revisions.ts:423](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/store/pg-revisions.ts:423)). Pinning generation to a source revision matters more than making reader-authored text revision-owned. Full per-revision brief history seems unnecessary for v1.

The materially simpler overall implementation is probably the plan’s rejected **job target parameter**. Fifteen mechanical wiring changes may cost less than introducing another claim, expiry, cancellation, concurrency and reconciliation system. Keep the proposed separate table and existing default; make job identity, freshness checks and output destination aware of the target brief.

**A/B/C is a genuine product choice**, and A is a reasonable recommendation. Other choices needing Greg’s explicit attention are:

- Whether an added brief **replaces or supplements** the shared purpose. Mentioning replacement in question details does not ask him to choose it.
- Whether briefs are **immutable**, requiring another paid route for a wording correction.
- Whether leaving Skim resets the selected brief.
- Whether added briefs require generating the default first.

For the remaining callers, explicitly retain default-only semantics for Chat/Guide’s `prepareMode` ([prepare-mode.ts:98](/var/tmp/spideryarn-worktrees/fbxyje0z-multiple-skim-briefs/src/prepare-mode.ts:98)). MCP currently exposes no Skim-specific read/plan tool to retrofit. Keeping added briefs outside `publicSkim` is correct.

The quota delay need not prevent testing the main flow: use deterministic model responses to exercise creating, planning, switching and deleting two distinct routes through the real API and client. Defer only the real-provider smoke test.

Read-only review; no files changed.