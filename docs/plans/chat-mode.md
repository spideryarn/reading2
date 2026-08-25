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

## What is still open

- **No keyboard shortcut** switches mode, and none opens the chat. The app has no shortcut map at
  all yet — the same gap [bottom-bar.md](bottom-bar.md#what-is-still-open) records.
- **A cited id that is real but wrong** — the model points at a neighbouring paragraph — is
  undetectable from here and uncounted. Only `unknownIds` catches an id that does not exist.
- **Markdown beyond bold is literal.** `*italics*`, `` `code` `` and links come out as the
  characters the model typed. Nothing has asked for them yet; the constraint on adding them is
  above.
- **No retry button** on a failed turn. The comment dialog has one; here you re-ask. Cheap to add
  and deliberately not added until somebody wants it.
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

### What was deliberately not fixed

- **Two servers on one `data/` directory can lose a message.** The read-modify-write queue is
  serialised per *process* — the same property `comments.ts` has always had — so two `npm run dev`
  instances can each read, each append a turn, and each rename a complete file over the other. Real,
  and it happened during development when a second Vite grabbed port 5275. The honest fix is a lock
  file, which is a bigger decision than this feature should be making alone, and the whole thing goes
  away with [postgres-migration.md](postgres-migration.md). What *was* done is the cheap half: the
  orphan sweep now leaves any `pending` message younger than 150s alone, so a second server no longer
  marks a live answer as failed while the reader watches it arrive.
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
