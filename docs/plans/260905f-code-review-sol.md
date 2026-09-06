# GPT Sol on the built code — stage 2 of the external link panel

**2026-09-05, `gpt-5.6-sol`, high effort, read-only.** The second of the two reviews the house
workflow asks for, and the one weighted higher: the
[plan review](260905f-plan-review-sol.md) reads prose and cannot find a handler that writes one
field and then rejects the request. Verdict on arrival: **no P0, five P1s, "not safe to commit as it
stands."**

## What was done about each finding

Every one was accepted, and the fixes are in the same commit as the code they correct. Each was
**watched go red under a deliberate mutation** rather than assumed — the mutation and the case it
reddens are named beside it.

| | Finding | What changed |
|---|---|---|
| **P1-1** | `requestTarget` percent-decoded the path, so `/a%2Fb` and `/a/b` were one key — and that key is the route's *authorization* test | `requestTarget` is now the plain WHATWG serialization with only the fragment cleared. The generous version survives as `sameTarget`, which is what the chat tool's *already-open* refusal actually wants, because there over-matching is the safe direction. [`tests/request-target.test.ts`](../../tests/request-target.test.ts) pairs the two so neither can be "fixed" into the other |
| **P1-2** | the single-flight lease had no fencing token, so a stalled claimant could delete its successor's claim or overwrite a good answer with an older failure | a `claim_id` column; `release` is conditional on it; and `fill` carries a `setWhere` that refuses to turn a **live** `ok` row into a failure — which is the half no per-target lock can cover, because a redirect's two writers hold different locks. **And the promise was weakened to match the code**: at most one fetch inside a lease, and *a loser can never destroy a winner* |
| **P1-3** | only the published URL was checked for a credential, so a redirect into a signed URL stored it | every hop of `doc.chain` is checked after the fetch; a chain that lands on one writes a short-lived row under the **requested** address only and nothing about where it went. The list of parameter names is wider, and the guarantee is now stated as the heuristic it is |
| **P1-4** | retention was documented and never ran — `expires_at` stops a row being served, it does not delete it | `sweepABatch` deletes fifty long-dead rows on the rare path that writes a new one. The script stays for a bigger pass |
| **P1-5** | the fetch, the extraction and the write shared one `try`, so our own bug became a seven-day global fact about somebody else's site | only a `FetchFailure` is cached. Anything else releases the claim and throws, which the route answers 500 and Sentry reports |
| **P2-1** | a `refused` (a chat link, a spent allowance) was cached under the URL, silencing it for the session | a fourth response member, `refused`, distinct from `unavailable`. The client caches only answers that are properties of the address |
| **P2-2** | the `pending` retry fired at 1.2s against a ten-second fetch, then cached the second `pending` for ever | 3s, and a second `pending` is not remembered, so the next hover asks again |
| **P2-3** | the `link_previews_shape` CHECK let an alias carry a title and a failure carry a description | the CHECK enforces the union it describes |
| **P2-4** | four comments and docs described behaviour that was not there | all four corrected — the route's own 404, `fetched_at` (the column was `created_at`), three overstatements in links.md, and `tests/link-facts.test.ts`'s "no React harness", which stage 1 had already disproved |

**On "over-built":** the review's closing note was that a hard *exactly once* is more machinery than
a metadata-only beta stage is worth, and it offered two ways out — weaken the promise, or fence it
properly. Both were taken, in proportion: the fencing that removes the only failure a *reader* would
see (a good preview replaced by a week of nothing) is ~20 lines and a column; the rest of the
promise was corrected downwards in the code comments, in `links.md` and here, rather than defended.

**The two migrations were folded into one pair afterwards** rather than a third being added on top.
They had been applied to nobody's database but this laptop's, so the honest artefact is one clean
migration rather than a correction visible for ever in the chain.

---

*What follows is the review verbatim.*

No P0. I found five P1s; the route’s basic owner gate is sound, but the URL identity, lease fencing, credential handling, and retention are not yet safe enough.

## P1 findings

[P1-1] `requestTarget` merges network-distinct URLs, weakening both authorization and cache identity

[src/urls.ts:570](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/urls.ts:570) decodes the entire pathname before constructing the key. Reserved escapes must remain escaped:

- `/a%2Fb` and `/a/b` both become `/a/b`.
- `/a%3Fb` and `/a?b` both become `/a?b`.

Because [articlePointsAt](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:379) uses this equality, an article linking `https://example.com/a%3Fb` authorizes a request for the distinct target `https://example.com/a?b`. The same collision can return one page’s cached content for the other. Dropping the hostname’s trailing dot has a smaller version of the same problem because HTTP virtual hosts can distinguish it.

Ignoring the fragment is right; decoding reserved path characters is not. The key should be the WHATWG URL serialization with only `hash` cleared.

[P1-2] The single-flight lease has no fencing token, so an expired claimant can overwrite or delete its successor

[PreviewClaim](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/store/contracts.ts:1879) carries no claim ID. Consequently, [fill](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/store/pg-link-previews.ts:264) unconditionally upserts by target and [release](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/store/pg-link-previews.ts:298) deletes any pending generation.

A concrete sequence:

1. A claims target T.
2. A stalls past the 20-second lease.
3. B reclaims T and begins fetching.
4. A resumes. If denied allowance, its `release(T)` deletes B’s claim. If A fills, it overwrites B’s pending row.
5. B later fills and can overwrite A’s good answer with an older failure, or vice versa.

Redirect aliases add another race: requests for R and final target F hold different advisory locks, yet both unconditionally write F. A slow direct-F failure can destroy a good R→F result.

Abandoned work is not permanently wedged—the expiry works—but “two cold requests do not both fetch” and “a slow loser cannot destroy the winner” are false. Claims need a generation/token stored in the row, with conditional fill/release. Final-target writes also need conflict semantics that cannot downgrade a newer answer.

[P1-3] Credential-bearing destinations can still enter the ownerless cache

[carriesCredential](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/urls.ts:650) recognizes only userinfo and an exact parameter-name denylist. Common capability names such as `token_hash`, `authkey`, `resourcekey`, `rlkey`, `code`, and `ticket` are missed; arbitrary or path-based capabilities cannot be recognized by this shape at all.

More importantly, only the initially supplied URL is checked. A harmless published URL can redirect to a signed URL, after which [fetchAndStore](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:506) stores `doc.url` and its content under the final target at [line 583](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:583). `fetchDocument` correctly validates redirect SSRF safety, but it does not enforce this ownerless-cache credential policy.

At minimum every redirect-chain URL must be checked before storage. More fundamentally, an exact-name denylist cannot support the documented guarantee that credential-bearing URLs are refused.

[P1-4] Retention is documented but not enforced

[scripts/link-previews-sweep.ts:16](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/scripts/link-previews-sweep.ts:16) explicitly says nothing schedules the sweep, and the command defaults to a dry run at [line 42](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/scripts/link-previews-sweep.ts:42).

Therefore ownerless URLs and extracted content live indefinitely by default. `expires_at` stops serving them; it does not delete them. This does not satisfy the plan’s requirement that ownerless rows have defined retention rather than outliving their introducing article forever. The deletion needs an actual scheduled or request-driven execution path.

[P1-5] Internal failures are misclassified and globally negative-cached as destination failures

The `try` beginning at [src/link-previews.ts:505](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:505) covers fetching, extraction, and database writes. Its catch at [line 552](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:552) turns every non-`FetchFailure` into a seven-day permanent `"failed"` entry.

Thus an extraction bug or transient failure writing a good result can become a successful `200 unavailable`, be logged only as an ordinary destination outcome, and poison that URL globally for a week. If the first database write committed but its acknowledgement failed, the catch can actively replace the good row with a failure.

Only `fetchDocument` failures should be negatively cached. Extraction/store defects should escape as server failures, leaving or releasing the claim rather than manufacturing a fact about the destination.

## P2 findings

[P2-1] A refused chat link can suppress an authorized prose preview for the rest of the session

The delegated hover listener includes prose, chat citations, and chat sources at [ProseHoverCard.tsx:261](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/ProseHoverCard.tsx:261). Yet the effect calls `loadPage` without knowing which kind supplied the link at [link-facts.ts:664](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:664).

A chat link is correctly rejected by server membership, but [loadPage](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:545) caches that contextual refusal as `null` under the URL. If the same URL later appears in the article prose, `pageCache.has(url)` prevents the authorized request.

The same problem applies to rate-limit, timeout, and authorization failures: positive answers are URL properties, but these negative answers are not. The raw-URL key also makes fragment variants send redundant API requests even though they share one network target.

[P2-2] The pending retry normally completes too early to observe the winner

The server fetch may take ten seconds, but the client retries after only 1.2 seconds at [link-facts.ts:469](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:469). A second `pending` is then cached permanently for the session at [line 558](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:558).

So a reader losing a cold race commonly receives no preview even after the winner fills the cache. It does not spin forever, but it defeats the stated reason for retrying. A second pending should remain uncached so a later hover can try again, or retry against a delay compatible with the server envelope.

[P2-3] `link_previews_shape` does not enforce the union its comment claims

The CHECK at [src/db/schema.ts:4426](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/db/schema.ts:4426):

- permits alias rows containing title/site/description/paragraph/words;
- permits transient/permanent rows containing all those content fields.

Current writers clear them, so this is latent, but the database does not guarantee “an alias has a final target and nothing else” or “a failure has no content.” A later partial update can preserve stale content while passing the constraint.

[P2-4] Several comments/docs confidently describe behavior that is not present

- [src/routes.ts:7005](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/routes.ts:7005) says an unknown article returns `unavailable`; `loadArticle` actually throws the owner-scoped 404.
- [src/db/schema.ts:4313](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/db/schema.ts:4313) repeatedly names `fetched_at`, but `createdAt()` creates `created_at`.
- [docs/project/links.md:609](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/docs/project/links.md:609), [line 613](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/docs/project/links.md:613), and [line 629](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/docs/project/links.md:629) overstate retention, credential refusal, and single-flight respectively.
- [tests/link-facts.test.ts:7](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/tests/link-facts.test.ts:7) still says there is no React harness, while its own footer says there are 124 TSX suites.

## What is sound

The ordinary authorization chain is correctly placed: the route is behind `requireUser`, `loadArticle` resolves through `ownedSlug`, and membership is checked before cache access or spending. Apart from the `requestTarget` collision, I found no route around those gates.

The limiter is substantially correct. Its count-and-insert is serialized by owner, successful work retains its hourly event, `finish` is immediately protected by `finally`, and process death fails conservatively until the lease expires. The in-transaction sweep is safe under the current policy because the lease is far shorter than the rolling window.

The core `fetchDocument` envelope is reused correctly: scheme checking, per-hop DNS/address validation, pinning, redirect limit, byte limit, deadline, type sniffing, and one attempt are present. Omitting the caller’s abort signal is defensible because the design intentionally lets the cache fill after the card gives up. The missing part is the feature-specific credential check across redirects.

`urls.ts` remains a leaf: it has no imports or side effects. The provided diff shows `requestTarget`/`sameTarget` moved without changing their implementation, so chat-tool behavior did not change. The percent-decoding defect pre-existed the move; using the function as an authorization and global-cache key makes it newly serious.

The remaining timing disclosure is broadly within the plan’s accepted category, but `pending` is sharper than ordinary cache latency: it tells another eligible caller that a fill is active within the lease window. The docs should say that explicitly. The 404 does not expose another reader’s article because nonexistent and non-owned slugs share the same owner-scoped miss.

## Over-built

The hard “exactly one fetch” mechanism is over-built for a beta metadata-only stage. Rare duplicate cold fetches would be cheaper and safer than an incomplete distributed lease protocol. Either weaken the promise now—unique cache plus limiter, accepting occasional duplicates—or add proper fencing. Once Stage 3 introduces model spend, robust single-flight becomes worth its complexity. The ownership check, SSRF envelope, credential policy, expiry, and limiter are not optional complexity.

Verdict: No — this is not safe to commit as it stands.