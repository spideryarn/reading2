# Two things a browser pass found, and neither is the thing it was looking for

A Sonnet browser pass on 2026-08-28 was sent to check three behaviours of the rebuilt chat client
(cancel from a selection, reload persistence, rename persistence). The dev server it was using died
under it before it finished any of the three — that work is still owed. On the way it found two
bugs that have nothing to do with the rebuild, and both are the shape this repo keeps writing up:
**something reports success while doing nothing**
([silent-success.md](../reusable/silent-success.md)).

Neither is fixed here. [`src/routes.ts`](../../src/routes.ts) and
[`src/web/App.tsx`](../../src/web/App.tsx) both had uncommitted work from other sessions in them at
the time, and a fix committed from here would have swept it up — see
[version-control.md](../project/version-control.md). Written down instead, with the evidence, so
whoever owns those files next can land it in one sitting.

## 1. `?summary=1` has never once been routed

The reading view asks which conversations are anchored to which passage, so it can draw a mark on
the prose and say something on hover. It asks like this
([`useChatAnchors.ts:123`](../../src/web/useChatAnchors.ts)):

```ts
apiFetch(`/api/chat/${encodeURIComponent(slug)}?summary=1`)
```

The server has the answer ready. Inside the chat GET handler
([`routes.ts:3807`](../../src/routes.ts)) there is a branch for exactly this, with a comment
explaining why it is a parameter rather than a route and what re-rendering disaster it avoids.

**It is unreachable.** Every route in that file is matched against the raw `url`, query string and
all, and every pattern ends in `$`:

```ts
const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
```

`/api/chat/some-slug?summary=1` matches nothing, falls through to the 404 at the end, and the
reading view logs `No API route for GET /api/chat/…?summary=1` on every anchor refresh. The same
URL without the query string returns `200`.

There is a query-stripped `path` sitting three hundred lines above, added in review for an unrelated
reason — keeping a future `?token=…` out of the log — and its comment says the thing that stopped
being true:

> No route reads a query string today, so this costs nothing…

One route does, and it is the only one of the twenty-odd that uses `path` rather than `url`
(`projection`) that would have made it work. The fix is to match `chat` — and, on the same argument,
everything beside it — against `path`.

**What would have caught it:** a route test that asks for the URL the client actually sends. Both
halves of this one are written and correct; no test has ever put them together, and each half is
green on its own.

## 2. "Also ask the AI about it" does nothing while the chat band is open

Select a passage, write a comment, tick the box that asks the AI about it, send. Outside chat mode
this opens a floating dialog pre-filled with the question and asks. **In chat mode — the band open,
`?mode=chat` — the comment is saved and the AI is never asked.** `POST /api/comments` returns 201,
no `/api/chat` request is made, and the stored comment keeps `status: "none"` for ever. Nothing on
screen says so. Reproduced twice, with a patched `window.fetch` counting the requests.

The cause is one line doing two jobs ([`App.tsx:1311`](../../src/web/App.tsx)):

```ts
!owner || mode === "chat" || mode === "review" ? null : (chatDraft ?? …)
```

The suppression is deliberate and its comment is right about the case it was written for: a
`?thread=` overlay in chat mode would be *a floating copy of the conversation the band is already
showing*, which is nonsense. But `chatDraft` — a passage with a question and no conversation yet —
is behind the same gate, and `overlay` is the only thing that ever consumes it. So the draft is set,
suppressed, and dropped.

The fix is to split the two: suppress the `?thread=` arm in chat mode, and let a draft through — or,
better, hand the draft to the band's own composer, which is where the reader is already looking.
That is a decision about what the reader should see, so it wants Greg rather than an agent.

**What would have caught it:** nothing available. The draft path has no test on either side of the
mode, and the band and the overlay are only ever tested apart.

## Still owed

The three browser checks the server death cut short: **cancel from a selection**, **reload
persistence**, **rename persistence** — see
[chat-operation-model.md § How each stage is checked](chat-operation-model.md#how-each-stage-is-checked).
Note that bug 2 above makes "ask from a selection" unavailable in chat mode, so the cancel check has
to start from the band's own composer.

One thing the pass did establish about cancel, which is worth keeping: the header control is two
different buttons switched by `firstAnswer = streaming && thread?.messages.length === 2`. It is
**Cancel** (discard, and send a real `/cancel`) only while the very first answer is streaming and
before any tool-call message has been appended, and **Close** otherwise — and Close stops nothing
server-side. Because nearly every question triggers a tool call within about a second, the window in
which a reader can discard a conversation is roughly one second wide. That is worth a look on its
own terms; the pass never landed a click inside it.
