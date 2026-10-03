# A consumer fixture asserts a field its producer never emits

Up: [postmortems.md](../project/postmortems.md)

Profile's model rows printed `(undefined)` because the page expected `wire`, but
`GET /api/models` never sent it. Commit `fd93e2757d3c711edeb5757b6375e3bc596109f4`
(2026-08-27) introduced the mismatch when it added the protocol labels. The browser
check for [plan 261003k](../plans/261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md)
found it; `0becf8dc7` fixes the producer and makes the consumer tolerate absent wires
on non-task rows. The defect reached the page; this review found no remaining
production defect in that fix.

## Why the regression test still missed it

`tests/profile-sections-collapsed.test.tsx` supplies `wire` in its own response fixture.
`tests/models.test.ts` checks the resolver. Neither crosses the boundary between the
resolver and the HTTP response. The existing HTTP positive control checks a nonempty
reply, and its Simple assertion checks only the model id.

In the 2026-10-03 code review, deleting the producer's `wire` assignment left all
20 Profile/model tests green. With the new HTTP assertion, that same mutation fails:
`structure: expected undefined to be 'messages'`. This is the class: **a consumer
fixture asserts a field its producer never emits**. Separate client and server row
types allowed the mismatch; the fixture made the consumer's expectation look proven.

## Countermeasures, ranked by ease against value

1. **Assert the real response at the boundary.** Added to
   `tests/authenticated-api-route-contract.test.ts`: each task must carry its resolved
   wire, with independent witnesses for Messages, chat, and a non-task row. The
   assertion was seen red with the producer assignment removed, then green restored.
2. **Share the response type.** A task row whose type requires `wire` would catch
   omissions before execution. This is a possible further improvement; the review
   leaves the production types alone and guards the actual reply now.
3. **Validate every API response at runtime.** Rejected for this fix: broader machinery
   costs more than the missing boundary assertion and would still need a correct
   contract to validate against.

The lasting fix is to check the producer's reply whenever a consumer fixture assumes
a new field. Rendering a supplied value cannot establish that it arrives.
