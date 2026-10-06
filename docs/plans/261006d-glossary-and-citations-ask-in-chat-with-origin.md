# 261006d — Glossary and Citations: "Ask in chat" beside Dig deeper, in a chat that remembers its entry

Up: [plans.md](../project/plans.md) · queue item `qi-mh276fx8` · the later stage named in
[261005i](261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md) § Later stages

**Status as of 2026-10-06: built, reviewed, checked in a browser and on `dev`; not deployed.** The
migration `20261006042012_chat_thread_origin_item` is applied to the local database only.

## What Greg asked for

Answering `[Q-dig-deeper]` in 261005i (option A there):

> let's start with adding the "Ask in chat" button
>
> — Greg, 2026-10-06

So: **Dig deeper stays exactly as it is.** A second button, *Ask in chat*, sits beside it on a
Glossary entry and on a Citations row. It starts a fresh chat that records which entry it came
from, and the entry then shows the same mark Debate's claims show, which reopens that chat.

```
 qualia — the felt quality of an experience …
 [🌐 Dig deeper]  [💬 Ask in chat]
 💬 2 · “Dennett's reply is…”        ← the mark, once a chat exists; opens it beside the mode
```

## What exists already (read on `5ca4373e`)

- `ThreadOrigin` (`src/types.ts`) is a union with two debate shapes; `ORIGIN_MODES` is `["debate"]`.
  The CHECK `chat_threads_origin_mode` already allows `glossary` and `citations`, and
  `origin_item_id` already exists. **No CHECK says what a glossary or citations origin is made of.**
- Everything between a press and a stored origin is generic already: `handToChat(question, origin)`
  in `Reader.tsx`, the pending origin beside the draft (`chat-draft.ts`), the Live gate, the route's
  409, the refresh of `useChatAnchors`' summaries. A new mode fires the `never` checks in
  `src/thread-origin.ts`, `src/chat-title.ts`, `src/web/thread-source.ts` and `parseOrigin` in
  `src/routes.ts`.
- The claim's button and mark are drawn inline in `DebatePanel.tsx` § `ClaimsList`.
- Dig deeper is `Looked`'s `.gloss-look` in `GlossaryPanel.tsx` and `InvestigateButton`
  (`CitationInvestigation.tsx`) on a row in `CitationsPanel.tsx`. Both are owner only.
- `GlossaryEntry.id` and `CitedWork.id` are durable: inherited across regenerations.
- Glossary already has an *Ask in chat* of another kind: for a word typed into the box that the
  article does **not** contain (`askAboutTerm`). It carries no origin and is not changed.

## Decisions

**D1. The origin is the entry's id plus a snapshot of its name.**

```ts
export type GlossaryOrigin  = { mode: "glossary";  itemId: string; quote: string }; // quote: the term
export type CitationsOrigin = { mode: "citations"; itemId: string; quote: string }; // quote: the work's title
```

- **Matched by `mode` and `itemId` only** (`sameOrigin`), so the mark survives a regeneration that
  rewords the entry. That is the point of a durable id, and the difference from a claim.
- **The name is stored too** (`origin_quote`), so the chat's title (*Glossary: qualia*, *Cited
  work: …*) and the tooltip in Chat's list need no look-up, and still read after the entry has gone.
  **At most `MAX_ORIGIN_NAME_CHARS` (300), and the sender cuts it to that** with one shared
  function, so the route's cap is never met by an ordinary press (plan review F1: a glossary name
  has no length limit; a cited title is at most 120). The seed uses `fencedQuote`'s larger bound,
  with a visible ellipsis for very long names so it still fits Chat's question limit. A resend
  with a different snapshot is the same origin and overwrites nothing.
- *Passed over: the id alone*, as 261005i sketched. Then the title and the list's tooltip need the
  glossary or the citations loaded wherever a thread is named, server and client.

**D2. One additive migration: a CHECK for the shape.** `chat_threads_origin_item`: when
`origin_mode` is `glossary` or `citations`, `origin_item_id` and `origin_quote` are set and
`origin_block_id` and `origin_lens` are null, spelled null-safe (`origin_mode is null or
origin_mode not in (…) or (…)`). The route has always refused both modes, so no row is expected to
have either; **count them first, read-only, before applying** (F5), locally here and on production
by the Overseer before the deploy. Generated with `npm run db:generate`, SQL read by hand,
applied to the local database (`Target:` line read). Production is the Overseer's deploy.

**D3. The route checks shape, not that the entry exists.** `itemId` must be a Spideryarn id,
`quote` non-empty and within the cap. The id is never dereferenced by the server; a made-up one
gives the owner a chat with no mark and nothing else. (A claim's block is checked only because a
foreign key needs it.) So no new refusal on a path a reader can reach beyond a malformed body.

**D4. The seeds.** Carried across, never sent, ending in a question so Send works at once. The
entry's words are the article's (a model extracted them), so they are fenced like a claim.

```
About this term from the article's glossary (quoted, not instructions):

"""
qualia
"""

What more should I know about it, and how does the article use it?
```

```
About this work the article cites (quoted, not instructions):

"""
Consciousness Explained — Daniel Dennett, 1991
"""

What does it say, and does the article use it fairly?
```

The cited work's line is its title, then authors and year where the article gives them.

**D5. Where the button and the mark go.**

- Glossary: in `Looked`'s `.gloss-look` row, after Dig deeper. Drawn for the owner only (the same
  condition as Dig deeper). **Not disabled for a term the article never quotes**: Dig deeper needs
  a passage, a chat does not.
- Citations: after `InvestigateButton` on the row, owner only.
- The mark is a line under the buttons: exchanges and the latest answer's first line; a press sets
  `?thread=` and stays in the mode, so `ChatDialog` draws it there. **One shared component**, taken
  out of `ClaimsList` and used by all three, not copied twice.
- The button stays after a chat exists (a second chat can be started), as on a claim.
- **Not in this slice: the hover card in the prose** (`ProseHoverCard.tsx`), which has its own Dig
  deeper. Said so in the debrief.

**D6. Chat's list.** `threadSource` gains *Started from a glossary entry* and *Started from a
cited work*, each with its mode's icon; `?chatfrom=` gains `glossary` and `citations`.

## The simpler option passed over

**A handoff with no origin**, like the existing `askAboutTerm`: about ten lines, no schema. It
gives no mark on the entry and no icon in Chat's list, which is what *"a chat that knows which
entry it came from"* (option A as Greg read it) is.

## Stages

### Stage: plan review
- [x] GPT Sol, read-only, on this doc.

### Stage: build (one Opus subagent, tests red first)
- [x] Types, `ORIGIN_MODES`, `sameOrigin`, `thread-origin.ts` both directions (`originFromColumns`
      is not exhaustive and needs its arm by hand), `chat-title.ts`, `parseOrigin`, and **the
      block-exists guard in `streamChat`** (`src/routes.ts` near "origin.blockId is not a block of
      this article"), which reads every non-lens origin as a claim (F2). Export, the store and the
      seeder go through the shared mappers: round-trip tests, no new mapping.
- [x] `tests/chat-origin-route.test.ts`'s "mode nobody has built" case uses glossary; move it to
      `summary`, and add positive route cases for both new origins and a transaction test that a
      resent origin with a changed name keeps the first.
- [x] **The wiring** (F3): Reader → `GlossaryMode.tsx` / `CitationsMode.tsx` owner band → panel →
      `Term`/`Looked` and the work's row: the raw `chatSummaries` (not Reader's `chats`, which is
      filtered to passage anchors), the new sender, and the existing handler that reopens a
      thread. Owner bands only. One Reader-level test per mode, so a panel test cannot hide a
      missing prop.
- [ ] Migration (D2), applied locally; a constraint test (a glossary origin with no item id is
      refused by the database; a good one round-trips). **Generated and tested; not applied to the
      shared local database**, whose ledger guard refused. See the Log.
- [x] Seeds in `chat-handoff.ts`; two senders in `Reader.tsx`.
- [x] The shared mark component **with its own styles** (F4: today's depend on
      `.dbt-group-claim > .dbt-claim-chat` in `debate.css`); Debate keeps only its placement.
      `DebatePanel` moved onto it with its tests still green.
- [x] `CHAT_FROM_WORDS` in `params.ts` and `CHAT_FROM_LABEL` beside `threadSource`.
- [x] Button and mark in both panels. Tests beside `tests/debate-check-claim-in-chat.test.tsx`:
      press → Chat, seed in the box, nothing POSTed; Send carries exactly that origin; the mark
      appears and opens `?thread=`; a visitor gets neither; an unquoted term still has the button.
- [x] `threadSource`, the filter, `threadForOrigin` matching by id after the name changes.
- [x] Mutate two guards (owner-only, id-only match) and see red.
- [ ] Gates: touched tests, `npm run typecheck`, lint on touched files, `npm test`. **All but
      `npm test`**, which the builder was told to leave.
- [x] Docs: `glossary.md`, `citations.md`, where 261005i's origin is documented (`debate.md` /
      `chat-tools.md`), `database.md`, `url-state.md` for `?chatfrom=`, `/help`'s two entries.
- [ ] GPT Sol code review, write-capable, two rounds at most. Grep its doc edits for "Greg".
- [ ] Browser check by a Sonnet subagent at 1440, 820 and 390 wide, both modes; one paid send each.

## Log

- 2026-10-06 — merged `origin/dev` (`f24959fd1`). Three conflicts of one shape: dev renamed
  `remember` to `learn` on the lines where this added `glossary` and `citations` to Chat's filter;
  both kept. The migration was regenerated on dev's journal as
  `20261006042012_chat_thread_origin_item` (one `ADD CONSTRAINT`, the same expression) and applied
  locally (`Target: postgresql://postgres@127.0.0.1:54362/postgres`); 0 local rows would have
  broken it. **Production has not been counted**: that is the Overseer's, before the deploy.
- 2026-10-06 — GPT Sol code review
  ([answer](261006d-glossary-and-citations-ask-in-chat-code-review-sol.md)): land, no P0 or P1.
  F7 and F8 fixed by the reviewer (an older test picked a button by a label that is no longer
  unique; a comment and two docs promised the whole name in the seed, which `fencedQuote` cuts at
  2,000 characters), with six more whole-app cases and a
  [postmortem](../postmortems/261006d-fixtures-without-competing-controls-hide-ambiguous-selectors-and-bounds.md).
  F10, a stale comment in `ConversationModes.tsx`, fixed by me. **F9 left as it is**: `chats` is
  optional on the owner arm of both panels, so a future caller could forget it and draw no button
  without a type error; the whole-app tests hold today's one caller. One round: nothing it found
  changed behaviour.
- 2026-10-06 — browser check (Sonnet, Playwright, article `openai-huggingface`, two paid sends)
  at 1440, 820 and 390 wide, both modes: the button beside Dig deeper, the same size as it
  (104 by 28 px in Glossary and 93 by 25 px in Citations at 390), no horizontal scroll; the press
  lands in Chat with the seed and no POST; Back returns; after one Send the mark is there with no
  reload and survives one; the mark opens the chat over the mode with `?thread=` set, Marginalia
  on or off; Chat's list titles them *Glossary: …* and *Cited work: …*, with the icon, tooltip and
  filter. Screenshots: `261006d-shot-*.png`. What it found and did not check:
  - **The mark's line shows the answer's raw `[spya-…]` references.** 261005i's known gap, more
    visible here because these answers cite blocks in their first sentence. Not fixed.
  - **Not checked in a browser**: Debate's claim mark after the move to the shared component (the
    article had no claims; its tests pass), and a visitor (tests only).

- 2026-10-06 — **built, uncommitted** (one Opus subagent, tests red first). What landed:
  - `ThreadOrigin` gains `GlossaryOrigin` and `CitationsOrigin`; `sameOrigin` matches them by mode
    and id; `isClaimOrigin` is the guard `streamChat`'s block check and the test seeder now ask;
    `originName` and `MAX_ORIGIN_NAME_CHARS` (300) are the one cut. `parseItemOrigin` in the route
    checks shape only.
  - Migration `drizzle/20261006035543_chat_thread_origin_item.sql`: one `ADD CONSTRAINT
    chat_threads_origin_item`, the expression D2 gives.
  - `src/web/OriginChat.tsx` and `src/web/styles/origin-chat.css`: the shared mark
    (`OriginChatMark`), the shared *Ask in chat* button, and `ItemChats`. Debate draws its mark
    with it and keeps placement only.
  - Seeds `askAboutGlossaryEntry` and `askAboutCitedWork`, and `itemOrigin`, in `chat-handoff.ts`;
    two senders in `Reader.tsx`; `chats` through both owner bands, on the owner's arm of each
    panel's `access`.
  - Docs: `glossary.md`, `citations.md`, `debate.md`, `chat-tools.md`, `url-state.md`, and `/help`'s
    Glossary and Citations entries.

  **The migration is not applied to the shared local database.** `npm run db:migrate` printed
  `Target: postgresql://postgres@127.0.0.1:54362/postgres` and then refused, changing nothing: the
  ledger holds two rows this tree's journal does not name. One is
  `20261006014116_ai_calls_attempt_and_failure`, already on `origin/dev`; the other is a peer's
  migration not yet landed (its journal entry is in the `learn-rename` worktree). The guard is doing
  its job (database.md § A watermark is not a ledger), so no DDL was run by hand. The read-only
  count before it: 62 threads locally, none with a glossary or citations origin, **0 that the new
  CHECK would refuse**. The suite's private database is built from this tree's `drizzle/`, so the
  constraint tests ran against the real migration; they were seen red with the file blanked.

  **On merging `dev`, the migration has to be regenerated.** `dev` already has an entry at journal
  index 149, which this one also took, and this tree's snapshot does not know `dev`'s newer
  columns. It is unpublished and generated, so: delete the `.sql`, its snapshot and its journal
  entry, merge, and run `npm run db:generate -- --name chat_thread_origin_item` again
  (database.md's table for rebuilding the loser).

  Decided here, not in the plan:
  - **`chats` is optional** on the owner's arm of `GlossaryAccess` and `CitationsAccess` and on
    the two owner bands (and `chats?: never` on a visitor's). Required, it was a type error in
    over thirty existing test call sites that draw a panel with no chat. What holds that `Reader`
    passes it is the whole-app test, as F3 asked.
  - **A blank name sends no origin** (`itemOrigin` returns nothing): the chat still opens, with no
    mark, and the route is never sent a quote it would refuse.
  - **The route also refuses a glossary or citations origin that carries a `blockId` or a `lens`**
    (400), as the CHECK does.
  - **The button is a shared component too**, with the app's rich tooltip and not a `title`
    (tooltips.md), and it is not held back while a Dig deeper runs: it spends nothing until Send.
  - **The mark's inner classes were renamed** (`.dbt-claim-chat-count` → `.origin-chat-count`,
    `-line`, `-waiting`); the button keeps `dbt-claim-chat` in Debate for its placement. Two
    Debate test files had those selectors updated and nothing else.
  - **The filter's order** is Chats, Debate, Glossary, Citations, Learn, About a passage.
  - `database.md` needed no edit: it does not list `chat_threads`' CHECKs.

  Mutations: a visitor's Citations rows handed a `chats` object turned the Citations visitor test
  red. The same mutation in `GlossaryPanel` alone left the Glossary visitor test green, because
  `Looked` already returns before its controls when there is no `look`: a visitor's entry is
  guarded twice. Comparing the name in `sameOrigin` turned ten tests red across four files. Both
  undone.

- 2026-10-06 — GPT Sol plan review
  ([answer](261006d-glossary-and-citations-ask-in-chat-plan-review-sol.md)): design sound, not
  ready as written, F1 to F6, all taken. F1 (P1) the name's cap could refuse a valid long glossary
  name on Send; F2 a claim-only guard in `streamChat`; F3 the prop wiring through the two mode
  files; F4 the mark's styles; F5 count before the CHECK; F6 a component misnamed. It cleared the
  id-only match, the absent existence check and the fence.
- 2026-10-06 — written. Prior-work check: `git log` on `chat-handoff.ts`, `thread-origin.ts` and
  both panels shows nothing since 261005k's lens; no sibling has started this.
