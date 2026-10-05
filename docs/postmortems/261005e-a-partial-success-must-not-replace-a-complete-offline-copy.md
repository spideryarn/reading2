# A partial success must not replace a complete offline copy

Caught during the 2026-10-05 code review of [261005b](../plans/261005b-quiz-answers-are-kept-and-restored.md).
No reader impact was established. A temporary failure to read saved quiz answers left them visible
in the current visit but removed them from the offline copy: reload without a connection, and the
answer box was empty. The database rows were intact.

## The class: envelope success spent as field-level replacement evidence

`GET /api/quiz/:slug` intentionally returns HTTP 200 with questions and `attempts: null` when the
attempts query fails. That means “unknown”, not “none”. `useQuizRead` respected the distinction,
but the other consumer, [`api.ts`](../../src/web/lib/api.ts) § `saving`, cached every successful
JSON body wholesale. The result was a complete replacement at a boundary that had evidence for
only part of the response.

The root cause was putting preservation only in React reconciliation while treating the cache as
transport bookkeeping. Once that cache serves a new visit, it is another reader of the same
partial-result contract. A sibling of this class is
[the Usage tab's container-success bug](260910a-a-container-success-cannot-prove-every-suppressed-child-has-a-replacement.md):
both spend an envelope's success as proof that every fact it replaces was successfully read.

## Origin and evidence

Commit `523e771cf299fd032dd0e7204430b9b9a7be7da5` introduced saved attempts and the partial-success
response. The generic cache write predates it (`git blame`: `ad90b1759`, later ticketed by
`e9f197ec0`); the new response shape made that previously sufficient replacement rule wrong.

The review added `tests/quiz-kept-answers.test.tsx` case **“keeps the offline answers when a later
same-batch read cannot load attempts”**. It loaded `What I said to one.`, refreshed with
`attempts: null`, and confirmed the current box still held that answer. After an offline reload,
the expected answer was `What I said to one.` and the actual box was empty. The main reviewer saw
this test red before changing the cache write.

The existing tests covered failed-attempt reads within a visit and offline reload after a successful
refresh separately. Both were green. Neither crossed the failure boundary into a new visit, where
the React state that hid the damaged cache no longer existed.

## The fix that is right for the long term

At the cache write, leave a complete cached response untouched when the new response cannot read
attempts and both copies name the same quiz batch. A new batch must never inherit the old answers,
and an authoritative `attempts: []` must still replace the previous list. The online response
remains `null` so its consumer can report the failed read.

The first review fix copied the old attempts into the new response, then wrote it with the newer
ticket. A second reviewer identified a cross-tab race: while that copy was being read, a full
response could commit newer answers; the partial response would then overwrite them using its
newer ticket and older copied data. `api-fetch-offline.test.ts` reproduced this red (expected
answer `new`, received `old`). Skipping the partial cache write also leaves outstanding full reads
free to improve the copy, without promoting old data to a newer ticket.

This is the intended review fix, not a change to the server's useful partial-success response.
It closes unavailable-attempt replacement; it does not promise that a save followed immediately
by a lost connection has already refreshed the offline copy.

## What would have caught the class, ranked by ease against value

1. **Read through the fallback after a partial success.** Cheap, implemented in the review test
   above: retain a complete copy, serve an unknown child in a successful envelope, destroy the live
   state, then exercise the fallback. Testing only the live state misses the second consumer.
2. **Check identity and authoritative emptiness beside preservation.** Cheap, needed for the fix:
   a matching batch can preserve unknown answers; a different batch and a known empty list cannot.
   Preservation without identity checks repairs disappearance by creating misattribution.
3. **Reject all partial successes from the cache.** Rejected: a new batch's questions should remain
   available offline even when its answers could not be read.
4. **Build a generic partial-response cache framework.** Rejected for this change: quiz batch
   identity is the relevant proof, and a framework would add machinery without removing that
   domain decision.

Up: [Postmortems](../project/postmortems.md).
