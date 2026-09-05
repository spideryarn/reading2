The plan needs revision before implementation. The two-table split is sound, and the existing fetch machinery covers the SSRF fundamentals, but the route identity, cache keys, cache lifecycle, and cost controls are not yet safe enough. I found no P0.

### Findings

[P1-1] The URL-only route cannot enforce the owner gate or build the contextual summary

The proposed `GET /api/link-preview?url=` contract contains neither the current article slug nor its ID, yet Stage 3 must load that article, establish that the caller owns it, and key the summary by article. Authentication alone means any signed-in account can call the route directly, including while viewing somebody else’s public article. The UI seam in [ProseHoverCard.tsx](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/ProseHoverCard.tsx:434>) correctly hides link facts from visitors, but it is not route authorization.

Make the endpoint article-scoped—at minimum `slug + url`—verify ownership, and preferably verify that the requested URL appears in that article’s extracted links before fetching or spending money. This also supplies the context Stage 3 currently lacks. The problematic contract is in the [plan](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md:138>).

[P1-2] `urlKey` is deliberately too lossy to identify a network request

The plan keys fetched previews and summaries with `urlKey`, but the repository already documents why it cannot identify what an HTTP request fetches: it folds HTTP/HTTPS, `www`, and tracking parameters that a server may treat differently. `readWebPage` therefore constructs an exact request identity from scheme, host, port, path, and query, ignoring only the fragment; see [chat-tools.ts](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/chat-tools.ts:662>).

Use two identities:

- An exact normalized request target for fetched content and in-flight coordination.
- The existing `urlKey` only for reader-facing equivalence such as shelf membership.

After redirects, record requested-target → final-target aliases. Otherwise infinitely many redirecting URLs still produce independent misses. Fragments already pose no problem; arbitrary query strings do.

[P1-3] The contextual-summary cache omits inputs that change its answer

The proposed `(owner, article, urlKey)` key never changes when the source article is re-extracted or the reader edits their profile/purpose, even though both are prompt inputs. That leaves a permanently stale personalized summary. The repository already treats profile hashes as cache-staleness inputs in [profile.ts](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/profile.ts:24>).

Key or validate the row using:

- Destination-content hash.
- Current-article/source hash.
- Profile hash, including a defined value for no profile.
- Prompt/model version.

Also, the statement that this is “exactly” the `glossaryLookups` shape is inaccurate: its primary key is `(articleId, entryId)`, not owner-inclusive; see [schema.ts](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/db/schema.ts:3290>).

[P1-4] Cache tables alone do not provide “fetch once” semantics

Two simultaneous cold requests can both miss, both fetch, and both invoke Luna before either inserts the unique row. An upsert prevents duplicate stored rows, not duplicate network traffic or model spend. The plan repeatedly promises that cache misses are absorbed, but specifies no claim, lock, or pending state.

Add database-backed single-flight coordination per exact fetch target and per contextual-summary key, with a lease expiry for abandoned work. Only the request that wins the claim should consume rate allowance; other requests should wait briefly or return a pending state.

[P1-5] The proposed limiter is not yet an enforceable spending bound

“Per-reader limiter on cache misses” leaves the key, window, concurrency, atomicity, and global limit unspecified. An owner-only limit must be keyed solely by authenticated owner ID—not article or URL, which an attacker can vary—and implemented atomically across server instances. Query variations remain an unlimited source of misses within whatever allowance is chosen.

A reasonable initial policy would be:

- Fetch fills: 120 per owner per rolling hour, concurrency 4.
- Luna fills: 30 per owner per hour, 100 per owner per day, concurrency 2.
- A separate global daily Luna fuse, initially around 1,000 fills or an equivalent monetary ceiling.

These are starting limits, not numbers established by repository evidence; tune them from telemetry and the maximum acceptable daily loss. The existing transactional advisory-lock pattern used for feedback admission is the precedent. Cache hits should bypass these limits.

The model request also needs explicit input and output bounds. A 1 MB download ceiling is not a prompt-token ceiling: the plan currently feeds destination text, current article, and profile without character/token limits or a stated `max_completion_tokens`.

[P1-6] The non-streaming Stage 3 conflicts with an explicit repository rule

The plan deliberately declines streaming, but AGENTS.md says to stream any model call a person is waiting on. The cited explanation precedent actually strengthens that rule: [explain.ts](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/explain.ts:440>) implements the model call as a stream, while its batch interface merely drains the same generator.

Implement Stage 3 as a stream from the start, with accumulated partial text held in the tab-level preview store so card teardown and re-hover do not discard it. It should also have a separate deadline from the existing eight-second metadata lookup timeout. If the product deliberately wants an exception, that needs Greg’s explicit decision recorded in the plan.

[P1-7] The global-cache disclosure argument is incomplete

Two tables are the right design: fetched public-page material and personalized summaries have genuinely different ownership and lifetimes. Combining them would require nullable ownership fields, duplicate preview data, and confused retention rules.

However, “the asker already knows the URL” does not dispose of all disclosure:

- Cache timing—and especially returning `fetchedAt`—can reveal whether and when some prior reader caused a fetch.
- An ownerless row survives deletion of the article that introduced it, unlike the article-scoped privacy property explained above `checkpoints` in [schema.ts](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/db/schema.ts:3699>).
- Query-bearing URLs may contain capability-like secrets and leave exact URLs plus extracted content in an ownerless store.

Keep the split, but document this as an accepted limited disclosure, do not return cache timestamps, reject credential-bearing URLs, and define retention for ownerless rows. Article ownership/link-membership validation from P1-1 substantially reduces arbitrary probing.

[P2-1] Card teardown can lose submission and shelf-invalidation state

Once a job appears in `jobEngine`, its progress is durable across card teardown, so that part of the plan is correct. The gaps are around it:

- The POST is not represented in the engine until `useJobs().add(url)` resolves, so re-hovering can expose a second enabled button.
- `lastFailure` is subscriber-local and non-durable.
- A completion callback mounted after the job finishes does not replay that historical completion, so the planned shelf invalidation can be missed and the module-level `shelf` remain stale.

Billing deduplication prevents two lasting slot charges, but the second admission can transiently reserve or be refused under the documented double-click race. Track in-flight adds by exact URL at tab level, disable duplicates there, and invalidate/reload shelf state from durable engine state rather than relying only on a mounted completion callback.

[P2-2] Negative and positive cache expiry are unspecified

“Cache failures so every hover does not retry” would make a transient timeout, 429, or 5xx poison the global entry indefinitely. Successful previews can likewise remain stale forever. Store outcome class and `expiresAt`: short expiry for transient failures, longer expiry for stable 404/unsupported responses, and a refresh horizon for successful content. Respect `Retry-After` where available.

[P2-3] Destination prose needs explicit prompt-injection fencing

`readWebPage` treats fetched text as untrusted model input and fences it accordingly. Stage 3 merely says to feed Readability text to Luna. The plan should explicitly require equivalent untrusted-content delimiters, a system instruction that destination text is data rather than instructions, and no tools or follow-up fetching available to the summarizer.

[P2-4] The foot-layout claim contradicts the component

The plan says three controls require the card foot to wrap, but `.prose-card-foot` currently has no `flex-wrap`; see [reader.css](</home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/reader.css:5584>). More importantly, “Read it here” and “Add to Spideryarn” are mutually exclusive under the plan, so three controls should never coexist. Remove that premise or define the actual small-width behavior being changed.

### Load-bearing claims checked

- `useJobs().add(url)` can operate from the reading view without navigation: confirmed.
- The module-level `shelf` in `link-facts.ts` is loaded once and never invalidated: confirmed.
- No existing task uses the quick tier: confirmed; all current `TASK_TIER` entries are capable.
- `fetchDocument` plus the `readWebPage` envelope covers the important SSRF surface: confirmed, provided the new route copies the complete envelope—URL limits, DNS/address rejection, pinned connections, manual redirect validation at every hop, body limit, deadline, and bounded retries.
- The `lookUpLinks`/`WithLinkFacts` seam covers normal visitor rendering: confirmed. It does not secure a directly invoked API route.

Review was read-only; no files were changed and no tests were necessary for these structural findings.