The diagnosis is correct at HEAD `d7f4de4`: I found no current passage-question path that reaches a model without web search being offered.

- “?” creates an anchored chat with `help: true` ([ChatDialog.tsx:539](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/web/ChatDialog.tsx:539)).
- Save & ask AI creates the same anchored chat ([Reader.tsx:2150](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/web/reader/Reader.tsx:2150)).
- Every turn reaches `converse`; the thread anchor is restored, and `help` is read from the stored user row ([routes.ts:2973](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/routes.ts:2973)).
- Every round, including the last, carries `webSearchTool` ([converse.ts:1802](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:1802)).
- A newly typed follow-up has `help: false`; retrying or editing the original “?” question preserves its stored `help: true`.
- The retired comment-answer route uses `explainStream`, which also offers web search.

Thus “the tool was offered” is established. “The model declined it on Greg’s particular turn” remains an inference until that stored turn or log is read.

## Findings

F1 — P1 — established

(a) Stage 1 says `helpSection` still says nothing about searching, then proposes adding “may need the web” ([plan:95](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md:95)). That directly contradicts the authoritative rule and test that `SYSTEM` alone owns search encouragement ([converse.ts:884](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:884), [help-prompt.test.ts:131](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/tests/help-prompt.test.ts:131)).

(b) Replace item 3 with:

> **`helpSection` remains byte-for-byte unchanged.** `SYSTEM` alone owns every rule about searching and sources. If the evaluation does not move “?” turns, revise the `SYSTEM` trigger and rerun it; do not add `search`, `web`, `look it up`, or `tool` to `helpSection`.

F2 — P1 — established

(a) The proposed “three sources” omits the reader’s library, deleting the existing rule to identify library claims and name the other article ([plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md:84), [converse.ts:461](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:461), [converse.ts:477](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:477)). A library-derived claim could consequently read as model knowledge or web research.

(b) Make it four origins and preserve this explicit fourth rule:

> From the reader’s library → say that it came from their library and name the other article by title. Do not present its block id as a citation into the article currently open.

F3 — P1 — established

(a) The plan explicitly permits externally checkable factual claims from model memory with only “Outside the article” or “As is widely known” ([plan:88](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md:88)). For the target question—“is this mainstream?”—that licenses exactly the unsupported answer the feedback’s “evidentiary links back” requirement rules out.

(b) Replace that bullet with:

> From your own reasoning or synthesis → say “My inference is …”. Do not use general knowledge as an unlinked factual source: an externally checkable fact not supported by the article or the reader’s library must be searched and linked, or explicitly left unverified.

F4 — P2 — reasoned

(a) “Each web claim is marked in the sentence” conflicts with `WEB_LINKS`’s “Link a page once.” Two separate claims from one page cannot satisfy both rules.

(b) Replace `Link a page once` with:

> Link a page in the first sentence of each contiguous group of claims drawn from it. Do not repeat it on every sentence; repeat it only when a later, separated claim would otherwise lose its source.

F5 — P1 — established

(a) `loadCitations` returns correctness metadata the plan does not handle: `stale`, `outdated`, and the artefact’s `capped` flag ([pg.ts:3310](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/store/pg.ts:3310), [types.ts:3562](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/types.ts:3562)). A stale list can describe an earlier article revision; a capped list explicitly may omit works. Saying its “total is always exact” can therefore turn a stored-row count into a false claim about the article.

(b) Add:

> Read `{ citations, stale, outdated }`. If `stale`, return a non-error outcome saying the stored list describes an older article version and do not emit its rows as current citations. If `outdated`, announce that before the rows. When `citations.capped` is true, call `citations.citations.length` the number in the stored list, never the article’s total. Matched and shown counts are exact only within that stored list.

F6 — P1 — established

(a) The row design names only “blocks that cite it.” Bibliography-only works have `citedAt: []`; their usable location is `firstCited` with `citedInBody: false` ([types.ts:3442](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/types.ts:3442)). Such a row would lose the block provenance needed to say the article contains that work.

(b) Replace the location clause with:

> End each row with `citedInBody ?` up to six `citedAt` block ids plus the remainder count `:` `only in the references [firstCited]`.

F7 — P2 — reasoned

(a) “Exactly as the glossary tool” invites copying its catch-all `catch`, which treats every database failure as “no glossary” ([chat-tools.ts:1350](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/chat-tools.ts:1350)). A database error must not become the false claim “no citations have been generated.”

(b) Specify:

> Treat only an error with `status === 404` as no list. For any other load error, log tool name/slug/error metadata and return a normal failed tool outcome saying the list could not be read; do not throw and do not call it absent.

F8 — P2 — established

(a) One before/after run over a handful of prompts cannot separate a prompt effect from stochastic tool choice, and the plan gives no pass threshold. The controls can reveal a hammer, but only if repeated and judged against a rule chosen before seeing the result.

(b) Replace the measurement sentence with:

> Freeze the article snapshots, questions and model id; run every case at least three times before and after. Report target and control search rates separately. Before running, set acceptance thresholds—for example, each target searches in at least two of three post-change runs and improves over baseline, while each control remains at no more than one of three. Manually inspect mixed-source answers for linked web claims and valid article ids.

F9 — P2 — established

(a) Adding the tool to `CHAT_TOOLS` exposes it beyond typed Chat and comments: Remember and Candidates receive the same array in `converse`, while Live derives both its advertised and allowed tools from it ([converse.ts:1808](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:1808), [live.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/live.ts:304)). This is not a security leak—the data remains owner-local—but it is an unrecorded scope decision.

(b) The cheapest closure is to accept it explicitly:

> `CHAT_TOOLS` is shared by typed Chat, Remember, Candidates and Live. This read-only, article-local tool is deliberately available in all four; tests cover `liveTools` and `LIVE_SERVER_TOOLS` as well as `converse`.

Otherwise introduce a per-kind tool list.

F10 — P2 — reasoned

(a) Adding the heading inside the existing `message.citations.length > 0` guard can render “From the web” over an empty list when all stored citations fail the defensive `isWebUrl` filter ([ChatPanel.tsx:1420](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/web/ChatPanel.tsx:1420)).

(b) Require filtering first and render both heading and list only when `webCitations.length > 0`. Test an array containing only a non-web URL, not merely `undefined` and `[]`.

F11 — P3 — established

(a) “One cold write per article per conversation” is not how the cache is scoped. The cache key is the exact tools/system/article prefix plus model parameters, and identical conversations can share it within the TTL ([prompt-caching.md:16](/home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/project/prompt-caching.md:16)).

(b) Replace it with:

> Adding the tool invalidates each affected article/kind/model prefix. The first marked call while that prefix is cold writes it; byte-identical calls within the TTL read it. The cache is not conversation-scoped.

The fence is right: publisher-written titles/authors and article-derived model prose remain untrusted data even though the `why` field was produced by one of our models. The experimental-feature switch governs the Citations UI, not entitlement to owner-local derived data, so it need not by itself hide the tool. No proposed step needs to touch `isSlug`, URL caps, or `fetchDocument`.

The cheaper Stage 1 is: add the broader-world trigger to `SYSTEM`, add the filtered “From the web” heading, preserve the library rule, prohibit unlinked factual memory, and leave `helpSection` untouched. Measure that before adding the more restrictive sentence-separation rule.

Verification note: the permitted Vitest file could not start because this sandbox refused creation of `node_modules/.vite-temp`. A read-only `node --import tsx` probe confirmed the help/ordinary cached prefixes are currently byte-identical and neither final-user addendum mentions search. I changed no file; unrelated eval files appeared concurrently in the worktree and were excluded from this review.

stop: F1, F2, F3, F5, F6