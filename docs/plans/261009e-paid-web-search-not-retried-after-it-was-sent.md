# A web search is not sent again once it may have left (qi-2gaxfaaj)

Queue item qi-2gaxfaaj, from GPT Sol's 261008i stage 3 review (E2). Bug fix under Greg's standing
rule (2026-10-09: *"You are definitely authorised to fix bugs any time you notice them"*).

## The problem

The OpenRouter seams in `src/ai-call.ts` retry a call up to three times when `fetch` itself rejects
with a `TypeError` (`worthAskingAgain`). That covers two very different failures:

- **the request never left** — connection refused, DNS failure, connect timeout. Nothing reached
  OpenRouter, so nothing was billed;
- **the request left and the answer never came** — a reset, a socket closed, a headers timeout.
  OpenRouter may already have accepted and billed it, and there is no idempotency key, so a retry
  can pay a second and third time.

For an ordinary call the second is a few tokens, and
[ai-gateway.md § transport retry](../project/ai-gateway.md#transport-retry) already accepts it
("the retry may pay twice for the first moment of a call"). For a call carrying
`openrouter:web_search` it is the searches too, which can cost 15–20 cents a call: Debate's Reception and claim
checks (`openRouterJson`), chat search and explain (`openRouterStream`), citation find/investigate,
dig deeper, referee criteria.

## The fix

A request whose body carries an `openrouter:web_search` tool is asked again after a network failure
**only when the error's cause chain names a code that proves no request bytes were written**:
`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`. Every other network failure,
a bare `fetch failed` with no code included, ends the call, and so does every refusal, unpriced
503s included (changed after the plan review, below). `send` refuses redirects on every request.
Nothing else changes:

- calls without web search keep today's rule;
- `worthAskingAgain(err)` (exported, used by the PDF reader's and embeddings' own loops) keeps its
  signature and meaning; neither of those callers searches. The new rule sits in `mayAskAgain`,
  which every seam's loop (`asTransportAttempts`, `acceptedStream`) already goes through, and which
  is handed an immutable web-search flag computed from the serialized request. The image,
  transcription and decisions payloads cannot carry web-search tools and pass `false`.

The code list lives beside `NETWORK_CODES` in `src/call-failure.ts` as `UNSENT_NETWORK_CODES`, with
a `sentNothing(err)` that walks the same cause chain `networkClass` does. Which requests count as a
web search is one predicate in `ai-call.ts` next to `frameProviderTrusted`, matching the `tools`
spelling every caller uses (any engine).

**Why these four codes are safe.** Each is raised before a TCP connection exists (`ECONNREFUSED`,
`UND_ERR_CONNECT_TIMEOUT`) or before one is attempted (`ENOTFOUND`, `EAI_AGAIN`). A reused
keep-alive socket that turns out dead fails with `ECONNRESET` / `UND_ERR_SOCKET` / `EPIPE`, which
are not on the list, so a pooled connection cannot sneak through.

## Simpler options passed over

- **Turn the gateway retry off for web search entirely** (`retryTransport: false` at each caller).
  Simpler to write, but nine callers would each have to remember it, and a refused connection —
  the cheapest, safest retry there is — would fail the reader for nothing.
- **Narrow the rule for every call, not only web search.** The doc already chose to pay twice for a
  few tokens rather than fail a reader; changing that is a product trade-off nobody asked for.

## Plan review (GPT Sol) and what changed

1. *The unpriced-5xx exception leaves the billing question open* — a refusal proves the request
   arrived, an unpriced body proves only that no cost was reported, and a streamed refusal's
   unreadable body is classed unpriced too. **Taken**: it is also what the Overseer's reading says
   ("never after it was sent"). Web-search calls are no longer retried on any status.
2. *The codes describe one connection, not the whole fetch* — `fetch` followed redirects, so a
   first POST could go out and the refused connection be the second hop. **Taken**:
   `redirect: "error"` in `send`. Undici's own 421 replay and HTTP/2 refused-stream replay remain;
   both are, by protocol, requests the server did not process.
3. *A requeued pipeline step buys the searches again.* **Documented**, not fixed: that is the job
   lease's behaviour, not the gateway's. Fixed since by
   [261009l](261009l-a-requeued-job-does-not-buy-the-debate-search-again.md).
4. Keep the four codes; no broad TLS list. **Agreed.**
5. The predicate covers every current caller; add a default-engine case. **Added.**

## Question left for Greg

**[Q-search-5xx]** A web-search call that meets a transient 502/503/504 now fails instead of trying
again, so a reader may see a Debate or chat search fail on a bad second that a retry would have
survived. Recommendation: keep it — the alternative is paying 15–20 cents again on the strength of
a body that did not mention a cost — and revisit if `ai_calls` shows web-search rows failing with
`failure_status` 5xx often enough to matter.

## Tests (red first)

In `tests/ai-call-transport-retry.test.ts`, for `openRouterJson` and `openRouterStream` with a
web-search body:

- a dropped connection with `ECONNRESET` (and a bare `fetch failed`) → one request, one `error` row,
  the error thrown — **red before the fix**;
- `ECONNREFUSED` / `ENOTFOUND` → retried, answers on the second go;
- an unpriced 503 → not retried; a default-engine search is covered; `send` asks for
  `redirect: "error"`;
- the same `ECONNRESET` without web search → still retried (existing tests cover this).

Gates: `npm test`, `npm run typecheck`, lint on touched files. Doc: one paragraph in
ai-gateway.md § transport retry.

## Code review

The retry guard originally inspected the caller's body after each failure, while `send` reused
the serialized payload. Removing `tools` during a request, or producing tools through `toJSON`,
could therefore replay paid search after a reset. Four regression cases (JSON and stream, both
inputs) failed before the repair. The guard now uses an immutable flag from the serialized payload.
Coverage also checks every transient refusal status, refusal code/cause chains, all excluded
network codes, and redirect settings across all five seams, including opted-out calls.
