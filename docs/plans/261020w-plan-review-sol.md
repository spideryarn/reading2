# Plan review: export your own words and a chat as Markdown

The three-part shape is right. Copying one conversation and downloading one article-wide personal file solve different jobs; including the same `your-words.md` in the zip is a useful convenience rather than a competing format. I found no P0 issue.

## Findings

### F1 — P1 — The server lacks the `ChatThread` shape the shared renderer expects

Evidence: the plan says a narrow `Pick<ChatThread>` accepts “the server's `toMessage`-mapped rows” ([plan lines 91–92](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 91)). `toMessage` maps only messages ([src/store/pg-chat.ts lines 152–196](../../src/store/pg-chat.ts#L152)). Thread conversion remains inside `threadsFor`, where dates become ISO strings, anchor columns become a `ChatAnchor`, and `storedThreadKind` validates the kind ([src/store/pg-chat.ts lines 247–295](../../src/store/pg-chat.ts#L247)). `ArticleRows` exposes raw database rows ([src/store/article-rows.ts lines 748–754](../../src/store/article-rows.ts#L748)), whose dates/nulls do not satisfy `ChatThread` ([src/types.ts lines 4740–4787](../../src/types.ts#L4740)).

Concrete fix: define a pure row-to-Markdown-thread adapter. Extract/reuse the conversion logic from `threadsFor`, including `toMessage`, anchor construction, ISO dates, and `storedThreadKind`. Feed it the existing `ArticleRows`; do not call `threadsFor`, which would reread outside the repeatable-read snapshot. Test nullable fields, both anchor forms, unknown stored kinds, and ordinal message order.

### F2 — P1 — Spoken answers can lose all passage provenance

Evidence: the plan assumes block ids occur in message text ([plan lines 49–50 and 65–66](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 49)). Spoken answers deliberately omit spoken ids; their pointers live in `ChatMessage.passages` ([src/types.ts lines 4201–4225](../../src/types.ts#L4201)) and are rendered separately by `PassageLinks` ([src/web/ChatPanel.tsx lines 2750–2760](../../src/web/ChatPanel.tsx#L2750)). The proposed renderer input does not name `passages`.

Concrete fix: include `passages` and render its `why` plus block ids after the answer. Test a spoken answer whose text contains no id. Explicitly decide whether separate web `citations` and tool activity belong in v1 or Deferred; “whole chat” should not choose silently.

### F3 — P1 — The status policy mislabels partial failures and misses interrupted speech’s special warning

Evidence: `_No answer: it failed._` is proposed for errors ([plan lines 71–74](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 71)), but failed answers deliberately retain partial text on the server ([src/routes.ts lines 4147–4161](../../src/routes.ts#L4147)) and client ([src/web/chat/reduce.ts lines 1193–1202](../../src/web/chat/reduce.ts#L1193)). “No answer” contradicts visible text. Separately, `interrupted` means a spoken transcript may contain words the reader never heard ([src/types.ts lines 4227–4237](../../src/types.ts#L4227)); the UI says this explicitly ([src/web/ChatPanel.tsx lines 2745–2748](../../src/web/ChatPanel.tsx#L2745)). That differs from `truncated`.

Concrete fix: distinguish empty errors from partial errors, preserve partial pending text, and give interrupted speech its unheard-words warning. Emit every applicable warning unless mutually exclusive flags are documented and tested. Cover partial error, partial pending, stopped, truncated, and interrupted cases.

### F4 — P1 — Comment rendering does not distinguish reader prose, article text, model output, and wordless marks

Evidence: the plan promises each comment’s passage, “your words,” and AI answer ([plan lines 115–118](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 115)). Only `body` is reader prose; `quote` is article text and `answer` is model text. `body` is absent on bookmarks and legacy explanations ([src/types.ts lines 3565–3577](../../src/types.ts#L3565)). Rows can also be wordless highlights, Referee placements, or severity-sorted notes ([src/types.ts lines 3591–3651](../../src/types.ts#L3591)). Only a nonempty `done` answer is an answer the reader saw ([src/reader-notes.ts lines 175–184](../../src/reader-notes.ts#L175)).

Concrete fix: specify row classification. Label quote/block text as the article’s passage; label only `body` as the reader’s words; include `answer` only for `status === "done"`; never invent a reader question for legacy body-less explanations. Render bookmarks/highlights as actions instead of blank notes. Include Referee placement/severity/colour or explicitly defer them.

### F5 — P2 — Comment ordering duplicates an existing rule incompletely

Evidence: the plan specifies only block ordinal and removed blocks last ([plan lines 116–117](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 116)). `readerNotesRows` already defines article position, selection start, creation time, and id, with missing blocks last ([src/reader-notes.ts lines 189–220](../../src/reader-notes.ts#L189)). `readArticleRows` itself returns comments by creation time/id ([src/store/article-rows.ts lines 934–948](../../src/store/article-rows.ts#L934)).

Concrete fix: extract a shared `commentsInArticleOrder` comparator and use it in both places. Test reversed selection positions within one block, timestamp ties, and deterministic ordering of removed-block comments.

### F6 — P1 — The direct Markdown response lacks the platform byte cap and response hardening

Evidence: the new route specifies type, disposition, and caching but no size behavior ([plan lines 123–128](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 123)). Vercel buffers at most 4.5 MB, and the zip path measures bytes to avoid a truncated file that looks valid ([src/store/export-bundle.ts lines 78–100](../../src/store/export-bundle.ts#L78), [src/routes.ts lines 1021–1037](../../src/routes.ts#L1021)). Markdown is uncompressed and can exceed the limit when the zip does not. `sendBinary` also supplies `nosniff` and a byte-accurate length ([src/binary-response.ts lines 53–71](../../src/binary-response.ts#L53)).

Concrete fix: UTF-8 encode once, apply the response byte cap with a Markdown-specific 413 message, and send through `sendBinary` using `text/markdown; charset=utf-8`, after setting attachment and `private, no-store`. Test the cap boundary without a multi-megabyte fixture.

### F7 — P2 — The feature touches security/routing defences and needs their tripwire tests

Evidence: “No defence is edited” ([plan lines 154–159](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 154)) is inaccurate: `src/routes.ts` owns `requireUser` and `slugPart`, while `ownedSlug` is the owner-isolation defence ([docs/project/security-map.md lines 95–113](../project/security-map.md) (line 95)). The existing export regex is end-anchored, so it will not swallow `/your-words` ([src/routes.ts lines 11606–11614](../../src/routes.ts#L11606)); ordering is therefore safe. However, the authenticated-route inventory and ordered expectation must gain the new matcher ([tests/authenticated-api-route-contract.test.ts lines 856–860](../../tests/authenticated-api-route-contract.test.ts#L856), [lines 2382–2385](../../tests/authenticated-api-route-contract.test.ts#L2382)). `ArticleRows.article` also contains the private-link credential, which the existing exporter explicitly removes ([src/store/export-bundle.ts lines 382–395](../../src/store/export-bundle.ts#L382)).

Concrete fix: describe the existing defences this route rests on. Add route-contract entries and a witness; test unauthenticated, malformed, missing, and other-owner requests; use a two-owner positive control; and scan both standalone Markdown and the full zip for planted `shareToken` and owner UUID values.

### F8 — P2 — The generic downloader must key in-flight work by artifact, not slug

Evidence: the plan generalizes `export-download.ts` with path and filename ([plan lines 132–134](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 132)), but its guard is keyed only by slug ([src/web/export-download.ts lines 35–50](../../src/web/export-download.ts#L35)). Pressing Markdown while the zip is building would return `busy`; Metadata deliberately says nothing for `busy` because it assumes the same requested file is already coming ([src/web/Metadata.tsx lines 2262–2269](../../src/web/Metadata.tsx#L2262)).

Concrete fix: key in-flight work by encoded request path or `{slug, artifact}`. This should still coalesce the command-bar and Metadata zip requests while allowing zip and Markdown concurrently. Give each Metadata control independent busy/error state and test both scenarios.

### F9 — P2 — `yourWordsMarkdown(rows)` cannot share the zip manifest’s export timestamp

Evidence: the format promises an `exported` field ([plan lines 28–44](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 28)), but the proposed function accepts only `rows` ([plan line 111](./261020w-export-your-own-words-and-a-chat-as-markdown.md) (line 111)). `articleBundle` already establishes one `exportedAt` for its files and manifest ([src/store/export-bundle.ts lines 267–280](../../src/store/export-bundle.ts#L267)).

Concrete fix: use `yourWordsMarkdown(rows, exportedAt)`. Pass the bundle’s timestamp for the zip and one request timestamp for the standalone route. Assert that zip manifest and Markdown front matter agree. JSON-string scalars are valid YAML 1.2; quote the fixed `spideryarn` and `kind` values in the example too so it matches the stated encoding rule.