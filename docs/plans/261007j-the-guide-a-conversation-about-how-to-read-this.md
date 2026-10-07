# 261007j — The guide: a conversation about how to read this piece, in Chat

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-gjvvvc6n`; reports `spya-tddvg2`,
`spya-kfjrzv` and the guide-agent third of `spya-ucftjt` (SPIDERYARN-READING2-E7, -EA, -E9). Session
`fbtddvg2-guide-agent-on-open`. **Status: planned; GPT Sol's plan review said *build with changes*, F1–F8 accepted (§ After the plan review, which overrides the design where they differ).**

## What Greg asked for

The reports are long; the parts that shape the build, verbatim:

> perhaps instead of flashing it up as a modal, we could kick off a chat in the left-hand sidebar
> and think of it as a chat less about the content and more about the reading experience. So more
> about a guide for the user about how to use Spideryarn and how to make the most of its features
> and also how to read this article given their needs. […] the key thing, though, is that it has a
> whole bunch of tools. Pretty much anything that you can do in the UI, it has a tool for. […] in
> an ideal world, the chat would get injected in its system prompt stuff like whatever they put in
> their user profile and, you know, how experienced a user they are, you know, how many articles
> they've already read. Because if the answer is zero, then it should probably be more kind of an
> introductory user guide. […] tutorial and explore, if they don't already, should take into
> account the user's profile and why they're reading it. And, you know, if they haven't filled out
> the profile, it should say, by the way, tell me a bit about you yourself. […] use your judgment.
>
> — Greg, 2026-10-06, `spya-tddvg2`

> the command bar, you could think of it as the guide agent. […] Or maybe the guide agent has a
> large subset of tools available in the command bar. […] certainly I'm seeing them as pretty
> closely related and, if possible, reusing a lot of the same machinery and maybe even more or less
> identical. […] if some of the things are really complex, let's look for the, you know, 80-20,
> rather than bending over backwards trying to meet the letter of the suggestion
>
> — Greg, 2026-10-06, `spya-kfjrzv`

The help-page chatbot (`qi-e6ksaejb`, from `spya-ucftjt`) is a subset of this agent and is queued
separately; it is not built here.

## What is already there, and what that leaves

- **Tutorial and Explore already take the profile and the reason for reading into account.** Every
  conversation kind is sent `renderProfile` (About you, and Why you're reading this one) on every
  turn, resolved fresh (`streamChat` in `src/routes.ts`, `profileSection` in `src/profile.ts`);
  Explore speaks to the reader with it, Tutorial lets it set emphasis. Nothing to build; the note
  says so.
- **Chat already proposes actions as buttons** the reader presses
  ([chat-tools.md § Command buttons](../project/chat-tools.md#command-buttons-chat-proposes-the-reader-presses)):
  jump, find, glossary look-up, tags, bookmark. Seven ids, one allowlist, one token format.
- **The command bar already turns a sentence into a row** (Jev, `POST /api/command-pick`) and
  **suggests a short list from why you are reading** (Luna, `POST /api/command-suggest`, 261005k).
  Both see our words for every mode — `src/command-pick-catalogue.generated.json`, 73 rows with a
  description each.
- **"Why are you reading this?" is a modal**, `PurposePrompt`, shown once when the add page opened
  the article with its box untouched.

So the gap is: no conversation whose subject is *how to read this with Spideryarn*, that knows how
experienced the reader is, and whose buttons cover the modes and searches rather than only the
seven.

## The design (v1)

```
 Chat band (left)                              what happens on a press
 ┌──────────────────────────────────────┐
 │ 🧭 Guide                      pinned  │  ← one per article, top of Chat's list
 │ ────────────────────────────────────  │
 │ Why are you reading this one? Tell me │  ← the greeting: written by us, free,
 │ and I'll suggest where to start. …    │    adapts to what is already filled in
 │ ────────────────────────────────────  │
 │ you: I'm a neuroscientist, after the  │
 │      new imaging method               │
 │ guide: Then the Methods section is    │
 │ yours. Two searches worth running:    │
 │ [⚡ Quick search "pulse sequence"]    │──▶ Search opens, runs it   (generates)
 │ [   Open Learn › Tutorial        ]    │──▶ the band switches       (moves you)
 │ [✎ Save as why you're reading: …]     │──▶ purpose saved           (writes yours)
 └──────────────────────────────────────┘
```

1. **A `guide` thread kind**, one per article, owner only, opened and talked to in the Chat band,
   pinned at the top of Chat's list with its own icon. Its own system prompt, `GUIDE_SYSTEM`: you
   are this reader's guide to reading this piece well with Spideryarn; the subject is the reading,
   not a replacement for it (no summaries in place of the prose — [the anti-goal](../project/vision.md#anti-goals));
   one question at a time; if they have not said why they are reading, ask; if *About you* is empty,
   invite it once; match the introduction to their experience; propose actions as buttons. It sees
   the article (cached, like every kind), the profile (`with-the-reader` stance, like Explore), and
   **two lines only it gets**: how many articles are on the reader's shelf, and our words for the
   modes (from the catalogue). Read tools: `CHAT_TOOLS` (word search, glossary, citations, links…).
   No web search: this is about the reading, not the world. No Live, no `visible` blocks.
2. **Three more buttons**, for the guide and for Chat both (Greg: *"all of the main chats should
   probably have all the same tools"*):
   - `mode:<catalogue key>` — open a mode or sub-mode (`mode:glossary`, `submode:learn:tutorial`).
     Moves the reader only. Validated against the catalogue's `mode`/`submode` ids.
   - `quick-search:<words>` — the bar's own quick-search row; *generates*.
   - `purpose:<text>` — save as *Why you're reading this one* (replacing what is there; the button
     shows the words). Writes the reader's own data. **Guide only**: in Chat it would be a write
     nobody asked a chat for. Capped at `MAX_PURPOSE_CHARS`.
   Every one is a press, never a model's act, so [the line](../project/chat-llm-help-commands-vision.md#the-line-what-it-may-do-without-asking)
   and chat's *"nothing chat can call writes … or spends"* both stand unchanged.
3. **The greeting is ours, not a model's.** The empty guide shows a few sentences chosen by what is
   filled in (no reason → asks for it; no *About you* → one line inviting it). Nothing is spent
   until the reader sends.
4. **The ways in**:
   - Chat's list, always (the pinned row).
   - **First open, instead of the modal**: where `PurposePrompt` would have asked (the add page's
     mark, no reason stored) *and* there is room for a band beside the text, the article opens on
     the guide in the band instead of the modal. Under that width (a phone) the modal stays, because
     a band there covers the article.
   - **The command bar**: a typed sentence that matches no row gets one more row, *Ask the guide:
     "…"*, which opens the guide and sends the sentence (the press is the consent, as Ask in chat's
     rows are). The fast pick stays first: it is instant and free. This is the 80/20 of *"the
     command bar is the guide agent"*: one agent, two doors, the guide's thread the place both
     answers live.

## After the plan review (overrides the design above where they differ)

[GPT Sol's review](261007j-plan-review-sol.md), *build with changes*, eight findings, all accepted.

- **F1 — the guide's tools are its own, and the dispatcher enforces them.** `GUIDE_TOOLS` = the
  article tools only (`search_article_words`, `search_article_meaning`, `article_links`,
  `article_glossary`, `article_citations`); no `read_web_page`, no library reads, no web search.
  `runTool` refuses any name not in `toolsFor(ctx.kind)` before dispatch, for every kind (today only
  `reader_notes` checks). This *adds* a refusal in `src/chat-tools.ts`; it does not touch the
  `isSlug` or URL-length defences that security-map.md lists for that file. Test: an excluded,
  model-supplied call does no fetch and no store read.
- **F2 — three separate ideas, not one.** `SingleThreadKind` (Learn's three plus guide: one per
  article, `targetOf`), `LearnKind` (Learn's three: Learn's layout, `LEARN_VIEW_OF`), and
  *openable in Chat* (chat and guide). The kind sent is the open thread's (or the handoff target's),
  never the band's; `visible` only for a chat. Handoffs gain a required target, so *Ask in chat*
  still starts a chat while the bar's row targets the guide. The guide row is pinned outside the
  source filter. Tests per the review's list.
- **F3 — `mode:<key>` resolves against the live command set**, at draw and at press: the Dock's
  visible modes (experimental switch, context), not the whole catalogue. Its *generates* mark is
  the mode's own (`modeGenerates` / `subModeGenerates`), not fixed per id.
- **F4 — one first-open coordinator.** While the add page's mark is pending, `useLastView`'s
  Summary default waits for it. The coordinator: reason stored → clear the mark, the ordinary
  first-open default; definitively none and a band fits → clear the mark, open the guide (existing
  or one new), no modal; definitively none and narrow → the modal as today; read failed → keep the
  mark, decide nothing. Race-order and StrictMode tests.
- **F5 — no `purpose` button.** Instead of a model proposing words to save as the reason for
  reading, **the guide's greeting holds the same autosaving box the modal has** (`ProfileBox` with
  `useAutosavedText`, as Metadata's *Why you're reading this one*). The reader's own words are saved;
  nothing model-written ever becomes their reason. This removes the kind-aware chip check the
  review said the button would need. The buttons added are `mode` and `quick-search`, for chat and
  guide both.
- **F6 — the bar's order.** The first Enter on an unmatched sentence still runs the fast pick; only
  when it answers *could not tell* does that line become an *Ask the guide: "…"* row, and a fresh
  press sends. Exactly one paid send; in-flight lock.
- **F7 — experience is "articles opened before", bucketed, below the cache.** Owner-scoped, not
  archived, excluding this one, `opens > 0`: *none*, *a few* (1–5), *many*. It goes in the final user
  message beside the profile, never in `GUIDE_SYSTEM` or the cached prefix. The privacy page and
  privacy.md say the guide is sent it — required, not conditional.
- **F8 — no new route or gateway job.** The guide uses `/api/chat`; `jobFor("guide") === "chat"`, so
  its cost is reported under chat, on purpose for v1 (a test pins it). security-map.md gains the
  per-kind tool gate and the proposal allowlist. The paid eval includes hostile articles asking for
  the new tokens, hidden and experimental mode ids, and is scored by the real draw-and-press
  validator; written up in `docs/investigations/`.

## The simpler options passed over, and the larger ones deferred

- **Smaller: no new kind, a chat with an origin** (`origin_mode = 'guide'`). No new prompt
  possible: the system prompt is chosen by kind, and a guide answered with chat's prompt is just
  Chat. Passed over.
- **Smaller: keep the modal and add *Ask the guide* to it.** Keeps two surfaces asking the same
  question; Greg's report is about replacing the modal with the conversation. Kept for phones only.
- **Deferred — the guide acts on its own** (*"I've kicked off a search for methods"*). Today every
  action is a button. Letting a model whose context holds the article run a search (which spends)
  without a press changes the line Greg accepted on 2026-10-02, and chat-tools.md's *nothing chat
  can call spends*. That is his call: `awaiting-approval.md`, and its own queue entry.
- **Deferred — the guide speaks first on open** when a reason is already stored (a model call
  nobody pressed for, on every first open; about 10 cents uncached on Sonnet for a long paper).
  Queue entry, with the cost written down.
- **Deferred — the Help pages in the guide's prompt.** `/help` is becoming Markdown pages in
  261007e (`fbucftjt-help-pages-and-help-icon`, not yet on `dev`); once it lands, the guide can
  carry them, which is also most of the help chatbot (`qi-e6ksaejb`). Queue entry.
- **Deferred — one agent behind the bar** (the pick replaced by the guide with tools). The pick is
  0.3 s and free-ish; the guide is seconds and cents. The door above gets most of the value.

## Questions for Greg (not waited on)

- **[Q-guide-acts]** May the guide run a search or open a mode *itself*, telling you after, rather
  than offering a button? Recommendation: moves (open a mode) yes; anything that spends stays a
  button for now.
- **[Q-guide-first-open]** On first open, should the guide replace Summary as the starting band for
  everyone, or only (as built) when the reason for reading is missing?

## Stages

### Stage 0: plan review
- [ ] GPT Sol, read-only.

### Stage 1: the `guide` kind, server side
- [ ] Migration: `chat_threads_kind` CHECK gains `guide`; `chat_threads_one_guide` partial unique
      index. Generated, read, `db:chain`.
- [ ] `ThreadKind`, `THREAD_KINDS`, and a guide that is single-thread but **not** a Learn view
      (narrow the Learn-only uses of `SINGLE_THREAD_KINDS` to a `LearnKind`).
- [ ] `GUIDE_SYSTEM`, `readItFor`, the shelf-count line and the mode-words section, `toolsFor`,
      `kindWords`, web search off, `visible` refused as for other non-chat kinds.
- [ ] Store: `countArticles(owner)` reusing `onTheShelf()`.
- [ ] Tests red first: kind round-trips, one per article, prompt carries count and modes and not
      web search, a guide thread refuses `visible`.

### Stage 2: the buttons and the band
- [ ] `mode`, `quick-search`, `purpose` proposal ids through `command-proposal.ts`,
      `chat-commands.ts` (guide-only for `purpose`), runners in the reading and chat executors,
      `COMMAND_CHIPS` lines.
- [ ] Chat band: the guide openable and sendable (send the open thread's kind; no `visible`),
      pinned first, own icon and source, own greeting.
- [ ] Tests: chipFor accepts/refuses each; a press runs the runner; the band sends kind `guide`.

### Stage 3: the ways in
- [ ] First open: the mark plus band-room opens `?mode=chat&thread=<guide>` and no modal.
- [ ] The bar's *Ask the guide* row for an unmatched sentence; a handoff that targets the guide and
      sends.
- [ ] A small paid eval of the guide prompt (a handful of readers × two articles): asks why when
      missing, introduces for a first-timer, buttons valid, no summary in place of reading.

### Stage 4: docs, browser, bookkeeping
- [ ] chat-tools.md, chat-llm-help-commands-vision.md § Where we are, reader-profile.md, help page,
      privacy page if the shelf count counts as new data sent (it is a number, not words).
- [ ] Sonnet subagent: desktop, iPad, phone.
- [ ] GPT Sol code review; full suite; push; note; queue entries; `done qi-gjvvvc6n`.

## Log

- 2026-10-07: plan written after the prior-work check: `gjd-remote ls` shows this session as the
  only one on the guide; 261005k (the bar suggests from why you are reading) is built and its
  `[Q-suggest-together]` answered on 2026-10-06, so its line in `awaiting-approval.md` is stale.
