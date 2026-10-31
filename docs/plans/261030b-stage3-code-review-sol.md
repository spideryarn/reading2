# Sources digest Stage 3 code review — GPT Sol

Status 2026-10-31: commits `a9386ceae` and `ca3f258b2` reviewed. Four findings are fixed in the
working tree, not committed. One documentation finding remains for Greg because
`chat-from-a-mode.md` is a rule document and its edit needs an approved before/after set.

## Findings

### SD3-01 — P1 — Summary's paragraph chat buttons were still live in admin view-as — fixed

**Evidence.** The new level-chat bundle was correctly withheld in view-as, but the pre-existing
Summary paragraph sender was still handed straight to the owner band. Consequently Brief and
Fuller drew both old *Ask about this paragraph in chat* buttons in view-as, contrary to the Stage 3
owner-only contract. The test's title claimed “no paragraph button” but asserted that only for the
Digest, not Summary.

**Fixed.** [`Reader.tsx:4433-4442`](../../src/web/reader/Reader.tsx#L4433) now withholds
`askAboutSummary` when `viewAsNonce()` is present, just as it withholds `summaryChats`. The missing
assertion is at
[`glossary-and-bibliography-ask-in-chat.test.tsx:1539-1544`](../../tests/glossary-and-bibliography-ask-in-chat.test.tsx#L1539).

**Red then green.** The added assertion first received two paragraph buttons instead of zero. It
passes after the sender gate. Shared visitors already took `VisitorSummaryBand`, which has no
sender, and the server chat route remains authenticated and article-owner scoped.

### SD3-02 — P1 — a slow chat-summary refresh put a fresh box back and could discard new words — fixed

**Evidence.** `reopenItemChat` already kept an immediately handed-off thread in
`handedItemChats`, so another press could not create a second conversation. The Digest and Summary
panels, however, chose box versus mark from raw `chatSummaries` alone. If the reader returned before
that separate list contained the new thread, the item drew a fresh ask box. Sending words from it
found the existing handoff and merely reopened it; [`AskBox.tsx:51-56`](../../src/web/AskBox.tsx#L51)
then cleared the field, so those words became neither a first question nor a follow-up.

**Fixed.** The handoff bridge now keeps a small `ThreadSummary` beside each immediate origin and
reconciles corrected ids and refused sends
([`Reader.tsx:1352-1398`](../../src/web/reader/Reader.tsx#L1352)). Digest and Summary receive a
rendered-only merge of those pending summaries
([`Reader.tsx:1513-1527`](../../src/web/reader/Reader.tsx#L1513),
[`Reader.tsx:3433-3448`](../../src/web/reader/Reader.tsx#L3433)), so Send changes the box to the
one-turn Continue mark immediately. The canonical `chatAnchors` list stays server-backed: writing
the optimistic row there made a rejected turn look confirmed and cleared its pending-origin way
back, which the existing refusal regression caught. The synchronous ref remains the duplicate-send
guard; the display state is removed on refusal, article change, or once the server summary names
the id ([`Reader.tsx:3230-3245`](../../src/web/reader/Reader.tsx#L3230)).

**Red then green.** The regression at
[`glossary-and-bibliography-ask-in-chat.test.tsx:1404-1417`](../../tests/glossary-and-bibliography-ask-in-chat.test.tsx#L1404)
froze the summary endpoint before Send. It first found no Continue mark and a second live box; it
now finds the mark, no box and one POST. The full rendered-reader file also keeps the existing
StrictMode, refused-send, corrected-id and pending-way-back cases green.

### SD3-03 — P1 — the migration could fail on a row the previous schema validly admitted — fixed

**Evidence.** Before Stage 3, `summary` was a reserved origin whose CHECK explicitly admitted
`origin_mode='summary'` with all shape fields null
([`20261009113018_chat_thread_origin_ideas.sql:3`](../../drizzle/20261009113018_chat_thread_origin_ideas.sql#L3)).
The application route could not create that row, but the database contract could. The reviewed
migration asserted that no stored row could have it and immediately replaced that permissive CHECK
with `chat_threads_origin_item`, which requires an id and quote. Any valid reserved row would make
`ADD CONSTRAINT` fail and stop the migration.

**Fixed.** The migration now first changes only that obsolete reserved marker to no origin, keeping
the conversation and all its messages, before tightening the meaning of `summary`
([`20261030220450_chat_thread_origin_sources_digest_and_summary.sql:5-17`](../../drizzle/20261030220450_chat_thread_origin_sources_digest_and_summary.sql#L5)).
The preceding CHECKs guarantee the old reserved row has no item/block/quote/lens/Quiz shape, so the
existing no-origin CHECK accepts the update. This was not run against any database; the private
Postgres lane could not start in the sandbox.

### SD3-04 — P2 — the first-message builder could return a question Chat must reject — fixed

**Evidence.** For every UI call, the shared field cap of 1,000 left the promised quote room and the
builder returned at most Chat's 4,000-character limit. A hand-made call above that cap was different:
it kept the reader text whole, added headings and fences, returned more than 4,000 characters, and
relied on the route's 413. That contradicted the builder's “everything counts” invariant and made a
successful return unsafe to send.

**Fixed.** [`askAboutModelText:543-565`](../../src/web/chat-handoff.ts#L543) now rejects a caller
above the ask-box cap instead of returning an invalid message; valid calls still keep the reader's
question whole, escape fence-closing quote runs, and cut only at a grapheme boundary. The changed
test at [`chat-handoff.test.ts:645-659`](../../tests/chat-handoff.test.ts#L645) was seen fail before
the guard and pass after it.

The server remains the independent boundary for a stale or hand-made client: an over-limit chat
request gets JSON 413 with *A question may be at most 4000 characters*
([`routes.ts:3717-3724`](../../src/routes.ts#L3717)). The chat effects read that JSON refusal before
the stream ([`effects.ts:204-209`](../../src/web/chat/effects.ts#L204)); its `HttpError` is a
reader-facing error, so the failed turn shows the server's sentence rather than losing it. No
ordinary Digest or Summary box can reach that path now.

### SD3-05 — P3 — “Which modes have it” still omits Digest and Summary — not fixed, for you

**Evidence.** `chat-from-a-mode.md` now describes both new origin shapes in its checklist and
correctly distinguishes Summary's old paragraph button. But its table headed **Which modes have it**
still has no row for Sources › Digest or the ask box under Summary Brief/Fuller
([`chat-from-a-mode.md:37-56`](../../docs/project/chat-from-a-mode.md#which-modes-have-it)). Its way-back table is
also not current for the newer origins. This remains false after the concurrent Stage 4 docs commit
`f24d4957a`.

**Not fixed, for you.** This file is a rule document, so the house process requires an approved
before/after edit. Add a Sources › Digest row covering the whole box and paragraph buttons, a
Summary row covering only the Brief/Fuller whole-level box, and the corresponding way-back rows.
Do not describe Summary's paragraph button as an origin: it still waits in Chat and stores none.

## Checks with no finding

- Both origins are present in `ThreadOrigin`, `ORIGIN_MODES`, `sameOrigin`, both column directions,
  `parseShapedItemOrigin`, the schema and migration CHECKs, titles, `originPlace`, `originBack`,
  `openOrigin`, `CHAT_FROM_WORDS` and `CHAT_FROM_LABEL`. The route and SQL patterns agree: digest
  ids are `sd-` plus 14–17 digits with optional `-p1`…`-p999`; Summary ids are
  `ss-(brief|fuller)-` plus 14–17 digits. Cross-mode ids and malformed suffixes are refused.
- Digest paragraph numbering follows the stored section arrays in the one shared
  `SOURCES_DIGEST_SECTIONS` order. A stored digest never reorders itself. Both server writers stamp
  `generatedAt` with `new Date().toISOString()`, whose 17 digits match the client and CHECK regexes;
  a rerun gets new ids.
- The first-message headings explicitly say the model text is quoted, not instructions. Triple
  quote runs are escaped before length accounting, and `Intl.Segmenter` supplies the grapheme-safe
  cut (with a surrogate-safe fallback). Tests cover fence injection, emoji, combining accents,
  maximum Digest/Fuller text and a question at the UI cap.
- One press becomes one handoff. The AskBox clears and disables after submission; ConversationBand's
  object-identity latch and queued StrictMode send take one handoff once; the ref bridge closes the
  interval before React state and the server summary catch up. As the established contract says,
  “one” is a button rule, not a database uniqueness rule: two tabs may still start two item chats.
- Visitors receive neither owner panel senders nor a chat route they can use. View-as receives no
  Digest box/button/mark, no Summary level box/mark and, after SD3-01, no Summary paragraph button.
- Investigate still uses the lifted `AskBox` with its original markup/classes, trimmed Enter and
  button submit, 600-character cap, IME `isComposing`/229 guard and `.ask-box-send` touch floor. Its
  rendered and touch-target tests are green.

## Verification

- `tests/chat-handoff.test.ts` + `tests/glossary-and-bibliography-ask-in-chat.test.tsx`: 115 passed
  after the final fixes. SD3-01, SD3-02 and SD3-04 were each observed red before green.
- Origin/handoff/Investigate/touch suite (eight files): 297 passed. Together with
  `tests/chat-origin-transaction.test.ts` and `tests/chat-title-ownership.test.ts`, another 31
  passed; 328 focused tests in that wider run.
- `node --experimental-strip-types scripts/typecheck.ts`: all five TypeScript projects passed; all
  4,123 source files are covered. `npm run typecheck` itself could not start because the sandbox
  forbids tsx's IPC socket (`listen EPERM /tmp/tsx-1000/...pipe`).
- `tests/chat-origin-route.test.ts` could not run: the private lane could not reach
  `127.0.0.1:54362` or ask Docker for the container, and failed before collection. This is the
  database-backed route/CHECK/round-trip/export suite. The migration itself was therefore not
  applied to a suite-minted database. No database was touched.
- `npm test` was attempted and stopped at the same private-lane global setup failure before it ran
  the projects. Focused unit commands above did run normally.
- `tests/doc-links.test.ts`: 18 passed after writing this report.
- Biome on the four touched TypeScript/TSX files reported only the existing large-Reader complexity
  advisories and two pre-existing unsafe-optional-chain findings in the rendered-reader test; the
  review added no lint finding. `git diff --check` on the five changed code/migration/test files
  passed.
- No commit, push, deploy or database action was taken. A concurrent Stage 4 documentation commit
  advanced this worktree to `f24d4957a`; none of its files is part of this review's working-tree
  diff.

approve with changes
