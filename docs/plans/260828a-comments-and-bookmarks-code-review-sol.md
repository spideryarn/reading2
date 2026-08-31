Do not ship yet. The Postgres `create` race is mostly right, but there are several blockers around it.

## Findings

1. **Blocking — `src/routes.ts:1316-1334` — `sourceCommentId` can put reader prose into logs.**

   It is checked only with `typeof === "string"`. A request can send the quote or body as `sourceCommentId`. On failure, that entire value is logged as `id`, and likely again through `errorFields(err)` because `NotAnExplanation` embeds the ID in its message.

   Fix: validate `isSpideryarnId(sourceCommentId)` before `beginTurn` or any other write. Reject with a fixed 400 message that does not include the value. Never pass an invalid value to `linkThread` or logging.

2. **Blocking — `src/comments.ts:beginAnswer` and `src/store/pg-comments.ts:beginAnswer` — simultaneous attempts both succeed.**

   `status <> 'none'` does not claim the row. The first request changes `done` to `pending`; the second waits, rechecks the predicate against `pending`, finds that `pending <> none`, and also succeeds. The filesystem implementation likewise rejects only `none`.

   This can buy two model calls, reset fields underneath the first stream, and leave terminal writes racing. The comment claiming two requests cannot both pass is false.

   Fix: atomically claim only an answerable terminal state, probably `status IN ('done', 'error')`, and reject `pending` as already running. Ensure each claim gets a fresh attempt token and terminal writes are fenced by it. Deal with abandoned `pending` rows through the existing sweep/lease path.

3. **Blocking — `src/routes.ts:createFree` — the anchor offset still is not validated.**

   The code proves only that:

   - `start` is somewhere within or at the end of the block; and
   - the quote occurs somewhere in the block.

   Those facts are independent. A valid quote with an arbitrary wrong `start` is accepted. `start === block.text.length` is also accepted for a non-empty quote.

   Fix: resolve the quote at the supplied offset using the same whitespace/index rules used when drawing the mark. Reject unless the quote begins at that resolved position. At minimum, a non-empty quote requires `start < block.text.length`, but that alone is insufficient.

4. **Blocking — `src/web/useComments.ts:create` — retries do not reuse the idempotency key.**

   Every invocation calls `mintId()`. Therefore:

   - two hook invocations for the same Save use different IDs and both persist;
   - if the server commits but the response is lost, the hook removes the optimistic row, and the reader’s retry creates a second comment under a new ID.

   The server’s same-ID idempotency cannot help either case.

   Fix: mint the ID once per draft/save gesture and retain it across re-entry and ambiguous network failure. Also guard concurrent submission synchronously, rather than relying only on a rendered disabled state.

5. **Blocking — `src/comments.ts:patchComment` — the field-mutability contract is not enforced.**

   `patch: Partial<Comment>` followed by `{ ...c, ...patch, id: c.id }` permits callers to rewrite `blockId`, `quote`, `start`, `createdAt`, `body`, `updatedAt`, and `threadId`. Only `id` is protected. This is precisely the generic patch shape the named allowlists were meant to remove.

   Fix: replace `Partial<Comment>` with a narrow answer-patch type and explicitly construct the permitted fields: status, answer, citations, searches, model, and error. Check that the Postgres `patch` implementation uses the identical allowlist.

6. **Should-fix — `src/routes.ts:1316-1340`, `src/web/useComments.ts`, `src/web/TableView.tsx` — the successful server link never reaches live comment state.**

   `linkThread` updates storage, but no frame returns the linked comment and there is no client link call. The browser’s stored comment therefore still lacks `threadId` until some later reload. Immediately after Save & ask:

   - the double mark opens chat rather than the comment;
   - “Open conversation” cannot appear in the comment dialog.

   Fix: capture the `Comment` returned by `linkThread` and include it in the `begin` frame, or send a separate link frame. Replace/merge that comment into `useComments` state. Remove the obsolete `useComments.link` function that calls a route which no longer exists.

7. **Should-fix — the server link is scoped, but not bound to the source passage.**

   Given your stated `articleIdFor(slug)` owner scoping, `sourceCommentId` cannot link a different article’s or another owner’s comment. That part is safe.

   It can, however, name any comment owned by this reader in the same article. Neither `status: "none"` nor equality with the chat anchor is checked. A stale or forged ID can link an unrelated comment.

   Fix: make the compare-and-set also verify that the comment is a free comment and matches the chat request’s anchor. Do that within the storage operation so it is not a read/check/write race.

8. **Should-fix — both `create` implementations accept a legacy explanation as an idempotent free Save.**

   Matching only anchor and body is insufficient. A legacy explanation commonly has no body. If its ID and anchor are reused, `create` returns the old `done`/`error`/`pending` row as a successful free comment.

   Fix: the idempotent read-back must additionally require `existing.status === "none"` in both adapters. Otherwise throw `CommentIdTaken`.

9. **Should-fix — `src/web/useComments.ts:edit` cannot clear a body.**

   When PATCH clears the body, the returned `Comment` correctly has no `body` key. But `{ ...c, ...comment }` retains the old `c.body`, because absence does not overwrite an existing property.

   It does preserve the answer; it does not blank it. The broken case is turning a comment back into a bare bookmark.

   Fix: replace the stored comment with the full server response. If client-only fields exist, explicitly remove `body` before merging.

10. **Should-fix — optimistic failure rollback can remove the real colliding comment.**

    If `mintId()` collides with an existing local comment, `put(optimistic)` overwrites or duplicates it. The 409 handler then filters every row with that ID, removing the legitimate comment from memory.

    Fix: mint against IDs currently in state and make rollback restore the exact previous row rather than blindly filtering by ID.

11. **Should-fix — `src/web/TableView.tsx:526-553` examines only the first comment and chat IDs.**

    The space-separated attributes show that a mark can represent multiple overlaps. A linked comment or thread later in either list is ignored.

    Fix: parse all comment and chat IDs, find a comment whose `threadId` is in the chat-ID set, and open that comment. Only fall back to the first chat when no linked pair exists.

12. **Minor — `src/routes.ts:tidyBody` silently converts malformed values into a bookmark.**

    Numbers, arrays, booleans, and objects all become `null`. `{ body: {…} }` should not silently mean “no body.”

    Fix: accept only string, `null`, or absent. Return a fixed 400 for every other type.

13. **Minor — the second `beginAnswer` read is a diagnostic race.**

    Between the failed UPDATE and SELECT, a free row can be deleted, or a missing row can be created. That changes 409 into 404 or vice versa. It does not cause an unsafe write, but the reported reason can be wrong.

    Fix: if the distinction matters, use a transaction with `SELECT … FOR UPDATE`, then classify and update. Unlike creation, the row being locked already exists, so the old “cannot lock an absent row” problem does not apply.

## `pgCommentStore.create`

For a valid supplied ID under normal `READ COMMITTED` operation:

- Same ID, same payload: one insert wins; the other waits, performs no insert, reads the committed row, and returns it. Both requests succeed, but there is one row. Correct.
- Same ID, different anchor or body: one succeeds; the other reads the winner and gets 409. Correct.
- Same ID in different articles: both insert because the key and read-back include `articleId`. Correct.
- Different owner: safe if, as stated, `articleIdFor(slug)` resolves an owner-specific article ID.
- Concurrent deletion between conflict and read-back: the loser gets 409. That classification is conservative and harmless.
- Concurrent body edit before read-back: an old POST gets 409. That follows your deliberate “changed body is not a retry” rule.
- Existing legacy row with matching anchor/body: incorrectly succeeds, because status is not compared.

Also, `ON CONFLICT (article_id, id) DO NOTHING` does not swallow violations of unrelated constraints; those throw directly. The comment suggesting the no-row branch might represent another constraint is misleading.

## Foreign key

Keeping no foreign key is defensible, but parity is not the decisive argument: the filesystem adapter could implement equivalent deletion and import checks in application code. The sound argument is that a dangling `threadId` is intentionally a valid domain state. If that is truly the contract, a foreign key would reject valid archives and erase information through `SET NULL`. Keep it without an FK, but test deletion and dangling-link archive round-trips explicitly, and enforce same-article/owner/source-anchor integrity when creating a live link.

## Tests

Without the test bodies, I cannot honestly identify which four you watched fail. The parity and round-trip tests can pass while both adapters share the same semantic bug. Tests that should be present before shipping:

- concurrent `beginAnswer`: exactly one claim succeeds;
- wrong-but-in-range `start`, including `start === text.length`;
- invalid `sourceCommentId` containing a prose sentinel never reaches logs;
- lost-response retry and double invocation reuse one comment ID;
- matching legacy explanation ID gets 409 from free creation;
- clearing body removes the key while retaining answer, citations, and thread;
- immediate Save & ask updates the live comment’s `threadId`;
- wrong same-article source comment is rejected;
- optimistic collision rollback preserves the existing comment;
- multiple comment/chat IDs choose the linked pair;
- stale attempt cannot finish after a newer attempt starts;
- real-Postgres concurrent create matrix using separate connections and a barrier.

**Verdict:** do not ship this build. The Postgres insert/read-back race is good, and no FK is a reasonable domain choice, but the unvalidated log value violates a hard privacy rule, `beginAnswer` still allows duplicate paid attempts, the anchor offset is not actually checked, and client retries can create duplicate durable comments. Fix those blockers and the named should-fixes, then rerun the cross-family review.