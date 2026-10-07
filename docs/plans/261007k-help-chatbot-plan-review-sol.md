The core signed-in design is sound, and the size claims are close: the Help Markdown is 95,381 bytes; `docs/project/` is currently about 5.8 MB. I would not build the plan unchanged, chiefly because the conversation trust model and cache-cost assumption undermine its abuse bounds.

## Findings

F1 — High — Caller-supplied assistant history can turn this into a general-purpose text generator.

Evidence: the request accepts up to twelve user/assistant messages and says forged assistant turns “harm only their own answer” ([plan:91](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:91)). That is not true operationally: forged assistant turns provide several thousand characters of arbitrary few-shot context, making the Help-only instruction easier to evade while consuming more input tokens. Signup is open to anyone; authentication is explicitly not an allowlist ([security-map.md:29](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/project/security-map.md:29)).

The lack of tools, fixed corpus and ~800-token output ceiling make it a limited general LLM, but not a Help-only one. Per-account limits are farmable; the global fuse is the only firm financial bound, and exhausting it denies service to legitimate readers.

Change: make v1 single-turn: accept one `question`, not roles or assistant history. If follow-ups are essential, return a server-signed transcript token and verify it before accepting prior assistant messages. The simpler and safer choice is single-turn first.

F2 — High — The cache is assumed rather than designed, so the proposed fuse is materially underpriced.

Evidence: the plan says stable bytes mean the provider cache “holds,” then proposes sizing the fuse from warm-cache measurements ([plan:87](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:87), [plan:138](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:138)). Existing Luna jobs deliberately have no cache policy or provider pin ([ai-call.ts:758](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/ai-call.ts:758)), while the project’s cache documentation says provider routing is a precondition ([prompt-caching.md:548](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/project/prompt-caching.md:548)).

OpenRouter says caching behavior depends on the selected model/provider; sticky routing normally derives a conversation from the first system and first user messages. Here the first user message differs between questions, so a stable system prefix alone does not guarantee that different readers reach the same warm upstream. Explicit `cache_control` is required by some model families, while OpenAI-family caching is automatic but still provider-dependent. See the [official OpenRouter caching guide](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

The initial cost estimate is also wrong in the cold case. At the repository’s stated Luna price of $0.20/M input tokens ([models.ts:230](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/models.ts:230)), 3,000 × 24k input tokens is about $14.40 before output, reasoning or fees—not “a few dollars.”

Change:

- Decide and record the exact selected model’s cache mechanism and provider-routing policy.
- Measure cold, cache-write and repeated cache-read calls, checking `cached_tokens`, provider/upstream and actual cost.
- Consider a stable `session_id` tied to the corpus version or a measured provider pin.
- Size the global fuse from the worst credible cold cost; treat warm-cache savings as upside, not the safety case.

F3 — Medium — The corpus generator’s named source of truth is not the one the Help UI uses.

Evidence: the plan says to use the order in `help-pages.ts` ([plan:78](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:78)), but the product order is explicitly `HELP_GROUPS` in `help-content.tsx` ([help-content.tsx:211](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-content.tsx:211)). Modes have neither title nor summary in front matter; those come from `MODE_LABEL` and `MODE_CATALOG`, including two sentences absent from the Markdown ([help-content.tsx:24](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-content.tsx:24), [help-content.tsx:99](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-content.tsx:99)). Four files also contain generated `{{…}}` tokens, and `expandHelpTokens` expressly names the chatbot as its consumer ([help-markdown.tsx:124](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-markdown.tsx:124)).

A standalone `tsx` script also cannot simply import `help-pages.ts`, because it contains Vite `?raw` imports. The command-pick precedent is a Vitest generator precisely because browser-only imports prevent an ordinary script ([command-pick-catalogue.test.ts:6](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/command-pick-catalogue.test.ts:6)).

Change: make the freshness test the generator, as command-pick does, and run it under Vitest. Generate in `HELP_GROUPS` order; derive metadata through `helpEntry`; include the mode catalog’s missing sentences; expand tokens; and include `helpHref(anchor)` as the canonical URL. That last point matters because FAQ anchors live at `/help/questions#faq-…`, not `/help/<faq-anchor>` ([help-anchors.ts:156](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-anchors.ts:156)).

F4 — Medium — The rendering rule is right, but neither existing renderer can be reused unchanged.

Evidence: model output that becomes an `href` needs an allowlist ([security-map.md:16](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/project/security-map.md:16)). `Cited` is designed for untrusted model output, preserves unknown syntax as text, caps nesting depth, and treats HTML/images as text ([Cited.tsx:45](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/Cited.tsx:45), [Cited.tsx:254](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/Cited.tsx:254)). But its optional links accept external HTTP(S) URLs ([Cited.tsx:513](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/Cited.tsx:513)). Conversely, the trusted Help Markdown renderer throws on unknown constructs, so malformed model Markdown could crash the answer ([help-markdown.tsx:13](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/help-markdown.tsx:13)).

Change: reuse or extract `Cited`’s untrusted-output walk, but supply a Help-specific link resolver that accepts only exact canonical values produced by `helpHref`. Do not enable `Cited`’s generic web links and do not feed model output through `renderHelpMarkdown`. Render the end of an in-progress stream as partial input, and preserve invalid links/HTML as escaped text. With that design, the XSS risk is low; the remaining risks are deceptive link labels and pathological Markdown depth, both bounded by the resolver and existing depth cap.

F5 — Medium — The route and stream integration checklist misses two repository contracts.

Evidence: every authenticated route has an independent entry in `EXPECTED_AUTH_ROUTES`; a new route deliberately fails until that row is added ([authenticated-api-route-contract.test.ts:343](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/authenticated-api-route-contract.test.ts:343), [authenticated-api-route-contract.test.ts:1985](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/authenticated-api-route-contract.test.ts:1985)). A streaming route additionally needs a behavioural lifetime test ([authenticated-api-route-contract.test.ts:58](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/authenticated-api-route-contract.test.ts:58)).

`runStream` is only the provider transport. The server’s SSE headers, heartbeat, dead-socket detection and disconnect signal come from `sse()` ([routes.ts:1332](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:1332)); its documentation requires every new stream to choose a disconnect policy and join the list ([routes.ts:1362](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:1362)).

Change: add to Stage 1:

- `EXPECTED_AUTH_ROUTES` and its count/order canaries.
- Use `sse(res)` and pass `gone` to `runStream`.
- Add `help-chat` to the disconnect-policy inventory.
- Add a lifetime test proving the handler stays awaited and closing the response aborts the provider call.

F6 — Medium — The model registration checklist is nearly right but should name the actual exhaustive tables.

Evidence: a new evaluated model job belongs in `NonTaskAiJob`, from which `AiJob` is formed ([models.ts:887](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/models.ts:887), [models.ts:1044](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/models.ts:1044)). Chat jobs require independent entries in both `AI_JOB_ROUTE` and `CHAT_REASONING` ([ai-call.ts:423](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/ai-call.ts:423), [ai-call.ts:1002](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/ai-call.ts:1002)). A newly introduced cheaper model id also needs `DISPLAY_NAME`, or the privacy/model inventory test fails ([models.ts:1658](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/models.ts:1658)). Because `help-chat.ts` calls `runStream`, it must actually call `plainWords(...)`; the coverage test recognizes that seam ([plain-words-coverage.test.ts:25](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/plain-words-coverage.test.ts:25)).

Change: spell out `NonTaskAiJob`, `AI_JOB_WIRE`, `AI_JOB_ROUTE`, `CHAT_REASONING`, `NON_TASK_MODELS`, `JOB_DISPOSITION`, and—only if the eval introduces a new id—`DISPLAY_NAME` and the privacy page.

F7 — Medium — The request and allowance limits are internally incomplete.

Evidence: assistant history is capped at 2,000 characters, but the generated response is allowed approximately 800 tokens ([plan:91](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:91), [plan:96](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/plans/261007k-help-chatbot.md:96)). An ordinary 800-token response can exceed 2,000 characters, so a follow-up may reject the chatbot’s own previous answer.

`runStream` also requires explicit total and stall deadlines ([stream-run.ts:97](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/stream-run.ts:97)), while concurrency correctness depends on a `leaseMs` long enough to cover the call ([contracts.ts:3011](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/store/contracts.ts:3011)). The Dig policy demonstrates the intended timeout-plus-margin calculation ([dig-deeper.ts:134](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/dig-deeper.ts:134)).

Change: specify the total deadline, stall deadline and lease now; require the first role to be the reader; and make the accepted assistant-history size at least as large as any answer the server can emit. Single-turn v1 removes the latter mismatch entirely.

F8 — Low — Signed-in v1 touches `routes.ts`, but it does not edit the listed routing defence.

Evidence: the listed defences in `routes.ts` are `slugPart()` and the one `requireUser` call ([security-map.md:103](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/docs/project/security-map.md:103)). `AUTH_ROUTES` is dispatched only after `requireUser` succeeds ([routes.ts:8205](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:8205), [routes.ts:11907](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:11907)).

Therefore v1, as described, changes a file containing a listed defence but does not change the defence itself. Option A’s “No defence changes” is substantively fair, but “no listed defence logic changes” would be more exact.

Change: keep the new row inside `AUTH_ROUTES`; do not touch the pre-gate dispatch, `requireUser`, or `slugPart`. Likewise, implement the Help-link allowlist outside listed `src/urls.ts` rather than widening `isWebUrl`.

F9 — Medium — Options B and C omit material security and operational costs.

Evidence and changes:

- The Stripe comparison is structurally true but security-misleading. Stripe’s exact pre-gate path is also protected by a cryptographic signature; an exact `/api/help-chat` path authenticates nobody ([routes.ts:8167](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:8167)). Say “same routing position,” not “like the Stripe webhook.”
- Vercel already offers exact-path WAF rate limiting on all plans, keyed by IP or JA4. It is useful as an edge burst limit, but counters are per-region and fixed windows max out at ten minutes outside Enterprise, so it cannot replace the database-backed daily global fuse. Add this as B’s first layer or as a B′ option. [Vercel WAF rate-limiting documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
- On Vercel, read the platform-set `x-vercel-forwarded-for` or `x-real-ip`; Vercel says `x-forwarded-for` is overwritten to prevent spoofing. If another proxy sits in front, the original IP is lost unless the Enterprise trusted-proxy feature is configured. [Vercel request-header documentation](https://vercel.com/docs/headers/request-headers).
- Canonicalize IPv4/IPv6 before hashing and use a server secret, not merely a public salt. State that the raw IP is processed transiently and the stored hash remains pseudonymous data. Shared NATs cause false sharing; IPv6 rotation and proxies bypass it.
- The current allowance store fundamentally requires an authenticated owner ([pg-rate-limit.ts:96](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/store/pg-rate-limit.ts:96)), and the schema requires a non-null UUID owner ([schema.ts:7026](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/db/schema.ts:7026)). A sibling anonymous table is cleaner than weakening that invariant.
- Do not share the entire fuse between anonymous and signed-in traffic. Reserve signed-in capacity or give anonymous requests a smaller fuse; otherwise a stranger can deny the feature to paying readers exactly as the plan describes.
- Require same-origin `Origin`/Fetch-Metadata and JSON content type on the anonymous route. Today `readBody` parses JSON regardless of content type ([routes.ts:1093](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/routes.ts:1093)), so another website could issue preflight-free `text/plain` requests from its visitors and drain the fuse.
- Option C is more work than stated. Turnstile requires server-side verification; tokens expire after five minutes and are single-use. “Before the first question” therefore needs a server-minted, signed, short-lived session credential for later questions, or a fresh Turnstile token per request. Client state alone is bypassable. [Cloudflare’s server-validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

A is fairly described. B remains a reasonable recommendation if these limits are explicit. C currently understates its server-side machinery.

F10 — Low — “Beside the contents and search on every Help page” does not match the current Help layout.

Evidence: topic/question pages have the two-column `HelpSidebar` layout ([HelpPage.tsx:327](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/HelpPage.tsx:327)), but `/help` and missing pages use a single main column with inline search and contents ([HelpPage.tsx:308](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/HelpPage.tsx:308)).

Change: specify that the chatbot sits in the sidebar on content pages and below search or above contents on `/help`; otherwise the client stage still has a product/layout choice to make.

The simplest viable build is: signed-in, one question per request, generated corpus built under Vitest from the existing Help sources of truth, a measured cache policy, the existing owner/global limiter, and a `Cited`-style renderer with an exact Help-link resolver. Multi-turn and the anonymous door can then be added independently; for anonymous access, Vercel WAF plus a smaller anonymous-only global fuse is simpler than starting with a new long-window per-IP database identity.

VERDICT: build with changes