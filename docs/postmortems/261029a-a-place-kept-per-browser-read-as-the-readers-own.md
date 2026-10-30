# A place kept per browser, read as the reader's own

**What happened.** Greg reported (`spya-e23tee`, 2026-10-29 00:19 UTC, SPIDERYARN-READING2-Q3) that
he reopened *Consciousness in Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`), which he
was about halfway through, and it opened at the top instead of where he had been.

**What the evidence says.** His six earlier reports on the article that evening were filed from
addresses carrying `?at=` (the last, at 00:12, from
`?at=spya-uyn4sz&margin=1&mode=structure&structure=expanded`), all on build a3d0f98e. This one was
filed from `?mode=chat&guide=1` with no `?at=`. That address is the first-open default, and
[`last-view.ts`](../../src/web/last-view.ts) § `claimFirstOpen` applies it only when the browser
holds **no key at all** for this reader and article. An empty key would have opened plain at the
top; a key holding a place would have restored it. The command bar's *Guide* row also writes
`guide=1`, but it adds to the address, so mid-article it gives `?at=…&margin=1&mode=chat&guide=1`;
Greg's had neither the place nor the `margin=1` he had used all evening. So **in the browser that
opened it, there was no key for his account and this article** (GPT Sol's narrower wording, plan
review F1, F2 and F5).

A real-browser check on local dev ruled out the same browser losing it. Reload, a bare reopen in
the same tab and in a new one, Chat, Structure with the margin, the shelf and back, Metadata and
back, two tabs, sign-out and back, and a lapsed session all kept the place. The key was never
removed or overwritten with an address missing `?at=`. Nothing in `src/` removes it, and Sol found
no ordinary same-account, same-origin path. Greg reads on a laptop and an iPad, partly as a
home-screen web app, whose storage on iOS is separate from Safari's. So the likeliest story is that
the place he had reached was in another browser's `localStorage`; cleared site data would look the
same. Production cannot tell the two apart: the feedback row carried no diagnostics, and the app's
database role cannot read auth sessions. Either way the class below is the same: this browser did
not know, and the app took that for "never".

**The class: a per-device memory answering a per-person question.** Two questions here are about
the reader: *where was I in this article?* and *have I ever opened it?* Both are answered from one
browser's `localStorage`. A miss there is taken to mean the reader has no place, or has never opened
the article, when it only means this browser was not told. The second answer turns the first miss
into a confident wrong arrival. It is a cousin of the house's silent-success pattern
([silent-success.md](../reusable/silent-success.md)): the code does exactly what it was designed to
do, and the design's limit is invisible from inside it. Nothing on screen says "this device has no
record of you here", while the server, which keeps the reader's reading time for this article, could
have said otherwise.

**Introduced by** design, in two steps, not by a slip:

- a04dc7f5d (2026-09-05) made the restore per browser, on Greg's *"It's fine for this to be local to
  the device/browser, or whatever is simplest"*. Cross-device was named as deferred
  ([260905d](../plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
  § What is deferred). It was offered to Greg again in the note for `spya-qspg5a` on 2026-10-19.
- 815a2608e (2026-10-05) made **no key** mean **first open**, which is where a local miss started
  to override the reader's history rather than just failing to restore it. de4cacdae (2026-10-07)
  made that default the guide in Chat, which is the arrival Greg saw.

Neither was wrong for its day. What changed is that Greg now reads one article across several
browsers, and reading time made the server the place that does know.

**The right long-term fix** is to answer the per-person questions from a per-person store: keep the
reader's place on the server beside reading time, and let "first open" mean no place anywhere. That
is plan [261029f](../plans/261029f-your-place-in-an-article-follows-you-to-another-device.md),
which Greg chose as option A of [q-mpq9dp](../user-feedback/questions/q-mpq9dp.md) on 2026-10-29
(reply `spya-hfufq8`) and which was built that day: the test for this report is
`tests/last-view-server-place.test.tsx`, red on the code before it.

**What would have caught the class.** A review question, asked of any per-browser store: *what does
this answer when the same person arrives on another device, and is that answer worse than saying
nothing?* For the restore alone, "nothing" was acceptable. For the first-open default, the answer
was "the new-article welcome, on an article half read", and that should have sent the question back
to the server, which already knew. The test to write when the fix is built is the two-context
browser check in the plan's stage 3: read in one fresh context, open in another.
