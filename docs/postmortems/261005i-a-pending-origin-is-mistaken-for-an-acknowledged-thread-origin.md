# A pending origin is mistaken for an acknowledged thread origin

Up: [postmortems.md](../project/postmortems.md).

Caught during review of `eaf3a3fee`; no evidence this reached readers. A Debate handoff kept
its origin after the server refused its first Send. Returning to Chat could then label an
existing plain thread with that rejected claim's origin, even though the server stored none.

The class is **pending request metadata mistaken for acknowledged resource state**. The draft
store intentionally outlives the Chat band so an unsent or failed handoff keeps its source.
The band used that same metadata to fill an origin absent from a named thread. A named thread
proves existence, not acceptance of the local request. After a 409 caused by an id collision,
leaving Chat and returning creates a new controller; its load makes the existing server thread
named. The old draft then supplied provenance the authoritative row explicitly lacked.

The overlay was introduced in `eaf3a3fee`, alongside the origin draft store. Its purpose was
to display the source immediately after the first Send without a reload, because the `begin`
frame carried ids but no origin. Existing tests covered successful sends and first-send failures
with no server thread. They did not cover refusal followed by a successful load of a thread with
the same id. The separate truths—thread exists and origin request succeeded—therefore never
disagreed in those tests.

The fix sends the stored thread's origin in the server's `begin` frame and preserves it through
`Begun` and `withServerIds`. The band renders origins from the acknowledged thread and clears
confirmed draft entries. A pending draft remains useful for retrying creation, but no longer
fills missing provenance on a loaded row. This is the durable fix: provide authoritative metadata
at acknowledgement instead of inferring it from resource existence.

The regression in
[conversation-band-origin.test.tsx](../../tests/conversation-band-origin.test.tsx),
`does not overlay a refused origin on an existing plain thread after returning to Chat`,
was seen fail with an undefined expectation receiving the held claim origin. After the fix,
all 12 tests passed, including immediate source display, failed-send retention and Live gating.
The regression models the server's 409 and stored plain thread without requiring a database.

Countermeasures, ranked by ease against value:

1. **Let acknowledgement carry the metadata it confirms.** Added here, with a cheap regression
   where rejected request metadata differs from a subsequently loaded resource. This catches
   the boundary between intent and persisted state rather than just successful submission.
2. **Test the absence of authoritative optional fields after failed writes.** Cheap cases for
   optimistic annotations generally: a missing server value can be meaningful, and pending
   client metadata must not silently fill it.
3. **Refetch after every successful first Send.** Rejected as the primary fix. It adds requests
   and latency while leaving the false fallback in place; even a correct refetch could still
   be overlaid with the rejected value.

The lesson is that an acknowledged id says which resource exists. Only acknowledged metadata
says which part of the local intent that resource accepted.
