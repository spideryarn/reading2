# A selector is only as current and total as its input

The first implementation of “show the newest import for this article” had three gaps: it ignored a
Retry response until the next poll, did not break equal-time ties the way the store does, and let one
malformed time poison every later comparison. The code review found all three before commit; nothing
reached a reader.

## What happened

`OwnerNotShared` changed from a set of status-ranked fallbacks to one `newestImport` selection. That
was the right model, but the selector did not receive or order the whole reality it claimed to
represent.

- Pressing Retry returned the replacement `Job`, but the component kept only its id. Selection still
  read the old polled list, so the failed card and its live Retry button stayed on screen until a poll
  found the replacement.
- `newestImport` compared `Date.parse(createdAt)` with `>`. Jobs created in the same millisecond kept
  whichever input order happened to arrive, while the store's total order is `(createdAt, id)`.
- `/api/jobs` is typed but not decoded at runtime. A missing or invalid `createdAt` can therefore
  reach the selector if the server breaks its contract. Once the first candidate produced `NaN`,
  every later `validTime > NaN` was false and the malformed candidate stayed selected.

The three red-first cases said:

```text
expected … to contain 'The retry now running'
expected … to contain 'The higher id'
expected … to contain 'The valid job'
```

## A selector is only as current and total as its input

This is **a selector whose candidate set omits a newer local fact and whose comparison is only a
partial order**. The selector's name said “newest”, but neither half of that claim was complete:
the POST response was newer than the polled snapshot, and timestamp alone did not order ties or
malformed values.

The malformed-time sibling is also a boundary mistake: a static `Job` annotation was treated as if
it validated JSON. TypeScript proves what callers say they have; it does not prove what the network
sent.

The defects were introduced in the uncommitted part 1 diff for plan 261019n. There is no introducing
commit.

## Why nothing went red

The original new tests covered different timestamps and always put the newest job first. That made
the timestamp comparison and the list's existing newest-first order agree. They did not exercise
the period after Retry had answered but before polling, an equal timestamp, or a value outside the
TypeScript contract.

The existing running-to-done test stayed green correctly: its job id does not change, and
`watchTerminal` observes the polled status transition. The two completed-import tests also stayed
green correctly. They prove the reread and loop guard, not the selection boundary added beside them.

## What would have caught it, ranked by ease against value

1. **Test each source of recency and each edge of the order** — done. The component test now holds
   the old list after Retry answers, reverses two equal-time ids, and sends malformed and missing
   times before a valid job.
2. **Use the store's whole order wherever the client says newest** — done here. The comparison is
   `(createdAt, id)`, with a valid time above an invalid one.
3. **Keep an action's returned object until the list carries that id** — done here. The list's copy
   wins as soon as it arrives, so a held `running` snapshot cannot mask `done` or `error`.
4. **Decode every `/api/jobs` response at the browser boundary** — not part of this fix. It would
   protect every consumer and is the stronger long-term boundary, but it is wider than the part 1
   review and needs an inventory of the whole `Job` wire shape. The local selector still fails soft
   instead of allowing `NaN` to hide valid work.

## The fix that is right for the long term

The scoped fix is structurally sound: selection sees the optimistic Retry result and the polled
list together; duplicate ids prefer the polled copy; and the comparator reproduces the store's
total order while demoting malformed times.

The wider long-term fix is runtime validation of the job-list response once, at its network
boundary. That should be planned separately because silently dropping or rejecting a malformed job
affects every queue surface, not only this page.

## The thing I would tell myself

When I replace several fallbacks with one “newest” selector, I need to list every place a newer fact
can arrive and write down the complete tie-break. A timestamp comparison over a typed array is not
enough when the freshest fact came from a POST and the array came from unvalidated JSON.
