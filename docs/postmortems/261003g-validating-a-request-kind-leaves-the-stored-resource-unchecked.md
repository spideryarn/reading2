# Validating a request kind leaves the stored resource unchecked

Up: [postmortems.md](../project/postmortems.md) · review:
[261003l stage 2](../plans/261003l-stage-2-code-review-sol.md)

Caught during the review of Explore before landing; no evidence this reached readers. A spoken
append naming an existing Explore thread, omitting `kind` and supplying its correct tail, added
two spoken messages to a conversation that has no Live. The pure reproduction changed its
message count from 2 to 4. Root cause investigated in a read-only subagent.

The class is **validating a request discriminant without validating the referenced resource's
capability**. `spokenChat` allows an omitted kind for older callers. `withSpokenTurn` checked
whether a supplied kind contradicted the stored thread, but an omitted kind skipped that check.
The tail guard proves the conversation has not moved; it says nothing about whether it permits
speech. `appendSpoken` persisted the result inside its transaction.

Explore made this a new defect in `34ca6137a`. The conditional request-kind check came from
`da1f24ea6d`; Tutorial inherited the same gap in `849cdcb50`. The UI's missing Live button and
the route's rejection of explicit `kind: "explore"` were mistaken for a complete capability gate.
The existing route test covered explicit forbidden kinds, so it passed over a reference-only
request that exercised the same write with no discriminant.

The stage fix checks the resolved Explore thread in `withSpokenTurn`, before minting messages
or changing rows. Its regression in `tests/explore-kind.test.ts` was seen fail with
`expected function to throw an error, but it didn't`, then pass after the guard. Controls still
allow omitted-kind appends to Chat and Recall. A route regression asserts 409 and unchanged
stored data; it was added to `tests/chat-spoken-route.test.ts` but cannot run without Postgres.

Countermeasures, ranked by ease against value:

1. **Test reference-only requests against resources that forbid the operation.** One cheap pure
   regression, done here; the resource's stored capability must decide even when request metadata
   is absent. This catches the class in edits and retries as well as appends.
2. **Check the persisted result at the route boundary.** The additional Postgres regression costs
   a fixture and confirms that refusal writes nothing. Added here, pending the implementer's run.
3. **Require every request to repeat its kind.** Rejected: it breaks legitimate older clients and
   keeps authorization dependent on request metadata instead of the referenced resource.

The durable wider fix is to check resolved thread kinds against `isSpokenKind` at every Live
entry point. This stage's narrow fix leaves the pre-existing Tutorial/Candidates append gap,
and Live token/session creation still accepts any stored thread's id. Those are reported in
the linked review, outside the authorized stage fix. The lesson is to validate what the id
resolves to, rather than rely on the caller repeating its discriminator or the UI hiding a button.
