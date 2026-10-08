# Plan review: 261008e, Chat knows the reader's other conversations

You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only: do not edit any file.

Read `docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md` first. Then check its claims against the code:
`src/reader-notes.ts` (`threadIndexRows`, `indexRow`, `threadTranscript`, `eligible`, `readerNotesDigest`),
`src/chat-tools.ts` (`READER_NOTES_TOOL`, `readReaderNotes`, `toolsFor`),
`src/converse.ts` (`SYSTEM` around "READ THE READER'S NOTES", `buildConverseMessages`, `notesSection`, the cache_control breakpoint),
`src/routes.ts` (`streamChat`, the `chatStore.finish` success path near line 3763, `exploreNotes`),
`src/store/pg-chat.ts` (`load`, `rename`, `finish`, how an owner is resolved), `src/db/schema.ts` (`chatThreads`),
`src/wait-until.ts` (`keepAlive`), `src/title-tidy-model.ts`, `src/ai-call.ts` (the `title-tidy` route and policy), `src/models.ts` (`AiJob`, `TITLE_TIDY_MODEL`, the job wire table), `src/cost-categories.ts`,
and docs: `docs/project/chat-tools.md` § The reader's notes and § Security, `docs/project/prompt-caching.md`, `docs/project/prompting-guide.md`, `docs/project/security-map.md`, `docs/project/database.md`.

Greg's words are only those quoted in the plan; every design decision is mine.

Tell me, numbered, with file:line evidence:
1. Anything wrong against the code: a registration the new `chat-gist` job will miss, a seam that does not exist as described, a place a new `ChatThread.gist` field must be named (load mapping, export, admin, client types, tests that pin the shape), caching that will not hold.
2. Concurrency and lifecycle: the gist written after `finish` racing with `retry`, `edit`, `remove`, a second turn, or `sweepPending`; whether keepAlive + the request's auth context work for a store write after the response ended; whether a stale gist (written from an older transcript after a newer one) matters and how to prevent it cheaply.
3. Security: the gist is model output derived from text that can include web pages and the article; putting it into every Chat turn; anything in security-map.md this touches.
4. Cost/latency claims: are they right?
5. Prompt: is the proposed wording likely to make the model read a relevant earlier thread without making it read irrelevant ones on every turn? Better wording?
6. Anything simpler that would do as well.
End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
