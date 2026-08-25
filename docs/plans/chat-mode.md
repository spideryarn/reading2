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

### The citation contract

The prompt in [`converse.ts`](../../src/converse.ts) requires a block id in square brackets on any
sentence that says what the article says. The panel splits the answer on the *shape* of one of our
ids rather than on the brackets, so a model that forgets the punctuation still gets working links.

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

## See also

- [vision.md § Anti-goals](../project/vision.md#anti-goals) — the objection this feature has to answer
- [original-version/search-and-chat.md](../project/original-version/search-and-chat.md) — their chat, and what went wrong with it
- [comments.md](../project/comments.md) — select a passage and ask about *that*; the older, narrower feature
- [bottom-bar.md](bottom-bar.md) — the bar the Chat button lives in, and the two kinds of button it used to have
- [block-ids.md](../project/block-ids.md) — the contract the citations rest on
- [url-state.md](../project/url-state.md) — `?mode=` and `?thread=` among the rest
- [logging.md](../project/logging.md) — what a model call may and may not write down
- [web-client.md](../project/web-client.md) — the reading view this is a mode of
