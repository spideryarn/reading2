## Ordered findings

1. **Blocking — creation and answering cannot share `CommentStore.create`.**

Where: `POST /api/comments/:slug`, `pgCommentStore.create`, filesystem `createComment`.

The first bug you found is real. The Postgres conflict update would blank new fields if they are added to `fields`, and the filesystem reset definitely rebuilds the object without them. But “make them insert-only” is not the complete fix:

- `body` is editable, so it is only immutable to answer writes.
- `updatedAt` is server-owned and edit-only, not insert-only.
- `threadId` must be write-once after creation in the proposed workflow.

More seriously, reopening POST makes an id collision destructive: an attempted new bookmark with an existing client-minted id is indistinguishable from retrying an explanation, so the upsert can overwrite the existing anchor and answer.

Concrete fix:

- `POST /api/comments/:slug` only creates a free comment with `status: "none"`.
- On conflict, return the existing row only when the immutable anchor and initial body match; otherwise return `409`.
- Add `POST /api/comments/:slug/:id/answer` for legacy retry/deepen. It loads the stored anchor rather than accepting another one.
- Replace overloaded `create` resets with `create`, `beginAnswer`, `patchBody`, and `linkThread` operations.
- `beginAnswer` must preserve the anchor, `body`, `updatedAt`, `threadId`, and `createdAt`, and must reject `status: "none"` so new comments cannot enter the retired explanation path.

2. **Blocking — `Save & ask` cannot populate `threadId` as planned.**

Where: the proposed FK, the “threadId is insert-only” rule, and the body-only PATCH.

If the comment is inserted first with `threadId`, the FK fails because the thread does not exist. If it is inserted without one, there is no operation that can add it. Creating the chat first starts a paid operation before the free comment is safely stored, and risks recording the provisional thread id rather than the server-confirmed id.

Make the choreography explicit:

1. Create the comment idempotently.
2. Start chat with a trusted `sourceCommentId`.
3. After the real thread exists, link it with a compare-and-set update from `NULL` to that thread id, before starting the model call.
4. Verify server-side that both anchors are identical.
5. If already linked, return/open that thread rather than creating another.

Do not accept an arbitrary `threadId` on the ordinary comment-create route.

3. **Blocking — the archive import order is broken, and all three archive projections currently drop the fields.**

Your second finding is correct. Comments must be inserted after their referenced chat threads. The safe order is:

1. Mint the union of comment and chat anchor identities.
2. Insert chat threads and messages.
3. Insert comments.

The current explicit projections also omit `body`, `updatedAt`, and `threadId` in all these places:

- `toComment`
- export’s `compact({...})`
- import’s `.values({...})`

Use `NULL` in Postgres and omit the property at the TypeScript/archive boundary. Import must also define what happens to a dangling `threadId`; fail with a useful archive error or deliberately normalize it to absent. Do not let it emerge as a raw FK failure.

The filesystem adapter also needs the equivalent of `ON DELETE SET NULL` when a chat is deleted, or a filesystem archive can contain a relationship that Postgres refuses.

4. **Should-fix — write down the field mutability rules; “insert-only” is too blunt.**

The required contract is:

| Field | Allowed writes |
|---|---|
| anchor, `createdAt` | creation only |
| `body` | creation and body PATCH |
| `updatedAt` | server-set when body changes |
| `threadId` | one successful link; cleared when thread is deleted |
| answer fields | legacy answer state machine only |

Every later operation must use a named allowlist. In particular, the client must merge the complete PATCH response over its optimistic comment; replacing it with a body-only optimistic object could blank `threadId`, answers, or timestamps in memory.

5. **Should-fix — keep `status: "none"`; do not add a discriminator or make status nullable.**

`none → pending → done/error` is a reasonable answer-state machine. A separate “kind” is worse because body, legacy answer, and linked chat are independent properties rather than exclusive kinds. Nullable status makes omissions and “no attempt” indistinguishable.

Exact behaviour:

- Free create inserts `status = 'none'` and null answer/attempt/lease columns.
- Legacy `beginAnswer` changes only eligible legacy rows to `pending`; it never changes `none`.
- Terminal writes remain fenced to the matching pending attempt.
- `sweepOrphaned` continues filtering exactly `c.status === "pending"`.

The plan is wrong that sweep needs changing: the pasted filter already excludes `"none"`. Consequently, the proposed “none is not swept” test will not be red first. Replace it with a route/store test showing that free creation currently produces `pending` or invokes the answer path.

6. **Should-fix — the comment route needs anchor validation, and `checkAnchor` is weaker than described.**

The pasted `checkAnchor` does not verify that the quote occurs at the supplied offset. It only checks that the quote occurs somewhere in the block. It also accepts an empty quote because every string includes `""`.

For free creation, validate before writing:

- valid client id;
- block belongs to the article;
- non-empty quote with a size limit;
- integer, non-negative, bounded start;
- quote occurs in the block after whitespace folding;
- body is a string, trimmed once, dropped when empty, and size-limited.

Do not include body or quote contents in errors or logs. The legacy answer endpoint should accept no replacement anchor at all.

7. **Should-fix — the double-mark behaviour is no longer acceptable.**

The old chat-first click rule was justified because comment/chat overlaps were rare legacy accidents. Under this plan, every `Save & ask` deliberately creates one. Clicking the passage would consistently hide the reader’s own note behind the chat.

For a comment whose `threadId` matches the overlapping chat, open the comment dialog and provide “Open chat” there—or show a two-item chooser. I would open the comment: it is the reader’s mark, and `threadId` gives the chat an explicit route. Keep the current preference only for unrelated accidental overlaps.

8. **Should-fix — use an explicit AI checkbox and do not bind plain Enter to either outcome.**

Changing Enter from paid to free is financially safe, but it silently changes the meaning of a box that still invites questions. It also prevents multiline comments.

Use an unchecked checkbox such as “Also start a chat and get an AI response.” The primary button changes from “Save comment” to “Save & ask AI” when checked. Enter inserts a newline; ⌘/Ctrl+Enter invokes the visible primary action. With an empty checked body, use “Explain this passage.”

9. **Minor — add failure-path tests, not only happy-path parity tests.**

Add tests proving:

- an id collision cannot mutate an existing comment;
- retry/deepen preserves all annotation fields and the anchor;
- a new `none` comment cannot use the legacy answer endpoint;
- chat failure leaves a valid free comment;
- retried `Save & ask` creates at most one thread;
- the server-confirmed thread id is linked;
- deleting a filesystem chat clears the link;
- clicking a linked double mark can reach the note.

## Verdict

**Build B, but not as written.** C’s objections are real under the current chat invariants, and D requires a genuine backfill, new identity/cardinality rules, both adapters, both archive seams, and rendering changes; defer it until a third anchored artefact appears. Before building B, split creation from legacy answering, specify the `Save & ask` transaction/link choreography, reorder import, and fix linked-mark navigation. Those are correctness issues, not polish.