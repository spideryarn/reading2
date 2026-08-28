# Chat, and the mode band it introduced

**Built 2026-08-25.** Ask the article a question and get an answer whose every claim is a block id
you can press. It lives in the band between the spine and the prose — the strip the granularity
columns used to own outright — because Greg's answer to "where should it go" reframed that band as
a **slot** rather than as a fixture.

Code: [`src/converse.ts`](../../src/converse.ts) (the model call),
[`src/chat.ts`](../../src/chat.ts) (storage), [`src/routes.ts`](../../src/routes.ts) §
`streamChat`, [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx),
[`src/web/useChat.ts`](../../src/web/useChat.ts),
[`src/web/citations.ts`](../../src/web/citations.ts) (finding the block ids in an answer — pure, and
the one piece of this with real test coverage), and `§ mode band` at the end of
[`src/web/styles.css`](../../src/web/styles.css). Tests: [`tests/chat.test.ts`](../../tests/chat.test.ts).

```
  TOC MODE — the default, and unchanged

 ┌─────────────┬────────┬────────┬─────────────────────────────┐
 │             │  Granularity: L0 L1 L2  Text  fit             │
 │  ▇▇▇▇▇▇▇▇   ├────────┬────────┬─────────────────────────────┤
 │  ▇▇▇▇▇      │ L1     │ L2     │ the full text of the        │
 │  ▇▇▇        │ gists  │ gists  │ article                     │
 │  ▇▇▇▇▇▇▇    │        │        │                             │
 ├─────────────┴────────┴────────┴─────────────────────────────┤
 │ ⌂ Home  ✳ Questions  ⓘ Metadata  ☰ Thread  ⌸ Chat          │
 └─────────────────────────────────────────────────────────────┘
   spine          the middle band          the article


  CHAT MODE — same spine, same article, the band is a conversation

 ┌─────────────┬───────────────────┬───────────────────────────┐
 │             │  Mode: chat   back to contents                │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────┼───────────────────────────┤
 │  ▇▇▇▇▇      │ Why does he call  │ the full text of the      │
 │  ▇▇▇        │ it metabolic?     │ article — still here,     │
 │  ▇▇▇▇▇▇▇    │                   │ still scrolling, still    │
 │  ▇▇         │ Because Seth ties │ where a citation lands    │
 │  ▇▇▇▇       │ feeling to living │ you                       │
 │             │ processes [k3m9qt]│                           │
 │             │            ^^^^^^ │                           │
 │             │      press → jumps the article, right →       │
 │             │ ┌───────────────┐ │                           │
 │             │ │ Ask…       ▷ │ │                           │
 ├─────────────┴───────────────────┴───────────────────────────┤
 │ ⌂ Home  ✳ Questions  ⓘ Metadata  ☰ Thread  ⌸ Chat ●        │
 └─────────────────────────────────────────────────────────────┘
```

**Since 2026-08-26 chat has tools of its own** — it can search this article's exact words, search
the reader's other saved articles, read a web page in full, and read its glossary. That is a
[document of its own](../project/chat-tools.md); everything below still describes the panel, the
mode band and the citation contract those tools answer to.

## Say the awkward thing first

**Chat is a named anti-goal in this repo, and it was refused twice in writing before it was built.**

[vision.md § Anti-goals](../project/vision.md#anti-goals) opens with:

> A chatbot with the article stuffed in the context window.

[original-version/search-and-chat.md](../project/original-version/search-and-chat.md#chat-the-one-to-be-suspicious-of)
calls it *"the one to be suspicious of"* and reports the damning finding about the previous version's
own: a year of work, three persistence rewrites, and **no document anywhere assessing whether the
chat pane helped anyone read better**. And [bottom-bar.md](bottom-bar.md) left it out of the bar
deliberately — not even a dimmed placeholder — while giving five less contentious ideas one each.

Greg asked for it anyway, on 2026-08-25, and that is his call to make. What follows is not a
retraction of the objection; it is the design the objection produced.

The same doc that refused it also said what would make it acceptable:

> If chat ever does arrive here, the constraint to hold is that it must be **rooted in a selection**
> and must cite block ids back. That keeps it on the augment side of the line — an interlocutor
> about the passage, not an oracle about the article.

Half of that is honoured and half is not, and it is worth being exact about which:

| Their constraint | What we built | Why |
|---|---|---|
| must cite block ids back | **Held.** Every claim carries `[spya-k3m9qt]`, rendered as a chip that scrolls the article to that paragraph | This is the whole feature. See below |
| must be rooted in a selection | **Not held.** You can type any question | That is what [comments.md](../project/comments.md) already is, and a second, worse version of it is not worth a mode. The scoping work is done by the citation instead |

**The citation is what does the work the selection was supposed to do.** A chat that must point at
the passage it is talking about cannot become a substitute for looking at the passage — pressing the
chip is *going and reading*, and it is the fastest thing on screen. The reader's position is also
sent to the model (`?at=`), so "what does he mean here" resolves without a selection.

The honest residual risk: nothing forces the reader to press a chip. Somebody determined to use this
as an oracle can. What the design does is make reading the cheaper of the two paths, which is the
most a piece of software can do about it.

**And it is not the previous version's chat**, in the two ways that made theirs the wrong thing: the
article never leaves the screen (their pane sat over it), and an answer is an index into the piece
rather than a replacement for it.

## Greg's reframing, which is the actual design

The question asked was where to put it: a drawer over the article, a panel beside it, or a page of
its own. The answer was none of the three:

> Can we have it as a panel on top of/replacing/instead of the middle columns (i.e. L1/L2/L3/etc, to
> the right of the spine, to the left of the article)? I'm thinking that this might be a common
> pattern, that when we switch into a mode (e.g. Chat, Glossary, etc) we'll want to keep the spine
> and article, but reuse the middle sections. In fact, the current "Table of Contents" middle
> sections are just such a mode that can be chosen from the bottom-bar (the default).
>
> — Greg, 2026-08-25

That last sentence is the one that changed the code. The band between the spine and the prose is
not *the granularity columns*; it is **whatever mode you are in**, and the table of contents is the
default mode. Two things are permanent — where you are (the spine) and what you are reading (the
prose) — and the middle is the working surface.

So `?mode=` is a first-class parameter with `toc` as a real named value, `fitView` knows about a
**mode band** rather than about chat, and the four CSS rules that make room for it read a
`--mode-w` custom property that is `0px` in the default mode. Adding Glossary later is a value in
`MODES`, a component, and nothing else.

### What that bought, and what it cost

**Bought:** the article stays on screen, which is what makes a citation worth pressing; the layout
arithmetic gained one branch rather than a fourth term in an existing negotiation; and the next
mode is nearly free.

**Cost:** the granularity columns are *gone* while you chat, not shrunk. You cannot read the L1
gists and chat at the same time. That is the deliberate trade — the band is one slot, and Greg's
framing is that a mode owns it — but it is a real loss on a wide screen where both would have fit.
If that turns out to be the wrong call the fix is a mode that renders a narrowed ToC beside the
chat, and `fitView` is where it would go.

## How the pieces fit

```
  ChatPanel.tsx ──── useChat.ts ──POST /api/chat/<slug>──► routes.ts § streamChat
   the panel          the client       (a stream, not               │
   and the            half, SSE         an answer)          ┌───────┴────────┐
   citation           reader                                ▼                ▼
   chips                                              chat.ts          converse.ts
                                                    data/<slug>/      OpenRouter,
                                                     chat.json         streaming
```

### What an empty conversation offers

**Chat opens *in* a conversation, not in front of a list of them.** Greg, 2026-08-26: *"By default,
if no existing Chats, start a new one."* A list is worth showing when it has something in it; when
it does not, it is a screen whose only content is a button, and pressing that button was the only
thing anybody was going to do. Starting a new one also takes the focus — *"when a new chat is
started, move focus to the input box"* — and only then, because focus in a textarea turns ↑ / ↓ from
"step through the article" into "move the cursor", and nothing on screen would explain why.

The empty conversation is not blank. It carries five suggestions, and **the filter on them is that
every one sends the reader back into the article.** The obvious suggestion — *summarise this* — is
deliberately absent and should stay absent: it is [the anti-goal](../project/vision.md#anti-goals) in
a single click, and a chat that opens by offering to replace the reading is not the feature argued
for at the top of this file.

They were borrowed rather than invented, at Greg's suggestion — *"borrow ideas from
docs/project/original-version/ for suggestions for the user about what to use the Chat for"*:

| Suggestion | Borrowed from |
|---|---|
| Where is the main claim argued? | their **criterion highlighting**, where the reader types a criterion in plain words — *"arguments supporting the main thesis"* ([highlighting.md](../project/original-version/highlighting.md)). Block ids do the marking here |
| Evidence or assertion? | the same tool, aimed at the distinction it was most useful for — their other worked example was *"statistical evidence"* |
| What does it assume I know? | their **glossary**: *"the terms this piece uses in a non-obvious way, defined from the piece itself"* ([glossary.md](../project/original-version/glossary.md)) |
| What does the author not say? | vision.md's **argument view** — "claims, the support offered for each, and **the moves the author doesn't make**". The only one on the list nothing else in the app can do |
| Check my understanding | vision.md's **recall** — "a few durable questions generated from what the reader actually dwelt on" |

Clicking sends, rather than filling the box: these are complete questions, and a confirming press
after choosing one buys nothing.

### The citation contract

The prompt in [`converse.ts`](../../src/converse.ts) requires a block id in square brackets on any
sentence that says what the article says. The panel splits the answer on the *shape* of one of our
ids rather than on the brackets, so a model that forgets the punctuation still gets working links.

**Two numbers, not one, and the first version had only the second.** `citedBlocks` counts the real
block ids in an answer and `unknownIds` counts the invented ones. `unknownIds` alone was supposed to
expose prompt drift, and it cannot expose the most obvious kind: a model that stops citing
altogether invents nothing and scores perfectly. A run of answers with `citedBlocks: 0` is chat
quietly becoming the uncited chatbot [vision.md](../project/vision.md#anti-goals) refuses — the one
failure this whole design exists to prevent, and it was the one the logging could not see. Caught by
a cross-family review, not by us; see below.

**Read `citedBlocks: 0` in aggregate, not one line at a time.** Measured on 2026-08-26 against the
Noema article: four substantive questions ("why does he reject substrate independence?", "what does
he say about anthropomorphism?") each cited four or five blocks, with no invented ids. The zero came
from *"in one sentence, what is this about?"* — a question about the whole piece, where there is no
particular block to point at and the prompt correctly tells the model not to decorate its own
synthesis with one. So a single zero is usually a summary question. A **run** of them is the drift.

**An id this article does not have is rendered as plain text, not as a dead link.** A link that
scrolls to nothing is the worse failure: the reader presses it, nothing moves, and there is no way
to tell that from a scrolling bug. (Precisely: a bracketed run where *nothing* resolves is left as
the model wrote it; in a mixed run the good ids become chips and the bad ones are dropped, rather
than printed beside a working link where they would read as one more link that happens to be
broken.) That leaves a silent failure — a hallucinated id looks like the
model choosing not to cite — so the server counts them and logs `unknownIds` on every answer. A
number creeping up there is the signal that the citation prompt has stopped working, which is
exactly what a model change could do quietly. Classic
[silent-success](../reusable/silent-success.md), handled by making it countable rather than by
pretending it cannot happen.

### What of Markdown we interpret

**Bold, and nothing else.** The prompt asks for plain paragraphs and gets them, but a model bolds
the term it is introducing whatever you tell it, and printing the literal `**asterisks**` makes the
app look unable to read its own model's output — found in a browser test on 2026-08-25.

The reason the list stops there is not laziness. Rendering model output as HTML is exactly what
[security.md](../project/security.md) exists to prevent, and what makes this safe is that it never
produces HTML at all: `splitEmphasis` returns runs of **text**, React escapes text, and there is no
version of it that would want `dangerouslySetInnerHTML`. Anything added here has to keep that
property.

Blank lines separate paragraphs; single newlines are preserved by `white-space: pre-wrap`, so the
occasional short bullet list the prompt permits does not collapse onto one line.

**A chip shows the paragraph it points at, on hover.** Added 2026-08-26 at Greg's request for a rich
tooltip, and the only content worth putting in one is the thing the citation points *at*: a card
saying "go to this passage" tells the reader what clicking does, whereas the paragraph itself lets
them check the model against the article without leaving the sentence they are reading. That check
is the entire justification for the feature, and until now it cost a jump and a scroll back. The
text is truncated at ~260 characters — enough to recognise the paragraph and see whether it says
what the answer claims, not enough to read instead of going there. The original version reached the
same conclusion about search results and kept two lengths for it
([search-and-chat.md](../project/original-version/search-and-chat.md)).

The tooltips appear **only once the answer has finished**. While it streams the chips are plain,
because of the next paragraph — and because nobody is hovering a citation in a sentence that is
still being written.

One consequence of streaming worth knowing before editing the panel: **the whole answer re-renders
on every token.** That is what killed the Floating UI tooltip that used to sit on each citation chip
— a dozen `useFloating` hooks created and torn down a hundred times during one answer, for a hover
hint. Anything else expensive per citation will have the same problem.

### Streaming, and the third outcome it introduces

[`explain.ts`](../../src/explain.ts) either returns an answer or throws. A stream has a state
neither of those covers: **it succeeded partly.** Sixty words arrived and then the connection died.
So `converse` is an async generator, and both the server and the client keep the partial text and
attach the failure to it rather than discarding it. The reader watched those words appear; taking
them away is more confusing than leaving them with an explanation.

Three failure modes get their own handling, because they want different sentences:

| | What it is | What the reader is told |
|---|---|---|
| deadline (120s) | the whole exchange ran too long | "The model did not finish within 120s." |
| **stall (45s)** | the connection is open and nothing is coming | "The answer stopped arriving after 45s of silence." |
| connection closed | the stream ended with no terminal frame | "The connection closed before the answer finished." |
| **truncated** | the upstream stream ended without `[DONE]` and without a `finish_reason` | "The answer stopped arriving before it was finished." |

That last row is the one that was missing, and its absence was a silent success of exactly the kind
this repo collects: an ordinary EOF and a clean `[DONE]` were indistinguishable, so a connection cut
two paragraphs in was committed as a **complete** answer — `status: "done"`, no error anywhere, and
the reader left holding half an explanation that never says it is half.

The stall timer is the one `explain.ts` does not need and the one worth knowing about: a streamed
response can sit open with nothing on it, and from the inside that is indistinguishable from a model
thinking hard. Without it the only backstop is the two-minute deadline, and two minutes of a
motionless cursor is not a wait, it is a hang.

**Leaving does not cancel the answer.** Switch threads, scroll away, close the tab — the model call
runs to completion and the answer is stored, so coming back finds it there. The alternative throws
away a nearly-finished answer that has already been paid for. What a disconnect *does* stop is
writing to the socket, checked before every frame, because an EPIPE would take down a turn that was
about to succeed.

### Storage, and the rewrite we are trying not to repeat

`data/<slug>/chat.json`, with the same atomic temp-file-and-rename write and the same serialised
read-modify-write queue as [`comments.ts`](../../src/comments.ts). Greg chose **multiple named
threads** over one-per-article and over no persistence at all.

The serialisation matters more here than it does for comments, and the reason is worth stating:
a chat answer is written **twice**, tens of seconds apart, with the reader free to type again in
between. Without the queue, sending a second message mid-stream reads the file as it was before the
first turn landed and writes it back that way. Both writes succeed. One turn is simply gone.

The previous version rewrote its chat persistence three times and every rewrite was about where the
threads live. What keeps this from being the fourth is that **a thread here is not a first-class
object**: no sharing, no cross-article list, no server-side ordering. It is a list inside the
article's own file, and the article owns it. When storage moves to Postgres
([postgres-migration.md](postgres-migration.md)) it is one table, one row per message, and nothing
in `chat.ts`'s interface changes.

## The URL

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode` | `chat`, absent for `toc` | **push** | A mode is where you are, not a glance. Back should put the contents back, like a column toggle. You do not toggle it twice in ten seconds, so it will not fill the history |
| `thread` | a minted id | replace | Stepping between conversations is browsing; `mode` already put the entry on the stack that Back should use |

An unknown `mode` degrades to `toc` and an unknown `thread` to the list, rather than throwing —
the same rule [`parseAsBlockId`](../../src/web/params.ts) follows, so a link from a future version
with a Glossary mode still shows you the article. See [url-state.md](../project/url-state.md).

The thread id is **minted on the client**, exactly as a comment id is, so `?thread=` names something
real from the first frame and nothing has to be swapped when the answer lands. The server may
overrule an id it cannot accept and says so in the stream's `begin` frame; the client follows it and
corrects the URL, because the alternative is an address bar pointing at a conversation that is not
there.

## What it cost the rest of the app

Small, and that was the point of the band being a slot:

1. **Four CSS rules gained a `+ var(--mode-w)` term** — `.reader`'s `padding-left`, `.masthead`,
   `.controls`, and `td.pin-left`. All four are no-ops in the default mode, where the property is
   `0px`. The masthead and controls bar matter more than they look: both are `100vw` sticky bars,
   and without the term the band paints over their left end — which is the article's own title.
2. **`fitView` gained one branch** and a `modeW` on its result, rather than a fourth term in the
   shrink-then-drop negotiation. In a mode the gist columns are not squeezed, they are gone.
3. **The Dock grew a third kind of button.** It had two — links (`aria-current`) and the drawer
   trigger (`aria-expanded`) — and a mode switch is neither.

   It began as two independent `aria-pressed` toggles, Chat and Glossary, with `toc` having no
   button at all: you left a mode by pressing the one you were in. A note in `Dock.tsx` argued that
   a radiogroup would be the *worse* markup while that was true, since it would name two options and
   hide the third, and it identified the real trigger for changing — **a Contents button existing**,
   not a third mode arriving.

   Greg, 2026-08-25: *"Yes, make them a radio group, but as buttons, with nice icons and tooltips."*
   So `toc` got a button, and all three became a `role="radiogroup"` of `aria-checked` buttons:
   `DockModes`, with roving tabindex (one tab stop, not three), arrow/Home/End traversal that wraps,
   and focus following the selection. The keys `stopPropagation` because ↑/↓ otherwise *also* step
   the article — `keynav.ts` ignores typing in an `<input>`, and a `<button>` is not one. Focus wins
   inside a radiogroup; that is the promise the role makes.

   The index arithmetic is `nextModeIndex`, exported and tested, because the alternative was a
   wrap-around that can only be checked by driving a browser — which is the check that gets skipped
   on the day it matters. `(index - 1) % count` returns `-1` in JavaScript, which is a
   valid-looking array index that reads as `undefined`: an arrow key that silently does nothing.
4. **`?cols=` is untouched by the trip through chat**, so coming back finds the columns as you left
   them.

## What a turn can have done to it

Added 2026-08-26, after Greg asked for *"the top handful of most useful Chat UI features"*. The list
came from a survey of Claude.ai, ChatGPT, Perplexity, Gemini, the editor chat panes and
`assistant-ui`; the ranking that decided what went in was **value per unit of complexity for a
400px panel, beside an article, in conversations a handful of turns long.** That last clause is
doing most of the work — several of the affordances everyone ships are aimed at long exploratory
chats in a full window, and they get worse, not merely unnecessary, at this size.

| | What it does | Where the difficulty actually was |
|---|---|---|
| **Copy** | the answer to the clipboard, block ids and all | `navigator.clipboard` returns a promise that rejects, so the button has three states and a refusal says so |
| **Retry** | answers the last question again, over the top of the answer it has | the row is *reused*, id included — see below |
| **Edit** | rewrites one of your questions and asks again, discarding everything after it | saying how much it will discard, before it does |
| **Stop** | ends an answer and keeps what arrived | a stop is a `done`, not an error, and a socket close is not a stop |
| **Jump to latest** | appears when you have scrolled up | it already followed the answer down; the button is the other half |
| **Escape** | stop → clear the draft → give the reading keys back | the composer swallows every key, so Escape had no other meaning available |

### A stop is not a failure, and not a disconnect

Two decisions here, and both went against the obvious implementation.

**Against `status: "error"`.** Aborting the fetch makes `converse` throw, and letting that throw
out would have stored the reader's own deliberate act as a model failure: a red row, an apology, an
offer to try again, for a button they had just pressed. So the abort is caught in
[`src/converse.ts`](../../src/converse.ts), told apart from the deadline and the stall by *which
signal aborted*, and finished normally with `stopped: true` on it. A flag, not a fourth `status`,
because everything else in the app that reads `status` is right to treat this as done.

**Against reusing the disconnect.** `streamChat` deliberately does **not** cancel a model call when
the reader closes the connection — switching thread mid-answer is ordinary, and the answer is
already paid for. That is written down in the route's header comment as point 3, and it is why a
stop needs a request of its own (`POST /api/chat/:slug/:threadId/stop`) rather than a socket close:
from the server's end the two are the same event, so the deliberate one has to say so.

A stopped answer stays in the history sent back to the model. It said those words; a conversation
where the model's own half-sentence has been quietly deleted would have it contradict itself one
turn later. The exception is a stop that lands *before the first token* — that is stored the same
way, `done` and `stopped` with zero characters, and `recentHistory` drops it on the empty text, so
the model is never handed a turn in which it said nothing. That case used to throw, which filed a
fast stop as a model failure.

### What a retry may touch

**Only the last answer.** Regenerating one in the middle leaves every turn below it answering a
question about words that no longer exist — the conversation reads as a non-sequitur and nothing on
screen says why. Every product that allows it pays with a message tree and a branch pager, and the
best writeup on the pattern calls that *"overkill for general-purpose chat"*. In a 400px band there
is neither the room nor the conversational depth to justify it. The button is therefore not rendered
anywhere else, rather than rendered and refused: a control that exists and always says no is worse
than one that never existed.

The row is **reused, id and all** — `retryTurn` blanks it in place. That is what keeps everything
already pointing at the answer still pointing at it: the client's optimistic patches, the `streaming`
key the route builds from `slug/threadId/messageId`, the stop button. And it is rebuilt field by
field rather than spread, because a spread carries `citations`, `searches` and `model` over from the
attempt being replaced — a retry that runs no web search would keep the old answer's sources, sitting
under text that never mentions them.

### Editing a question

Everything after the edited message is discarded. **No branch is kept behind a pager**, which is the
one place this deliberately diverges from Claude.ai. Their tiny `‹ 2/3 ›` control is the most
complained-about thing in that UI — a conversation that is still there but not on screen is
indistinguishable from one that was deleted — and it is a second navigation problem in a column that
already has one.

So the panel says what it is about to destroy: *"Asking again will discard the 3 messages below."*
That sentence **is** the safety mechanism, and it is deliberately not a modal. A confirmation dialog
in front of an edit is a tax on every typo fix, and readers learn to dismiss it without reading —
at which point it has stopped protecting the case it was put there for.

The old text is not kept. `editedAt` records only *that* it happened, which is enough to stop a
reader wondering why the answers below no longer quite match the questions above.

### The race a retry created, and the two things that fix it

Reusing the row means an aborted stream and its replacement can want the same row at the same time.
Aborting is not enough — the aborted stream's `finishTurn` can land *after* the reset and put the
stopped half-answer back over the fresh `pending` row, where nothing would ever clear it.

So `settleThread` aborts every live stream in the thread and **waits for the writer to let go**
(`Live.done`, resolved in the route's `finally`, after the key is removed). And `withEdit` mints its
new message id against *every* id in the file including the ones it is about to discard, because a
discarded id handed straight back is the same bug wearing different clothes.

Both are per-process, like everything else here — see [What was deliberately not
fixed](#what-was-deliberately-not-fixed).

### Streaming, and what a screen reader is told

The canonical chat pattern is a polite live region around the transcript. It is wrong here: the text
of an answer changes on every token, so the region fires a hundred times and a screen reader reads a
growing prefix of the same paragraph over and over. Announcing the finished text once instead means
putting the whole answer in the DOM twice.

So the live region carries a **status line and nothing else** — "Answering.", "Answer ready.",
"Answer stopped.", "The answer failed." It says when to go and read; the answer stays in one place
to be read. `.sr-only` uses the clip-rect recipe rather than `display: none`, which would take the
region out of the accessibility tree and make it announce nothing at all, silently.

### The second review, and what it found

The five affordances above were reviewed on 2026-08-26, adversarially and from a cold read of the
code. **GPT-5.6 could not do it — the Codex workspace was out of credits, twice in one day** — so
this was a same-family review, which is a weaker instrument: it shares the priors that produced the
bugs. That is worth re-running when credits return, because the *first* review of this feature was
cross-family, returned NO-SHIP, and found four things no test could have caught.

Even so, three of its findings were real and one was the same mistake this file already has a
section about.

- **The copy button did nothing, silently, on any insecure origin** — and its own comment cited
  `silent-success.md` while claiming that could not happen. `navigator.clipboard?.writeText(…)`
  short-circuits **the whole chain**, `.catch` included: with no clipboard object the expression is
  `undefined`, nothing throws, nothing rejects, and the state stays `idle`. And "no clipboard
  object" is not exotic — it is every insecure context, which includes reaching this app at
  `http://192.168.1.x:5273` from a phone. The guard is a statement now.
- **An open edit box was destroyed mid-typing.** Withdrawing `onEdit` while an answer streamed
  unmounted a half-written rewrite with no warning, and then remounted it by itself, with the
  original text back, when the answer finished. The pencil is what goes away now; an editor already
  open stays.
- **`stick` and `away` disagreed on the one commit that mattered.** `stick` was recomputed in a
  layout effect after every commit, which measures the DOM *after* the new content is in it — so any
  commit adding more than the 60px slack decided the reader had scrolled away when the page had
  merely got taller under them. The commit that does that routinely is the last one: `done` adds the
  action row and, if the model searched, the whole source list. The reader was pinned to the bottom,
  the answer finished, and nothing followed anything after that — with no "Latest" button either,
  because `away` came from a different effect the same commit did not trigger. `stick` now changes
  only when the reader scrolls, which is the only event that means what it says.
- Two comments were overstating what their code did — `sseChunks`' abort listener is a backstop, not
  the mechanism; `withEdit`'s id-minting buys robustness against the *second server*, not against
  anything in this process, and only within one call. Both now say so.
- And a stale stop wish could kill the next retry: a stop firing after a run's `finally` left its
  entry in `stopWanted`, which the reused message id then matched on the retry's `begin` frame.

**The finding this file cares about most is a test.** One of the new tests asserted that a stop
before the first token is stored `done` and `stopped` — and built the row *by hand*, so it passed
while the code did the opposite. That is the [`recentHistory` mistake](#the-cross-family-review-and-what-it-found)
exactly: a test written from the same misunderstanding as the code, reading as coverage.
[`tests/converse-stop.test.ts`](../../tests/converse-stop.test.ts) exists because of it, and it goes
through `converse` with a stubbed `fetch` rather than constructing anything.

**Writing that test immediately found a fourth bug the review had not.** Every version of the stop
handling assumed an abort *throws*. It does under Node's own fetch — the pending `read()` rejects
with the abort reason. But `sseChunks` also calls `reader.cancel()` on abort, and cancelling a
reader makes a pending read resolve `{ done: true }`; where the cancel wins that race the loop exits
**cleanly**, `stopped` stays false, and the truncation guard files the reader's own stop as *"The
answer stopped arriving before it was finished."* There is no error to identify at that point, so
the check there is signal-only. Two catches and a clean exit: three ways out, and the promise has to
hold on all three.

### What a browser pass found that neither review did

Driven in a real Chrome tab, 2026-08-26. Nine of ten checks passed; the two things worth recording
are the ones no amount of reading would have produced.

**The first token takes about four seconds.** Measured, not guessed: the model queues, and it often
searches the web before it says anything. So the reader spends four seconds looking at `thinking…`
with a live stop button — which is precisely why the pre-token stop path, the one that was wrong
twice, is the *most* likely one to be exercised rather than an edge case. That number is the
justification for [`tests/converse-stop.test.ts`](../../tests/converse-stop.test.ts) existing.

**A stranded "Latest" pill.** Editing a question to discard three turns can leave a transcript
shorter than the panel — nothing to scroll to — with the pill still offering to take you to the
bottom. `stick` changes only on a scroll event, by design, and a shrink fires no scroll event. The
fix keeps the discipline rather than undoing it: the effect that follows a growing answer **only
ever clears** `away`, never sets it. Growth still cannot claim the reader scrolled off; a shrink
that puts the bottom back on screen now says so.

One thing is unexplained. A few times, pressing Enter on the very first message of a brand-new
conversation dropped back to the thread list — once out of chat mode altogether. The message was
always saved, so nothing was lost. It did not reproduce cleanly, and it happened during an afternoon
in which other agents were hot-reloading this app continuously; the shape fits a full reload landing
before nuqs has flushed `?thread=` and `?mode=` into the URL, which would put the reader on a URL
that genuinely does not name a conversation. Recorded rather than fixed, because a fix aimed at a
cause we have not confirmed is how you end up with two bugs.

**Copy could not be verified.** `navigator.clipboard.writeText()` never resolves inside the
browser-automation tab — the permission reads `granted` and the promise simply hangs. That is an
environment limit, not a finding about the code, and it means the clipboard path has been read and
reasoned about but not once watched to work. Worth a human eyeball in an ordinary window.

### What was ranked and left out

- **Attachments — images and files.** The one thing on Greg's example list that did not go in, and
  the reason is this document's own argument. Chat here is defensible *because* it is grounded in
  one article and every claim carries a block id back into it; a panel that accepts arbitrary files
  is a general chatbot that happens to be next to an article, which is the
  [anti-goal](../project/vision.md#anti-goals) stated plainly. It is also not cheap — upload
  storage, size caps, a security pass on a new untrusted input. Worth revisiting for a *specific*
  need (a screenshot of a chart the article refers to); not worth it as a general capability.
  OpenRouter would carry image content blocks, so the model end is not the obstacle.
- **A message tree.** See [What a retry may touch](#what-a-retry-may-touch).
- **Retry with a different model.** The app has one model, in one constant
  ([`src/models.ts`](../../src/models.ts)). A picker would be a decision surface with nothing behind it.
- **Copy-as-markdown vs copy-as-rendered.** There is no rendered form — the answers are plain
  paragraphs by instruction. One copy, no toggle.
- **Thumbs up/down.** Cheap to build and decoration unless somebody reads the data. When
  [Q6](../project/open-questions.md#q6) — how would we know this is helping — gets an answer, this
  is one of the things that answer might need. Not before.

### The two Greg found by using it

Both reported 2026-08-26, both in the first few minutes of ordinary use, and neither had a chance of
being caught by anything already listed above.

**Editing a question never worked.** Every edit answered *"That message is not in this
conversation."* — for any question asked in the current tab, which is to say for every question
anybody would actually want to edit. The client invents three ids per turn so the reader's words
appear the instant they press Enter; the `begin` frame corrected two of them. The reader's own
question kept a name the server had never heard of, and nothing renders an id, so the screen was
correct in every respect until something needed that row by name. Written up in full — including why
two reviews, a browser pass and a green test suite all went past it — in
[half-swapped-message-ids.md](../postmortems/half-swapped-message-ids.md). The fix is one field in
the frame and a positional lookup on the client; the test that now pins it,
[`tests/chat-route.test.ts`](../../tests/chat-route.test.ts), is at the *join* between the two sides
rather than inside either.

**An abandoned "New chat" was kept.** Greg: *"If I start a new conversation and then close it, it
shouldn't store unless there was at least some text in the input box."* Pressing new-chat and
changing your mind left a row in the list for it. Nothing was written to disk — that part was
already right — but the local list kept it, so the list filled up with conversations nobody had had.

The test is deliberately **both halves: no messages *and* an empty box.** A draft is enough to keep
the conversation, because the draft is filed under its id and dropping the conversation would take
the reader's unsent words off the screen with it. That is the one outcome worse than a stray row.

Three things fell out of it that are worth naming, because each was a bug in its own right:

- **Drafts leaked between conversations.** The composer held what you had typed in its own state and
  nothing remounted it, so switching conversation carried a half-written question into the next one.
  Drafts now live in the panel, keyed by conversation, and the conversation view is keyed by id so
  the composer starts again with the right one.
- **The focus rule broke the moment the composer was keyed.** *"When a new chat is started, move
  focus to the input box"* was implemented as "focus if the nonce is above zero", which a remount
  re-runs — so opening yesterday's conversation would have taken the caret, and a focused textarea
  turns the article's ↑ / ↓ into caret movement with nothing on screen to say why. The nonce that has
  been spent is now remembered *above* the thing that remounts.
- **Closing the last conversation bounced straight into a new one.** The rule
  [added the same morning](#what-an-empty-conversation-offers) — no conversations, so start one —
  fired again the instant the empty one was discarded, and the close button read as broken. It is
  latched now: "by default" means on arrival, and a reader who has just closed the only conversation
  asked for the list.

**Both fixes were driven in a real browser afterwards**, in a fresh tab with the backend state read
back from `/api/chat/<slug>` at each step rather than trusted from the screen — which matters here
more than usual, because the bug being fixed was one where the screen was right and the state was
not. Editing works in a fresh session and after a reload; the discard count on an edit is right;
three new-then-close rounds leave the list exactly as it was; a draft keeps its conversation and is
still in the box on reopening; a draft does not follow the reader into another conversation; a new
conversation takes the caret and an existing one does not (checked by `document.activeElement` and
by a real Down keypress reaching the article, not by eye); and retry and stop still behave.

The copy button **still has no evidence behind it** — `navigator.clipboard.writeText()` does not
resolve in the automation tab, so it has now failed to be verified twice, for a reason that says
nothing about whether it works. It wants ten seconds of somebody's own eyes in an ordinary window.

**A third bug came from the review of the fix.** `src/chat.ts` had an exported `createThread` that
wrote an empty thread to disk, called by nothing. It had been harmless; the moment the panel started
discarding empty conversations locally it would have become a deletion that did not delete — gone
from the screen, back on the next reload. It is deleted, with a note in its place saying that an
empty conversation exists only in the tab that started it, because that is now an invariant two
files depend on. Found by GPT-5.6, 2026-08-26.

### What a row of the list says, and the delete inside a conversation

Greg, 2026-08-26:

> In the Chat list view, it shows all the chat titles. That has a button to delete chats. Also add a
> Delete button **within** a chat. And add more metadata about the chats (even if it makes each row
> multi-line), with a slightly longer title, hover-tooltip, recency (e.g. "3d ago").

A row used to be one line: the title, cut at the panel's width, and a bare number beside it. The
trouble is what the title *is* — the first thing the reader typed. Days later that is often the
least useful sentence in the conversation: it says what they went in wanting, not what they came out
with. So a row is now three lines:

- **the title**, wrapped over two lines rather than cut at one. A stored title is up to sixty
  characters and the panel fits rather fewer than that on a line, so one line was throwing away the
  end of the sentence that said what the question was about; two lines shows all of it;
- **the last thing said in it**, one dimmed line, which is the "where did this get to" the title
  cannot answer;
- **turns and recency** — `4 turns · 3 days ago`, using the relative dates from
  [`relative-time.ts`](../../src/web/relative-time.ts) that the shelf already prints, and `useNow`
  so that a panel left open does not quietly rot.

The exact timestamps did not go anywhere: they are in the row's hover `title`, along with the whole
title, which is the same division the shelf makes — the row answers *how long ago*, because that is
the question a reader is actually asking, and the tooltip keeps the answer they occasionally need.

**The rename and delete icons only appear on hover** — three lines of metadata is enough in a row
without two permanent buttons competing with it — and they are hidden with `opacity` *and*
`pointer-events: none`. The second half is the one that matters, and it came out of the review: a
finger has no hover, so on a tablet the icons would sit invisible at the right edge of every row and
a tap landing on one of them would delete a conversation with nothing on screen to explain it.
Transparent is not the same as absent. `:focus-within` brings them back for the keyboard, which
cannot hover either.

**Delete inside a conversation asks twice.** The list's delete is one press, and that is right
there: the row is one of several and its title is under the mouse. Inside a conversation the thing
you are about to destroy is the page you are reading, and there is no Undo strip to offer — unlike a
shelf card, a deleted conversation is really gone rather than archived. So the head's bin arms on
the first press (red, and its tooltip changes to say what the next press does) and deletes on the
second, disarming itself after four seconds. Not `window.confirm`, which blocks the tab and cannot
be styled. It is keyed by the open thread's id, so changing conversation always gives you an unarmed
one.

**Driven in a real browser**, on an article with five stored conversations. The three lines are
there and separated, a long title wraps to two and a short one does not, nothing overflows the panel
sideways at 1300px, and the icons appear at the top-right of the row — level with the *first* line of
the title, which is the thing `align-items: flex-start` is for — on hover and on focus alike. The
tooltip was read off the DOM rather than the screen, because a native `title` does not appear in a
screenshot; it read exactly:

```
Summarize the main argument in two sentences.

Started 26 Aug 2026, 15:06
Last message 26 Aug 2026, 15:29
6 turns
```

The header's bin was pressed once and read back: `title` became "Press again to delete this
conversation" and the class gained `armed`, and it disarmed itself afterwards. There is one thing in
that worth writing down, because it is the sort of thing that reads as a bug. **In a hidden tab it
did not disarm on time** — it was still armed at six seconds and at eleven — and went back to grey
the moment the tab came to the front. That is the browser throttling `setTimeout` in a background
tab, not the timer being wrong, and it is one more entry in the list
[browser-testing.md](../project/browser-testing.md) keeps of the ways a hidden tab lies to you. No
console warnings at all: no key warnings, and no nested-interactive complaint, which is the one a row
with a button beside a button would have earned.

**What was tried and backed out.** The stored title cut was going to go from sixty characters to
ninety, with `titleFrom` moved into a shared pure module so that the optimistic title the client
writes and the one the server stores stopped being two implementations of the same rule. The review
killed it on scope rather than on merit: it touches `src/chat.ts`, which at the time held another
agent's uncommitted removal of the not-migrated guard, and there is no way to commit half a file
safely in a shared tree — see [version-control.md](../project/version-control.md). It is worth doing
on its own once that has landed, and it would carry a real bug with it: **a rename longer than the
cut is displayed and sent whole**, while both stores apply `titleFrom`, so it stays long until the
next reload and then changes under the reader.

### The box under the list, which saves the click

Greg, 2026-08-27:

> When I open Chat mode, it shows a list of previous chats, with a small button to start a new chat
> in the top-right of the panel. Since that's frequently what the user will want to do, let's add a
> text input box at the bottom that (when a message is input) automatically starts a new chat, to
> save the user a click.

So the list now ends in a composer, and typing a question into it and pressing Enter mints a
conversation and sends the question into it in one go. The `+` in the header stays — it is the way
to get an empty conversation with the suggestions in it, which is a different thing to want.

It is the same [`Composer`](../../src/web/ChatPanel.tsx) the conversation uses, third use of it after
[`ChatDialog`](../../src/web/ChatDialog.tsx), with a placeholder saying where the question is going:
*"Ask something new…"* rather than *"Ask about this article…"*, because the box beneath a list of
conversations has to say which one it is talking to.

Two things make it safe, and each was written by a review finding the state it had missed. Both
findings are the same shape: **the list being on screen does not mean what it looks like it means.**
The panel picks between list and conversation with `threads.find`, so the list is also what a reader
sees while the first fetch is in flight, and `?thread=` can still name a conversation — one from a
bookmark that has not arrived, or one that was closed and discarded.

- **The question goes down `onSendNew`, which always mints.** The ordinary `onSend` means *send to
  the open conversation*, and `ConversationBand` resolves that against `?thread=`. The first version
  used it, on the reasoning that `?thread=` is null whenever the list is showing — which is the thing
  that is not true. A reader opening a stored `?thread=` from a bookmark, or from the floating
  dialog's *"open in full chat"*, would have had their question **appended to that conversation**,
  under a placeholder promising a new one, past the `busy` guard, and possibly on top of an answer
  still arriving.
- **The box is offered only once the fetch has landed on a list with something in it** —
  `loaded && threads.length > 0`. It went in as a safety guard: minting before the fetch landed was
  no better than joining, because `refresh` on arrival replaced the whole list with the server's
  snapshot and took the just-minted conversation with it, so **the reader's question disappeared off
  the screen while its request carried on**. Both halves were needed for that, and the second
  review's own suggested guard — a non-empty list — is what the third review broke: press `+` before
  the fetch lands, type a draft, close the conversation, and `leave` above keeps that thread
  *because* there is a draft in it. A list, still loading.

  **That reason has since been fixed at its source** — see the next section — so what the guard now
  does is presentational, and it stays for that: a box saying *"Ask something new…"* under a list the
  reader cannot see yet is offering to start a second conversation in a panel that has not admitted
  to having a first, and an empty list is what the `+` and the empty panel's own button are for. Both
  halves still earn their place; neither is load-bearing for safety any more.

The second detail: **it is passed `focusNonce={0}` and a focus counter of its own.** The composer
takes the caret when the nonce rises, and that is right when a reader has just *asked* for somewhere
to type — arriving at a list is not that, and a focused textarea turns the article's ↑/↓ into caret
movement with nothing on screen saying why. A separate counter, because spending the panel's one
here would leave the real composer unfocused the next time a conversation was started. `onSendNew`
*does* raise it, so the caret carries into the conversation that opens, in the composer that has just
replaced the one the reader typed into.

Its draft is kept in a ref of its own rather than in the panel's `drafts` map, which is keyed by
thread id: this box belongs to no conversation, so there is no id to key it by, and a question typed
there and abandoned — for a row in the list, or for the loading state, which takes the box away
entirely — is still there on the way back.

[tests/chat-list-composer.test.tsx](../../tests/chat-list-composer.test.tsx) renders the panel and
drives the box: it sends down the call that mints and never the one that joins, empties itself,
ignores whitespace, never takes the caret, keeps a half-typed question across both ways of losing the
box, is **absent in the three states above**, and is **there under a `?thread=` this panel has
nothing for** — which is the state the first version got wrong and the one the fix has to keep
working. Every one was watched failing first, against the wiring swapped back to `onSend` and against
each half of the guard removed in turn.

### The list arriving is not allowed to overwrite what the reader did

The composer above is guarded because of a bug that was never the composer's: **the answer to the
load on arrival was written straight over whatever was on screen** — `setThreads(fresh)` in
[useChat.ts](../../src/web/useChat.ts) § `refresh`. That looks safe, on the reasoning that a panel
which has only just mounted has nothing on screen to lose, and it is true for exactly as long as the
fetch takes and no longer. Greg hit the visible half of it on 2026-08-27 — *"I tried loading Chat
mode on a slow internet connection, and it initially told me there were no chats"* — and everything
a reader can do inside that window landed in a list the response was about to replace:

- press `+` and get a conversation, and it is **gone** when the list lands;
- type a question into it and send, and the conversation goes with it while its request carries on.
  Every later frame of the answer then patches a row that is not there, so **the answer arrives
  nowhere** and the reader is looking at a list with no sign they ever asked anything;
- delete a conversation, and the older snapshot **puts it back**;
- and one that is not about the reader at all: **two loads of one article can be in flight at
  once**, and they can answer in either order. `StrictMode` runs the mount effect twice
  ([main.tsx](../../src/web/main.tsx)), so this is a development-only state — `Reader` is keyed on
  the slug, so changing article remounts the hook rather than re-running its effect, and nothing
  else starts a second arrival load. I claimed otherwise here first and GPT Sol corrected it. Worth
  guarding anyway: the `loadFailed` bug fixed the day before was the same shape and cost a day of
  believing a panel that said it could not load a list it was showing.

So `refresh` now does two things on arrival. The server's list is **added to** what is on screen and
never applied over it — `mergedArrival`, and its two rules are each a rule this file already keeps
somewhere else:

- **a row already on screen wins.** Not *unless the server's is newer*: ours is newer by
  construction, because the mount effect empties the list before it fetches, so everything in `prev`
  was put there afterwards by this tab, from a send this tab is watching. The server's copy of the
  same conversation is at best equal and at worst the half-written one it had when it answered — the
  question stored, the answer still streaming — and a response crawling back over a slow connection
  can be that stale even after the send it is behind has *finished*. The first version of this fix
  was narrower: it protected a conversation only while a send was still **running**, which is the
  narrowing [`refresh(only)`](../../src/web/useChat.ts) already makes. That rule passes four of the
  five tests and fails the fifth, which is the one where the answer completed before the list landed
  — so the rule with no timing in it is the one that is right;
- **deletions win**, which `put` has always said and the arriving list did not. A conversation the
  reader deleted while the fetch was out is still in the snapshot, because the send that created it
  told the server; putting it back reads as the delete button not working.

Both are the arrival load's alone. Neither would be safe for `refresh(only)`, where the screen is
the thing known to be wrong and a thread the server does not have is one somebody else deleted —
which is why that branch takes the server's copy, and deletes on its absence.

And it **numbers its loads**, so a response belonging to a load that a later one has superseded may
neither write nor complain. Merging covers half of that on its own — a stale snapshot answering *after* the
current one finds the fuller list already on screen, and the row on screen wins. It is the other
order that needs the number: the stale one answering **first**, when there is nothing on screen to
defend with, puts its shorter copy there — and the current response, arriving second, is then the
one that loses. The conversation sits a message short until the next reload. This is the same
distinction `loadFailed` was bitten by and fixed for in
[load-failed-flags.test.ts](../../tests/load-failed-flags.test.ts): `showing.current` tells
**articles** apart, and what has to be told apart here is **loads of one article**.

**Neither write nor complain**, and the second half was GPT Sol's, reviewing this: the `catch` was
still guarded on the slug alone, so a superseded load *failing* after the current one succeeded put
a failure message over a list that was on screen and correct. The exact shape
[load-failed-flags.test.ts](../../tests/load-failed-flags.test.ts) had fixed the day before for the
`loadFailed` flag — and a reminder that guarding a fix's write path is not the same as guarding the
request.

**What is still not covered**, and was not before either: `deleted` holds the conversations *this
tab* deleted, so a slow arrival response can still bring back a conversation that **another tab**
deleted while it was in flight. GPT Sol found it; it predates this change and the old
`setThreads(fresh)` had it too, so the merge is not what to fix it in. It wants a server-side
`deletedAt`, or a version on the list the client can compare.

[tests/chat-arrival-race.test.ts](../../tests/chat-arrival-race.test.ts) is seven cases: the three the
reader can cause, the answer that *finished* before the list landed, the two orders the double load
can answer in, and the superseded load that fails. Each was watched failing against the old `setThreads(fresh)`; the finished-answer
one was watched failing against the narrower still-running rule as well; and the superseded-load one
was watched failing against the merge with the number taken out, so each half of the fix has a test
that fails without it. The double-load pair mounts under the real `StrictMode` rather than an
imitation of the double run.

### And the one line the composer's own tests could not reach

[tests/chat-list-composer.test.tsx](../../tests/chat-list-composer.test.tsx) pins the panel's half of
the contract and [use-chat-recovery.test.ts](../../tests/use-chat-recovery.test.ts) pins the hook's,
that `send(null, …)` mints rather than joins. Between them sat `ConversationBand`'s `onSendNew`,
untested — both sides green and the value that crosses between them never exercised, which is the
classic gap and, here, the exact line the first version of this feature got wrong.

[tests/conversation-band-send-new.test.tsx](../../tests/conversation-band-send-new.test.tsx) drives
the real component with the real hook, `ChatPanel` stubbed to capture what it is handed, and reads
the one thing that says where the question went: the `threadId` in the request body. With `?thread=`
naming a stored conversation, the question must go somewhere else, `?thread=` must follow it, and the
focus nonce must rise. Watched failing against a copy of `ConversationBand` wired back to `thread`.

That needed `ConversationBand` exported from [App.tsx](../../src/web/App.tsx), which nothing else in
the repo does — the alternative was the source-text assertion
[glossary-band-wiring.test.ts](../../tests/glossary-band-wiring.test.ts) settles for, and this seam
is worth the real thing.

## What is still open

- **Three of the review's fixes have no regression test**, because this repo had no way to render a
  React component in a test — no `@testing-library/react`, no jsdom render anywhere. *That part is
  out of date since 2026-08-27:* `createRoot` under `@vitest-environment jsdom` works, and
  [tests/chat-list-composer.test.tsx](../../tests/chat-list-composer.test.tsx) renders this very
  panel. The three fixes below still have no test; they are now merely untested rather than
  untestable. The clipboard
  guard, the edit box surviving a `busy` flip, and `stick`/`away` agreeing are all verified by hand
  and by eye and by nothing else. Adding a component test runner is a dependency decision with a
  procedure attached ([third-party-library-selection.md](../reusable/third-party-library-selection.md))
  and is bigger than this change should be making on its own.
- **A dropped SSE stream used to leave the panel on "thinking…" for ever.** Fixed 2026-08-26 —
  the design, the three bugs found on the way and the two holes it does not close are all in
  [sse-stall-recovery.md](sse-stall-recovery.md). In short: the server beats every 15 seconds so
  that silence means something, the client puts a 60-second clock on the *bytes* rather than on the
  frames, and any `pending` answer that no local stream owns gets polled for until the server's own
  deadline has passed — which covers a stream this tab lost *and* a row inherited from a hook that
  has since remounted, since they are the same row in the same state.

  Still open from it: a `fetch` that hangs before the response headers is not covered, and a stream
  lost before the `begin` frame cannot be recovered because the client is holding a message id it
  invented.
- **A stop the server cannot honour says nothing.** `POST /stop` answers `{ stopped: false }` when
  there was nothing to stop, and the panel ignores it — rightly, in the common case, which is a stop
  pressed on an answer that finished a moment ago. In the two-server case, though, the reader presses
  stop, gets a 200, and watches the words keep arriving with no explanation. Telling the two apart
  needs a timer, and the underlying problem is the same one a lock file or
  [postgres-migration.md](postgres-migration.md) closes.
- **No keyboard shortcut** switches mode, and none opens the chat. The app has no shortcut map at
  all yet — the same gap [bottom-bar.md](bottom-bar.md#what-is-still-open) records. Escape now does
  three things *inside the composer*, which is not the same thing as a shortcut map.
- **A cited id that is real but wrong** — the model points at a neighbouring paragraph — is
  undetectable from here and uncounted. Only `unknownIds` catches an id that does not exist.
- **Markdown beyond bold is literal.** `*italics*`, `` `code` `` and links come out as the
  characters the model typed. Nothing has asked for them yet; the constraint on adding them is
  above.
- **The band's width does not remember anything.** It is `MODE_IDEAL` clamped by what the prose can
  spare, with no reader control. A drag handle is the obvious next thing to want.
- **Narrow windows.** Below roughly 900px the band and `PROSE_MIN` together overflow and the page
  scrolls horizontally. That is the same behaviour the ToC mode has when the columns do not fit, so
  it is at least consistent, but nobody has looked at it on a small screen.
- **No evidence it helps.** Which is the criticism the previous version earned, quoted at the top of
  this file, and repeating their mistake would mean never asking. [Q6](../project/open-questions.md#q6)
  is where "how would we know we are failing at this" lives.

## The cross-family review, and what it found

The plan above was reviewed by **GPT-5.6 (Codex CLI)** on 2026-08-26, after the code was written —
see [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md). Its verdict was **NO-SHIP**,
and it was right. Ten of its thirteen findings were fixed the same day; the list is worth keeping,
because the *shape* of what a different model family caught is the reusable part.

**Four were things the tests could not have caught, because the tests agreed with the code:**

- **`recentHistory` dropped half a turn.** A failed answer was filtered out and its question kept,
  so the model received two user turns in a row and answered the abandoned question again. The test
  named "drops turns that never got an answer" **pinned the bug** — it asserted the broken output.
  A test written from the same misunderstanding as the code is worth less than no test, because it
  reads as coverage.
- **The citation parser deleted prose.** `[see spya-k3m9qt for discussion]` matched as a bracketed
  citation and was replaced whole, so "see" and "for discussion" vanished from the model's answer.
- **A truncated stream was committed as complete.** See the table above.
- **`citedBlocks` did not exist**, so an answer that cited nothing at all logged as healthy.

**Three were "the comment says X, the code does Y":**

- `fitMode` said `showText` was ignored and the prose always on. It was ignored *in the arithmetic
  only* — App went on passing the reader's `showText` to `TableView`, so entering chat from outline
  mode (`?text=0`) rendered a chat panel beside an **entirely empty table**. The rule now has one
  home, `proseVisible`, and both callers read it.
- The stall timer's comment said keep-alives counted as activity. They were discarded inside the SSE
  parser before the consumer could see them, so a live connection through a long web search was
  aborted as stalled at 45 seconds.
- The security doc said there was exactly one place model output reached an `href`. Chat had quietly
  made it two, unvalidated — and an unparseable URL crashed the panel mid-render, because
  `new URL()` throws rather than returning null.

**And one was a bug fixed while fixing a bug.** Sharing the new URL check between the server and the
panel by importing `src/converse.ts` from `ChatPanel.tsx` type-checked, built, and worked — and put
the whole server module in the browser bundle, 24KB and the string `OPENROUTER_API_KEY` included.
The key's value was never there; the system prompt and request shape were. `src/urls.ts` exists
because of it, and [`tests/client-imports.test.ts`](../../tests/client-imports.test.ts) now fails the
build for the whole class.

### The second cross-family pass, run a day late

The review above was of the *plan*. A second one, of the five affordances as built, was written the
same morning and could not run: the Codex workspace was out of credits, and stayed out through three
attempts. It ran on 2026-08-26 once Greg refilled, against code that had moved on twice since the
brief was written — the verdict was **NO-SHIP**, with two High findings, and both were real.

**A refusal used to cost somebody else their answer.** A retry or an edit stops the live stream in
the conversation and waits for it (`settleThread`) *before* checking whether the request is one it
will accept. So a second tab retrying a turn that is no longer the last one aborted the answer the
reader in the first tab was watching, stored it as `stopped`, and only then returned 409. That
reader pressed nothing and was told they had stopped it, and no replacement came. Two tabs on one
conversation is the exact case `ChatConflict` exists for, so this was not exotic.

The fix costs one file read: `withRetry` and `withEdit` are pure, so the route runs the real rule
against a snapshot and throws it away. Whatever they would refuse is refused before anything
destructive happens. The authoritative run is still the one inside the store's queue — this is a
gate, not a substitute for it.

**A turn could be appended into the gap.** `settleThread` stopped the streams it could see when it
started and had no way to stop a *new* one arriving during the wait. One that did was appended by
`beginTurn`, streamed to the tab that asked for it, and was then truncated away by the edit that had
been waiting — and its `finishTurn`, finding no row, wrote nothing at all, by design. A complete
answer on screen that was not anywhere. Deciding and writing a turn now happen under a per-conversation
lock (`inTurnOrder`), released before the model is called, so two conversations never wait on each
other and a long answer blocks nothing.

**And a stop could stop the wrong answer.** The `streaming` key names a *row*, and a retry
deliberately reuses the row — so a stop pressed on one attempt, arriving after that attempt finished
and a retry started, aborted the retry. Every `Live` now carries an attempt number, the `begin` frame
carries it to the client, and `/stop` refuses a mismatch with the same `{stopped: false}` it already
returns for "that finished a moment ago", which is true in the only sense the reader means it.

Three of the Mediums and Lows were the same shape as each other — **a screen that is confidently
wrong**:

- A **409 left the optimistic edit on screen**: the question rewritten, the turns below it gone, and
  only the answer marked failed. It looked exactly like a successful edit until a reload put the
  conversation back. The client now refetches on 409, so the reader gets their conversation *and* a
  line saying why nothing happened.
- The **auto-follow effect could not see the frame that ends an answer** — `done` changes neither the
  character count nor the number of rows, while adding the action row and the whole source list. So
  the one commit that reliably grows the transcript past the 60px slack was the one commit the effect
  did not run on: pinned to the bottom, answer finishes, reader ends up above the sources with no
  Latest button either. That is [the same bug](#what-a-browser-pass-found-that-neither-review-did)
  as before, surviving its own fix in the dependency array.
- **Copy said nothing to a screen reader.** A tick replacing a clipboard icon is not an event, so a
  copy that failed was indistinguishable from one that worked — with the reader's clipboard still
  holding whatever was in it. A live region now says which.
- **An open editor ignored `busy`.** The pencil is withdrawn while an answer arrives and an editor
  already open is deliberately left alone; nothing stopped it being *submitted*, which discarded the
  row being streamed into. The editor still stays; its Ask-again is what waits.
- **Cancelling an edit dropped focus to the body**, losing a keyboard reader their place in the
  transcript. It goes back to the pencil.

**And one finding was about a test, which is the one worth repeating.** "Never reuses an id it just
discarded" handed `withEdit` a real `Math.random` and asserted the new id was none of the discarded
ones — odds of 771 million to one, whether or not the rule existed. It was worse than that: the
fixture's ids were `"u1"`, `"a2"` and so on, which are not in the id alphabet and could never have
been minted at all. The assertion could not fail. `withEdit` now takes an optional generator, for the
same reason `mintId` and `mintUniqueId` already do, and the rigged one offers a discarded id first.
Two reviews running have now found a test that pinned nothing; the tell both times was a test whose
inputs came from the same assumption as the code.

Two comments were corrected rather than any code: the `settleThread` wait is **not** bounded here
(what bounds it is the deadline and stall timer inside `converse`), and the composer does **not**
keep Escape from Dock.tsx — that listener is on `window` in the capture phase and has already called
`stopImmediatePropagation` before React's handler runs. The drawer wins, which is the right order,
but it wins rather than being stopped.

[`tests/chat-live-turn.test.ts`](../../tests/chat-live-turn.test.ts) pins the first of the two Highs
and the stop-token bug by driving the real route with a body that says one word and then hangs, which
is what a live answer is. The per-conversation lock is checked separately and differently — see the
round below.

### And a third pass, on the fixes themselves

The fixes above were sent straight back to GPT-5.6, because a concurrency fix written quickly is
exactly the kind of change that trades one race for a worse one. **NO-SHIP again**, two more Highs,
and both were the first fix's own new failure mode rather than anything older.

**The attempt counter could collide across processes.** Attempts were numbered `1, 2, 3…` from a
module variable, with a comment saying they were never reused — true within one process, which is not
the claim that matters. Two servers on one `data/` directory both start at 1, so server A's stale stop
for attempt 1 matches server B's live attempt 1 exactly and aborts an answer nobody asked to stop:
*the bug the field was added to prevent, wearing the fix as a disguise.* It is a `randomUUID` now.
Nothing else changed, and the client never looks at the value.

**The 409 refetch could erase a newer answer.** Refusing an edit put the server's copy of the *whole
list* over the top of the screen — including conversations the refusal had nothing to do with. A send
running in another thread had its optimistic rows replaced by a snapshot taken before them, and every
later frame of that stream then patched a row that was not there: an answer that arrives nowhere, or a
spinner that never clears. The refetch now replaces exactly one conversation, and skips even that if
another stream is still writing into it.

A **delete** was brought under the same per-conversation lock, because a delete landing between an
edit's check and its write put the abort-then-refuse bug back in a narrower window.

**And the test written for the lock did not test the lock.** It set up a send arriving during an
edit's settle, and it passed with the lock taken out — because the settle window it aimed at closes in
under a millisecond and nothing outside the process can hold it open. The one lever available, a slow
`cancel()` on the response body, is dropped on the floor: `openrouter-stream.ts` cancels once
un-awaited on abort, so the awaited cancel afterwards is a no-op. That test is gone. What replaced it
is [`tests/turn-order.test.ts`](../../tests/turn-order.test.ts), which checks the lock's own
contract — that it excludes, that it keeps its order, that two conversations do not wait on each
other, and that a turn queued behind a failing one still runs.

Writing that last one turned up a line of the lock that was **dead code with a comment claiming it was
load-bearing**: `before.then(fn, fn)`, whose second handler existed to keep a rejection from breaking
the chain. It could never fire — what a turn waits on is the previous turn's *tail*, and the tail
already swallows both outcomes. The property was real and the comment pointed at the wrong line for
it. That is the third pass running in which the interesting finding was about a test or a comment
rather than about code.

Two comments were corrected: the lock does **not** make two conversations independent (the store's
`update` is one queue for the whole process — the lock is narrower than that queue, not wider), and
focus after an edit box closes is restored only when the pencil is there to receive it.

### What the browser said about all of it

Driven in a real browser after the third round, with `curl /api/chat/<slug>` read back at every step
— which is not belt and braces here but the method: three of the bugs above were states where the
screen was right and the file was not, or the reverse.

All eight checks passed. Stopping an answer and immediately retrying it produces a genuinely fresh
stream rather than one that dies at birth, which is the attempt token doing its job. An edit box left
open while another answer streams has its Ask-again button `disabled` with the right title (checked in
the accessibility tree, not by eye — it is a 12px glyph and a screenshot cannot tell). Escape out of
an edit box puts the caret back on the pencil (checked with `document.activeElement`). An answer
finishing leaves the reader at the bottom rather than stranded above the sources. Drafts survive
closing a conversation and do not follow the reader into another one.

**Every apparent failure traced to something else.** The tree had four other agents editing it
throughout, so the panel showed "Couldn't reach the dev server" and stuck spinners repeatedly — and
every time, the backend had completed and stored the turn correctly. That is worth writing down
because it is the trap this kind of testing sets: a shared dev server under hot reload produces
symptoms indistinguishable from the bugs being looked for, and the only way to tell them apart is to
ask the server directly. The one thing still unverified by anybody is the copy button, for the third
time, because `navigator.clipboard.writeText()` does not resolve in an automation tab.

### What was deliberately not fixed

- **Two servers on one `data/` directory can lose a message.** The read-modify-write queue is
  serialised per *process* — the same property `comments.ts` has always had — so two `npm run dev`
  instances can each read, each append a turn, and each rename a complete file over the other. Real,
  and it happened during development when a second Vite grabbed port 5275. The honest fix is a lock
  file, which is a bigger decision than this feature should be making alone, and the whole thing goes
  away with [postgres-migration.md](postgres-migration.md). What *was* done is the cheap half: the
  orphan sweep now leaves any `pending` message younger than 150s alone, so a second server no longer
  marks a live answer as failed while the reader watches it arrive.
- **An unsent draft lives only as long as chat mode is open.** Type a question, do not send it,
  switch to the table of contents and back: the panel was unmounted, the empty conversation went with
  it, and so did the words. Storing drafts would mean `localStorage` or a server round trip for text
  the reader has not decided to send, which is a bigger promise than "your box is as you left it
  while you are looking at it". What it does buy is the case Greg reported — closing a conversation
  and reopening it.
- **A thread id the server overrules costs the reader their draft, their scroll position and their
  caret.** The conversation view is keyed by thread id so that switching conversation gets a clean
  one, and `beginTurn` may hand back a different id than the client guessed — a collision, or an id
  somebody typed into the URL — which remounts it mid-turn. Collisions are ~1 in a billion and the
  other case is URL tampering, so this is knowingly left. Fixing it means the panel learning about an
  id correction it currently has no reason to know about.
- **Sending, leaving chat mode and coming straight back can hide the conversation you just started.**
  The panel is unmounted on a mode change, taking its in-flight state with it, and the fresh load on
  the way back races the server writing the turn down. Lose that race and the new conversation is not
  in the list until the next reload; the answer is on disk either way. The window is the few
  milliseconds before `beginTurn` returns.
- **Focus does not follow a mode change that came from outside the radio group** — browser Back, for
  instance. Focus can be left on a button that is now `tabIndex={-1}`. Moving it on every external
  change would be worse: it would steal focus from wherever the reader actually is. Recoverable with
  one Tab.

## See also

- [vision.md § Anti-goals](../project/vision.md#anti-goals) — the objection this feature has to answer
- [original-version/search-and-chat.md](../project/original-version/search-and-chat.md) — their chat, and what went wrong with it
- [comments.md](../project/comments.md) — select a passage and ask about *that*; the older, narrower feature
- [bottom-bar.md](bottom-bar.md) — the bar the Chat button lives in, and the two kinds of button it used to have
- [block-ids.md](../project/block-ids.md) — the contract the citations rest on
- [url-state.md](../project/url-state.md) — `?mode=` and `?thread=` among the rest
- [logging.md](../project/logging.md) — what a model call may and may not write down
- [web-client.md](../project/web-client.md) — the reading view this is a mode of
