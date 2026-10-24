# Resting on a citation starts *Does it say that?* and streams it into the card

(Planned first as a cheap note on what this paragraph cites the work for; that version is kept below
as history. Greg chose the chat instead, for everyone: [§ What we build](#what-we-build-option-c-for-every-reader).)

Report `spya-mxk20e` (#678), Greg (admin: `feedback-reporter.ts` exit 0), 2026-10-23 22:15 UTC, a
suggestion, filed from `/read/effective-expressiveness-spya-z8dehh?mode=structure&thread=spya-tt3zzc`:

> I think any time I hover over a source, let's automatically start, you know, initiating some kind
> of deeper dive, which could be the same as initiating an ask in chat with a default input and just
> stream in the response so that I can just hover over a source or a link or whatever and find out
> more without having to click and ask for it and be taken somewhere else.

The brief added: cost matters. A model call on every hover is expensive and noisy, so design the
trigger (a dwell, a per-source cache, a cap) and name the trade-off. If there is a real product
choice, ask, and build the simplest version meanwhile.

## Greg's answer, 2026-10-24

The question was [q-hc4y2j](../user-feedback/questions/q-hc4y2j.md); option C was *after about 2
seconds of rest on a citation in the prose, start "Does it say that?" and stream its answer into the
citation card; each is a chat in Chat's list, one per work and paragraph, reused if you rest there
again*, recommended behind the Experimental switch first.

> C. Make it a main rather than experimental feature
>
> — Greg, 2026-10-24 (spya-r5hb87)

The brief that came with it keeps the question's cost controls (only when the card shows exactly
one work, only the reader's own articles, only after the rest, never twice for the same work and
paragraph, a daily cap per reader and overall) and asks this plan to say what a reader sees at a
cap, how touch and keyboard behave, and the cost per call **measured** on real works.

## What we build: option C, for every reader

### What the reader sees

```
 … as Vaswani et al. showed, attention alone suffices[12] …
                                 ▲ pointer rests
 ┌──────────────────────────────────────────────────┐
 │ Attention Is All You Need ↗                      │
 │ Vaswani et al. · 2017                            │
 │ The Transformer replaces recurrence with…        │  the abstract note, as now
 │ ─────────────────────────────────────────────── │
 │ 🔍 Does it say that?                  reading…   │  new: appears 2 s after the card opened
 │ Mostly. The paper's abstract and §3 say          │
 │ self-attention "dispensing with recurrence…"     │  the chat's answer, streamed, drawn as
 │ matches the translation results; it does not     │  Chat draws it, in a box that scrolls
 │ claim attention suffices for every task. ▍       │  past about 16 lines
 │                                 Continue in Chat │
 │ ─────────────────────────────────────────────── │
 │ cited in 4 paragraphs: 1 2 3 4                   │
 │ arxiv.org · …          Does it say that? 💬 Open │
 └──────────────────────────────────────────────────┘
```

- **When it starts.** The card has been open for **2 seconds**, and it shows **exactly one cited
  work**, opened from a **body paragraph that cites it** (`here` in `work.citedAt`), on the
  reader's **own** article, not in view-as. A mouse rests 320 ms before the card opens, so a cold
  hover starts at about 2.3 s; a warm swap from another mark at about 2.06 s. Nothing is asked for
  if the card closes or moves to another mark before then, so a pointer passing over buys nothing.
- **Keyboard.** Focus on a marked citation opens the card at once (as today); 2 s with it open
  starts the check. Tabbing on before then starts nothing.
- **Touch.** *(Superseded by C8 below: touch keeps the button only.)* A tap opens the card at once
  (as today); 2 s with it open would start the check.
- **Before the first word.** The section header shows what the chat is doing, from the stream's
  `tool` events (*reading the paper…*, *searching the web…*), so 10–20 s before text is not a blank.
- **Leaving.** Closing the card does not stop the chat: the server always finishes and saves a turn
  whose client went away (routes.ts `streamChat`, point 3), and the tab keeps reading the stream in a
  loader that lives outside the card. Coming back to the same citation shows the text so far, still
  streaming, or the finished answer. In a new tab or next week, the card finds the chat in the
  owner's chat summaries and shows its saved answer without spending anything; if that answer is
  still being written elsewhere, it says *still reading — the answer will be in Chat* and polls as
  Chat's own recovery does.
- **Continue in Chat** opens that thread in Chat (the same door *Ask in chat* uses to reopen an
  item's chat). The answer is a normal chat in Chat's list, titled from the work, labelled as
  started from a citation, and the reader can reply in it.
- **The *Does it say that?* button** keeps its place in the foot. If this work and paragraph already
  have a chat (from a rest or an earlier press), it opens that chat instead of starting a second; if
  not, it starts it as today, now carrying the same identity, so the next rest finds it. **A press is
  never capped** — it is the reader choosing to spend, as it is today.
- **At a cap**, the section says so in one line and nothing is spent:
  - the reader's own day: *You've had today's 25 automatic checks. Press Does it say that? to ask
    anyway.*
  - the reader's hour: *That's 10 automatic checks in the last hour. Press Does it say that? to ask
    anyway.*
  - everybody's day (the global fuse): *Automatic checks are paused for today. Press Does it say
    that? to ask anyway.*
  - two already running for this reader: nothing is drawn and nothing is sent; the next rest tries
    again (the tab keeps at most two of its own in flight, so this is a backstop).
- **A failure** (the model, the network) draws one line, *This check didn't finish. Continue in
  Chat to try again.*, because unlike the link card's note there is now a chat holding the error.
- **Not drawn at all**: a card naming two or more works (a phrase can cite several; we do not start
  several at once), the card on a reference entry (no "that" to check), a visitor, a public article,
  view-as, Marginalia's *Cites* card (mouse and keyboard only, and its `CiteCard` gets no slug; the
  button stays — a later step if wanted), and a chat answer's citation chips.

### Identity: one chat per work and paragraph

A new thread origin, **`cite-check`**: `{ mode: "cite-check", itemId: <work id>, blockId: <citing
block>, quote: <the work's title, cut> }`, on a `chat`-kind thread that is also anchored on that
block. Work ids survive Bibliography reruns (`types.ts`, the dedupe key), block ids are the stable
contract ([block-ids.md](../project/block-ids.md)), so the pair is a durable key.

Why a new mode rather than an existing one: the work's own *Ask in chat* is origin `bibliography`
keyed by the work id alone, so reusing it would make the paragraph check and the work's chat the
same thread to `reopenItemChat`; and an anchored chat with no origin (today's press) has no key at
all. The compiler finds every switch over origin modes (`sameOrigin`, `thread-origin.ts`,
`chat-title.ts`, `thread-source.ts`, the route's `parseOrigin`, the store, Sources).

- **Database**: an additive migration widening `chat_threads_origin_mode`, a shape check
  `chat_threads_origin_cite_check` (item id, block id and quote present, no lens), and a **partial
  unique index** on `(article_id, origin_item_id, origin_block_id) where origin_mode = 'cite-check'`
  so two tabs resting at once cannot buy two (the loser's `begin` maps to the 409 below). Deleting the
  chat frees the key; the next rest then starts a new one, which is the reader's choice.
- `sameOrigin`: same work id and same block id. The title snapshot is not compared.

### The server: the chat route, not a new one

`POST /api/chat/:slug` already creates a thread on its first send and streams its turn; the card
calls it exactly as Chat does (`runTurn`, `src/web/chat/effects.ts`). What changes, on a turn that
**creates** a `cite-check` thread, in this order, all before headers and before any spend:

1. The anchor is the origin's block (`anchor.blockId === origin.blockId`), else 400.
2. The owner's Bibliography is loaded and must be **fresh** (not stale against the current blocks),
   the work must exist, the block must be a current body block and in `work.citedAt`; else 409 with
   no spend. The card checks the same things, so this is a backstop for a stale tab.
3. An existing `cite-check` thread for that work and block → **409 `{ error, threadId }`**; the
   client opens or shows that thread instead.
4. **Only when the body says `auto: true`** (a rest, not a press): take an allowance from a new
   `RateBucket` **`cite-check`** (and its database CHECK), refusing with 429 (`rate`, the hour or the
   reader's day, said apart by a `reason` field) or 503 (`global`), each with the reader's sentence
   above. The slot is freed when the turn finishes, fails or the request ends, once
   (help-chat's `admitHelpChat` is the pattern). A press sends no `auto` and takes nothing.

The question is the one the press sends today (`askAboutBlock` around `askDoesItSayThat`), built on
the client; the model, tools and prompt are chat's, unchanged: **Opus 5.5 at high effort**, per
Greg's 2026-10-19 *"Default to Opus 5.5 for Chats"* (`ALWAYS_HIGH_POWER`), with `read_cited_work` and
`search_web`. The ledger records it as `chat`, attributed to the article, like any chat turn, so
nothing new is needed for cost tracking ([cost-tracking.md](../project/cost-tracking.md)).

**The caps** (`CITE_CHECK_RATE_POLICY`): 10 an hour and **25 a day per reader**, concurrency 2,
**150 a day across everybody**, lease the chat's own timeout plus a margin. What they bound is in
§ Cost, measured.

### The client

- **`src/web/cite-check.ts`**, a loader outside React keyed by `(slug, work id, block id)`, with
  states `looking | streaming {threadId, text, activity} | done {threadId, text} | capped {message} |
  failed` and a `useSyncExternalStore` hook. It is single-flight per key, allows at most two of its
  own in flight per tab, reads the stream with `runTurn`/`readEvents` (no third SSE reader), and on
  `begin` tells the reader's chat summaries about the new thread so Chat's list and the button's
  reuse see it at once (`owner.chatAnchors.add` / `handedItemChats`).
- **Finding an existing chat first**: `threadForOrigin(chatSummaries, origin)`; if found, its
  answer is read once from `GET /api/chat/:slug` (as `settledAnswer` does) and drawn, with no send.
- **`CiteCheckSection`**, mounted inside `CiteCard` only when eligible (single work, owner, `here`
  cites it, a slug and the senders present). Its effect starts the 2 s timer on mount and cancels it
  on unmount or a change of key; once fired, the loader carries on whatever the card does. The
  answer is drawn by Chat's `CitedMarkdown`, so passage chips and web links look as they do in Chat,
  in a box with a max height that scrolls.
- **ProseHoverCard** passes the slug, the article's blocks for the chips, `cited.length === 1`, and
  a `continueInChat(threadId)` sender. Reader wires the sender and changes `checkCitedWorkInChat` to
  reuse an existing `cite-check` thread and to send the origin.

### Cost, measured

[261024d](../investigations/261024d-does-it-say-that-cost-and-latency.md): nine real turns on seven
cited works across three local articles, through `converse` with the production tools, into the
ledger, 2026-10-24.

- **$0.17 median (range $0.07–$0.43), 21 s median to a finished answer (15–32 s).** The question's
  2p–10p was low: a turn is roughly **6p warm and 24p cold**.
- **Cold vs warm is nearly all of it.** The first chat on an article writes the 42–55k-token article
  to Opus's prompt cache ($0.22–0.28); later turns on the same article within the cache's life read
  it for under 2¢. Cold turns $0.27–0.43, warm $0.07–0.17. So a reader resting on several citations
  in one article pays the cold price once.
- **What the caps bound.** A reader at the 25-a-day cap on one article: one cold turn and 24 warm,
  about $2.20, worst case about $4 if spread over many articles. The global fuse of 150: about
  $15–25 a day typical, $45 at the very worst (all cold), against Dig deeper's $60 and Investigate's
  $50 fuses. The hour cap (10) is what stops a reader skimming one long reference-heavy article from
  spending the day's allowance in five minutes.
- **The paper was read for 3 of 7 works**; the others (paywalled, bot check, a book) were said
  plainly in the answer's first sentence, then answered from the abstract or a web search. Every
  answer was useful, and every one opened with a one-sentence verdict, which is what the card's box
  shows first.
- **The answers are long for a card** (311–403 words, with headings and lists): hence the scrolling
  box and Continue in Chat. The question is unchanged so a rest and a press make the same chat.
- **Two things found along the way, both chat-wide, both being root-caused separately** (stage 0b):
  no words reached the caller until the answer was essentially complete (all deltas within 0.1–2.6 s
  of the end), which would leave the card empty for 15–30 s and is against CLAUDE.md's streaming rule
  for Chat as much as for this; and a turn that uses every tool round drops the tool definitions on
  its last call, breaking the cached prefix ($0.26 on an otherwise warm turn). The card's activity
  line (*reading the paper…*) covers the wait whatever the streaming outcome.

**Stage 0b's answer** ([chat-tools.md § Still open](../project/chat-tools.md), probes in
`scripts/spikes/261024q-chat-stream-*`): the burst is **upstream, not ours**. Any round after a
`role: "tool"` result arrives at once at the end, on Opus and Sonnet, at high and low effort; a first
round streams over ~4 s. Our parser and `converse` pass every delta on as it comes. So every chat that
uses a tool, in Chat as in the card, shows its answer whole after the wait. For the card that means
the activity line carries the 15–30 s (*reading the paper…*, *searching the web…*, then *writing…*
once the last tool returns), and the answer then appears in one go, still drawn as a stream so it
streams for real the day upstream does. **Passed over**: running `read_cited_work` on the server
before the turn and putting the paper in the question, so the answer is a first round and streams.
It would make the card's chat a different shape from the press's and from Chat's, for a few seconds
of words appearing rather than arriving; worth revisiting if the wait reads badly in use.
The last-round cache break is real but its fix (`tool_choice: "none"` with the tools kept) came back
with an empty answer once on a question that needed a search, so it is written up there and left.

### Stages

0. **Measure** a real *Does it say that?* turn on five or six works, cold and warm, through the
   production code path, into the ledger: `docs/investigations/` (the brief's *"measured on a few
   real works"*). Done before the plan review, so the caps rest on it.
   **0b.** Root-cause the two chat-wide findings above in a subagent (streaming; the last tool
   round's cache break), fix what is ours red-first, postmortem if a bug.
1. **Server**: the origin mode end to end (types, parse, columns, title, labels, store, migration
   with the unique index), the route's checks and the `auto` allowance, the bucket. Tests red first:
   origin round trip; each refusal spends nothing; `auto` takes an allowance and a press does not;
   an existing thread is a 409 carrying its id; two concurrent creates make one thread; the CHECK
   refuses a malformed `cite-check` row.
2. **Client**: the loader, the section, the button's reuse, Continue in Chat. jsdom tests: nothing
   sent before 2 s or after an early close; nothing on a two-work card, a reference entry or for a
   visitor; the stream drawn with its activity line and caret; an unmount mid-stream keeps reading
   and a remount shows the text; an existing chat is drawn without a send; each cap's line; the
   press opens an existing chat. Then a browser check by a Sonnet subagent on a real article.
3. **Docs and bookkeeping**: [bibliography.md § Marked in the prose](../project/bibliography.md#marked-in-the-prose-in-every-mode),
   [chat-from-a-mode.md](../project/chat-from-a-mode.md) (a new origin), the Help page's Sources
   section, the question and the feedback note.

### Simpler options passed over

- **A fresh, unkeyed chat per rest** (today's press, fired by a timer). No migration, but every rest
  on the same citation would buy another Opus turn and add another thread to Chat's list, which is
  exactly what "never twice" rules out.
- **Keying by the anchor and the question text** instead of a new origin mode. No migration, but a
  key that is a convention over free text is the shape [sql.md](../project/sql.md) warns against,
  and it cannot carry a unique index.
- **A cheaper model for the automatic turn** (Sonnet). Roughly half the cost, but the thread then
  continues in Chat on Opus with a first answer from a different model, against Greg's chat default;
  the caps bound the spend instead. Greg's to change if the measured cost is too high.
- **A separate route** for the card. The chat route already creates, streams, finishes after a
  disconnect, records cost and titles the thread; a second route would be a second copy of all of
  that.

## After GPT Sol's review of option C (2026-10-24)

The review is [261024m-c-plan-review-sol.md](261024m-c-plan-review-sol.md) (prompt beside it): no
P0, eight P1s. **This section overrides the spec above where they differ**; it is the build brief.

- **C1, dedupe is transactional and a lost race refunds.** The route checks for an existing
  `cite-check` thread before anything (cheap 409 with its id). Then the allowance. Then `begin`
  re-checks the identity **inside the article-row transaction** (`pg-chat.ts`) and returns a typed
  conflict carrying the existing thread id; the partial unique index stays as the backstop, its named
  constraint translated to the same conflict, never a 500. A refusal after the allowance and before
  the model starts **refunds** the fill (a new `cancel` on the allowance store, deleting that row).
  The race test proves one thread, one model call, one counted fill.
- **C2, `runTurn` learns refusals with details.** `TurnSink.refused` receives the status and the
  validated details (`threadId`, `reason`); 409, 429 and 503 on a cite-check send are refusals, not
  failures. Chat's existing callers keep working.
- **C3, the loader forgets on a reader change.** `forgetOnReaderChange` (src/web/lib/reader-change.ts)
  clears every entry, and a generation fence makes callbacks from a previous reader's stream inert.
  An A→B account switch mid-stream is a test.
- **C4, the server builds the question.** `askDoesItSayThat` and the block wrapping move to shared
  code; on a creating `cite-check` turn the server computes the question from the current block and
  the Bibliography work and refuses (409, stale) a client question that differs. `auto` must be
  absent or literally `true`, and only on that first turn. The allowance is an accidental-spend guard
  for the reader's own hover, not an abuse boundary: a signed-in reader is trusted and chat turns are
  uncapped (security-map.md), which this does not change.
- **C5, what the card shows, and edits.** The card shows the thread's **first assistant answer**. The
  loader keeps state only while a stream of its own is in flight; otherwise it reads the thread from
  the server (the full `GET /api/chat/:slug`, finding the thread and its first answer) and refetches
  when the summary's `updatedAt` moves, after a retry, or on a missing thread. **Editing the first
  question of a `cite-check` thread is refused** (409): the identity is that question. Retry is fine;
  delete-from already refuses the first question; a full delete frees the key and the loader drops
  the entry when the summaries no longer have it.
- **C6, the caps, with the arithmetic corrected.** Measured: cold median $0.30, max $0.43; warm
  median $0.08. Caps lowered to **8 an hour, 20 a day per reader, 100 a day across everybody**,
  concurrency 2. Worst case, every turn cold at the observed maximum: **$8.60 a reader-day, $43 a
  day overall** (Dig deeper's fuse is $60, Investigate's $50). Typical: one cold turn per article
  then warm ones while the cache lives (warmth was measured four minutes apart, not all day), so a
  reader at the cap on two articles is about $2. Greg's to move.
- **C7, the stream that arrives whole: proceed, and tell Greg** (Opus arbitrated). Sol wanted a
  go/no-go gate and the choice back to Greg. Opus: proceed; Greg chose C knowing it took 15–60 s,
  and what differs is only how the wait looks. The section draws *Reading…* at once, then the tool
  activity, and the answer as a stream so it streams the day upstream does. A test asserts our own
  first-round path delivers deltas before completion. Opus also asked to try the pre-read (server
  runs `read_cited_work` before the turn) inside this work; **not done, my call**: stage 0b's control
  probe already shows a first round streams, so a spike would prove nothing new, while building it
  means a second shape of this chat (paper text injected by the server, which the follow-up turns
  would not see the same way), and in 4 of 7 measured works the paper could not be read and the
  model searched the web, a tool round, so it would burst anyway. Left as the first follow-up if the
  wait reads badly, and said so to Greg.
- **C8, touch keeps the button only** (Opus agreed). Greg's words are *hover over a source*; a tap
  is a request to see the card, and with this on for every reader, tap-and-wait would have strangers
  on phones spending by reading a card. Automatic start is for a mouse resting and keyboard focus on
  a linked citation; on touch the card and its *Does it say that?* button are as today (the press
  now reuses the same chat). The sentence above calling tap-and-wait the question's reading of
  "rest" was wrong: the question never mentioned touch. A one-line change if Greg wants it.
- **C9, wording.** Keyboard: a citation inside a link is a tab stop and gets the check; a bare
  `mark.cite` is not focusable, and no new tab stop is added. The section shows *Reading…* the moment
  it starts, before any tool event. The server **continues after an ordinary disconnect and normally
  stores a terminal result**; process loss leaves the orphan sweep to mark it, and the card then
  shows the failure line.
- **C10, the refusal reasons and the release.** `AllowanceTaken`'s `rate` refusal says `hour` or
  `day`, so the two sentences can differ. The concurrency lease is released in the turn's terminal
  `finally` on the server, after the model and the store, never on the socket closing. The
  existing-thread check runs before the freshness check, so a saved chat stays reopenable when the
  Bibliography has gone stale.
- **C11, the identity's guarantee, stated honestly**: one chat per *inherited* work id and stable
  block id. A rerun that re-mints a work's id (ambiguity, an identifier change) can spend once more
  for what the reader sees as the same work; accepted, since reruns are rare and the cap bounds it.
- **And the press goes through the loader too**, so a press during the 2 s cancels the timer and an
  in-flight automatic start is adopted rather than raced. The loader exposes the thread id; Reader
  refreshes the summaries after `begin` and after settlement rather than the module touching
  Reader's `handedItemChats`.

## What landed (2026-10-24)

- **Stage 0**: the plan, the measurement ([261024d](../investigations/261024d-does-it-say-that-cost-and-latency.md)),
  the streaming and cache probes, Sol's plan review (`65ed71315`).
- **Stage 1, server** (`339091370`, Sol's fixes S1–S4 `f33fc3986`): the `cite-check` origin, the
  route's checks, the server-built question in `src/chat-question.ts`, the `cite-check` allowance
  (`src/cite-check.ts`, 8/h, 20/day, 100/day overall, 2 at once) with refunds, the edit refusal;
  migration `20261024155534_cite_check_origin` (regenerated on top of the quiz origin's after the
  merge with dev, `df9d23620`).
- **Stage 2, client** (`ebbf69930`, Sol's fixes T1–T7 `f33f44e8a`): the loader
  (`src/web/cite-check.ts`), `CiteCheckSection` in the card, the press through the loader, `runTurn`'s
  refusal details, `byTouch` and the card's engaged state in `useHoverCard`. T3 changed Chat's
  controller to gate navigation callbacks on attachment rather than clear them on detach (StrictMode);
  round 2 checked that a real remount gets a new controller, so nothing stale can fire.
- **Stage 3, docs** (`ca8969aab`): bibliography.md, chat-from-a-mode.md, the Help page.
- **Round 2** (narrow: the stage-2 fixes, the merge, the regenerated migration): no findings.
- **Browser check** (Sonnet, Playwright on the box, `scaling-hypothesis`, two real checks): all six
  checks pass: section after ~2.5 s, answer ~15 s after the rest in a scrolling box, Continue in
  Chat opens the titled thread, a pass-over starts nothing, a re-rest shows the saved answer with no
  send, closing mid-wait loses nothing, the press opens the same chat, a tap starts nothing. No
  console errors. The card with an answer is about 795 px tall at 1300×900, which fits.
- **Left, not done**: Sol's T8 (a refusal carries no exact retry time, so a kept cap line can stay a
  little longer than needed); Sol's S5 from stage 1, an older Chat bug (*Answer again* on a first
  send that failed before `begin` retries a thread that does not exist), outside this work; the
  pre-read that would make the card's answer stream (C7, above); Marginalia's *Cites* card.

## History: the quick note (planned, reviewed by GPT Sol, not built)

Everything from here to § Then: nothing built is the first plan and its review, kept for the
reasoning. Its single-work rule, dwell, freshness checks and caps carried into option C above; its
model call, table and cache did not.

## What is already there

- **A link already does this.** Hover a hyperlink in the prose and, once the server has fetched the
  page, the card streams *in relation to what you're reading*: what is on the other end and how it
  stands to the paragraph the link sits in (`/api/link-summary`, [links.md § And what it has to do
  with the piece in your hands](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands)).
  Quick tier (GPT Luna), measured at **$0.00015 a call**, cached per reader, article, address and
  paragraph for a fortnight, capped at 30 fills an hour, 100 a day per reader and 1,000 a day across
  everybody. The "or a link" half of the report is therefore already met, with two known gaps
  (an article already on the shelf, a page we could not fetch), both left as they are here.
- **A citation does not.** The card on a cited work (`CiteCard` in
  [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)) shows the title, authors, the article's
  own entry, the stored *note from the abstract* where there is one, and the jumps to each citing
  paragraph, plus three presses: *Ask in chat*, *Does it say that?* and *Open in Sources*. All of
  that is stored, nothing is written on hover, and anything deeper is a press that leaves the card
  for Chat ([bibliography.md § Marked in the prose](../project/bibliography.md#marked-in-the-prose-in-every-mode)).

So the gap the report names is the citation card: hover, and something deeper arrives without a
press and without leaving.

## What we build (the simplest version, without waiting for Greg)

**The citation card gets the link card's section, for a cited work.** When the owner rests on a
citation in a paragraph that cites the work, and stays for a moment, a short note streams into the
card under a label like the link card's, *in relation to this paragraph*:

```
┌──────────────────────────────────────────────┐
│ Attention Is All You Need ↗                  │
│ Vaswani et al. · 2017                        │
│ The Transformer replaces recurrence with…    │  ← the stored abstract note (as now)
│   From the abstract · arXiv                  │
│ ✦ in relation to this paragraph              │  ← new, streamed
│ Cited here as the source of the claim that   │
│ self-attention alone suffices for…; the      │
│ abstract's "dispensing with recurrence…"     │
│ bears that out. ▍                            │
│ cited in 4 paragraphs: 1 2 3 4               │
│ arxiv.org · …     Does it say that? 💬 Open  │
└──────────────────────────────────────────────┘
```

What the note says, and what it may rest on:

- **The role the work plays in this paragraph**, said specifically: the source of a claim, a method
  or dataset borrowed, an example, a contrast, a position argued against, background. That is about
  *the article*, so it does not breach Greg's 2026-10-03 rule for this mode, *"err on the side of
  saying … nothing about a paper beyond what's available in the bibliography"*.
- **Whether what we hold of the work bears the paragraph out**, only from what was fetched from a
  public catalogue and checked: the stored abstract note's sentences and the abstract quotes code
  found for them. Where we hold nothing of the work beyond the article's own entry, it says the role
  and stops. The prompt forbids the model's memory of the work outright, as the abstract notes'
  prompt does.
- **The link card's test**, adapted: if what you wrote would be just as true for any paragraph that
  cites this work, it is the wrong answer.
- Plain prose, under about seventy words, no markdown. Article text and the entry are fenced as data
  (they come from the web, [security-map.md](../project/security-map.md)); **no tools on the call**.

**The trigger, and why it is cheap enough to fire on hover:**

- **Owner only, and only on a card opened from a body paragraph that cites the work** (`here` is in
  `work.citedAt`, the condition *Does it say that?* already uses). Not on the reference entry, not
  for a visitor, not in a chat answer.
- **A dwell.** The card opens after 320 ms (`HOVER_DELAY.open`). The note is asked for only once the
  card has been open a further **600 ms**, so a pointer crossing a paragraph on its way somewhere
  else buys nothing. A tab already holding the answer shows it at once.
- **Cached on the server per reader, article, work and paragraph**, for a fortnight, and checked
  against fingerprints of everything the prompt carried (the work's entry and note, the paragraph
  and the article's gist, the reader's profile, the prompt version and the model). A second hover,
  in any tab or next week, costs nothing. A tab cache in front of it, fenced and emptied on a profile
  save, as the link card's is.
- **Its own bucket in the limiter**, `cite-note-fill`, with the link card's numbers: 30 fills an hour,
  100 a day per reader, concurrency 2, a global daily fuse of 1,000. Quick tier, low effort, the same
  model as the link card.
- **Cost**: the prompt is smaller than the link card's (a paragraph, an entry and two sentences, no
  page), so about $0.0001 a fill. An article with 40 cited works, each hovered once in each of two
  paragraphs, is under a penny; the daily fuse bounds a runaway at about 10p a day.
- **A failure draws nothing**: no spinner before the first word, no error line. The card is complete
  without it, which is the link card's rule (`LinkRelation`).

**What it does not do: start a chat.** No thread is created. *Ask in chat* stays the press for the
real deeper dive. Whether a hover should start one is the question below.

## The question for Greg

**Should resting on a source also start a real Ask in chat, streamed into the card?**

- **A — the quick note only (built, recommended).** Under a penny an article, an answer in one to
  three seconds, nothing written into Chat. Shallower: no web search and no reading of the paper.
- **B — also start the real chat after a longer rest (say two seconds), streamed into the card.**
  The full chat model with web search and `read_cited_work`: roughly 2p–10p and 15–60 seconds each,
  and every one becomes a chat thread in Chat's list, so a skim through ten citations leaves ten
  threads. Deeper, and nothing to press.
- **C — A now, and *Ask in chat* answers inside the card** rather than taking the reader to Chat.
  Keeps the press (so the spend is chosen), gives the "without being taken somewhere else" half.

Recommended: A, with C as the next step if the press-and-leave is the part that grates. B spends
real money on accidental hovers and fills Chat with threads nobody asked for.

## Stages

### Stage 1 — the server: `GET /api/cite-note?slug=&work=&block=`, streamed

- `src/cite-note.ts`, shaped on [`src/link-summary.ts`](../../src/link-summary.ts): the prompt
  (`CITE_NOTE_PROMPT_VERSION = 1`), a pure `citeNoteRequest`, the streamed call, and
  `citeNoteStream` with link-summary's order of steps: refuse what is malformed; load the owner's
  article (route, before headers); load the owner's Bibliography and find the work by id; refuse a
  block not in its `citedAt`; read the cache (a hit ends there); claim; take an allowance; call;
  fenced fill. Events: the `LinkSummaryEvent` shape (`delta`, then one of `ready`, `unavailable`,
  `refused`, `pending`), under a name of its own.
- A table `cite_notes`, keyed `(owner_id, article_id, work_id, block_id)`, with link_summaries'
  status/claim/fingerprint/expiry columns, its shape check and expiry index, and its store
  `pg-cite-notes.ts` following `LinkSummaryStore` (the contract's comment says the claim protocol is
  copied deliberately rather than made generic; the plan review may argue otherwise). An additive
  migration. The expired-row sweep, wherever link_summaries' runs, takes this table too.
- Registered everywhere an article-owned table is, beside `link_summaries`:
  `src/store/article-rows.ts`, `src/store/pg-article-transfer.ts` (reader-state),
  `src/admin-articles.ts`, `scripts/never-published-tidy.ts`.
- Registered everywhere a job is: `models.ts` (`cite-note`, quick tier, its env override), the AI
  route and `CHAT_REASONING` (`low`) in `ai-call.ts`, `cost-categories.ts`, the limiter's bucket.
- Tests: the request body (no tools, `max_completion_tokens`), refusals (unknown work, block not
  citing it, a visitor), cache hit spends nothing, the fingerprint test, a red first for each.

### Stage 2 — the card

- A small client loader for the note (tab cache, partial text while streaming, single-flight,
  generation fence, emptied by the same profile save that empties link summaries), reusing the
  stream reader the link card uses rather than a third copy if it can be shared.
- `CiteCard` gets the section, drawn by the same component as the link card's (`LinkRelation`
  generalised to take its label), under the abstract note. Asked for after the 600 ms dwell, only
  for the owner and only when `here` cites the work. Marginalia's card reuses `CiteCard`, so it
  gets it too.
- Tests in jsdom: no request before the dwell, none on a reference entry or for a visitor, the
  stream drawn with its caret, nothing drawn on a failure.
- A browser check by a Sonnet subagent on a real article with citations.

### Stage 3 — docs, the question, the note

- [bibliography.md § Marked in the prose](../project/bibliography.md#marked-in-the-prose-in-every-mode)
  gets the section; [links.md](../project/links.md) a line pointing at it as the citation twin; the
  reader's help page for Sources a sentence.
- The question file (above), published; the feedback note, `ending: awaiting` with a comment saying
  what shipped.

## Simpler options passed over

- **No server cache, the tab's only.** Fewer parts, but every new session pays again for the same
  paragraph, and the report's own brief names caching per source.
- **Reuse `link_summaries` with a made-up target such as `cite:<id>`.** No migration and no new
  store, but a key that means two things by convention is the shape [sql.md](../project/sql.md)
  warns against ("keys over good intentions").
- **Show the stored `why` on every card instead of a model call.** Free, but it is one sentence for
  the whole article, not this paragraph, and it is hidden today unless a verdict checked it, for a
  reason (`showsWhy`).

## After GPT Sol's plan review (2026-10-24)

The review is [261024m-plan-review-sol.md](261024m-plan-review-sol.md) (prompt beside it). No P0;
every finding taken. What changes above:

- **F1: evidence or nothing.** No note on a work without a checked abstract note (`work.blurb`): the
  route answers `unavailable` before it claims or spends, and the card draws nothing. A
  paragraph-only role sentence is the stored `why` again, which is hidden on purpose, and links.md's
  "same failure in a better costume". The note must rest on both the paragraph and the supplied
  sentences and quotes, and speak narrowly ("the abstract excerpt we hold says…", "does not
  establish…"). `webNote` as a second evidence source is a later extension, not v1.
- **F2: one work only.** The note runs only when the open card holds exactly one cited work (a prose
  mark can name several; so can a Marginalia *Cites* line). Tested both ways.
- **F3: fingerprints over exact strings.** Two pure, capped context strings (article + passage;
  work + evidence) are what the prompt carries and what is hashed, plus profile hash, prompt version,
  model. No completed-answer tab cache keyed on `(slug, work, block)` alone: the client keeps only
  in-flight dedupe and lets the server cache answer (a hit is ~90 ms).
- **F4: freshness.** The route refuses unless: owner, not view-as (left off the allowlist, and the
  client's `viewAsNonce()` guard), a **non-stale** Bibliography, a known work, the block a current
  body block of the article, and in `work.citedAt`.
- **F5: everything external is fenced and defused** (title, authors, entry, note sentences, quotes,
  article text), the rule repeated after the fence, no tools, React text only, no full work URL,
  `plainWords("explain")`.
- **F6: the question re-cut** — the real full-chat action to compare against is *Does it say that?*
  (a fresh passage chat that reads the paper), not the work's *Ask in chat*; and "answer inside the
  card" is a second, separate question.
- **F7: the timer lives in a loader mounted only inside an open, eligible, single-work card**:
  920 ms on a cold mouse hover, 660 ms on a warm swap, 600 ms after focus or a tap. Marginalia
  (mouse and keyboard only, its tooltip skips touch) needs the slug plumbed in.
- **F8: a small eval** before calling it done, through the production request function:
  strong/weak evidence, contrast roles, insufficient excerpt, adversarial text; time, tokens, cost.
  Under `docs/investigations/`.
- **F9: own store, own advisory-lock namespace, own bounded sweep** on its own cold-fill path, not
  link-summary's. Own `RateBucket` member and database bucket CHECK.
- **F10:** reuse `readEvents` from `web/lib/sse.ts`; the loader is its own small state machine.

## Then: nothing built, Greg asked first (2026-10-24)

**Measured, read-only, on production**: of 790 cited works across the 72 articles with a stored
`citation_blurbs`, **86 (11%) have a checked abstract note**; 698 have no evidence (mostly no
abstract or no identifier), 4 failed the check, 2 were declined. The article the report was filed
from has one cited work, with no abstract note.

So the v1 above, after Sol's F1 (evidence or nothing), would appear on about one cited work in
nine, and never on Greg's own article. Every version that would reach most works spends on fetching
evidence on a hover (the web-note search, or *Does it say that?*), which reverses Greg's explicit
choice on [q-ny49p3](../user-feedback/questions/q-ny49p3.md), 1B: the web search runs on a press
for the clicked work only, never for every work.

Opus, asked to arbitrate between building the evidence-only v1 now, building something smaller, or
asking first, chose asking first: about a thousand lines of permanent surface for a feature mostly
invisible, and the one decision that makes it worth building is a cost choice that is Greg's. Taken.
The plan and both sections above stay as the build spec for whichever option he picks; the dwell,
cache, cap, single-work and freshness rules carry over to each.

The question is [q-hc4y2j](../user-feedback/questions/q-hc4y2j.md).
