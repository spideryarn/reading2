# An ask-once marker must share the request generation it represents

Stage 4's review found this before the reviewed worktree reached a reader. If *About “keyword”* was
pressed on article A, its request was still pending, and the reader went A → B → A, the next press
on A was ignored and the panel waited forever. The request-ordering hook had correctly discarded
the first A request; the separate “already asked” marker had not heard about that discard.

## What happened

`useCiters` kept two pieces of state for the topic view: `useOrderedRead` owned whether a request
generation was still current, while `topicAsked` deduplicated presses by slug. Changing the slug
invalidated the request generation but reset only the plain citer read's `askedFor` marker. On
returning to A, `topicAsked === "A"` suppressed the replacement request, while the old response was
forbidden to commit.

The red regression expected two `/api/citers/landmark?about=topic` requests across that sequence and
saw one:

```text
Expected: [plain A, topic A, plain A, topic A]
Received: [plain A, topic A, plain A]
```

Commit `bba409d8d` introduced the second read and its independent marker.

## An ask-once marker outlived the request generation it described

This is an **ABA state-machine desynchronisation**. A boolean or slug saying “already asked” is not
an independent fact; it is a claim about one live or completed request generation. If the request
owner invalidates that generation without invalidating the marker, the marker can suppress the only
operation capable of completing the UI.

The sibling plain citer read already reset its marker with the request on a slug change. The topic
read copied the deduplication but not that lifecycle rule.

## Why nothing went red

The topic test covered opening, one press and a settled second press. The hook's older race test
covered A → B → A only for the plain read. Both passed because neither combined an unsettled topic
request with the ABA navigation. The spinner was a valid rendering of `topic === null`, so types and
component tests also had nothing to reject.

## What would have caught it, ranked by ease against value

1. **Exercise every ask-once read through pending A → B → A** — cheap and now done in
   `tests/use-citers.test.tsx`; it catches the original interleaving and proves the stale response
   cannot overwrite the replacement.
2. **Reset dedupe markers beside request invalidation, not in a separate effect** — done here. The
   site comment names the invariant, and the settled answer is still reused rather than fetched
   again.
3. **Replace every read hook with one generic keyed request state machine** — rejected. The repo's
   read hooks deliberately differ in parsing and failure states; widening `useOrderedRead` to own
   product-specific “asked” state would trade this small lifecycle rule for a large abstraction.
4. **Property-test arbitrary navigation and response orderings for every hook** — rejected for now.
   It has high coverage value, but building a useful state-machine harness costs much more than the
   targeted regression and there is only one second, manually-triggered read today.

## The long-term fix

The shipped fix is also the long-term one at this scale: slug changes clear `topicAsked` in the same
render that makes `useOrderedRead` discard the old generation, while `askTopic` separately reuses a
settled answer for the current slug. That keeps “asked” and “answer exists” distinct: an invalidated
pending request may be replaced; a completed one need not be.

## The thing I would tell myself

I saw a synchronous ref preventing duplicate presses and treated it as local button state. It was a
lock on an asynchronous operation. Once the operation had a generation and an invalidation rule,
the lock needed the same lifecycle or it was bound to lie after an ABA navigation.

---

Up: [postmortems.md](../project/postmortems.md)
