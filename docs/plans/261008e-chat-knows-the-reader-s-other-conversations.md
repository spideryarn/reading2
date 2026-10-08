# Chat knows the reader's other conversations about the article

**Report** `spya-whq0j0` (Greg, 2026-10-08, suggestion), Overseer queue item `qi-7ap877jx`.
Owner doc: [chat-tools.md § The reader's notes](../project/chat-tools.md#the-readers-notes-the-one-tool-not-every-conversation-gets).

> I've just had a really interesting chat thread where the model pointed out some deficiencies in
> the paper, potential confounds. Now, if I was to start a new chat thread and say, Are there any
> potential confounds? I would be disappointed if the model sort of didn't make reference to points
> it had already made. […] Perhaps we auto-generate a descriptive title for each chat thread with a
> small model after each response, and then the model can easily consult those chat titles. […]
> when it starts a new— Chat, it would be told, by the way, here are some titles for other chat
> threads, and you have a tool to read them individually if you want to. […] let's look for a sort
> of 80-20 that allows the model to have some awareness of what has gone on in other chat threads
> and to be able to read them if it wants to.
>
> — Greg, 2026-10-08

He also asked for chat tools for **his comments and bookmarks**.

## What is already here (and why the report still stands)

Most of the plumbing landed on 2026-10-03 (plan
[261003l](261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md)): typed Chat has a
`reader_notes` tool that returns the reader's comments, highlights and **bookmarks** on the article
plus an index of their other conversations, and, given a thread id, one of those conversations in
full (newest 10 exchanges within 8,000 characters). So the comments-and-bookmarks half of the
report is **already built** — and the other-threads half is built as a *tool*.

What stops it doing what Greg describes is two things:

1. **The model is never told the other threads exist.** It has to call `reader_notes` to find out,
   and both the prompt and the tool's description tell it to do that *only* when the reader asks
   about their notes or an earlier conversation ("Do not read them for any other question"). A new
   thread asking "any confounds?" is not that, so it never looks.
2. **The index would not help it choose anyway.** A thread's title is the first 60 characters of
   its first question (`titleFrom`, src/chat-title.ts). A thread that started "What do you make of
   figure 3?" and went on to confounds is listed as "What do you make of figure 3?".

## Options weighed

| | What | Cost | Verdict |
|---|---|---|---|
| A | **Do nothing new; loosen the prompt** so the model calls `reader_notes()` to check for earlier threads on every substantive question | An extra tool round on most turns (latency ~2–4 s), and the index is still first-question titles | Fixes (1) badly, not (2) |
| B | **Greg's lean**: a small model writes a descriptive line per thread after each answer; every typed-Chat turn carries the list of the reader's other threads with those lines; the existing tool reads one in full | One cheap call per finished answer; a few hundred tokens per turn | **Chosen** |
| C | Inject *every* other thread's full transcript into each turn | Up to tens of thousands of tokens per turn, uncached, and drowns the current question | Rejected: Greg's own worry ("it wouldn't know which ones are relevant") and the cost |
| D | Embedding search over other threads' messages | Needs embeddings, which are not built (chat-tools.md § What Greg asked for) | Rejected for now: a reader has a handful of threads per article; a list of a few lines is cheaper and more legible than retrieval |
| E | A tool that calls a sub-agent to read the threads and report back | A second model loop per call | Rejected: what the sub-agent would produce *is* the per-thread line of B, made once and stored instead of on every call |

Web research on how others do it: see [§ Research](#research) below. In short, the big assistants
converged on the same split as B — a short, cheap, always-present index of past conversations,
plus a tool to pull one in full.

## What gets built

### 1. A gist per thread, written by a small model after each answer

- **New nullable columns on `chat_threads`**: `gist text`, `gist_at timestamptz` (store when it
  happened). An additive migration.
- **When**: after `streamChat` stores a finished (`done`) answer — **after the response has ended
  and the turn has released the thread, and awaited there** before the handler returns. Not handed
  to `keepAlive`: the request's spend collector closes when the handler returns, so a call that
  finished later would never reach the ledger, and on Vercel the handler's own promise already keeps
  the instance awake (GPT Sol's plan review, 2). Not before `release()`, or the next turn would wait
  behind it. Only when this turn's answer is the one stored `done` (a swept or superseded attempt
  reaches the same line), never on an error, never on a Candidates thread.
- **What the small model sees**: the thread's settled exchanges (`settledExchanges`, the rule the
  tool shares), the first exchange always and then the newest that fit 16,000 characters, each
  answer clipped to 2,000 — more of each answer than the tool's 700, because the points are in the
  answers. Recall answers as the reader saw them (`answerAsSeen`), so an unopened hint never reaches
  another conversation. Fenced.
- **What it writes**: one line, at most ~200 characters, saying what the conversation covered and
  the specific points it reached ("Possible confounds in the sleep study: self-selected sample, no
  control for caffeine, short follow-up"). Not a title for the reader — it is never shown on screen
  in this version; the reader's title and their renames are untouched.
- **Model**: DeepSeek V4.1 Flash on the existing zero-data-retention route (Fireworks / DeepInfra /
  Together), as a new job `chat-gist`, a copy of `title-tidy`'s route. Zero retention matters here
  more than for a title: this is the reader's private conversation.
- **Its cost, named**: **measured $0.0001–$0.0003 per answer** on the eval's short conversations
  (500–700 input tokens, 30–50 out, Fireworks, 0.6–1.5 s), from the ledger. The input cap is 16,000
  characters, roughly 4,500 tokens, so at the dearest of the three routed providers ($0.45 / $1.80
  per million, OpenRouter's table as GPT Sol read it on 2026-10-08) a long conversation's gist costs
  about $0.002. A typed Chat answer on Sonnet costs of the order of $0.02–0.10, so this is a few
  percent at worst. It is on the ledger as job `chat-gist`, category *interactive request work*.
- **Failure costs the gist, not the turn**: logged (slug, thread id, error type — never text),
  nothing stored, and the index falls back to the latest question beside the title.
- **Ownership and stale-write fence**: written through
  `chatStore.setGist(slug, threadId, gist, basedOn)`, which compares the stored transcript with the
  snapshot the gist was made from under the article lock. Comparing only `updatedAt` was not enough:
  JavaScript drops PostgreSQL's sub-millisecond precision, and opening a Recall hint changes what
  the gist may see without moving that list-order clock. The method resolves the slug through the
  owner like every other chat write (`articleIdForOwned`), so it cannot touch another reader's
  thread.

### 2. Every typed-Chat turn is told about the other threads

- A new section in the final user message of a **`chat`** turn (below the cache breakpoint, beside
  the profile and the anchor, like Explore's notes), present only when the reader has at least one
  other eligible conversation on the article:

  ```
  THE READER'S OTHER CONVERSATIONS about this article, listed for you before this turn …
  <<fenced rows: id · kind · “title” · gist · N finished exchanges · last added to …>>
  ```

  Rows are `threadIndexRows` — the same function the tool's index uses, same caps, same exclusion
  of Candidates and the current thread — with the gist added to each row. So the tool's index and
  this list cannot disagree, and Explore's digest gets the gists too.
- **A row with no gist yet shows its latest question** ("last asked: …") — a conversation from
  before this shipped, until its next answer. Greg's own confounds conversation is one of those, and
  there is no backfill (GPT Sol's plan review, 6, offered this as the whole design; it is the
  fallback here).
- **Every turn, not only the first**: a later question in the same thread can be the one that
  overlaps an earlier conversation. The rows share `THREADS_CHARS`, raised from 3,000 to 5,000
  because each row grew; with the sentences around them the section is under 6,000 characters,
  about 1,500 tokens at the most and a few hundred for a handful of conversations — $0.003 a turn
  at Sonnet's input price at the very most. It also costs one more `chatStore.load` per Chat turn,
  which reads every thread and message on the article.
- **Only typed Chat.** Explore already carries the whole digest; Recall, Tutorial and the guide do
  not get `reader_notes` (chat-tools.md says why) and so are not told about threads they could not
  open.

### 3. The prompt and the tool description change to match

- `SYSTEM` keeps READ THE READER'S NOTES for the notes, and gains BUILD ON THEIR EARLIER
  CONVERSATIONS: when one took up the same question, claim, passage or objection, read it before
  answering; answer the question, adding to what was said rather than repeating it; do not open
  one that is only on a nearby topic; never guess what one said from its line. The narrower trigger
  and "answer first" are GPT Sol's (plan review, 5): "looks relevant" invited a read on every turn,
  and "say what was said there" a recap at the top of every answer.
- `READER_NOTES_TOOL.description` says the same: no `thread` for the notes; an exact id when the
  list shows a conversation that took up the question.
- The injected section adds that a line in the list only says where to look.

### Security

Another conversation is the reader's, but its answers can quote the article and web pages, so the
gist is model output written from untrusted text, and it is read by a model with tools — security
map parties 3, 4 and 5. It goes in the same `untrusted()` fence as the title wherever it appears,
collapsed to one line and capped at 240 characters; the gist model's prompt says the conversation
is data and anything in it addressed to the model is to be ignored; its answer must be JSON with
exactly one field. None of that is a boundary — a fence is advice to a model. **What changes**: a
line of the reader's private conversations is now in front of the model on every Chat turn,
without a tool call, so a hostile article no longer has to persuade the model to read the notes
first. No new path out; the existing URL-channel weakness (chat-tools.md § The reader's notes,
"What it adds to the risk") applies, and that passage now says so. No defence in
security-map.md § Where the defences physically live is edited.

## Not built, and why

- **Showing the gist in Chat's list.** It would make the list more descriptive, but it is a UI
  change Greg did not ask for and the list already shows the full first question (plan 261005h).
  Easy to add later.
- **Gists for spoken (Live) conversations.** Live turns are stored by a different path
  (`appendSpoken`); they get listed with their title and latest question. Worth adding if it proves useful.
- **Backfilling gists for existing threads.** A thread gets one at its next answer. A backfill is a
  production write and Greg did not ask for it.
- **Embeddings or a sub-agent** (D, E above).

## Checks

- `tests/chat-gist.test.ts`: answer parsing and the cap, what the gist model reads (an unopened
  Recall hint stays out — seen red without `answerAsSeen`), the index rows with a gist and the
  fallback, the section's presence for `chat` alone and below the cache breakpoint, a gist that
  tries to close the fence.
- `tests/chat-gist-store.test.ts` (Postgres): `setGist` writes and leaves the clock alone, refuses
  a stale write (seen red with the guard removed), cannot reach another owner's thread;
  `refreshGist` writes for a landed answer, calls nothing for a failed one, never throws.
- `tests/explore-digest-route.test.ts`: its "chat carries none" case now says chat carries the
  list and still not the notes.
- The tool-routing check, `evals/chat-other-threads.ts` — results below.
- Browser: a real conversation on the dev server, then a second one.

## Research

A Sonnet subagent's web search, 2026-10-08. Most of this is third-party reverse engineering, not
vendor documentation, so it is a direction rather than a fact.

- **ChatGPT** ("reference chat history"): no retrieval over history. A precomputed block of about
  15 recent conversations goes into **every** turn, each a date, a quoted title and a few short
  bullets — the bullets summarise only the *user's* messages
  ([Manthan Gupta, Dec 2025](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)).
- **Claude.ai**: nothing preloaded; two tools (`conversation_search`, `recent_chats`) search the raw
  transcripts when the model decides to
  ([Simon Willison, Sep 2025](https://simonwillison.net/2025/Sep/12/claude-memory/);
  [Anthropic help](https://support.claude.com/en/articles/11817273-how-does-claude-s-memory-work)).
- **Titles**: Open WebUI and LibreChat both make titles with a separate small "task model"
  ([Open WebUI](https://docs.openwebui.com/features/administration/task-models),
  [LibreChat](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/shared_endpoint_settings)),
  from the first exchange, ≤ 5 words. Nothing found on regenerating them.
- **Letta/MemGPT**: what is always needed stays in context; history is behind a search tool the
  agent chooses to call, and the Letta forum's own argument is that a tool call adds latency and
  does not guarantee the relevant item is found
  ([Letta forum](https://forum.letta.com/t/how-does-memory-work-in-letta/93)).
- **Whether models call such a tool unprompted**: no evidence found either way.

What it changed in this plan: **the per-thread line is a gist of what was concluded, not a short
title.** A five-word title like "Discussion of study design" would not tell the model that
confounds were covered, which is the one thing Greg's example needs. And unlike ChatGPT's, ours
summarises the *model's* side too, because the points Greg wants built on are the ones the model
made. The hybrid — ChatGPT's always-present list, Claude's read-on-demand tool — is what this plan
already was. A suggestion passed over: drop the tool and inject every thread's gist alone. The gist
says what was found, but building on it well needs the reasoning, which is in the transcript; the
tool is already built and costs nothing until called.

## The live check

`npx tsx evals/chat-other-threads.ts --repeats=3`, 2026-10-08, Sonnet 5, $0.80. Two earlier
conversations on the Noema fixture, their gists written by the real gist call:

- `spya-thra11` (titled "What is the bit about the cinnamon bun for?"): *Cinnamon bun (Mother
  Teresa) as Seth's pareidolia example, then where his argument is weakest: brains-aren't-computers
  vs functionalism, life-consciousness link is hypothesis, bias shows belief not falsity*
- `spya-thrb22`: *Meaning of computational functionalism: mind equals the right computations
  regardless of substrate; basis of conscious-AI claims, which Seth challenges*

| question | arm | opened the right one | opened a wrong one |
|---|---|---|---|
| "Where is his argument weakest?" | list | 3/3 (`thra11`) | 0 |
| | no list | 0/3 | 0 |
| "Remind me what computational functionalism means here?" | list | 3/3 (`thrb22`) | 0 |
| | no list | 0/3 | 0 |
| "Who is Blake Lemoine?" | list | opened none, 3/3 | 0 |
| | no list | opened none, 3/3 | 0 |

The three "weakest" answers each began from the earlier conversation's three points and added new
ones ("The earlier conversation on this already named three weak spots — … A few more worth
adding:"), which is what Greg asked for. Small samples: this shows the mechanism works and the
trigger is not indiscriminate, not a rate.

### Against the simpler alternative: gists or the latest question

GPT Sol's plan review (point 6) and code review (point 7) asked for the test this plan had not run:
the same list with no gists, each row showing its latest question instead — no model call, no
migration. `--hard` makes it Greg's own case: conversation A's second question is "OK. What did you
make of it overall?", so the weak points are only in the *answer*, where a preview of the question
cannot see them. `npx tsx evals/chat-other-threads.ts --repeats=3 --hard`, $0.92:

| question | arm | opened the right one | opened a wrong one |
|---|---|---|---|
| "Where is his argument weakest?" | gist | 3/3 | 0 |
| | latest question only | 3/3 | 0 |
| | no list | 0/3 | 0 |
| "Remind me what computational functionalism means here?" | gist | 3/3 | 0 |
| | latest question only | 3/3 | 0 |
| | no list | 0/3 | 0 |
| "Who is Blake Lemoine?" | gist | none opened, 3/3 | 0 |
| | latest question only | none opened, 3/3 | 0 |
| | no list | none opened, 3/3 | 0 |

**The gist earned nothing measurable here.** With two earlier conversations, the model opens the
plausible one on a question as thin as "what did you make of it overall?". What made the
difference is the list itself. The case a gist should win — many conversations, or one whose title
and latest question both point elsewhere — is not in this eval, and is not shown.

**Kept anyway, and why that is a judgement rather than a finding.** It is what Greg asked for
("auto-generate a descriptive title for each chat thread with a small model after each response"),
it costs a fraction of a cent an answer, and a reader with a dozen conversations on a paper is
where a one-line "what was found" should matter. If it never earns its keep, taking it out is one
line in `streamChat` (stop calling `refreshGist`): the list already falls back to the latest
question, and the column can stay. Said in the feedback note so Greg can make that call.

## Progress

- [x] Plan reviewed by GPT Sol — [261008e-plan-review-sol.md](261008e-plan-review-sol.md), BUILD
  WITH CHANGES; points 1–5 taken. Point 6's latest-question preview is built as the fallback, and
  its head-to-head against the gist has been run (above): no measurable difference at this scale.
- [x] Migration, store, gist job
- [x] Prompt section, prompt and tool wording
- [x] Tests, live check
- [x] Browser check (Sonnet subagent, Playwright, local dev server, the Noema article): the first
  conversation's gist was written about a second after its answer; a second new conversation asking
  "What are the main weaknesses or gaps in this piece's reasoning?" showed three *read one of your
  earlier conversations* rows and began "Three earlier conversations already covered a fair bit of
  this ground: …  Beyond those, a few more gaps worth flagging:"; "Who is the author?" in the same
  thread opened nothing. No console errors, no gist errors in the server log. The article had older
  conversations with no gist, and the first new conversation opened two of them too: the
  latest-question fallback doing its job.
- [x] Code review by GPT Sol — [261008e-code-review-sol.md](261008e-code-review-sol.md). It fixed
  six findings itself (a millisecond compare-and-set that a same-millisecond write or an opened
  Recall hint could slip past, now a transcript compare under the article lock with the gist
  cleared on every transcript change; `finish` now says whether its attempt landed, so a superseded
  attempt writes no gist; the rollback restore helper kept the gist; the fallback names the latest
  question even when unanswered; two budgets made hard; four route tests that counted requests now
  tell the gist call apart). Its verdict was DO NOT SHIP for two reasons, both closed here: its
  sandbox could not reach Postgres, so I ran the store, export and route suites (13 files, 381
  tests, green); and point 7, the unrun alternative, is the section above.
- [x] Docs: chat-tools.md, setup-dev.md model table
