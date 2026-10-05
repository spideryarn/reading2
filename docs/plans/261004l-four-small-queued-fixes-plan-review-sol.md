**Request changes: F1 and F2 are established P1 contract violations.** Keeping the dormant parameters and adding the Marginalia fallback are otherwise sound choices.

**F1 — P1, established — A’s `http-error → retry` row includes explicit refusals.**

[`classifyStatus`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/fetch.ts:1975) sends HTTP 400, 405, 413 and 451 into `http-error`. The proposed table therefore offers Retry for those responses, including a server’s size refusal. This contradicts [`FailureKind.blocked`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/messages.ts:55), which explicitly includes size limits and rules refusing an unchanged request. The same fetch code also uses `http-error` for a partial 206 response, so simply changing that whole row to `blocked` would be wrong.

Smallest replacement wording:

> Keep an exhaustive map over `FetchFailureCode`, but let the `http-error` entry inspect the retained HTTP status. Explicit non-transient client refusals are blocked; transient statuses and uncertain failures remain retryable. Each resulting kind has its own registered message code.

Add a red-first pipeline test for 413 alongside the proposed 404 test, and preserve a retryable case for partial 206. The proposed table round-trip test checks registry consistency; it cannot establish that the chosen kinds are correct.

**F2 — P1, established — C’s return-to-Quiz navigation violates the atomic-navigation contract.**

Concrete sequence:

1. Choose Quiz, leaving `remember=quiz`.
2. Open Chat and select a conversation, producing `mode=chat&remember=quiz&thread=<chat-id>`.
3. Press Remember’s main mode button.

[`Reader.onMode`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/web/reader/Reader.tsx:4152) writes only `mode`. Remember mounts with Quiz and the Chat thread still selected; [`RememberBand`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/web/modes/conversation/ConversationModes.tsx:124) subsequently clears `thread` in a passive effect. The contract requires entering Quiz and clearing the thread **in one navigation**, without the intermediate combination. Metadata’s ordinary Remember link has the same issue because it changes only `mode`.

Smallest replacement wording:

> Keep dormant sub-mode parameters. When a navigation opens Remember with retained `remember=quiz`, write `mode=remember` and clear `thread` atomically. Apply this to the reading-view mode button and metadata links, reusing the existing Quiz sub-mode parameter rules.

The proposed “back to Remember opens Quiz” assertion passes after the repair effect and misses this violation. Assert the initial committed state or navigation write as well.

**F3 — P2, established — A’s diagnostic promise is false for existing `FetchFailure.message` values.**

The plan says the diagnostic retains the original message “with no address.” But [`parseTarget`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/fetch.ts:911) includes the supplied address, and [`classifyNetworkError`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/fetch.ts:2039) includes hosts and, in its fallback, an underlying error’s arbitrary message.

Replace that sentence with:

> Build the pipeline diagnostic from fixed wording, `FetchFailure.code`, and its numeric status when present. Do not copy `url`, `message`, or the cause’s message, and do not mark interpolated external text as authored.

A test should use sentinel address/host text and verify that the mapped reader sentence and diagnostic omit it.

**F4 — P2, reasoned — B needs a narrower focus guard and stronger negative coverage.**

The keyed `Conversation` remount and `focusNonce={0}` support the reported thread-to-thread focus loss structurally. I have not reproduced it in a rendered test.

The proposed rule is good, but the existing [`caretWasInside`](/home/greg/code/spideryarn2/.claude/worktrees/q-queue-four-small-bugs/src/web/ChatDialog.tsx:683) checks whether focus is *anywhere inside the dialog*, rather than specifically in its composer. Expanding that guard to every thread change could move focus from a surviving Close/footer control or an outgoing question editor into the new composer.

Replacement wording:

> Preserve focus only when the outgoing composer textarea itself held focus immediately before its replacement. Preserve explicit new-conversation focus behavior separately. Restoration must not override a later focus choice made while the replacement is unavailable.

The negative rendered tests should cover an article control, Close/footer controls, and the question editor—not only “caret elsewhere.” Exercise floating and card placement; card restoration should avoid scrolling the article.

**F5 — P2, established — the universal red-first requirement does not fit C, and D’s helper test alone proves no existing defect.**

C intentionally preserves today’s behavior, so its proposed retention test should already pass. D’s new `headBlock` tests initially fail because the export does not exist, which does not demonstrate the empty-head symptom.

Replace the completion requirement with:

> Bug-regression assertions are observed failing for the stated behavior before implementation. Tests pinning an existing decision may pass initially. For D, reproduce the missing head through the rendered Reader test before adding the helper.

With F2 addressed, C can also have a genuine red-first test for the atomic navigation.

**F6 — P3, established — A’s DNS rationale discards a distinction the code already retains.**

A resolver blip does not necessarily “look identical”: `classifyNetworkError` distinguishes `EAI_AGAIN` from `ENOTFOUND` through `retryable`. Offering manual Retry for both can be a deliberate conservative policy, but the rationale should acknowledge that choice.

Replacement wording:

> Offer manual Retry for both missing-name and temporary resolver failures as a conservative policy, although the fetcher distinguishes them for automatic retries.

Similarly, the claim that empty bodies are “more often” hiccups is unsupported here; describe the uncertainty instead.

For the remaining assessment: A’s account of generic job-card failures is accurate. Retries and CLI ingest use the same pipeline step; uploads use their own refusal path. Cancellation reaches the mapping, but `jobs.ts` overrides the reader-facing outcome for Stop and claimant deadlines. `certificate → blocked` matches the existing unchanged-request policy; `empty → retry` is defensible under uncertainty.

C’s parameter retention, `last-view.ts`, and existing Quiz sub-mode links otherwise fit the intended behavior. D’s “strictly before the first part” boundary is appropriate, and using the same resolved block for both path and arc is correct because generated arc entries use part ranges. Keep unknown IDs, unavailable trees, and later gaps from becoming top-of-article fallbacks.

No files changed. The single permitted `fetch.test.ts` run failed before executing tests because Vite could not create `.vite-temp` on the read-only filesystem. The findings above rely on source and contract evidence.