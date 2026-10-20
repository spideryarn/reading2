# Code review: export your own words and a chat as Markdown

Reviewed commit `be1c37ccb` against its parent. Result: **fixes applied; no unresolved defect found
inside the scoped feature**. No P0 finding.

## Findings fixed

### C1 — P1 — `src/store/your-words.ts:125`

Failed and pending comment explanations were treated as ordinary bookmarks/highlights unless their
status was `done`, and their stored partial answer was omitted. That loses words the reader already
saw: the answer route deliberately persists partial text when a stream fails. A bodyless failed
explanation was consequently exported as a bookmark even though it was an AI interaction.

Changed the export to classify the row by the established comment-kind rule, emit every nonblank
stored answer, and describe pending/error separately (including error-with-no-text). Tests were
added for a failed partial answer, a failed answer with no text, and a chat-linked bodyless comment;
they failed before the fix.

### C2 — P2 — `src/store/your-words.ts:188`

Comment answers omitted the web sources shown beneath them in the app. The result could carry the
answer while dropping the evidence needed to understand it.

Changed the export to include them under **Web sources it found**. The wording is deliberate:
comment search results are sources the system found, not necessarily sources the answer cited.
The Markdown link-list renderer is shared with chat answers in `src/chat-markdown.ts:132`, rather
than copied.

### C3 — P1 — `src/chat-markdown.ts:41`, `src/store/your-words.ts:218`, `src/web/ChatPanel.tsx:3096`

“Copy this conversation” and `your-words.md` omitted the articles brought into a conversation with
`@`-mentions. That made the supposedly whole conversation lose part of the context supplied to the
model. On the server, the raw mention rows are ordered by message ID (`src/store/article-rows.ts:964`),
and message IDs carry no chronology, so merely adding those rows would also produce an unstable,
wrong order.

Changed the shared renderer to emit an **Also reading** list. Clipboard copy now accepts the
`ChatThreadView` that already contains resolved mention titles. The server restores message-ordinal
then mention-position order, deduplicates with the existing `mentionKey`, and passes **titles only**
to the renderer. It does not pass the mentioned article's internal ID, owner-scoped slug, blocks, or
current owner data. Tests cover renderer output, clipboard output, server output, turn ordering, and
non-disclosure of the internal mentioned-article UUID. The ordering test was watched failing first.

### C4 — P1 — `src/web/Metadata.tsx:2278`

The two independent download controls collapsed their errors with `zip.error ?? words.error`.
After a zip failure, a later Markdown failure was hidden behind the older zip message, so the second
press appeared to fail silently or reported the wrong operation.

Changed each download to render its own alert beside its own control. A regression test makes both
requests fail and requires both distinct errors; it failed before the fix.

### C5 — P2 — `src/comment-kind.ts:42`, `src/web/comment-nav.ts:13`

The new export invented a second comment-row classifier instead of using the reading view's
`commentKind`. The two already disagreed on failed, pending, and chat-linked comments; this was the
design cause of C1.

Moved the pure classifier and labels from the browser-only path into `src/comment-kind.ts`, kept
the former module's exports for existing callers, and reused it from the server export. Existing
comment-navigation tests plus the new export cases pin the shared behavior.

## Wider findings reported, not fixed

### C6 — P1 — `src/store/pg-article-transfer.ts:53`

There is a documented, pre-existing privacy race during article ownership transfer. An old owner's
write can resolve the article ID before the transfer, insert after the transfer commits, and then be
read as child data by the new owner—including through this export. Ordinary exports remain properly
owner-scoped, and the transfer removes reader state in the normal case; this needs the wider queued
write-fencing work, not an export-local patch.

### C7 — P2 — `src/reader-notes.ts:179`

The model-facing `reader_notes` context still assumes a failed or pending comment explanation has
no answer the reader read. Failed streams can retain visible partial text, as C1 demonstrates. It
does not leak the answer text, but it can incorrectly omit that an AI answer exists. This is older
shared context behavior, outside the export work.

### C8 — P2 — `src/web/useComments.ts:739`

Starting a replacement comment answer carries the previous row's citations/search metadata. New
deltas and a locally synthesized failure replace the answer text but can retain those old sources,
temporarily displaying stale evidence under the new partial answer. This is pre-existing client
answer-state behavior and is not specific to export.

## Privacy and completeness checks

- The new route still reaches data through owner-scoped `readArticleRows`; no new ordinary
  cross-reader path was found.
- The share token and article owner ID are not projected into Markdown. Existing adversarial data
  plus the focused tests cover both.
- A server-composition test now proves an unopened Recall hint is absent and the same hint appears
  only after `hintOpenedAt` is set.
- The thread-kind switch remains exhaustive; `candidates` is intentionally excluded from
  `your-words.md`. Pending, error, stopped, interrupted, and truncated chat states are represented.
- Comment answers, sources, bodyless AI attempts, notes, highlights, bookmarks, referee severity,
  criterion, and valence are covered. The known transfer race is C6.

## Verification

- `npx vitest run tests/chat-markdown.test.ts tests/your-words.test.ts tests/chat-copy-conversation.test.tsx tests/metadata-export-button.test.tsx tests/comment-nav.test.ts` — **66 passed**.
- `npx vitest run tests/doc-links.test.ts` — **18 passed**.
- `node --import tsx scripts/typecheck.ts` — **passed all projects; all 3,874 source files covered**.
  The npm wrapper was also attempted, but this sandbox denied its temporary IPC socket with
  `EPERM`; running the same typecheck script without that wrapper passed.
- Biome lint on the ten touched TypeScript/TSX files — **exit 0**. It reported six existing
  complexity notices in large `ChatPanel`/`Metadata` functions, none introduced here.
- `git diff --check` — **passed**.
- The full `npm test` command could not start its private-database lane in this sandbox
  (`connect EPERM 127.0.0.1:54362`). The author-provided Postgres evidence remains 18 passing
  `tests/export-route.test.ts` cases; those were not rerun here.
