# The tested state is not the whole lifecycle

Up: [postmortems.md](../project/postmortems.md). Found in the 2026-10-07 write-capable review of
[C6](../plans/261007d-seventh-sweep-small-server-request-path-defects-and-dead-branches.md).
Root causes independently traced in a review subagent. These are reviewer conclusions, not
product-owner decisions.

Three request paths were correct for a settled state and wrong across a transition. The class
is **equivalence tested only in a settled lifecycle state**: a preflight observation is mistaken
for the eventual request outcome.

- **Minimal paper, before publication.** `4912e4de5` deleted an article-state gate in favour of a
  published-revision read. The characterization published every minimal paper first, when both
  reads agree. Before publication the article exists but the inner join finds nothing: 409 became
  404. The review's fix asked the existing owner-scoped processing reader on a failed revision
  read. **Not kept at landing:** that moved the lookup into `loadArticle`, where it changed the
  answer for every other caller in the same state, so the deletion was reverted and the gate is
  back beside its two routes
  ([the plan § 4](../plans/261007d-seventh-sweep-small-server-request-path-defects-and-dead-branches.md#4-the-minimal-paper-gate-deleted-and-put-back)).
  The Postgres route cases the review wrote were run then: red (404) without gate or lookup,
  green with either.
- **Stream, after headers.** `d7efdead8` correctly preserved the transmitted 200 but let it
  determine log severity after an unexpected throw. The original tests asserted status and
  capture, overlooking the operator's warning/error filter. The fix preserves wire status in
  fields and uses mapped failure status for severity. Four assertions went red first and pass.
- **Upload, after Stop.** `5c046561a` added cancellation to `expired` and a 410 preflight response
  without updating the failed-claim classification inherited from `e9a8392cd` (later extracted in
  `38503e9b5`). Stop wins the conditional mutation, yet the loser was told somebody was importing
  the file. The fix explicitly classifies an expired row as expired. The route race test now
  expects the existing 410; run against Postgres at landing, red (409) without the line.

These fixes belong at the authoritative read/outcome boundaries, rather than in additional
preflight guards. The state machines already choose the correct winner.

Countermeasures, ranked by ease against value:

1. **Test immediately before and after each relevant transition.** Added before-publication,
   post-header severity and Stop-between-look-and-claim cases. A characterization that covers only
   the final state does not license deleting the earlier guard for every state.
2. **Check independent observations together.** Delivered status, log level and capture are
   different contracts; assert all three. Forced route outcomes need a real-store counterpart.
3. **Rejected by the review: restore the successful-path duplicate gate, add locks or write a
   second request log.** Locks and a second log stay rejected. **The gate was restored at
   landing**, for the reason in the first bullet: a guard that looks like a duplicate in the
   settled state can be the only thing covering the transition, and the cheapest correct answer
   was to leave it where it was.
