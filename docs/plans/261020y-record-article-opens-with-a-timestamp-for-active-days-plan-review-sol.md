No P0. I found two serious correctness problems and four P2 issues.

## P1

1. **The 30-minute throttle can still lose an active day.**  
   The throttle compares against `articles.last_opened_at`, while that column advances on every mount—even when no history row is inserted ([plan:45](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:45)). Example:

   - 23:50 Monday: insert Monday’s row.
   - 00:10 Tuesday: skip because the previous open was 20 minutes ago; `last_opened_at` becomes Tuesday.
   - Wednesday: insert Wednesday’s row; `last_opened_at` becomes Wednesday.

   Tuesday then exists in neither `article_opens` nor `last_opened_at`. The existing branch only preserves an omitted day while it remains that article’s latest open ([pg-admin.ts:808](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/store/pg-admin.ts:808)). This contradicts the claim that opens are counted from launch ([plan:60](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:60)). At minimum, never throttle across a UTC-day boundary.

2. **Current article ownership is the wrong owner for historical account activity.**  
   The plan rejects `owner_id` because it could disagree after a transfer ([plan:28](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:28)), then deletes the rows on transfer to avoid crediting the new owner ([plan:72](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:72)). That makes the old owner’s Active days shrink retroactively. Article deletion does the same.

   For an activity event, “who performed it then” and “who owns the article now” are different facts and are expected to disagree after transfer. Store the event’s owner directly, or use the approved per-reader/day design. Otherwise the promised account-level count is not durable.

## P2

3. **The design collects more detailed data than the approved option requires, without showing why it is necessary.**  
   Option B was explicitly one reader/date row, “not the time and not what they did” ([q-xcc7xq.md:12](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/user-feedback/questions/q-xcc7xq.md:12)). Greg’s reply suggests adding times of article opens, but does not clearly require retaining which article. The plan adds both exact timestamps and article identity ([plan:21](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:21)).

   A simpler design directly serves the metric: `reader_days(owner_id, day, first_opened_at[, last_opened_at])`, written only by the owner-scoped open route. It needs no throttle, article export, transfer handling, or article-identity history. If per-article history is genuinely wanted, the plan should present that as the extra product/privacy decision.

4. **The proposed user-facing claims overstate what is recorded.**  
   “Each open is counted” is false under the throttle ([plan:62](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:62)). Likewise, “when you opened each of your articles” reads like a complete history, while many mounts are deliberately omitted ([plan:79](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:79)). The row also cannot honestly mean “sat down with this article”: the POST runs on component mount, including before the metadata branch renders ([ArticlePage.tsx:477](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/web/article/ArticlePage.tsx:477)). Call these recorded/open sessions or say explicitly “at most once per article per 30 minutes.”

5. **`READER_STATE` makes the “only the admin aggregate reads it” claim false.**  
   The plan puts `article_opens` into `READER_STATE` ([plan:70](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:70)), but every non-zero reader-state count is returned by the transfer preview and displayed in its confirmation ([AdminArticlesPage.tsx:98](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/web/AdminArticlesPage.tsx:98), [AdminArticlesPage.tsx:224](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/web/AdminArticlesPage.tsx:224)). Thus an administrator will see an open count for one specific article, contrary to [plan:66](/var/tmp/spideryarn-worktrees/active-days-article-opens/docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md:66). This does not reveal the private article’s title or prose, but it is an unacknowledged per-article activity disclosure and consumer.

6. **The tests listed do not prove the concurrency claim, and one schema obligation is definite rather than optional.**  
   Sequential throttle tests can remain green if `FOR UPDATE` is accidentally omitted—the existing store explicitly documents this limitation ([pg-shelf.ts:63](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/store/pg-shelf.ts:63)). Add either a deterministic SQL-shape assertion for the lock or a concurrent-open test proving two simultaneous tabs produce one history row and two counter increments.

   Also, `opened_at` definitely must be registered as the `created_at` stand-in; the test fails every timestamped table lacking either `created_at` or an allowance ([action-tables-have-created-at.test.ts:100](/var/tmp/spideryarn-worktrees/active-days-article-opens/tests/action-tables-have-created-at.test.ts:100)). The plan’s “if that test needs telling” is uncertain wording for a mandatory edit. The schema description should also say whether `id` is a primary key with `defaultRandom()`; otherwise the proposed `id uuid` has no stated invariant.

The transaction’s lock ordering itself looks sound: it takes only the article row, never a billing row, so it does not invert the repository’s billing-before-article order; transfer and destruction serialize on the same article lock. The Active-days aggregate itself also does not leak what was read: it projects only owner, distinct-day counts, and the latest time ([pg-admin.ts:724](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/store/pg-admin.ts:724)). RLS is intentionally not used here, and existing default privileges cover newly created tables.