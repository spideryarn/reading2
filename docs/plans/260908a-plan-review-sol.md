The route move itself is sound, but the plan is not safe as written: one established P1 makes Stage 3 impossible without unplanned edits.

## Findings

**F1 — P1, established: Stage 3 must update two route-table expectations.**

The plan says the contract checks are “run rather than extended” ([plan:151](/home/greg/code/spideryarn2/docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md:151)). That is false for:

- `answers the moved domains from the table` ([contract test:1888](/home/greg/code/spideryarn2/tests/authenticated-api-route-contract.test.ts:1888)): add the twelve pair keys and add both `/api/chat` and `/api/live` to `moved`.
- `keeps the table in the chain's order` ([contract test:1959](/home/greg/code/spideryarn2/tests/authenticated-api-route-contract.test.ts:1959)): prepend the twelve pair keys in existing guard order, preferably red-first as the preceding slices did.

`EXPECTED_AUTH_ROUTES` should indeed remain unchanged. These are different expectations. Without editing them, the authoritative contract suite must fail.

**F2 — P2, established verification gap: the hand argument for `chat` GET is not enough.**

The return rail is correctly specified. An AST walk finds:

- `chat` GET: two argumentless returns, at current lines 8423 and 8426.
- Every other guard: exactly one final argumentless return.

But the plan’s hand argument is written before the move and therefore cannot establish that the future moved body retained both returns. Deleting the early return is also the requested third mutation: neither the DELETE oracle nor the automatic body comparison would see it, because `chat` GET has been excluded from that comparison.

There is already a good behavioural catcher: [the query-string route test](/home/greg/code/spideryarn2/tests/the-query-string-does-not-decide-the-route.test.ts:181) distinguishes the summary and full responses and would reject executing the second `send`. Amend the plan to either:

- compare `chat` GET mechanically with an AST-aware normalisation that removes only the final return; or
- explicitly run that test and watch an early-return deletion make it red.

A post-move hand inspection can supplement either; the current pre-move assertion cannot replace them.

**F3 — P2, established: the named purity verifier is not durable.**

Stage 2 says to repoint `scratchpad/e4f7-capture-referee.mjs` ([plan:127](/home/greg/code/spideryarn2/docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md:127)), but that file is absent from both this checkout and the stated base commit. The plan contains the broad algorithm, but not an executable verifier whose new return rail can be reviewed.

Commit a reusable verifier, or put a complete reproducible implementation in this slice. This matters particularly because F2 depends on precisely what it refuses and normalises.

## The six questions

1. **Ordering:** correct. Removing the exact contiguous suffix and prepending the same rows above the existing table preserves the dispatch sequence. I found no path or method whose selected handler changes.

2. **`live-tool`:** correct. The path matches both patterns, but POST reaches only `chatLiveTool`; PATCH and DELETE reach only `oneThread`. Other methods reach neither. Order is therefore immaterial, though contiguity preserves it anyway.

3. **Stage 1:** the decomposition and predicted results are correct. `inTurnOrder` always returns a Promise, and `send` synchronously stringifies it, so dropping its `await` produces `{"threads":{}}`. Removing the lock while retaining `await chatStore.remove(...)` preserves the response and makes the proposed test green. The third mutation is F2’s removed early return.

4. **Return rail:** it fires on exactly `chat` GET. The hand argument alone is inadequate; the existing focused test or an AST-aware comparison closes the gap cheaply.

5. **Security:** the account is correct. Public dispatch only claims `/api/public` and `/api/public/*` ([public routes:182](/home/greg/code/spideryarn2/src/public/routes.ts:182)); chat/live proceed through the single `requireUser` call. Guards 1–5 and 9–12 preserve `slugPart` for article slugs. Guards 6–8 correctly use `part`: their session IDs are owner-scoped lookup values and are never joined into storage paths.

6. **Size:** keep all twelve together. A six/six split cuts through the interleaved chat/live sequence, doubles the table-expectation and purity ceremony, and removes no distinct risk. With F1 and F2 fixed, this remains a bounded mechanical slice. The file-size increase is not grounds to stop: this migration reduces dispatcher complexity and converges on one routing mechanism; file extraction is a separate decision.

**Verdict: build it with these changes.**

With one hour rather than four, I would keep F1 and F2 and drop F3’s durable-verifier work, recreating the one-off comparison carefully for this slice.