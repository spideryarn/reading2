# A disabled button does not close the same-tick submit gap

Up: [postmortems.md](../project/postmortems.md). Code review of the uncommitted work after
`13fd49387` found that two activations of the author-gift dialog's Draft button before React
rendered its busy state sent two POSTs and started two overlapping read-backs. **Nothing reached a
reader.** The server's concurrency guard meant only one gift, lookup and article preparation could
be made.

## What happened

`AuthorGiftDialog.draft()` checked the render's `busy`, called `setBusy(true)`, then awaited
`useAdminAuthorGifts.ensure()`. A second activation in the same turn ran the same closure before
React committed another render, so it also saw `busy === false` and entered. A red regression test
pressed Draft twice inside one `act`:

```text
expected [ { … }, { … } ] to have a length of 1 but got 2
```

Both calls POSTed `/api/admin/author-gifts`, and each triggered a list reload. The durable operation
remained safe: `ensureAuthorGift` locks and rechecks the article, inserts under the unique
`author_gifts.article_id` constraint with `ON CONFLICT DO NOTHING`, and only the winning insert
creates the lookup and preparation.

There is no introducing commit; `AuthorGiftDialog.tsx` was an untracked file in this change.

## The class: a render-lagged admission gate

React state controls the next render but was treated as a synchronous lock by the event handler
that scheduled it. `disabled={busy}` prevents interaction after the commit; it cannot reject an
event already delivered before that commit. An asynchronous action that admits one call per mounted
surface needs a synchronous latch as well as visible state.

The repository already contained the correct sibling: `EmailLine.again`, added in `b68513105`,
acquires `busyRef.current` before setting state for this reason. The older author-gift form,
introduced in `4ab35b277` and moved into `AdminVouchersPage.CreateForm` in `6309d50d5`, still has the
state-only shape and is a wider finding.

## Why nothing went red

The planned tests made one activation and waited for React. They proved the button became disabled,
not that the handler admitted one call before that render. Types cannot distinguish presentation
state from a lock. The server's idempotency hid the duplicate transport at the final gift state.

## What would have caught it, ranked by ease against value

1. **Acquire a ref before scheduling busy state, and press twice in one `act`.** Done here. The test
   asserts one POST, not merely one eventual gift.
2. **Apply the same latch and test to `AdminVouchersPage.CreateForm`.** Wider than this change and
   left for a decision; both its author-gift and ordinary voucher branches share `busy`.
3. **Keep transactional server idempotency.** Already present and still authoritative across tabs,
   remounts and retries; the component latch only covers one mounted surface.
4. **Lint `if (busy) return; setBusy(true)`.** Rejected: syntax varies and many actions tolerate
   concurrency or have stronger owner-level guards.
5. **Introduce a generic exclusive-action hook now.** Rejected: actions have different release and
   retry rules. The explicit ref-and-state pair is smaller until more identical lifecycles appear.

## The fix that is right for the long term

Each write-producing control that promises one in-flight action owns a synchronous per-mount latch;
React state remains its visible busy signal; the server remains concurrency-safe across components,
tabs and retries. The dialog now acquires the latch before the POST and releases it in `finally`.

## The thing I would tell myself

If the second call must be rejected synchronously, I would not use a value that changes only on the
next render as the lock. State shows busy, a ref admits the event, and the server defends the durable
operation.
