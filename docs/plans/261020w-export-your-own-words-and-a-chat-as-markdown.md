# 261020w: export your own words, and a whole chat as Markdown

Report `spya-p88dcx` (#648), a suggestion from Greg (`feedback-reporter.ts` exit 0), 2026-10-19,
filed from Sources on `tinbergen1963onethology-spya-ks84se`. Overseer queue item `qi-xbeptfxf`.

> Provide a way to export the user's input/content from an article.
>
> Also, provide a way to export the whole of a chat (in a nice machine-readable and ideally also
> human-readable format that could be pasted into another AI).
>
> — Greg, 2026-10-19

Up: [export.md](../project/export.md), which this builds on rather than beside.

## What is already there, and what is missing

The Metadata page's **Export this article** zip ([export.md](../project/export.md)) already
carries every comment, every chat message and every quiz answer, as JSON (`comments.json`,
`chat.json`, `quiz-attempts.json`). So the reader's words can already leave. What they cannot do:

1. **Read them.** The zip is a folder of JSON files mixed in with the model's thirty-odd
   augmentations, and its `index.html` deliberately renders no comment bodies and no chat
   (export.md § `index.html` is an index, not a reader). Getting "what I wrote about this article"
   out of it means opening `chat.json` and reading escaped strings.
2. **Take one conversation somewhere else.** Each answer has a Copy button; a whole conversation
   has nothing. Pasting a chat into another AI today means copying turn by turn.

## The format: Markdown, with a small front-matter header

Both halves produce Markdown, because it is the one format that is plain to read in a text editor,
renders on GitHub or in Obsidian, and is what every chat model reads natively — the "pasted into
another AI" case. A short YAML front-matter block at the top carries the machine-readable facts
(which article, both addresses, what kind of conversation, when), with every value written as a
JSON string so it is valid YAML whatever it contains.

```
---
spideryarn: conversation
title: "What does Tinbergen mean by survival value?"
kind: chat
article: "On aims and methods of ethology"
article_url: "https://www.spideryarn.com/read/tinbergen1963onethology-spya-ks84se"
started: "2026-10-19T20:41:00.000Z"
exported: "2026-10-20T09:00:00.000Z"
---

# What does Tinbergen mean by survival value?

A conversation in Spideryarn about "On aims and methods of ethology". Ids like `spya-k3m9qt`
name passages of the article: the model cites them as its sources.

Started from this passage:

> the study of survival value …

## You · 2026-10-19 20:41 UTC

What does he mean by survival value here?

## Spideryarn · 2026-10-19 20:41 UTC

He means … (spya-k3m9qt)
```

Turns are `## You` and `## Spideryarn`. Message text goes in unchanged — block ids and all, for the
reason `CopyAnswer` gives (they are the provenance) — so a reader's text that itself contains a
`## You` line could confuse a naive parser. That is accepted: the strictly machine-readable form is
`chat.json` in the zip, and this file is the human-and-model one. The README of the zip and
export.md say so.

What each turn shows beyond its text, in one italic line when it applies: a failed answer
("_No answer: it failed._"), an answer still being written, one the reader stopped, one that may be
incomplete. A Recall answer goes through `answerAsSeen` (src/recall-hint.ts), so a hint the reader
never opened is not in the export — the same rule the `reader_notes` transcript and Live follow.

## Stages

### Stage 1 — one renderer, shared (`src/chat-markdown.ts`)

A pure module, types-only imports plus `answerAsSeen` and `articleUrl`, so both the browser and the
server use it:

- `conversationMarkdown(thread, { level })` — the body: title heading, the anchor passage if any,
  then each turn. `level` sets the heading depth, so the same body nests inside the larger file in
  stage 3 (`# title` / `## You` standalone; `## title` / `### You` nested).
- `conversationDocument(thread, article, exportedAt)` — front matter plus the body at level 1.
- `kindWords` moves out of `src/reader-notes.ts`'s private scope only if it fits; the export wants
  the app's own names (Chat, Recall, Explore, the guide), which are close to but not the same as
  that function's sentence fragments ("a chat"), so the export gets its own small exhaustive switch.

Its input is a narrow `Pick` of `ChatThread`/`ChatMessage`, so the client's in-memory thread and the
server's `toMessage`-mapped rows both satisfy it without a second shape.

Tests: `tests/chat-markdown.test.ts` — turn order, the italic status lines, Recall hint hidden until
opened, the front matter parses as YAML-in-JSON-strings even with quotes, newlines and `---` in the
title.

### Stage 2 — Copy this conversation, in the chat header

An icon button beside the in-chat delete (`ChatPanel.tsx`, the `head` of `ModeSurface`), and beside
Learn's *Start over* — Recall and Explore are conversations too. It copies `conversationDocument`
for the open thread, through the shared `useCopy` with the same three states and live region as
`CopyAnswer`. Shown only when the open thread has at least one message. No fetch: the panel already
holds the whole thread.

**Copy, not download**, for the chat: the request is "pasted into another AI", and a clipboard is
the shortest road there. A file of every conversation is stage 3.

### Stage 3 — Your words, as one file (`your-words.md`)

`yourWordsMarkdown(rows)` in `src/store/your-words.ts`, built from `readArticleRows` — the same
owner-scoped, one-snapshot walk the zip uses, so it cannot see another reader's rows and cannot
disagree with the zip. Sections, each left out when empty:

- **On your shelf** — your title (if you renamed it), your purpose, your tags.
- **Comments and notes** — in article order (by the block's ordinal; a comment whose block has
  left the article goes last), each with the passage it was made on as a blockquote, your words,
  and, when you asked the AI on it, the answer marked as the model's.
- **Quiz answers** — the question, your answer, and the mark, marked as the model's.
- **Conversations** — every thread except Referee's `candidates` (machinery, not the reader's
  thinking — the rule `reader_notes` already follows), each through stage 1's renderer at level 2.

Delivered two ways, one function:

- `GET /api/export/:slug/your-words` → `text/markdown; charset=utf-8`, `attachment`,
  `<slug>-your-words.md`, `Cache-Control: private, no-store` — the same headers and the same
  `ArticleNotFound` → 404 translation as `sendExport`. Ownership comes from `readArticleRows`, as
  for the zip.
- inside the zip as `your-words.md`, with a `FILE_NOTES` line and a README line, so the zip stays
  "everything".

The Metadata page's Export section gets a second button, **Download your notes and conversations
(.md)**, beside the zip's. `export-download.ts` takes the path and filename rather than gaining a
copy of itself.

## Deferred, named

- **The reader's other inputs**: search queries, glossary terms looked up, referee criteria,
  Sources claim checks typed in, reading time. All are in the zip as JSON already; each is half the
  reader's and half a machine's, and rendering each well is its own small design. Add them to
  `your-words.md` when someone asks.
- **Block ids resolved to the passage text** in the Markdown. A pasted chat says `spya-k3m9qt`
  where the app shows a link; quoting the passage inline would make it self-contained for another
  AI, at the cost of a much longer file. Not v1.
- **A per-conversation download** and a command-bar row for the new file. The clipboard covers one
  conversation, and the file covers all of them.

## The simpler option passed over

Doing nothing new and pointing at the zip: it already holds every word. Passed over because the
report is precisely about the zip being the wrong shape for both jobs — not readable, and not one
conversation.

## Security

No defence is edited, but the new route rests on several (GPT Sol's F7 corrected the first
wording here): `requireUser` above the dispatcher, `slugPart` on the capture, and the owner
predicate `ownedSlug` inside `readArticleRows`. It is the zip route's twin and is tested the same
way in `tests/export-route.test.ts` — the owner's 200 as the positive control for another reader's
404, a signed-out 401, a traversal-shaped slug's 400 — and the authenticated route contract names
it. `your-words.md` reads only named fields, so the private-link key (`articles.share_token`) and
the owner id cannot reach it; `tests/your-words.test.ts` plants both and looks. The Markdown is
served as an attachment, `nosniff`, `no-store`, and never rendered by us; the clipboard copy is
plain text. Nothing reaches a model or an outside service.

## Plan review (GPT Sol, 2026-10-20)

[261020w-plan-review-sol.md](261020w-plan-review-sol.md): shape right, no P0. Each finding and
what became of it:

- **F1 (P1)** the server has rows, not `ChatThread`s — `your-words.ts` maps the snapshot's rows
  with the store's own `toMessage`, `anchorOf` (now exported from `pg-chat.ts`) and
  `storedThreadKind`, never `threadsFor`, which would read outside the walk's transaction.
- **F2 (P1)** a spoken answer carries no ids in its text — the renderer lists `passages` (and web
  `citations`) under the answer. Tool runs are left out: they are how an answer was made, not
  what it said.
- **F3 (P1)** a failed answer can keep partial text — "failed part-way; the above is what
  arrived" versus "No answer"; pending likewise; `interrupted` gets the unheard-words line; every
  flag that applies is said.
- **F4 (P1)** comment rows are mixed — only `body` is labelled as the reader's; an answer shows
  only when `status = 'done'`; a body-less explained passage (before 2026-08-28) is "Asked the AI
  about this passage", with no invented question; highlights and bookmarks are named as marks;
  severity, colour, criterion and the referee's placement are shown.
- **F5 (P2)** comment order duplicated an existing rule — `byArticlePlace` in
  `src/reader-notes.ts` is now the one comparator, used by `reader_notes` and by this file.
- **F6 (P1)** the Markdown route had no ceiling — it has the zip's, through `overBundleCap`, with
  its own 413 sentence pointing at the zip.
- **F7 (P2)** route contract and tripwires — done, above.
- **F8 (P2)** the download guard was keyed by slug — keyed by path now, so the zip and the
  Markdown build side by side; the Metadata buttons have their own wait and error each. The test
  was watched failing against a slug-keyed guard.
- **F9 (P2)** `yourWordsMarkdown(rows, exportedAt)` takes the zip's timestamp.

## What landed

All three stages, in one commit: `src/chat-markdown.ts`, the header button
(`CopyConversation` in `src/web/ChatPanel.tsx`), `src/store/your-words.ts`, `sendYourWords` and its
route, `your-words.md` in the zip, the second Metadata button, and
[export.md § Your words, and one conversation, as Markdown](../project/export.md#your-words-and-one-conversation-as-markdown).
Tests: `chat-markdown`, `chat-copy-conversation`, `your-words`, and additions to
`export-route`, `metadata-export-button` and the route contract.
