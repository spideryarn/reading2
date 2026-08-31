# Comments — the reader's mark on a passage

Select a sentence and it is **yours**: bookmarked, with a note on it if you want one, and an
answer from the model only if you ask for one. Saving costs nothing.

> **Reopened, and turned around, 2026-08-28.** For three days this file described a feature that was
> closed: selecting a sentence bought an explanation until 2026-08-26, then opened a chat, and there
> was no way to make a new comment at all. Greg:
>
> *"someone might want to simply add bookmarks or comments to the text, without wanting an AI
> response … you can select some text, and that bookmarks it. You can optionally add a comment. And
> you can request (when you do so) whether you want an AI response (in which case it kicks off a
> Chat)."*
>
> So a comment is now the **free** thing and the model is a tick-box.
> [260828a-comments-and-bookmarks.md](../plans/260828a-comments-and-bookmarks.md) is the plan, and its GPT Sol
> review is beside it.
>
> **Read the rest of this file with that in mind.** Everything it says about *anchoring*,
> *streaming*, *reading order*, `?note=` and the failure modes is unchanged and still true. What
> has changed is what a selection creates, and what a comment is allowed to hold.

## What a comment is now

Three independent properties, and a comment may have any combination of them:

```
   the mark      always. blockId + quote + start, onto the permanent id spine.
   the words     optional — `body`. Nothing written is a bare bookmark.
   the answer    only on one made before 2026-08-28, or on a chat it started.
```

`status` says **how the model call went, and nothing else**. Every comment made from 2026-08-28
carries `none`: no call was ever attempted. That is also what keeps a bookmark invisible to
`sweepOrphaned`, which turns an abandoned `pending` row into an error — a bookmark is not an answer
that never arrived, and the sweep needed no change at all to leave it alone.

### The four operations, and why there are four

There used to be one writer, `create`, which meant both *make this* and *redo this*. That was safe
only while making one cost a model call, so a colliding id could only ever be a retry. **Once a
comment is free, a collision is an ordinary event** — and a reset would silently overwrite the
anchor and blank the answer of a comment made in another tab. GPT Sol found this reviewing the
plan; it is the reason the store contract now names who may write what.

| operation | writes | refuses |
|---|---|---|
| `create` | the anchor, `body`, `status: "none"` | a stored id whose anchor or body differs — **409**, never an overwrite |
| `beginAnswer` | the answer fields only | anything not `done` or `error` — a bookmark was never a question, and a `pending` row already has an answer coming |
| `patchBody` | `body`, `updatedAt` | — |
| `linkThread` | `threadId`, once, from absent | a second conversation, a comment that is not free, or one about a different passage |

`beginAnswer` takes an id and *nothing else*: it reads the stored passage rather than accepting one,
so a retry cannot quietly move a comment to different words. **It claims a terminal row**, and that
is stricter than it first looks: the first version excluded only bookmarks, which meant a row
already `pending` passed the check, so two presses of *Try again* both succeeded and bought two
model calls. An abandoned `pending` becomes `error` through `sweepOrphaned` and can be retried then
— which is what that sweep is for.

The legacy answer patch is `AnswerPatch`, six fields wide, not `Partial<Comment>`. A generic patch
was what let the one remaining writer reach the anchor and the reader's words.

### Asking the model, and the link back

Ticking **Also ask the AI about it** saves the comment *first* — free, and on disk — and then opens
the anchored chat that [260826ab-chat-as-gateway.md](../plans/260826ab-chat-as-gateway.md) built, pre-filled with
whatever was written. If the chat call fails, the reader still has their words.

The link between the two is written **on the server**, from inside the chat stream, because that is
the only place a real thread id exists: the browser mints an optimistic one and only hears about an
overrule when there is one, so a link written in the client is a race it cannot see it has lost.
The chat request carries `sourceCommentId`; the route calls `linkThread` once the thread is real,
**with the passage** — because that id comes off a request and on its own names any comment this
reader owns on this article, so a stale one from another tab would attach the conversation to an
unrelated mark. The browser then patches its own copy locally (`noteThread`), so the mark and the
dialog are right before the next reload rather than after it.

`threadId` is **advisory and has no foreign key**, which reverses the reflex this schema follows
everywhere else. A deleted conversation leaves a comment that is still the reader's mark, so
whoever offers "Open the conversation this started" checks the summary list rather than trusting
the stored id. The full reasoning — including that a constraint Postgres can keep and the
filesystem store cannot is exactly what `tests/store-parity.test.ts` exists to catch — is in the
plan.

### A click on a doubly-marked passage opens the comment

A comment made with *Save & ask* has a `cmt` mark and a `chat` mark over identical words.
`annotateHtml` merges them into one `<mark class="cmt chat">`, and until 2026-08-28 chat won the
click. That rule was right when comments were closed and an overlap was always an older
explanation under a living conversation — but **every Save & ask now creates the overlap on
purpose**, so it would hide the reader's own note behind the chat it started, every time.

So the comment wins when the comment's `threadId` names that chat. An overlap with an *unrelated*
conversation keeps the old preference. See `MarkKind` in [`annotate.ts`](../../src/web/annotate.ts).

## Intent

Greg, 2026-08-25:

> If I use the mouse to select some text in the VERBATIM-TEXT column, it should:
>
> - Create a persistent UI artifact in the doc for that selection, indicating that there is an
>   explanatory comment there
> - Add an element in the new rightmost column, initially showing a loading spinner
> - Call an LLM with a prompt to try and explain what that sentence means (given the whole text of
>   the article, and after doing some web research)
> - Fill in the rightmost column entry when we have a response from the LLM.

Three of the four decisions below were settled by him the same day; the fourth reversed the "new
rightmost column" in that brief.

### Decision: a dialog, not a column <a id="decision-a-dialog-not-a-column"></a>

Asked whether a fourth column would complicate the UI:

> Perhaps we shouldn't add it as a column of its own. I don't know. Will it complicate the UI
> substantially, do you think? Perhaps for now let's have them show up as a dialog box to avoid
> screwing up the existing UI, until we come up with a better plan.

It would have. A real column has to enter [`layout.ts`](../../src/web/layout.ts)'s shrink-then-drop
arithmetic ([granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)),
take `pin-right` off the prose, and thread through the `rowSpan` geometry in
[`TableView.tsx`](../../src/web/TableView.tsx) — and a comment belongs to a *span of a paragraph*,
not to a row, so a table cell is the wrong shape for it anyway. The dialog
([`CommentDialog.tsx`](../../src/web/CommentDialog.tsx)) touches none of that: **nothing in
`fitView` changed for this feature.**

The cost is that only one answer is visible at a time, and there is no way to see every comment on
the article at once. Marginal cards or a column remain the better long-term answer — this is
explicitly "until we come up with a better plan".

### The two questions a selection raises <a id="the-two-questions"></a>

**A selection is ambiguous about what is being asked, and for a long time the prompt only heard one
reading of it.** Greg, 2026-08-26, having selected the name *Ben Miller* in the acknowledgements line
of *Writes and Write-Nots* and been told that it is an acknowledgements line:

> I asked for more context on this person, Ben Miller, and I basically got an immediate response
> like, oh, it's a person that's been acknowledged. Like, yeah, I get that. But I mean, it'd be much
> more interesting if you'd done some web searching to try and figure out who Ben Miller is.

The model did not decline to search. It was never asked a question whose answer it lacked: it was
sure what an acknowledgements line is, and it was right. So the encouragement below could not fire,
and turning it up would have changed nothing.

The fix came from [glossary.md](glossary.md), which had solved this on *the same article* — an entry
there says two things, not one:

- **what the author means here**, from the article and only the article;
- **what the reader has to bring to it** — who this person is, what this work is — from the model's
  own knowledge, labelled as such.

Explain had the first half only, so it gave the first kind of answer to a question of the second
kind. [`src/glossary.ts`](../../src/glossary.ts)'s own worked example names the failure, and
[`src/explain.ts`](../../src/explain.ts) now borrows the sentence: **that describes the page the
reader is looking at, and it is the whole failure.**

Three rules carry it:

- **A short selection is almost always the second question.** "Somebody who selects two words is not
  asking what the sentence around them does. They are asking who or what that is."
- **The search trigger is about the selection, not the model's confidence** — because confidence was
  the thing that failed. A named person it cannot place *with at least one concrete, checkable fact*
  means search. "A category is not a fact."
- **Outside knowledge is labelled in the sentence** — "Although the article doesn't say so…", "As
  you may know…". Borrowed outright from
  [original-version/glossary.md](original-version/glossary.md#the-prompt-which-is-the-best-written-one-over-there),
  which had recommended it for this exact file and never had it moved across.

> [!NOTE]
> **Measured, not assumed.** Selecting `Ben Miller` went from 0 searches and a description of the
> line, to one search and *"Ben Miller, by contrast, isn't a public figure in the same way"*.
> Selecting `Robert Morris` in the same sentence runs **no** searches and still answers properly —
> which is the result that says this is a fix rather than a bigger hammer. Full before/after in
> [260826l-explain-deeper-answers.md](../plans/260826l-explain-deeper-answers.md#measured-not-assumed).

### Decision: the model decides whether to search <a id="decision-web-research"></a>

Asked how much web research the explain call should do:

> Only when the model asks for it, but encourage the model to ask for it unless it's very sure

That is OpenRouter's **server tool** — `tools: [{ type: "openrouter:web_search" }]` — which hands
the model a search tool and lets it choose. The encouragement is a paragraph of the system prompt in
[`src/explain.ts`](../../src/explain.ts); the choice stays with the model.

The count reports what it actually did, and the dialog prints it — "3 web searches" or "no web
search needed". A claim about research that nobody can check is worth nothing.

> [!WARNING]
> **Prefer the server tool over the `plugins` form — but be precise about why.** This was written
> first as `plugins: [{ id: "web", engine: "native" }]`. The *plain* `plugins: [{ id: "web" }]` form
> genuinely does run exactly one search per request whatever the model wanted, and would have broken
> the decision above outright. `engine: "native"` is the documented exception — OpenRouter's docs
> say it "gives the model control over when and how often to search, rather than always running once
> per request" — and live calls on 2026-08-25 bore that out: nine stored comments came back with a
> real mix of search counts, four of them **0**. So the earlier form was honouring the decision, and
> an account of this that says otherwise is wrong about which form was in the file. The server tool
> is still the better spelling: it is the shape OpenRouter documents for model-invoked search, and it
> does not depend on one engine value keeping a special meaning.
>
> **The field name is `usage.server_tool_use_details.web_search_requests`.** OpenRouter's own docs
> say `server_tool_use`; the live API sends `server_tool_use_details`. A cross-model review
> confidently cited the docs, and following it would have made the count permanently `0` — with a
> passing test asserting it, because the test mocked the response shape the docs described. Only
> printing a real `usage` object settled it. [`src/explain.ts`](../../src/explain.ts) now reads
> both names, and `tests/explain.test.ts` pins both. This is
> [silent-success.md](../reusable/silent-success.md) twice over: the check you would naturally run
> shares its assumption with the code.

### Decision: comments persist on disk <a id="decision-persistence"></a>

They survive reload, back/forward and a pasted link, in the `reader.json`-shaped slot
[architecture.md § Storage](architecture.md#storage) already reserves — as
`data/<slug>/comments.json`. Written under `data/` even when the article itself came from the
committed [`example/`](../../example/README.md) fixture: the fixture is shared, a reader's questions
are not, and `data/` is gitignored. `loadArticle` requires *both* `blocks.json` and `tree.json`
before it accepts a directory ([`src/api.ts`](../../src/api.ts)), so a lone `comments.json` cannot
make an empty `data/<slug>/` shadow the fixture.

## Several at once <a id="several-at-once"></a>

Greg, 2026-08-25:

> improve the UI so it's possible to kick off multiple selection-searches at the same time (and
> navigate between them somehow, e.g. with next/prev arrows)

Concurrency itself was never the obstacle — each POST is independent, `explain` runs *outside* the
write mutex in [`src/comments.ts`](../../src/comments.ts), and the client never awaits one ask before
allowing another. What was missing was any way to keep track. Three things fix that:

- **Prev/next in the panel header**, with a `3 / 9` counter. The panel shows one comment, so this is
  how you get back to the ones you are not looking at.
- **"2 still working"** in the footer whenever other questions are in flight. Firing one and reading
  on is the whole point, so the panel has to be able to say that work is happening out of sight.
- **The panel steps aside while you drag.** It is pinned bottom-right, over the prose — which is
  exactly where the next sentence you want to ask about is. On a pointerdown that *starts* in the
  prose it drops to 10% opacity and stops taking pointer events; on pointerup it comes back. Only
  for drags that start in the prose, so pressing one of its own buttons doesn't make it vanish under
  your finger.

### Reading order, not ask order <a id="reading-order"></a>

The arrows walk you **down the article**, not back through your own afternoon —
[`comment-nav.ts`](../../src/web/comment-nav.ts), tested in
[`tests/comment-nav.test.ts`](../../tests/comment-nav.test.ts). Ties inside a block break by offset,
then by `createdAt`, so two comments on the same paragraph keep a stable order and the counter
doesn't flicker between renders.

> [!WARNING]
> Document order comes from the **index in `blocks.json`**, never from the id string. Ids are random
> ([block-ids.md](block-ids.md#why-random-and-not-sequential)), so `a.blockId < b.blockId` compiles,
> runs, returns a plausible order, and is meaningless. There is a test that fails on exactly that
> substitution.

The arrows **stop at the ends rather than wrapping**. A live arrow that goes nowhere reads as "there
is more this way" when there isn't, and wrapping from the last comment would fling the reader back to
the top of the article — a big move to get from a small button.

Stepping **scrolls only if the passage isn't already on screen** (`isBlockOnScreen` in
[`scroll.ts`](../../src/web/scroll.ts)). Two comments in one paragraph is the common case, and
jolting the page between them costs the reader their place for nothing. Like
[keynav.ts](keyboard.md), it writes no position state of its own: it scrolls, and the listener in
`useReadingPosition` notices and updates `?at=`.

Deleting steps to the neighbour instead of closing the panel — deleting one of nine is a tidy-up, not
a reason to lose your place.

### A pasted `?note=` brings its own passage into view <a id="note-arrival"></a>

Stepping was always fine, because stepping has the comment in hand. **Arriving was not.** A link that
comes in from outside — `/read/<slug>?note=<id>` — has only an id, and until 2026-08-26 nothing
connected it to the article: the dialog opened, and the paragraph it was explaining could be anywhere.
That is the ordinary shape of a link you *send someone*, because the `?at=` that would have saved it
is only in the URL if the sender had scrolled. It was found while building the metadata page and left
open there ([260825e-metadata-page.md](../plans/260825e-metadata-page.md)); it is fixed now.

The rule when a URL carries both: **the note wins.** `?at=` is written by scrolling and says where the
sender's eye happened to be; `?note=` is only in a URL because somebody opened a dialog. The argument
in full, and what happens when the two agree, is in
[url-state.md § When `?note=` and `?at=` disagree](url-state.md#when-note-and-at-disagree-the-note-wins).

Two things about it are worth knowing before you touch it, and both come from the anchor being a
comment rather than a block:

- **It waits for the fetch.** The link carries a comment id; the block it is anchored to arrives over
  the wire with the comments. So the jump happens when they land, not when the URL is read — and
  until then it deliberately does nothing, leaving the page where `?at=` put it.
- **It fires once**, for the note the page opened with. After that, moving between comments is
  `goToComment`'s, which holds still when the next passage is already on screen. Two things moving
  the page is two things that have to agree.

It reuses `scrollToBlock` and its glide (`scroll.ts`) rather than adding a second way to move the
page, and it is smooth rather than instant — unlike the `?at=` restore, which runs before the reader
has seen anything. This one lands on a page that is already up and being looked at, so the travel is
what says the article moved rather than was replaced. It is also the safer of the two: the glide gives
way to a wheel or a touch, so a reader who started reading during the fetch is not dragged off their
line. The decision itself is `arrivalTarget`, pure and pinned in
[`tests/scroll.test.ts`](../../tests/scroll.test.ts). The wiring is one effect in `App.tsx`, and
whether the page *actually moves* can only be checked in a browser — there is no component runner
here. What is guarded is narrower and worth knowing the shape of:
[`tests/note-arrival.test.ts`](../../tests/note-arrival.test.ts) reads `App.tsx` and checks the call
survives, **with comments stripped first**. The effect's own explanation names `arrivalTarget` twice,
so a guard on the raw file would have been satisfied by prose while the call was gone — the same
silent pass a `sanitizeStoredBlocks` guard hit on 2026-08-26. Match a call, never a mention.

**Checked in a browser, 2026-08-26**, on `constitution` (22,518 words) at 1300px. A fresh load of
`?note=` with no `?at=` scrolled from the top to the commented passage and opened the dialog on it,
then grew `&at=` on its own. With an `?at=` that already had the passage on screen, `scrollY` was
5073.5 on load and 5073.5 a second later — held still, which is the case that costs no movement. With
an `?at=` pointing at the article's first block, the note won and `?at=` was overwritten. A `?note=`
naming nothing rendered normally with no dialog and no console error. One Back went to the library
rather than through a trail of scroll positions, which is `?at=` replacing rather than pushing.

**One thing that pass could *not* establish**, recorded because a silent gap is worse than a stated
one: whether the glide reads as travel or as a jolt. Every round trip through the automation tool
took longer than the 200ms animation, so only "not yet arrived" and "arrived" were ever observable.
See [browser-testing.md § An animation shorter than your round trip](browser-testing.md#short-animation).

### The web-search badge <a id="search-badge"></a>

Greg, 2026-08-25: "indicate (with an icon + hover-tooltip or similar) in the dialog box whether or
not a web search was used."

A globe in the footer, with the search count beside it, and a hover tooltip saying what it did. The
un-searched state gets its **own** icon (`GlobeOff`) rather than no icon at all: the model chooses
per question ([above](#decision-web-research)), so "did not search" is a fact about *this answer*.
A badge that only appeared on searched answers would leave the reader unable to tell "checked, and
it was fine" from "nobody has said".

> [!NOTE]
> The panel sits at `z-index: 70` — above everything structural, but **below** the tooltip layer
> (`.tooltip-anchor`, 80). It was 90 first, on the reasoning that a hover should never cover
> something the reader deliberately opened. That was wrong and visibly so: the panel has a tooltip
> of its own, and at 90 it buried it. A tooltip is dismissed the instant the pointer moves, so it
> cannot obstruct anything.

## The answer arrives a few words at a time <a id="streaming"></a>

**The rule this is an instance of: stream any model call a person is waiting on.** A spinner for
fifteen seconds and the first sentence after two are the same call; only one of them lets the reader
start reading. A batch call in the pipeline, which nobody is watching, does not need this.

Greg, 2026-08-26: *"see if you can make the text stream in (if that won't be too complex)"*. It was
not, because chat had already built every piece and none of them were chat-shaped. The three that
moved into shared modules are worth knowing about, because each carries comments that record a real
bug — and because they are what makes a new streaming endpoint a generator and a route rather than a
project:

- [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) — `sseChunks` (a chunk of bytes is not
  a line; `: OPENROUTER PROCESSING` is a keep-alive, not data; `data: [DONE]` is not JSON) and the
  three abort helpers, which exist because a deadline, a stall and a reader leaving all throw the
  same `AbortError`.
- `sse(res)` in [`src/routes.ts`](../../src/routes.ts) — the frame writer and its headers, including
  why the disconnect listener is on the **response** and not the request.
- [`src/web/lib/sse.ts`](../../src/web/lib/sse.ts) — the client's reader loop.

`explain()` did not become a second implementation: `explainStream` is the only one, and `explain`
drains it. The glossary's per-term lookup still uses the waiting version — not because streaming it
is impossible, but because the answer has to be persisted through a store contract that was being
rebuilt for Postgres when the question came up. What it would take is written down in
[260826o-streaming-the-slow-two.md](../plans/260826o-streaming-the-slow-two.md).

> [!WARNING]
> **A stream can end by simply stopping, and that looks exactly like finishing.** `[DONE]` is the
> only clean end an SSE response has, so a connection cut two paragraphs in would be stored as a
> complete answer with no error anywhere. `finish_reason` counts as a second witness. This is
> [silent-success.md](../reusable/silent-success.md) and the check is in `explainStream`.
>
> **And an abort can end it cleanly too.** `sseChunks` cancels the reader on abort, and a cancelled
> read resolves `{ done: true }` rather than throwing — so a 45-second silence exited the loop with
> no error at all and was filed as "the answer stopped arriving before it was finished". Both
> sentences end in "try again", so no reader would ever notice; the loss is the log line, which is
> the only thing that says whether to blame the network or the provider.

The `begin` frame carries the whole comment, and that is the point of it: `createComment` re-mints an
id that is malformed or collides, and a stream has no response body to carry the real one back.
Without it the client streams an answer into a row the server has never heard of.

### And a stream that stops without ending <a id="stall-clock"></a>

The warning above is about a stream that **ends** early. There is a third case, and until
2026-08-26 nothing here had an answer to it: a stream that simply goes quiet. A TCP connection that
has gone away without being closed delivers no bytes and no error, so `reader.read()` never settles
and the `for await` over it waits for ever — the dialog spins, and nothing will ever stop it.

So `readEvents` is given `stallMs` here, the same 60-second clock chat uses, and `sse(res)` beats a
`: ping` comment down this route every 15 seconds so that silence means something. Both are
described in [260826r-sse-stall-recovery.md](../plans/260826r-sse-stall-recovery.md); the short version is that the
clock is on **bytes** rather than on frames, because a heartbeat is deliberately not a frame.

Chat responds to a stall by going and looking for the answer, which the server usually finished
writing anyway. **Nothing here does that**, on purpose: there is no `pending` comment row for a
watcher to adopt, and the finished answer simply appears on the next reload. All the clock buys a
comment is a failure the reader can see instead of a spinner that never stops — which is most of
the value, since the bug all of this came from was a panel that said "thinking…" for ever.

## Two more ways to push back on an answer <a id="pushing-back"></a>

Both from Greg, 2026-08-26, on the same weak answer.

**"Search the web"** — *"maybe add the 'Web search' button to do a deeper web search"*. It re-asks
with an extra instruction saying the reader has read an answer and asked you to go and look
properly. It **replaces** the answer rather than adding one: a comment is one question and one
answer, and a second would need a schema that can hold two and a panel that can show them.

> [!WARNING]
> **The extra instruction goes after the cache breakpoint, and the tool definition does not change at
> all.** The cached prefix is *tools + system + article*. Putting the instruction in `SYSTEM` costs a
> second cache write of the whole article; changing `max_uses` on the tool is worse, because tools
> render at position 0 and a tool edit invalidates all three tiers
> ([prompt-caching.md](prompt-caching.md)). The first draft did the second of those while carefully
> avoiding the first. The cap is now `MAX_SEARCHES` for everyone — a cap is not a quota, the model
> still decides. `tests/explain.test.ts` pins the two tool arrays as **equal**, so the test fails on
> the difference rather than on a number somebody might legitimately tune.

The old answer stays on screen, dimmed, while the new one runs, and **comes back if the re-ask
fails**. Losing a good answer to a failed attempt at a better one is the one outcome this button must
not produce, and the server has overwritten the stored copy by then — the client's is the only one
left.

**A follow-up box that opens a chat** — *"if the user enters text into it, it should automatically
open up as a new chat (rather than making the [dialog] itself too complex)"*. Which is what keeps a
comment at one question and one answer: the dialog does not grow a transcript, the reader is moved to
the thing that already is one. The mechanics, and the three silent ways a handoff goes wrong, are in
[`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts).

> [!WARNING]
> **The question does not go in the URL.** [`useChat.ts`](../../src/web/useChat.ts) already argues
> this for its own POST — the question is arbitrary length and it is the reader's private text,
> which would then be in browser history, in any shared link, and in every access log on the way. It
> travels in a module-level cell and is lost on reload, which is the right trade: the cost is
> retyping one sentence.

## Anchoring <a id="anchoring"></a>

A comment is `blockId` + the exact `quote` + a `start` offset — and **in that order of authority**.
The block id is the spine ([block-ids.md](block-ids.md)); the quote is the anchor; the offset only
chooses between repeats of the same words inside the block.

That ordering is the whole design. An offset alone drifts the moment the paragraph changes, and
drifts *silently* — you get a mark over plausible, wrong words, which is the failure random block
ids exist to prevent. So [`resolveMark`](../../src/web/annotate.ts) re-finds the quote by text and
returns `null` when it is gone. A comment whose quote has vanished draws no mark at all; it is still
in the list and still openable. Losing the anchor is the safe failure, exactly as in
[block-ids.md § The cost we accepted](block-ids.md#the-cost-we-accepted).

**And since 2026-08-31 it is not invisible either.** Every commented block carries a `Bookmark` in
the prose gutter ([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx)), counted from `comments` by
**`blockId` alone** — never from the resolved marks. That is the point of it: the block id is the
half of the anchor that cannot drift, so a comment whose quote has been re-extracted away still has
somewhere to show. Click it and the dialog opens on the block's first comment in reading order.

Two things follow, and both are easy to get wrong:

- Anything drawing the gutter marker must group on `blockId`, which is what
  [`commentsByBlock`](../../src/web/comment-nav.ts) exists to be the only copy of. Deriving it from
  the marks instead would compile, run, and quietly lose exactly the comments the marker is for.
- It recovers a comment whose **block** still exists. A comment whose block is gone entirely has no
  row to sit beside; `orderComments` sorts it to the end of the dialog list and that is where it
  stays.

### The offset space is the *rendered* text, not `block.text` <a id="offset-space"></a>

> [!WARNING]
> `block.text` is not the string the browser renders. `extractText` in
> [`src/blocks.ts`](../../src/blocks.ts) collapses whitespace **and inserts a space at every nested
> block boundary**, so a two-paragraph `<blockquote>` is one character longer in `block.text` than
> on screen. An offset taken against one and applied to the other lands somewhere plausible and is
> silently wrong.

The offset space used here is the concatenation of the **text nodes of `block.html`** — which is
what `Range.toString()` measures and what a `TreeWalker` over `SHOW_TEXT` produces. Both halves of
the feature use that one definition, and the *browser's own parser* computes it: no entity table, no
tag scanner, nothing of ours that could drift from what the DOM does.

That is also why [`tests/annotate.test.ts`](../../tests/annotate.test.ts) and
[`tests/selection.test.ts`](../../tests/selection.test.ts) carry a
`// @vitest-environment jsdom` line instead of using the node default in
[`vitest.config.ts`](../../vitest.config.ts). A hand-rolled tokenizer tested under node would pass
against itself and disagree with Chrome.

### One `<mark>` per text node <a id="one-mark-per-text-node"></a>

A selection may start inside an `<em>` and end outside it. One `<mark>` around the whole range would
be malformed (`<em>a<mark>b</em>c</mark>`) and the browser would quietly repair it into something
else, so a mark becomes one `<mark>` per text node it touches. The last run carries `data-mark-end`,
which is what the ✳ in [`styles.css`](../../src/web/styles.css) hangs off — a mark broken across
three runs still shows one marker. Overlapping comments share a single `<mark>` listing both ids
rather than nesting, because two underlines on the same words read as a rendering bug.

## Why this call is not a pipeline stage <a id="why-this-call-is-not-a-pipeline-stage"></a>

[architecture.md](architecture.md#server-and-client) says "LLM calls happen in the pipeline, not in
request handlers". This is the deliberate exception, and the reason is that its input does not exist
until the reader makes it: a selection cannot be precomputed, cached on a content hash, or run
ahead of time. Everything else about the stage discipline holds — the call is one transport-free
function ([`src/explain.ts`](../../src/explain.ts)), the routes are a thin wrapper
([`src/routes.ts`](../../src/routes.ts)), and the artefact is JSON on disk.

It is also the only place the project talks to **OpenRouter** rather than the Anthropic SDK the
pipeline uses, because `OPENROUTER_API_KEY` is the key this project has. The model defaults to
`anthropic/claude-sonnet-5` and is overridable with `SPIDERYARN_EXPLAIN_MODEL`.

## What the prompt asks for

The system prompt is in [`src/explain.ts`](../../src/explain.ts) and is written against
[vision.md § Principles](vision.md#principles) rather than against "explain this":

- Supply what the passage **assumes you know** — the term of art, the named person, the debate being
  alluded to, the earlier passage it answers. The reader can already see the words.
- Keep the author's own vocabulary, so the explanation and the prose are recognisably about the same
  thing (principle 2).
- **Do not summarise the article.** The reader is reading it. That is the anti-goal in
  [vision.md](vision.md#anti-goals), one sentence from the prose it would be replacing.
- Say when the article does not say, rather than picking a reading and sounding confident.

The whole article goes in the prompt every time — Greg asked for the answer to be given "the whole
text of the article", and a selection is usually ambiguous without it ("this move", "the same
objection"). At ~15k tokens for the test article that is a few cents a question.

The answer is rendered as **text**, never as HTML: there is no `dangerouslySetInnerHTML` on this
path and there should never be one. It is model output landing beside the author's prose, and it
must not be able to dress itself up as the article.

## Where the code is

| File | What it does |
|---|---|
| [`src/web/selection.ts`](../../src/web/selection.ts) | mouse selection → `{ blockId, quote, start }`, clamped to one block |
| [`src/web/annotate.ts`](../../src/web/annotate.ts) | re-find a quote, and draw the `<mark>` runs over it |
| [`src/web/AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) | **what a selection opens**: the quote, a box, and the tick-box |
| [`src/web/useComments.ts`](../../src/web/useComments.ts) | fetch / create / edit / retry / delete, and the client-minted id |
| [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | the panel: the reader's words, then the quote, spinner, answer, sources |
| [`src/web/BlockGutter.tsx`](../../src/web/BlockGutter.tsx) | the `Bookmark` beside a commented block, and what opens when it is pressed |
| [`src/web/comment-nav.ts`](../../src/web/comment-nav.ts) | reading order, stepping, and grouping onto blocks for the gutter |
| [`src/store/pg-comments.ts`](../../src/store/pg-comments.ts) | the same four operations against Postgres |
| [`src/explain.ts`](../../src/explain.ts) | the OpenRouter call and the system prompt |
| [`src/comments.ts`](../../src/comments.ts) | `data/<slug>/comments.json`, and the write serialisation |
| [`src/routes.ts`](../../src/routes.ts) | the four endpoints, mounted by [`vite.config.ts`](../../vite.config.ts) |
| [`src/env.ts`](../../src/env.ts) | `.env.local` → `process.env` |

```
GET    /api/comments/:slug              every stored comment
POST   /api/comments/:slug              { id?, blockId, quote, start, body? } → the comment
                                        FREE. 201, ordinary JSON, no model call.
                                        409 if that id is a different comment.
PATCH  /api/comments/:slug/:id          { body }  — null clears it back to a bookmark
POST   /api/comments/:slug/:id/answer   {} or { deep: true } → **a stream**
                                        The legacy explanation path: Try again, and
                                        Search the web properly. 409 on a bookmark.
DELETE /api/comments/:slug/:id
```

**Two routes, because a colliding id means opposite things to them** — a retry to the answer path,
somebody else's comment to the create path. One route could not safely be both.

There is deliberately **no route for linking a comment to its conversation**: the only place that
knows a real thread id is the chat stream, so `POST /api/chat/:slug` carries `sourceCommentId` and
writes the link itself.

The answer POST **is** the answer — it streams and then returns the finished comment, so there is
nothing to poll.

## Four things that fail silently here

1. **Concurrent writes.** Every create is a read-modify-write of the whole file, and selecting two
   passages in quick succession is the normal way to use this. Without the promise chain in
   [`src/comments.ts`](../../src/comments.ts) the second read starts before the first write lands
   and a comment vanishes — with *both* writes reporting success.
   [`tests/comments.test.ts`](../../tests/comments.test.ts) pins it, and the test genuinely fails
   when the chain is removed (7 of 8 comments lost). See
   [silent-success.md](../reusable/silent-success.md).
2. **A 200 with no completion.** OpenRouter answers `200` with an empty `content` when the model
   stops for its own reasons. `explain` throws on that rather than storing a blank comment that
   looks answered.
3. **The browser's own selection highlight** sits on top of the mark we just drew, so without
   `removeAllRanges()` after asking, the new artefact is invisible until the reader clicks
   elsewhere — and it looks exactly like a mark that was never drawn. The call is in
   [`App.tsx`](../../src/web/App.tsx) § `onSelect`.
4. **Retry, which shipped broken and was caught in the browser.** `retry` fired the POST from
   inside a `setComments` updater. An updater must be pure — React StrictMode invokes it twice — so
   one click sent *two* requests; and because `createComment` refused a client id that was already
   taken, each reply came back under a **new** id. Result: two model calls paid for, two orphan
   comments on disk, the original still marked `error`, and a dialog spinning forever on an id
   nothing would ever answer. Every individual piece reported success. The fix is two-layered — the
   updater is pure now, *and* `createComment` is idempotent on the id, so a duplicated POST resets
   the comment in place instead of appending. `tests/comments.test.ts` pins the server half.

The last of those is the shape [silent-success.md](../reusable/silent-success.md) describes almost
exactly: it was invisible to the unit tests (both halves passed in isolation), invisible in the
network tab (two 200s), and only visible as "the spinner never stops".

## When it says "Failed to fetch" <a id="failed-to-fetch"></a>

The dev server is not running. That is nearly always the whole story — an explain call is a normal
`fetch` to `/api/comments/<slug>`, and a bare `TypeError: Failed to fetch` means the request never
got a response at all.

It is the easiest failure to hit here, for a reason worth stating: **an explain call takes 11-25
seconds**, and `npm run dev` restarts whenever `vite.config.ts` changes. With several agents editing
this tree at once, that is a wide window for a request to be orphaned mid-flight. So
`describeFetchFailure` in [`useComments.ts`](../../src/web/useComments.ts) rewrites the browser's
message into one that names the cause, keeping the original in parentheses so it stays searchable:

> Couldn't reach the dev server — is `npm run dev` still running? (Failed to fetch)

Check the server the way [browser-testing.md](browser-testing.md) says to — don't take another
agent's word for it, or your own from ten minutes ago:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5273/api/article/<slug>
```

A comment whose POST never reached the server is **not** written to disk, so it disappears on
reload rather than leaving a permanent unanswered mark. Nothing to clean up.

## Deliberate limits

- **A selection under 8 characters is ignored.** Every one of these costs a model call, and a
  double-click that skidded should not fire one. `MIN_SELECTION_CHARS` in
  [`selection.ts`](../../src/web/selection.ts).
- **A selection spanning two blocks is clamped to the first.** A comment addresses one block —
  that is what makes it storable against the id spine — and silently doing the first paragraph beats
  appearing to ignore the drag.
- **A comment is stored `pending` before the model is called**, so a crash mid-answer leaves a
  visible unanswered question rather than a selection that evaporated. The dialog offers a retry.
- **A `pending` comment nobody is answering becomes an `error` on the next read.** `pending` on disk
  cannot distinguish "an answer is coming" from "the process writing it died" — so the server keeps
  the list of what it is actually answering, and anything else that is `pending` is swept to `error`
  with a message. Without the sweep, a comment orphaned by a `npm run dev` restart reloads as a
  spinner that never stops. See `sweepOrphaned` in [`src/routes.ts`](../../src/routes.ts).
- **The model call has a 90-second deadline.** `fetch` has none of its own, so a request that never
  comes back would hold the comment `pending` for ever. `EXPLAIN_TIMEOUT_MS` in
  [`src/explain.ts`](../../src/explain.ts); the timeout is reported as a sentence, not `AbortError`.
- **Deleting while the answer is still in the air wins.** The POST returns the whole comment, so
  storing it used to put back a row the reader had already deleted, mark and all. `useComments`
  keeps a tombstone and re-sends the DELETE once the write it was racing has landed.
- **Selecting inside an existing mark asks a new question**, rather than reopening the comment that
  is already there. Asking about a narrower part of something you asked about before is ordinary;
  the mark only takes the click when there is no selection to act on.
- **No editing, no reply, no follow-up question.** Ask, read, delete. Anything more is a chatbot
  with the article in the context window, which is
  [an explicit anti-goal](vision.md#anti-goals).
- **Comments are per-article, not per-reader.** There is one reader.

## The other way to ask

Since 2026-08-25 there are two. This one is scoped to a passage you selected and answers in a
dialog anchored to it. The other is **chat** ([260826a-chat-mode.md](../plans/260826a-chat-mode.md)): you type a
question about the article and the answer cites block ids back.

They are not competing, and the division is worth keeping straight when deciding where a new idea
belongs:

| | Comments (here) | Chat |
|---|---|---|
| What you address | a span you selected | the whole article |
| Where the answer goes | a dialog over the prose, anchored to the words | the band beside the prose |
| The anchor back to the text | the quote itself | block ids the model cites |
| Stored as | `comments.json`, one flat list | `chat.json`, threads |
| Transport | one POST, the answer comes back with it | a stream |

**Comments are the narrower and safer feature**, and the one whose scoping vision.md's anti-goals
actually argue for. Chat is the one that had to earn its place; the argument is in
[260826a-chat-mode.md § Say the awkward thing first](../plans/260826a-chat-mode.md#say-the-awkward-thing-first).

### And since 2026-08-26, a third caller of this same call

The glossary's **"Check the web"** button ([glossary.md § Checking a term on the
web](glossary.md#checking-a-term-on-the-web)) calls `explain` directly, with the term's name as the
quote and the block it first appears in as the anchor. Not a copy of it — the function.

That is worth knowing here rather than only there, for two reasons. **A change to `SYSTEM` in
[`src/explain.ts`](../../src/explain.ts) now changes what a glossary entry's checked answer says**,
and nothing in this file would tell you. And it is the first half of a merge our review of the
previous version asked for and
[glossary.md § What is still open](glossary.md#what-is-still-open) has been carrying since: *a
glossary should be the same mechanism as comments with a different prompt, not a second system.* The
second half — one storage artefact, one anchor model — is still open.

One practical consequence: because the article half of the prompt is one cached prefix
([prompt-caching.md](prompt-caching.md)), a glossary lookup on a piece somebody has already asked a
question about is a cache hit rather than a fresh read of the whole article.

## See also

- [vision.md](vision.md#where-this-goes-after-granularity-zoom) — where "ask in place" sits in the plan
- [block-ids.md](block-ids.md) — the spine, and why losing an anchor beats moving it
- [web-client.md](web-client.md) — the reading view this hangs off
- [url-state.md](url-state.md) — `?note=` joins the family; why it replaces rather than pushes
- [setup-dev.md](setup-dev.md) — `OPENROUTER_API_KEY`
