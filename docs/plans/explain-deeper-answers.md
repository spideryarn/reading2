# Making an explanation worth reading

**2026-08-26.** A reader selected the name **Ben Miller** in the acknowledgements line of Paul
Graham's *Writes and Write-Nots* and got back a correct, useless answer: that this is the
acknowledgements line, thanking three people who read drafts, and that it does not connect to the
argument. No web search. Greg:

> I asked for more context on this person, Ben Miller, and I basically got an immediate response
> like, oh, it's a person that's been acknowledged. Like, yeah, I get that. But I mean, it'd be much
> more interesting if you'd done some web searching to try and figure out who Ben Miller is.

This plan is four changes. The first is the one that mattered most — it is a prompt fix and it costs
nothing at runtime; the other three are the affordances Greg asked for around it. **All four are
built.** What each section describes is what is in the code, and
[§ What the review changed](#what-the-review-changed) is the list of things this plan got wrong
before it was.

## The diagnosis, which is not "the search encouragement was too weak"

The model did not decline to search. It was never asked a question whose answer it lacked.

[`src/explain.ts`](../../src/explain.ts)'s prompt asked exactly one thing — what does this passage
claim, and where does it sit in the argument — and the model answered exactly that. It was sure what
an acknowledgements line is, and it was right. `USE IT unless you are genuinely sure` could not fire
because the gap never opened. Turning the encouragement up would have changed nothing.

**We had already solved this, in the glossary, on this same article.**
[`src/glossary.ts`](../../src/glossary.ts) splits an entry in two:

- **`senseHere`** — what *this* author means by the term. From the article and only the article.
- **`background`** — what the reader has to bring *to* the piece: who this person is, what this work
  is, what the term means outside this article. The model's own knowledge, labelled as such.

and its worked example is the Lamport quotation two paragraphs above the line in question. Its
verdict on the bad version is the sentence this plan is named after:

> BAD — "senseHere": "Computer scientist quoted for the line 'If you're thinking without writing,
> you only think you're thinking,' which the article uses to argue writing and thinking are
> inseparable."
> **That describes the page the reader is looking at. It is the whole failure.**

Explain had the first half only. It gave a `senseHere` answer to a `background` question. A short
selection — a name, a title, a term of art — is almost always the second question wearing the
first's clothes, and nothing in the prompt said so.

There is a second borrowed line.
[original-version/glossary.md § The prompt](../project/original-version/glossary.md#the-prompt-which-is-the-best-written-one-over-there)
had already recommended one for this exact file and nobody had moved it across:

> If you need to draw on knowledge from outside the text, be very explicit about it, e.g.
> "_Although the text doesn't mention it, ..._" or "_As you may know, ..._"

## 1. The prompt — **done**

Rewritten in [`src/explain.ts`](../../src/explain.ts). Four additions:

- **Two questions, named.** *What the author means here* (from the article) and *what the reader has
  to bring to it* (from the model and the web) — with the rule that a short selection is almost
  always the second, and that "somebody who selects two words is not asking what the sentence around
  them does".
- **The failure, stated exactly**, in the glossary's words: describing the page the reader is
  looking at. And the consequence — *not knowing who the person is, is not a reason to describe the
  line; it is the reason to search.*
- **Lean towards searching.** Greg, 2026-08-26: *"Lean towards a web search, and try and do the right
  thing without the user needing another action."* The trigger is now about the **selection**, not
  the model's confidence, because confidence was the thing that failed: *a named person you cannot
  place with at least one concrete, checkable fact. A category is not a fact.* Plus: aim the search
  with the article — the author, the date, the other names — because searching a bare common name
  wastes the call.
- **Say where it came from**, the borrowed line above, plus permission to fail honestly: if after
  searching it still cannot place something, say so in one sentence and stop.

### Measured, not assumed

Both run live against `data/writes/` on 2026-08-26, `anthropic/claude-sonnet-5`:

| Selection | Before | After |
|---|---|---|
| `Ben Miller` | 0 searches. *"This is simply the acknowledgments line at the very end…"* | **3 searches.** *"…the name is too common to pin down without more context than the piece provides"* — names the Fundrise CEO and a GovTech editor as candidates and declines to guess. |
| `Robert Morris` | — | **0 searches**, and a real `background` answer: *"As you may know, Morris co-founded Viaweb with Graham… he's also a computer scientist at MIT known for writing the 1988 'Morris worm'… that background comes from outside the piece rather than from the text itself."* |

The second row is the one that says the change is a fix rather than a bigger hammer: it did **not**
search, because it could place him with concrete facts, which is exactly the rule as written.

> [!NOTE]
> **Ben Miller may be genuinely unfindable**, and that is a fine outcome. Three searches produced an
> honest "there are several people by this name and the article does not say which". That is worth
> far more than a confident wrong guess, and it is what the "fail honestly" clause is for.

One more tuning round was needed and is in. The first after-answer *opened* by narrating the search
— "None of these search results confirm…" — because the honest-failure clause is the last thing
before FORMAT and recency won. FORMAT already said "no preamble, begin with the explanation itself"
and the model overrode it, so the fix was not another rule but a worked example, in the glossary
prompt's own BAD/GOOD style: *BAD — "None of these search results confirm which Ben Miller is
meant." GOOD — "Ben Miller is not a public figure the way the other two names are."* Write the
not-knowing as a fact about the subject, not as a report on your looking.

The rule then moved *into* FORMAT beside those examples, as a numbered order — what you did
establish, then in one sentence what you did not — because the two halves were in different sections
and only the last one was being obeyed.

> [!NOTE]
> **This is better and it is not fixed, and the difference is worth writing down.** Three live runs
> after the change: two open correctly (*"Jessica Livingston and Robert Morris, the other two names
> in this acknowledgement, are easy to place…"*), one still opens *"None of these searches turn up a
> Ben Miller…"* — despite an explicit "never open with 'None of'".
>
> It is a soft constraint losing to a hard case. `Ben Miller` is the one selection in this article
> where the negative genuinely is most of the answer, so the model keeps reaching for it first. The
> **substance** is right on every run — it searches, it places the two names it can, it declines to
> guess — and only the opening sentence wobbles. Pushed harder, it drifts the other way instead and
> starts with *"This is one of the three people Paul Graham thanks at the end"*, which is the
> original failure. Left here rather than tuned further: the remaining cost is one sentence of
> style on the hardest question in the piece, and the next change would be over-fitting to it.

## 2. Streaming the answer — **done**

Greg, 2026-08-26: *"see if you can make the text stream in (if that won't be too complex)"*.

It is not too complex, because **chat already does all of it** and none of the plumbing is
chat-shaped. The measured wait is ~16s for one explanation; that is a long time to watch a spinner
when the first sentence is usually the one you wanted.

What exists, and where:

| Piece | Today | Needed for explain |
|---|---|---|
| OpenRouter SSE → objects | `sseChunks`, [`src/converse.ts`](../../src/converse.ts) — module-private | export, or move to a shared `src/openrouter-stream.ts` |
| The `stream: true` request | converse.ts, incl. `stream_options: { include_usage: true }` — **without which usage counts come back null on a stream** | copy into an `explainStream` generator |
| Server frames | `frame()` closure inside `streamChat`, [`src/routes.ts`](../../src/routes.ts) — `begin` / `delta` / `done` / `error`, SSE | extracted as `sse(res)`. Explain needs `begin` too — see the review note below; the plan was wrong to think it did not |
| The route shape | `handleApi` is raw Node `(req, res)`, so streaming needs no Web-stream conversion and Vite does not buffer | a second streaming branch drops straight in |
| Client reader loop | `readEvents` / `parseFrame`, [`src/web/useChat.ts`](../../src/web/useChat.ts) — private | export to `src/web/lib/`, reuse in `useComments` |
| Persistence | chat writes twice: a `pending` row before the call, a patch at the end. **Deltas are never persisted.** | `commentStore.create` / `.patch` already have exactly this discipline — no new storage code |

Two things to copy deliberately rather than by accident:

- **The dual clock.** converse.ts has an overall deadline *and* a 45s stall timer restarted on every
  read, because a stream that goes silent is a different failure from one that takes a long time.
  `AbortSignal.timeout` cannot be reset, so the stall timer needs its own `AbortController`. Explain
  today has a deadline only.
- **The post-loop invariants.** converse.ts throws if neither `[DONE]` nor a `finish_reason` arrived
  — an EOF mid-answer otherwise looks exactly like a complete answer. That is
  [silent-success.md](../reusable/silent-success.md) and it must come across with the code.

Not copied: the `streaming` map / `Live` / `settleThread` / `stopChat` machinery. That exists so chat
can stop and rewrite turns; explain has no stop button and no history to rewrite. `answering:
Set<string>` in routes.ts is the existing, sufficient version.

**Partial text on failure is kept**, as chat does: the `error` frame carries what had arrived, and it
is patched onto the comment. Half an answer plus a reason beats a spinner that turns into nothing.

## 3. A "search the web" button — for a *deeper* search — **done**

Greg: *"maybe add the 'Web search' button to do a deeper web search"*.

The storage layer already supports this and nobody has noticed: `createComment` is **idempotent on
`id` and resets in place** — POSTing an existing id clears `answer`, `citations`, `searches` and
`error`, keeps `createdAt`, and re-answers. `useComments.retry(id)` is that call today, shown only
when `status === "error"`.

So the change is small: a `deep: true` field on the POST body, threaded to `explain`, which does two
things — raises `max_uses` from 4 to 8, and appends an instruction.

> [!WARNING]
> **The instruction must go in the *last* user part, not in `SYSTEM`.**
> [`buildExplainMessages`](../../src/explain.ts) puts the cache breakpoint on the article part, so the
> cached prefix is *tools + system + article*. A `SYSTEM` that differs between a normal and a deep
> call is a different prefix, which means a cache miss **and a second cache write of the whole
> article** — paying twice for the thing [prompt-caching.md](../project/prompt-caching.md) exists to
> stop us paying for once. The deep instruction rides after the breakpoint, with the quote.

> [!CAUTION]
> **And then the first draft did the same thing one tier lower, which is worse.** It raised
> `max_uses` from 4 to 8 for a deep call — a change to the **tool definition**, and tools render at
> position 0, *ahead* of the system prompt. This repo's own research says what that costs:
> [prompt-caching-anthropic.md § invalidation](../research/prompt-caching-anthropic.md) puts
> "Tool definitions (add/remove/edit)" in the row that invalidates all three tiers, and notes that
> neither of Anthropic's escape hatches is available on Sonnet 5. So the version that took pains to
> keep its instruction out of `SYSTEM` was throwing the whole cache away one field earlier, for both
> variants, and the only symptom would have been the bill.
>
> Caught by review before it shipped, 2026-08-26. **The cap is now the same on every call** —
> `MAX_SEARCHES = 8` — because a cap is not a quota: the model still decides whether to search at
> all. `deep` buys an instruction after the breakpoint and nothing else, which is free.
> `tests/explain.test.ts` pins the two tool arrays as equal rather than pinning either number, so
> the test fails on the *difference* rather than on a value somebody might legitimately tune.

UI: a button in the dialog footer beside the globe badge
([`CommentDialog.tsx`](../../src/web/CommentDialog.tsx):163 — the footer is
`justify-content: space-between` with `.cmt-delete { margin-left: auto }`, so anything inserted
before the Delete link lands on the left without touching the prev/next header). Label it for what
it does — "Search the web properly", not "Retry".

It **replaces** the answer rather than appending one. A comment is one question and one answer, and a
second answer would need a schema change and a panel that can show two. Asking again is cheap; this
is the reader saying the first answer was not good enough, not asking for a comparison.

## 4. A follow-up box that opens a chat — **done**

Greg: *"Add a follow-up text-input box, but if the user enters text into it, it should automatically
open up as a new chat (rather than making the [explanation dialog] itself too complex)."*

This is the right call and it is what keeps the comment schema at one question, one answer. The
dialog gets an input; typing in it and pressing enter leaves the dialog behind and lands the reader
in chat mode with the question already sent, the selected quote quoted above it.

The obstacle is real and worth stating before anyone estimates this: **`useChat` is mounted only when
`mode === 'chat'`**. `ChatBand` is rendered at [`App.tsx`](../../src/web/App.tsx):676 and calls the
hook inside itself, deliberately, so a reader who never opens chat never pays for the fetch.
`CommentDialog` is a sibling *outside* that gate, so it has no `send` and no `threads`.

Two ways across, and we take the first:

- **A. A handoff box.** A module-level "pending question" cell (`src/web/chat-handoff.ts`), set by
  the dialog, read by `ChatBand` on mount, which calls `send(null, question, at)` and clears it.
  `send(null, …)` already mints the thread itself and returns its id, so no `begin()` is needed.
- **B. Lift `useChat` into `Reader`** so both share one instance — which costs every reader the chat
  GET that App.tsx:722-735 was written to avoid.

> [!WARNING]
> **The question must not go in the URL.** [`useChat.ts`](../../src/web/useChat.ts) already argues
> this for its own POST: *"the question does not belong in a URL — it is arbitrary length and it is
> the reader's private text, which would then be in every access log between here and the server."*
> A `?ask=` param would put the reader's private question into history, into any shared link, and
> into every log on the way. Hence a module-level cell rather than the obvious query parameter.

One trap to guard: `ChatBand`'s auto-start effect (App.tsx:811-822) calls `startNew()` when
`loaded && threads.length === 0`, which would stomp a handoff — and only for readers with no existing
conversations, so it would work in testing and fail for anybody who had used chat before. The handoff
must be checked before that effect can fire.

## What the review changed

The plan was reviewed against the code before any of §§2-4 was built. Six things came back that were
wrong or missing, and all six are now in the code above or in the list below. Recording them because
five of the six were silent failures — nothing would have errored, the feature would have looked
fine, and the cost would have been a wrong number, a lost answer or a question sent to the wrong
article.

- **The tools tier.** Above. The single most expensive item, and it was in the plan's own §3.
- **No `begin` frame.** The plan said the comment id is minted client-side so there is nothing to
  correct. But `createComment` **re-mints** an id that is malformed or collides
  ([`src/comments.ts`](../../src/comments.ts)), and a stream has no response body to carry the real
  one back — so the client would have streamed an answer into a row the server had never heard of,
  and a reload would have shown a different comment. `useChat.ts § Begun` is the write-up of that
  exact bug happening in chat. There is now a `begin` frame carrying the whole comment, and the
  client drops its optimistic row when the ids differ.
- **`answering` is a `Set`.** It was sufficient only because "Try again" appears solely on a *failed*
  comment, so two requests for one id could not overlap. A button on an *answered* one removes that
  guarantee, and then the first request to finish deletes the key while the second is still
  streaming — after which `sweepOrphaned` tells the reader "the server stopped before this was
  answered" about an answer arriving as they read it. It is now a refcount (`beganAnswering`).
- **A failed deep search destroyed a good answer.** `create` resets the row to `pending` before the
  model call, so a re-ask that fails leaves an error where the reader's answer was, with no undo and
  nothing left on disk. The client now keeps the old answer, shows it dimmed while the new one runs,
  and puts it back if the re-ask fails.
- **The handoff cell needed three guards, not one.** Keyed by slug (or article A's question, with
  A's quote, arrives in article B's conversation); expiring (or a question typed and abandoned fires
  days later, next time chat is opened); and — the subtle one — the auto-start effect reads
  `threads.length` from the render that *scheduled* it, so declaring the handoff effect above it is
  not enough. `started.current` has to be set **synchronously** before `send` is called. All three
  are in [`chat-handoff.ts`](../../src/web/chat-handoff.ts) and `ChatBand`.
- **"Do not invent. If the article does not say, say that it does not say."** Residue in the prompt
  from the version that produced the Ben Miller answer, sitting under `WHAT IT MUST NOT DO` where it
  reads as a hard constraint against the softer search guidance below it. For a name the model
  cannot place, the cheapest compliant answer is "the article does not say who Ben Miller is" —
  which *is* the failure. Rewritten: `"the article does not say" is not an answer on its own — it is
  the point at which you go and find out.`

Two more, found by writing the tests rather than by the review:

- **A stall ends the stream cleanly, not with a throw.** `sseChunks` cancels the reader on abort, and
  a cancelled read resolves `{ done: true }` — so a 45-second silence exited the loop with no error
  and was filed as "the answer stopped arriving before it was finished". Both sentences end in "try
  again", so no reader would notice; what is lost is the log line, which is the only thing that says
  whether to blame the network or the provider. `src/converse.ts` has the same shape, guarded only
  for the *reader's* signal.
- **`--surface` and `--focus` do not exist.** An undefined custom property is not a CSS error; it
  silently does nothing. The follow-up box now uses `--rule-strong` / `--page` / `--highlight`, the
  same three `.chat-input` uses.

## Order, and why

1. **Prompt** — done. Free at runtime, no UI, and it fixes the common case. Everything below is for
   the cases it does not.
2. **Streaming** — before the button, because it reshapes the route the button posts to. Doing the
   button first means building it twice.
3. **Deep-search button** — a flag on the new streaming route.
4. **Follow-up → chat** — independent of all of the above.

## What we are deliberately not doing

- **An "I couldn't place this — [search]" offer in the answer.** Proposed, and Greg chose against it:
  *"Lean towards a web search, and try and do the right thing without the user needing another
  action."* An affordance that appears when the model fails is a second-best to not failing.
- **Asking the reader for a question at selection time.** It would fix the ambiguity at the root, but
  it taxes the one gesture that makes this feature feel free. The follow-up box is the same idea
  moved to where the reader already knows what they want to ask.
- **Threading a comment.** See §3.

## See also

- [comments.md](../project/comments.md) — the feature, its four decisions, and the anchoring rules
- [glossary.md](../project/glossary.md) — the two-part entry this prompt now borrows
- [original-version/glossary.md](../project/original-version/glossary.md) — where the "be explicit
  about outside knowledge" line comes from, and the doc that had already asked for it here
- [prompt-caching.md](../project/prompt-caching.md) — why the deep instruction goes after the
  breakpoint
- [chat-mode.md](chat-mode.md) — the streaming machinery being borrowed
