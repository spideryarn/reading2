# The ingest queue

Paste a URL on the homepage and an article appears on the shelf a minute or two later, with the
stages ticking over while you watch. Since 2026-08-26 the watching happens on a page of its own,
`/add/<the URL>` — [§ The add page](#the-add-page).

> Now let's think about the "Add" functionality that takes a URL as an argument. There should be
> some kind of queue that processes things (e.g. fetch, Mozilla Readability, sanitiser), and ideally
> a progress indicator.
>
> — Greg, 2026-08-25

Before this, the add box on the homepage printed the four commands for you to run yourself. That was
honest — there was no job runner — and it is what
[library.md § Adding an article](library.md#adding-an-article-the-box-submits-now) described. This is that stub
growing up, and it kept the shape it promised it would: the input stayed, and the command list became
the progress list.

| File | What's in it |
|---|---|
| [`src/pipeline.ts`](../../src/pipeline.ts) | the six steps, as data — the only place that knows the pipeline's order |
| [`src/jobs.ts`](../../src/jobs.ts) | the queue, the job records, and the restart sweep |
| [`src/routes.ts`](../../src/routes.ts) | six HTTP routes, all of which return immediately |
| [`src/web/useJobs.ts`](../../src/web/useJobs.ts) | the poll |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) | the box on the shelf, the progress list, and `JobCard` |
| [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) | `/add/<a whole URL>` — [§ The add page](#the-add-page) |
| [`src/ingest.ts`](../../src/ingest.ts) | `slugFromUrl` and `isSlug` — what an article gets called, and whether that name is safe |
| [`src/fetch.ts`](../../src/fetch.ts) | stage 1, somebody else's — [fetching.md](fetching.md) |
| [`src/web/UploadPicker.tsx`](../../src/web/UploadPicker.tsx) | the file picker, the drop zone and the progress bar — [§ Uploading a PDF](#uploading-a-pdf) |
| [`src/uploads.ts`](../../src/uploads.ts) | what counts as a PDF worth uploading, and how big is too big |

## Uploading a PDF

**Built 2026-08-27.** Choose a PDF off your own machine, or drop one on the shelf, and it becomes
an article the same way a pasted URL does. The picker had been sitting there since 2026-08-26
saying in as many words that there was nowhere to send a file — deliberately, because a disabled
button or a spinner over a file going nowhere are both
[the failure this repo keeps writing up](../reusable/silent-success.md). There is somewhere now.

**The bytes never touch our server**, and that is not an optimisation. A Vercel function refuses a
request body over 4.5 MB — flat, unraisable, the same on Node, Edge and Fluid — and two of the
three PDFs in this project's own eval set are bigger than that. So:

```
  POST /api/uploads   {filename, bytes, sha256}   ~200 bytes of JSON to us
  PUT  <signed url>   the whole file              straight to Supabase Storage, no credentials
  POST /api/jobs      {uploadId}                  ~60 bytes of JSON to us
```

The middle step carries no bearer token and no API key. The grant is in the URL, it is bound to one
path *we* chose, and it lasts two hours. `MAX_BODY_BYTES` in
[`src/routes.ts`](../../src/routes.ts) is untouched — that is the point, no route grew a
large-body path. Measured end to end on 2026-08-27 with the 145 KB fixture: verified, extracted,
split, ToC'd and arc'd in 148 seconds, and `GET /api/source/:slug` handed back all 144,779 bytes.

**Where each piece lives.** [`src/web/upload.ts`](../../src/web/upload.ts) hashes and sends;
[`src/store/blobs.ts`](../../src/store/blobs.ts) is the seam, with the Supabase and filesystem
adapters beside it; [`src/upload-records.ts`](../../src/upload-records.ts) is one attempt's state;
`acquireUpload` in [`src/pipeline.ts`](../../src/pipeline.ts) is the half of stage 1 that verifies
bytes instead of fetching them. The design, the measurements behind it and the two cross-family
reviews are in [pdf-upload-and-storage.md](../plans/pdf-upload-and-storage.md).

### Four things about it that are not obvious

**The upload is not the ingest, and they happen in different places.** The transfer runs on the
shelf, because that is where the `File` is — a file handle is not something an address can carry,
so navigating first and uploading there is not available. Only when the bytes have landed does the
reader go to `/add/upload/<uploadId>`, which queues the job and watches it exactly as `/add/<url>`
does. So an ingest still has one place and one address, and the thing that *cannot* have an address
is over before the navigation happens.

**There is no new step in the pipeline.** An upload's first step is still called `fetch`; it simply
has two halves, and the branch on `ctx.upload` is the only place in the whole pipeline that knows
where an article came from. Both halves write the same `raw.json`, so stage 2 onwards cannot tell
which ran — the same seam [content-extraction.md](content-extraction.md) calls the entire design.
What the step *says* does change: "Checking the file", not "Fetching the page", because there is
nothing to fetch and no page, and a reader watching a row that claims otherwise learns something
untrue about where their document went.

**The staging object is never deleted, and that is a rule rather than an oversight.** Measured
against the running stack: deleting an object **re-arms** any grant still live over its key. So a
tidy-up inside the two-hour TTL races the browser it is cleaning up after, and can end with us
having checksummed one document and extracted another. Verified bytes are *copied* to
`sha256/<hash>.pdf` — create-only, so the name stays a true statement about the contents — and the
staging key is left alone. A sweep after `SWEEP_GRACE_MS` is not built;
[`tests/upload-acquire.test.ts`](../../tests/upload-acquire.test.ts) asserts the object survives,
which is what stops somebody adding the obvious `remove` later.

**An upload never adopts an existing article.** `freeSlug` may adopt one, because `urlKey` can
prove two addresses are one piece. An upload has no address, so `freeUploadSlug` in
[`src/jobs.ts`](../../src/jobs.ts) always finds a slug nothing else has — two files called
`paper.pdf` get two articles, per [Greg's answer](../plans/pdf-upload-and-storage.md#gregs-answers-2026-08-26).
The existence check is `articleExists` and **not** `urlForSlug`, which is the trap: an uploaded
article has no URL in its `meta.json`, so the lookup `freeSlug` uses reads `undefined` and calls
the slug free. Every step would then find an artefact, skip, and show the reader a different
document under their own filename in about a second. It also takes the *upload's own id*, so a
Retry keeps the article it already started rather than stepping aside from itself and paying for
the transcription twice.

### The slug comes from the filename, and that is the ugly part

`source.pdf` becomes the slug `source`; `paper.pdf` becomes `paper`, then `paper-2`. The reader
sees the title everywhere that matters — the shelf card, the masthead, the tab — so this is a
directory name rather than anything they read. But `document.pdf` and `download.pdf` are extremely
common and the counters will pile up.

The plan's alternative is to store under a provisional id, run pass 0, and reserve the final slug
from the title. That is a **rename**, and [block-ids.md](block-ids.md) is largely about why renames
here are expensive. Written up as an open question rather than quietly decided:
[pdf-upload-and-storage.md § Still open](../plans/pdf-upload-and-storage.md).

### The checks are the cheap ones, and they are not the real ones

**The picker's checks** `uploadProblem` in
[`src/uploads.ts`](../../src/uploads.ts) reads a name, a browser-guessed MIME type and a size,
every one of which is a claim by whoever chose the file. The check that decides anything is the
`%PDF-` magic over the bytes that actually arrived, on the server, before anything expensive. The
module is shared rather than inlined in the component for exactly the reason
[`src/ingest.ts`](../../src/ingest.ts) is: `POST /api/uploads` will ask the same question, and a
browser and a server disagreeing about what counts as a PDF is invisible until a file is taken in
one place and refused in the other.

**And the server must not answer that question on the browser's behalf.** `POST /api/uploads` calls
the same `uploadProblem` with `type: ""` — no guess — because the browser's MIME guess does not
cross the wire, and supplying `"application/pdf"` there writes the answer we want into the input:
`looksLikePdf` accepts *either* the type or the name, so `notes.txt` sails through on a type we
made up. Caught by a test, not by reading.

**The real check is `acquireUpload`**, in the step, over the bytes: the object exists and is under
the cap (`head`, before anything moves), one bounded `get`, `%PDF-` over what came back, and our
SHA-256 against the browser's. Downloading once and doing the last two over that same copy is not
tidiness — reading the object twice is the one sequence content addressing does not cover, because
the grant is still live and the second read may not be the bytes the first one verified.

Two smaller things in the picker that are easy to get wrong and are worth not rediscovering:

- **The drag highlight counts, it does not toggle.** `dragleave` fires every time the pointer
  crosses into a child element, so a boolean cleared on leave makes the zone flicker as you move
  across it. Enters minus leaves is the fix that survives nested children.
- **`dragover` must call `preventDefault`.** Its default action is *"this is not a drop target"*,
  and without cancelling it the browser opens the PDF in the tab instead — which looks exactly
  like a drop handler that never ran.

## The add page

> Add a url that I can use to add something directly, e.g. `/add/[my-full-url-here]` or
> `/?add=[my-full-url-here]` or similar … And then modify the Home page so that when you add a url
> and click add, it takes you to this page.
>
> — Greg, 2026-08-26

`/add/https://example.com/an-essay` queues that article, shows the stages ticking over, and takes you
to the reading view when the last one goes green. Pressing **Add** on the shelf now goes here rather
than queueing where it stands, so there is exactly one thing that starts an ingest and it has an
address. The spellings the address bar accepts, and why the app's own is percent-encoded, are in
[url-state.md § `/add/<a whole URL>`](url-state.md#which-article-is-the-path).

**Two things this buys, and neither is the redirect.**

*An ingest has somewhere to be.* The progress list on the shelf was fine for something you were
watching and could not be reloaded, bookmarked or sent to anybody, because it was a state of that
page rather than a place. Reload `/add/…` and you are still watching the same job — `enqueue` hands
back the job already working on that article rather than starting a second one, so the page picks up
where it was rather than starting again ([§ Idempotent is the goal](#idempotent-is-the-goal-this-is-a-step-towards-it)).

*An article can be handed to us from outside.* A bookmarklet, a share sheet, or a shortcut is now
`spideryarn/add/` plus wherever you are, with nothing to paste.

### The three traps in a page whose whole job is one effect

- **Queue it once.** `<StrictMode>` mounts, unmounts and mounts again in development, so a plain
  effect POSTs twice. The guard is a ref, which survives that where state does not. Worth knowing
  *why this had to be got right rather than noticed*: `enqueue` would have handed the second request
  the same job, so both POSTs would have looked completely successful and the only trace of the bug
  would have been a duplicate line in the log — [silent-success.md](../reusable/silent-success.md)
  again, and the same trap the article open-count fell into on the same day.
- **Watch that one.** By the job id `queue.add` returned, not by slug. `useJobs` polls the whole
  queue, and the same article being re-run from another tab is the same slug and a different job.
  This is what widened `add` from `Promise<void>` to `Promise<Job | null>`; its docstring in
  [`useJobs.ts`](../../src/web/useJobs.ts) used to argue against that, and the argument was sound
  until a caller existed that needed the receipt.
- **Leave properly.** The navigation to the article `replace`s rather than pushes, so Back takes the
  reader to wherever they came from rather than dropping them here to watch a job that has already
  finished.

### Three ways the address can lie about itself

All three were found by review rather than by use, and together they are the argument for the
rewrite being a pure `canonicalAddHref` that main.tsx calls rather than four lines inside it:

- **The target URL's own `add=`.** `/add/https://x.test/article?add=2` canonicalised to `/add/2` —
  the article's own parameter read as ours, and replacing it. The path form is asked first now.
- **An `add=` that is not a parameter.** `?next=/somewhere?add=x` matched, because only the *first*
  `?` in a URL begins its query and the pattern accepted any of them. Anchored to a real boundary now.
- **An encoded segment carrying a query.** `/add/https%3A%2F%2Fx.test%2Fa?edition=2` was
  double-encoded into something that is not a URL at all, because a query string's mere presence was
  being read as proof the segment was raw. The query is now always put back, whichever spelling the
  segment is in — which is what the first of these three needed anyway.

An article already on the shelf takes about a second — every step finds its artefact and skips — so
adding the same URL twice is a blink and then the article, rather than an error telling you that you
already have it.

**The add box stopped being an `<input type="url">` for this.** The browser will not submit one
without a scheme, and `example.com/an-essay` is meant to work — so it is a plain text input whose
validation is `slugFromUrl`, the same function the server derives the slug with. The one check that
used to live on the page has moved into `slugFromUrl` itself; see the next section.

## Two URLs, one article

> And will this de-dupe correctly if near-identical versions of the url are used, e.g. http vs https
> or without url protocol or capitalised similar non-significant changes, or if we already have the
> article?
>
> — Greg, 2026-08-26

It did not. `freeSlug` compared the URL you gave against the one in `meta.json` **as strings**, so
adding `http://x.test/piece` when the shelf held `https://x.test/piece` read as a different article:
it stepped aside to `x-piece`, fetched it again, extracted it again, and paid for a second tree and
a second arc — then put two cards on the shelf under one headline. Nothing errored, and the check
anyone would run said the article was there. [Silent success](../reusable/silent-success.md) again.

The fix is two functions in [`src/ingest.ts`](../../src/ingest.ts), and **the reason there are two
rather than one is the whole design**:

| | Answers | May it change the address? |
|---|---|---|
| `normaliseUrl` | *what do we fetch and store?* | **No.** Whatever comes out is what gets fetched. |
| `urlKey` | *is this the article we already have?* | It is never fetched, so yes — freely. |

`normaliseUrl` is therefore limited to what the URL spec itself calls insignificant: it supplies a
missing scheme (`example.com/x`, `//example.com/x` → `https://…`), lower-cases the scheme and host,
drops a default port, and drops the fragment — which is never sent to a server, so an article whose
stored URL carried one would be claiming we fetched something we did not. It leaves `http` alone.
Turning `http` into `https` is a different request to a possibly different server, and that is not a
call to make on the reader's behalf. Anything it will not fetch comes back as `""`, which is one rule
with one answer — an early version handed the input back instead, which reads well in an error
message and is indistinguishable from *already normal*, so `http://127.0.0.1/x` was refused and then
happily slugged as `x` one function later.

`urlKey` is where `http` and `https` become one article. On top of the above it drops the scheme
entirely, a leading `www.`, one trailing slash, and the tracking parameters a share button staples on
(`utm_*`, `fbclid`, `igshid` and a dozen more).

### The rule it is written to, which is an asymmetry

**Failing to merge two spellings of one article costs a duplicate** — a second card on the shelf,
visible, deletable, paid for once. **Merging two different articles costs the wrong article**,
silently, under the headline the reader pasted, with nothing anywhere saying so. So a merge has to be
one the spec or universal practice actually guarantees, never one that is merely usually right.

That rule arrived from [GPT Sol's review](../../scripts/run-codex.ts) of the first version, which
merged four things it should not have, and each is now a test:

| Merged before | Why it must not |
|---|---|
| `/Why-Trees` and `/why-trees` | plenty of servers are case-sensitive and mean it |
| `?tag=a&tag=b` and `?tag=b&tag=a` | a repeated parameter's order is part of the request |
| `?a=x%26b%3Dy` and `?a=x&b=y` | decoding and re-joining on `=` and `&` is ambiguous — the first is **one** parameter whose value contains an ampersand |
| `alice:pw@host/x` and `bob:pw@host/x` | two readers' credentialled views of a page are not one article |
| `?a=1&&b=2` and `?a=1&b=2` | an empty query field is part of the request target; only *tracking* pairs are dropped |

The path-case one is worth dwelling on, because the argument *for* lower-casing was not silly: the
slug is lower-cased already, so `/Why-Trees` and `/why-trees` collide on the slug whatever the key
says. But that collision is exactly what `freeSlug`'s ladder is for, and it resolves it into the
cheap failure rather than the expensive one. Credentials are not dropped from the key — they are
refused by `normaliseUrl` outright, since an `/add/…` URL now lives in browser history and in
whatever access log sees the request, and percent-encoding hides a password from nobody.

Query-string **order between different names** stays significant for the same reason, and that is a
deliberate non-merge: nobody reorders a URL they copied, so the merge buys nothing, and it cannot be
had without the sort that broke the repeated-parameter case.

**What else it will not merge:** a different host (`a.example/news` and `b.example/news` are what
`freeSlug`'s ladder exists for), a real subdomain (`blog.example.com` is a site; only `www.` is
decoration), a non-default port, and any query parameter not on the tracking list — `?ref=`, `?s=`
and `?id=` are used both ways, so they stay.

Both are tested exhaustively in [`tests/ingest.test.ts`](../../tests/ingest.test.ts), and the ladder
built on top of them in [`tests/jobs.test.ts`](../../tests/jobs.test.ts) § `freeSlug`.

### Two things claim a slug, and one of them only exists for a minute

`freeSlug` now takes its claim lookup as an argument, which is what makes every decision above
testable without a filesystem, a network or a queue. The default consults **`meta.json` first, and
then the live queue** — because a job that is queued or running has taken a slug and not yet written
a `meta.json` for it. Without that second half, two different articles with the same last path
segment added within a minute of each other both get the bare slug, and the later one is then handed
the earlier one's job by `activeFor` and quietly never happens.

### What it still cannot know

Two addresses that are genuinely different and serve the same piece — a syndication, a canonical URL
and an AMP one, a link-shortener — are two articles here, and nothing short of fetching both could
say otherwise. `<link rel="canonical">` is in the HTML we already fetch and would close most of that
gap; it is not read yet.

## Opening a link starts a fetch, and that is new

Nothing else in this app does anything expensive because you *arrived* somewhere. The add page does:
the POST is on mount, which is what makes a bookmarklet work and also what turns a link a stranger
sends into a server-side fetch of their choosing. `normaliseUrl` therefore refuses a host that is on
this machine or this network — loopback, link-local (`169.254.169.254` is the one worth naming),
`10./172.16-31./192.168.`, the IPv6 equivalents, and `localhost` — and it refuses them *after*
`new URL` has expanded the compressed spellings, so `127.1` and `0x7f.0.0.1` are caught by a check
for `127.0.0.1`.

**The obvious version of that check has a hole, and it took a second review pass to find.**
`http://[::ffff:127.0.0.1]/` is loopback, and `new URL` re-spells it as `[::ffff:7f00:1]` — neither
a dotted quad nor `::1`, so a check for those two waves it straight through. An IPv4-mapped address
now has its IPv4 half decoded and checked properly, so `::ffff:8.8.8.8` stays fetchable; the rest of
`::/96` — `::`, `::1`, the deprecated v4-compatible form — is refused outright, being unroutable
anyway.

**That is a smaller claim than "no SSRF" and the gap is stated in
[security.md](security.md).** A *name* that resolves into the private range still gets through, as
does a redirect into it, as does a rebind between the check and the connection; only the fetch itself
can catch those. Refusing `localhost` also costs the ability to add a page from a dev server on this
machine, which is a real loss and a small one — this reads published articles.

## The pipeline is a list, not a function

Six steps, in [`src/pipeline.ts`](../../src/pipeline.ts):

```
  fetch     Fetching the page              → data/<slug>/raw.html
  extract   Extracting the article         → output/<slug>.html, data/<slug>/meta.json
  blocks    Splitting into blocks          → output/<slug>.blocks.json   (and the sanitiser)
  toc       Building the table of contents → data/<slug>/tree.json, data/<slug>/blocks.json
  arc       Writing the arc                → data/<slug>/arc.json
  tweets    Writing the thread             → data/<slug>/tweets.json     (never on a plain add)
```

Each step is a name, a label, **the artefact it produces**, and the function that produces it. A job
is a *list of step names*, which is the whole reason this is data rather than four `await`s in a row.
Greg asked for more than "add this URL" — re-run one stage after a prompt change, refresh an article
from source, and *"potentially it'll be used in other ways too"* (2026-08-25). All of those are the
same machinery given a different sub-list, and none of them needed a special case.

- **Add** — every step in `DEFAULT_INGEST_STEPS`, which is the first five.
- **Re-run a stage** — `{ slug, steps: ["arc"], force: ["arc"] }`.
- **Refresh from source** — the default steps, with `force: ["fetch"]`.
- **Write the thread** — `{ slug, steps: ["tweets"] }`, which is the button on the tweets page.

### `STEP_ORDER` is not the default list

They were the same array until the sixth step arrived, and separating them is the whole change the
tweet thread needed in this file ([tweet-thread-page.md](../plans/tweet-thread-page.md#the-one-real-snag-stated-precisely)).
The constant was quietly doing three jobs:

| Read at | What it means there | Does `tweets` belong? |
|---|---|---|
| `orderSteps`, sorting by `STEP_ORDER.indexOf` | the chain's order | **yes** — a name that is missing gets `-1` and sorts to the *front*, so it would run before `fetch` |
| `isStepName`, which is `STEP_ORDER.includes` | the names the API will accept | **yes** — otherwise `POST /api/jobs { steps: ["tweets"] }` is a bad request and the button can never work |
| `enqueue`'s `request.steps ?? …` | what a bare "add this URL" runs | **no** — a thread costs a model call and nobody asked for one |

So `STEP_ORDER` gained `tweets` and `enqueue` now defaults to `DEFAULT_INGEST_STEPS`, which is the
same five as before. [`tests/jobs.test.ts`](../../tests/jobs.test.ts) pins both: that `tweets` is a
valid name, and that it is **not** in the default list.

### The pipeline is no longer one straight line

`cascadeForce` above encodes *"invalidating a step invalidates everything after it"*, and that is
sound for a chain in which each step eats what the one before it wrote. **`tweets` is not a link in
that chain.** It reads `blocks.json` and `tree.json` — the same inputs the arc reads — and nothing
reads what it writes. Its position after `arc` in `STEP_ORDER` is about *running order*, not about
dependency, and reading it as dependency costs money: forcing `arc` in a job that also holds
`tweets` would spend a second model call rewriting a thread whose inputs never moved.

So `FORCE_ONLY_WHEN_NAMED` in [`src/pipeline.ts`](../../src/pipeline.ts) holds the steps the
positional cascade may not speak for, and `tweets` is in it. Forcing an earlier step no longer
forces the thread; `force: ["tweets"]` still does, which is the rewrite button.

**Read that together with the next section, because neither half is safe alone.** Taking a step out
of the cascade is only defensible when the step can tell for itself whether it is current — and
`tweets` can. `arc` deliberately stays *in* the cascade for the inverse reason: it has no freshness
check, so its position is the only signal it has. Give it one and it belongs in the set too.

### A step can now say whether its artefact is *current*, not just present

`stepIsDone` asked one question — are the files there? — and calling the answer a cache was
generous. A `tweets.json` describing last week's text is present, so the step would skip, report
*"already done"* with a green tick, and the page would serve a thread about an article that has
since changed. A [silent success](../reusable/silent-success.md) of the exact kind this repo keeps
finding, and the reason the plan's `sourceHash` was not enough on its own: **nothing would ever have
read it.**

`PipelineStep` therefore has an optional `isDone(ctx)`. Existence still runs first and the override
can only narrow the answer, so a freshness check can never declare a missing file fine. `tweets` is
the only step that supplies one so far: `threadIsCurrent` in [`src/tweets.ts`](../../src/tweets.ts)
compares the stored `sourceHash` against the blocks on disk, and checks the prompt version and the
model id with it — which is what [architecture.md § Storage](architecture.md#storage) has always
specified for a cached artefact and what nothing had implemented. Anything unreadable answers *not
current*: the cost of being wrong that way is one model call, and the other way round is a wrong
thread served for ever.

The consequence worth stating: a refresh does not force the thread, but it does not strand one
either. The next time anything asks for `tweets` the hash no longer matches, so the step runs
without anyone having to remember.

### Forcing a step forces every step after it

This was wrong for an afternoon, and the way it was wrong is the reason it is now a rule rather
than a convention. "Refresh from source" was written as `force: ["fetch", "extract"]` — force the
two stages that read the outside world, leave the rest alone. But the rest are not independent of
them: `blocks`, `toc` and `arc` all find their artefacts still on disk from last time, skip
themselves in milliseconds, and report three green ticks. What you get is **a freshly fetched
article under last week's tree and last week's arc** — every gist describing paragraphs that have
moved, and nothing anywhere saying so.

That is [silent success](../reusable/silent-success.md) exactly: the pipeline reports success, the
check you would naturally run (*did the refresh work? is the article current?*) says yes, and the
reading view quietly shows the wrong thing. Caught by an outside review rather than by using it,
which is the usual way with this family.

So `cascadeForce` in [`src/jobs.ts`](../../src/jobs.ts) expands any `force` to include everything
downstream of the earliest step named. The pipeline is a chain; invalidating a step invalidates what
comes after it, by definition. The alternative is asking every caller to remember a rule the
pipeline already knows.

### A step is done when *all* its files are there

`extract` writes the HTML **and** `meta.json`. `toc` writes `tree.json` **and** its copy of
`blocks.json`. Each step declares an `outputs` list rather than a single artefact, and counts as
done only when every one of them is present — because a crash between the two writes would
otherwise leave a step reporting itself finished with half its output, and the stage after it
consuming the missing half.

**There are two copies of `blocks.json`, and it matters here.** Stage 3 writes
`output/<slug>.blocks.json`; stage 4 copies it into `data/<slug>/blocks.json` as it writes the tree,
so the pair in the data directory is guaranteed to be the one the tree was built from. Each step's
`done()` checks *its own* artefact — the first one for `blocks`, the second for `toc`. Getting that
backwards means a finished `blocks` step reports itself unfinished until `toc` has also run, so
every retry redoes stage 3 and a `{ steps: ["blocks"] }` job can never skip itself. Which also means:
run `blocks` on its own and the two copies disagree until you run `toc` as well. That is the
pipeline's existing shape, not something the queue introduced, and it is why a re-run of a middle
stage should generally include the ones after it.

Sanitising is not a step. It happens *inside* `blocks`, at the top of `splitIntoBlocks`, so that the
stored `blocks.json` is already safe and no later consumer has to remember —
[`src/sanitize.ts`](../../src/sanitize.ts), and see [open-questions.md § Q9](open-questions.md) for
how that landed.

### `fetch` is its own step, and since 2026-08-27 it has two halves

**The second half is an upload**, and everything about it is above under
[Uploading a PDF](#uploading-a-pdf). The short version, here because this is the section somebody
reads when they are looking at the step list: same step name, same one output (`raw.json`), same
`beginStep`/`finishStep`/cancellation/`assertProduced` machinery — a different label and a
different way of coming by the bytes.

That it is a *step* rather than something beside the step list was a review finding, and the
reasoning is worth keeping: work that floats outside the list bypasses exactly the machinery built
to make interrupted work visible.

#### Why it is a step at all

Stage 1 used to be three lines inside `src/extract.ts`. It is now a step with an artefact,
`data/<slug>/raw.html`, which [architecture.md § Storage](architecture.md#storage) has always listed
and nothing had ever written.

The reason is retries. Extraction going wrong is the common failure — Readability is a heuristic —
and when it does you want to try again **without asking the publisher a second time**, and without
the answer being different because they changed the page in between. The previous version of this
project reached the same conclusion from production:
[original-version/extraction.md § Keep the untouched original](original-version/extraction.md#keep-the-untouched-original).

The step itself is three lines because the work is [`src/fetch.ts`](../../src/fetch.ts), which
landed the same day from the agent who owns stage 1 — byte caps counted on the decompressed stream,
the page's own declared encoding rather than an assumed UTF-8, PDFs told apart by their bytes,
address checks before each redirect hop, and typed failures carrying a sentence a reader can act on.
Those sentences are what a failed step shows. It takes an `AbortSignal`, so cancelling a job stops
the fetch rather than waiting it out. See [fetching.md](fetching.md).

## The queue: p-queue

Chosen 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md). **p-queue 9.3.3**,
published a month before it was picked; 33.6M downloads a week, 4.3k stars, one small pure-ESM
package with no dependencies and nothing to install alongside it. Concurrency, priorities, pause and
`AbortSignal` are the API.

**Concurrency is 1, deliberately.** Three of the six steps are long model calls billed by the token
and one is a fetch of somebody else's server. Running two articles at once would double the spend
rate, halve the politeness, and turn the progress display into a race — for a single reader adding a
handful of articles a day, in exchange for nothing.

| Rejected | Why |
|---|---|
| **BullMQ** | The best-known of these and its `updateProgress` + `QueueEvents` is exactly the progress mechanism we want — but it needs **Redis**, and [architecture.md](architecture.md) says filesystem, one process, no infrastructure. Worth a second look one day: BullMQ 6 added a Postgres backend, though its own docs still call Redis "the most battle-tested option". |
| **pg-boss** | The runner-up — Postgres-only, nothing else to run, with retries, backoff, dead-lettering and cron included. It needed a database we didn't have, and adopting one to get a queue would have been the tail wagging the dog. **Postgres has since landed as a plan**, and this was reconsidered rather than inherited: still no, but for a different reason, and it stays the first thing to re-evaluate — see [§ When this becomes Postgres](#when-this-becomes-postgres). |
| **graphile-worker** | The same idea as pg-boss and a good library. pg-boss has 2.7× the downloads and 1.6× the stars, which under [our first criterion](../reusable/third-party-library-selection.md#selection-criteria) — pretraining data — is the whole difference. |
| **bee-queue** | Redis again, with less momentum than BullMQ. No upside. |
| **fastq** | Fine, and lower-level than we need. Its enormous download count is `glob` pulling it in transitively, not people choosing it. |
| **better-queue** | Looks like it does everything; last published September 2022, no types. A trap. |
| **Inngest, Trigger.dev** | Hosted SaaS, or a self-hosted stack of eight to ten containers. For one reader on a laptop. |
| **Nothing at all** — a hand-rolled FIFO | Genuinely viable at ~50 lines, and it was close. p-queue wins on the two criteria that matter here: an API a model already knows cold, and someone else owning the concurrency and abort edges. |

The previous version of this project had **no queue**, and is worth reading as evidence rather than
as precedent — [original-version/overview.md](original-version/overview.md). Its ingestion ran inline
inside Next.js API routes, with the browser tab as the orchestrator: a React component held the task
list and called the API once per unit of work. Their own docs call it a prototype shortcut, and it
cost them production 504s on long documents, lost all progress on a refresh, and never got migrated.
`PROJECT_STATUS.md` there still lists *"Background processing — move from frontend-driven to proper
job queue"* as unstarted. So: the server owns the queue here, and the browser only watches.

## Why polling

`GET /api/jobs` every second while anything is running, every eight seconds when nothing is.

A job is five or six steps over one or two minutes, so a one-second poll is at worst a second behind
something that changes every twenty; nobody can tell. What it buys is that the client holds no
connection. It survives the dev server restarting under it, which vite does on any config change. It
is the same three lines against a future standalone server, or against a serverless one where SSE is
awkward. And there is no reconnect logic to get wrong — the failure mode of a dropped `EventSource`
is a progress panel that quietly stops updating, which looks exactly like a stuck job.

The poll reschedules itself on each response rather than running on an interval, so a slow response
can never stack a second request on the first.

## Idempotent is the goal; this is a step towards it

Greg, asked whether an interrupted job should survive a restart (2026-08-25):

> We want to get to the point where this is idempotent and simply picks up from where it started.
> But if that's a lot more work, then make a note somewhere that this is the intention, and build
> simpler machinery that's a step in that direction.

**What is built.** Every step declares the files it produces, and a step whose files are all already
on disk is *skipped* rather than run. Job records live in `data/_jobs/<id>.json`, written
atomically. On startup, anything still marked `running` or `queued` is turned into an error —
this process has just started and its queue is empty, so nothing on disk can have work happening
against it. The steps keep their individual statuses through that sweep, so a swept job still shows
which stages finished, and **Retry queues the same steps and skips them**.

So in practice: the server dies during `toc`, you press Retry, and `fetch`, `extract` and `blocks`
are skipped in milliseconds while `toc` starts again. That is "picks up from where it started" for
the case that matters — the two model calls, which are the expensive part.

**The check used to be existence, and it is not any more.** A step now declares `produces` — the
*kinds* of thing it makes, `tree`, `labels`, `blocks` — beside the old `outputs` list of paths, and
an **artefact store** ([`src/store/artifacts.ts`](../../src/store/artifacts.ts), file adapter
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts)) answers whether they are all there.
It answers by **parsing**, not by `stat`ing, which is the fix for the truncation hazard this section
used to list as unbuilt: a `writeFile` killed halfway leaves a file that exists and will not parse,
and that used to report its step done. `stepIsDone` takes a store, so the same question will be
asked of Postgres columns without the pipeline changing — and the store is now a **required**
argument rather than one that quietly defaults to the filesystem, since a Postgres caller that
forgot it used to compile and get a confident answer about the wrong store. See
[postgres-storage-implementation.md § Step 11](../plans/postgres-storage-implementation.md), half B.

**One step asks a second question, and only one.** `extract` and `blocks` write to the same path —
`output/<slug>.html`, first as Readability left it and then with the block ids stamped in — so the
filesystem cannot tell the two apart, and both are "some non-empty text". After a re-extraction an
old `blocks.json` therefore sat beside new *unstamped* HTML with every check passing, and the
reading view served an article whose paragraphs had no anchors and whose comments pointed at
nothing. `blocks` now checks that every id in its `blocks.json` is actually in the HTML beside it —
exact, not a spot check, and cheap because stage 3 makes no model call and re-running it carries the
ids over rather than minting new ones.

**What is still not built, honestly.** Three things, roughly in order of value:

1. **A freshness stamp for every step.** [architecture.md § Storage](architecture.md#storage)
   specifies that `tree.json` is keyed on `hash(blocks.json) + prompt version + model id`. Three
   steps implement it — `tweets` and `summary` via the optional `isDone` above, `glossary` via the
   newer `stamp`, which hands the store four values and lets one `sameStamp` do the comparing.
   `tree.json` and `arc.json` carry no hash at all, so `toc` and `arc` are still presence-only, and
   `arc` still needs the force-cascade to notice that its tree moved. `labels.json` *does* carry
   one, which is what `toc`'s stamp is read from today even though nothing yet compares it.
2. **Atomic artefact writes across a step's whole set.** `toc` and `labels` write temp-then-rename,
   and the store's `write` does too; the other stages still write in place, and none of it makes the
   *pair* `extract` produces atomic. Only a database transaction prevents that.

   **And the state a kill leaves is worse than "one artefact of two", which is what this said until
   a review read the code.** `has` requiring all of `produces` catches a *missing* half. It cannot
   catch a *replaced* one: leave a complete generation A on disk, let a rerun overwrite exactly one
   of the step's three outputs with a perfectly good generation B and then die, and every path is
   present, parses, and is individually beyond reproach. The step reported itself done, holding two
   generations at once, and no amount of looking at the files could say so.

   So the store records the **attempt** as well as the output —
   [`beginStep` / `finishStep` / `interrupted`](../../src/store/artifacts.ts), a marker under
   `data/<slug>/steps/` on the filesystem and `revision_step_runs.status` in Postgres. A marker
   still sitting there is a run that did not finish, and a run that did not finish is not done
   however good its files look. `finishStep` is on the success path only, so a throw, a cancel and a
   `kill -9` all leave the same honest answer.
3. **Automatic resume on startup**, rather than a sweep to `error` and a Retry button. Cheap once
   (1) and (2) hold, and unwise before then: automatically re-running steps against artefacts we
   cannot vouch for is how you get a tree built for the previous version of an article.

The sweep-then-retry shape is deliberately the same one
[`sweepOrphaned`](../../src/routes.ts) uses for comments, and for the same reason: a status of
`running` on disk does not mean work is happening, and a spinner that spins for ever is the worst of
the available outcomes.

Related, and the reason a failed job stops rather than continuing: every step consumes the artefact
the one before it wrote. Carrying on past a failure would run the two model calls against whatever
stale file happened to be on disk, and produce a tree for the previous version of the article —
which looks entirely fine. A [silent success](../reusable/silent-success.md).

## The failures Retry is not offered under

Until 2026-08-26 the button appeared under every failure. That included the ones that are
arithmetic. Greg pasted a long article, stage 4 worked out that its answer would not fit in one
model response, said so, and offered him a Retry — which made the identical call and failed
identically. The whole story is in [toc-max-tokens.md](../postmortems/toc-max-tokens.md).

**A failure can now say what kind it is**, and the card asks before drawing the button. The kinds
are the four in [`src/messages.ts`](../../src/messages.ts) — the same four the reader-facing failure
sentences already use — and three of them mean another go cannot help.

- A stage says so at the throw site with `stageFailure(kind, message)`
  ([`src/job-failure.ts`](../../src/job-failure.ts)). Grep for that name to see every claim the
  pipeline makes.
- [`src/jobs.ts`](../../src/jobs.ts) copies it onto the job as `failureKind`, beside the message it
  already copies. On the job and not on the step, because Retry is a job-level action and the runner
  can fail with no step having failed.
- [`AddArticle.tsx`](../../src/web/AddArticle.tsx) asks `jobWorthRetrying(job)`. Nothing takes the
  button's place when it is hidden: the failed step's own message is already on the card and already
  says why.

**A structured field rather than a bracketed code**, which is the other half of how a failure can
carry its kind. The codes exist because a stored chat message or comment keeps `err.message` and has
nowhere else to put anything (see `kindOfMessage` in `src/messages.ts`). A job is a struct with room
for a field, so it takes the field rather than inheriting a workaround it does not need. The one
place `failureKindOf` still reads a code is a failure thrown by the model-call layer, which is the
layer with nowhere else to put it.

**Not a `permanent` flag.** Nothing here is permanent: configuration changes, providers change their
policies, and websites change what they serve. The answerable question is narrower — *should this
unchanged attempt be offered again now?*

**Which way to be wrong.** A failure that says nothing gets the button. That is for compatibility:
every job recorded before the field existed carries nothing, and so does one the restart sweep
marked, which really is worth another go. It is not because a wasted click is cheap — here a false
retry costs minutes of pipeline and another billed model call, which is a good deal worse than the
same mistake on a chat message.

**What makes a failure permanent is Retry's own shape.** `forceForRetry` forces from the first step
that did not finish, so **a retry never re-runs a step that succeeded**. A stage that failed while
reading an artefact an earlier step wrote will read that identical artefact again. That is what
separates the two lists:

| Cannot come out differently | Might |
|---|---|
| an answer too long for one response (`TooLongForOnePass`) | a model answer that would not parse |
| a missing source URL — Retry asks the same `meta.json` | the wrong number of arc sentences |
| a page Readability already refused, over cached bytes | an empty answer, a refusal, a timeout |
| a tree that does not contain its own root | a fetch that failed at somebody else's server |
| a PDF over the page cap, or a chunk over the request cap | a nav-label batch that came back truncated |
| an answer truncated at `max_tokens` — *see below* | |

Model-output validation failures are in the right-hand column on purpose. The next call is a fresh
draw, and the whole reason those checks are loud is that the model does occasionally get it right on
the second attempt.

**Truncation is the one entry that is not certain, and it is worth being exact about why.**
`TooLongForOnePass` is arithmetic: the same block count gives the same estimate for ever. Running
past `max_tokens` mid-answer is not — adaptive output varies between calls, and what we have is two
observations on one article. So it is `bug` rather than `blocked`, because the thing that needs
changing is a constant in [`src/token-budget.ts`](../../src/token-budget.ts) rather than anything
the reader can do, and the sentence says **unlikely** rather than *will*. The button and the copy
have to agree; softening the sentence is the honest way to make them.

It is `truncationFailure` that carries the tag, and it returns an `Error` rather than a string
**so that `throw new Error(truncationFailure(…))` does not compile.** Five stages meet a truncation
— toc, arc, summary, glossary, thread — and each used to build its own `new Error` around the
message, which is precisely how a sixth stage added next month copies the line without the tag and
nothing says so. The type is the guard.

`src/labels.ts` is the deliberate exception, and the only caller left taking the bare sentence. It
throws `BatchIncomplete`, which the stage **catches and retries with double the headroom** — so the
same attempt has not been made twice, and the claim does not hold. If that retry also fails, what
escapes is a fresh error combining both messages, and the second failure is often a 429 or a refusal
rather than a truncation. Hiding the button there would be wrong on both counts.

`FetchFailure.retryable` in [`src/fetch.ts`](../../src/fetch.ts) is deliberately **not** wired into
this. It marks a plain HTTP 500 non-retryable while 502–504 are retryable, which is a sensible
enough thing for a fetch layer to believe and not a claim that the page will never load.

## The one security check

`isSlug` in [`src/ingest.ts`](../../src/ingest.ts) is a path-traversal guard, not a tidiness check.

A slug arrives from the client on `POST /api/jobs` and is joined onto `data/` and `output/`, so
`../../.ssh` has to be refused there or it is refused nowhere. It lives beside `slugFromUrl` because
the two must not drift: everything `slugFromUrl` can produce must pass, and
[`tests/ingest.test.ts`](../../tests/ingest.test.ts) asserts both halves.

For the `{ url }` shape the slug is **derived, not accepted** — the add box shows you the same
derivation so the two agree by construction rather than by trust.

## The routes

```
  GET    /api/tweets/:slug     the thread, and whether it still describes the article
  GET    /api/jobs             every job this server knows about, newest first
  POST   /api/uploads          { filename, bytes, sha256 } → 201, where to PUT a PDF and for how long
  GET    /api/uploads/:id      what became of one upload
  POST   /api/jobs             { url } | { uploadId } | { slug, steps?, force? }  → 202, the job
  GET    /api/jobs/:id         one job — what the poll reads
  DELETE /api/jobs/:id         forget a finished job's record (artefacts untouched)
  POST   /api/jobs/:id/cancel
  POST   /api/jobs/:id/retry   → 202, a NEW job with the same steps
```

`POST /api/jobs` answers **202**, not 200: the work has been accepted and has not been done, and the
body is a receipt to poll. Retry creates a new job rather than mutating the old one — what went
wrong the first time is worth keeping, and overwriting it would erase the only evidence at exactly
the moment somebody is trying to work out what happened.

Cancelling stops a queued job outright, and a running one as fast as the step it is in allows. Every
step gets the `AbortSignal`: the fetch layer folds it into its own deadline, and the Anthropic SDK
takes one directly, so a model call stops mid-stream. The tokens already streamed are paid for
either way, so there is nothing to save by letting the call run on — and a Stop button that does
nothing for two minutes is a Stop button that looks broken. Between the click and the step
unwinding the job carries `cancelling`, which is why the button says "Stopping…" rather than
staying "Stop".

## Naming the step is the point

Each row of the progress list says what is happening: *Extracting the article*, *Building the table
of contents*. Not "Step 3 of 5", and not "Loading…".

That is the one thing the previous version got right without a queue at all —
[original-version/extraction.md § Document lifecycle](original-version/extraction.md#document-lifecycle-atomic-no-processing-state)
records a blocking screen with method-aware captions, and
[design-system.md § Loading](original-version/design-system.md#loading-states) is the reasoning. A
named step tells you what is slow and what is about to fail. A counter tells you neither.

The two model steps also report as they stream — how much has arrived, not what it says, because the
JSON is unparseable until it is complete. That is a deliberately low bar: the question a reader
watching a two-minute step is actually asking is whether anything is still happening.

## When this becomes Postgres

`Job` and `JobStep` live in [`src/types.ts`](../../src/types.ts), shaped as table rows — every field
a scalar or a small blob a column could hold. The same discipline `LibraryEntry` follows
([library.md § When this becomes Postgres](library.md#when-this-becomes-postgres)).

**Updated 2026-08-25.** The row that said "pg-boss" is
[reversed by the Postgres plan](../plans/postgres-migration.md#the-queue), and the row that said
`LISTEN/NOTIFY` was simply wrong. Both are corrected here rather than left to disagree.

| Today | Then |
|---|---|
| `data/_jobs/<id>.json`, one file per job | a `jobs` table, `steps` as `jsonb`. **`id` stays `text`** — jobs are minted by the same `mintId()` as blocks, so they are `spya-` ids, not uuids |
| p-queue, in the server process | our own `jobs` table plus a singleton `queue_state` row, claimed under a lease, surviving the process |
| restart sweep marks orphans `error` | lease expiry, and a rescue sweep that reclaims what a dead worker held |
| one process, so the in-memory map is authoritative | the table is authoritative, and every write is **fenced on `attempt_id`** |
| polling `/api/jobs` | still polling — it is fine, and it is the part that does not need to change |

Three things that changed since this table was first written:

- **Not pg-boss after all.** The original reason to reject it (a second client and its own pool) has
  gone away now that we connect to Postgres directly, so it was reopened honestly. It is still not
  being adopted, for a weaker reason: our `jobs` table is unusually rich — per-step state, a
  cancellation that must *not* release the global slot, de-duplication on forced steps — and would
  have to exist beside pg-boss's own, leaving two sources of truth about the same work. **Revisit
  when redelivery or backoff becomes a requirement rather than a nicety.**
- **`SKIP LOCKED` does not give concurrency 1.** The obvious
  `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` lets two workers claim two *different* jobs, which is
  exactly the global concurrency-1 guarantee this document chose on purpose. Claiming must lock the
  singleton `queue_state` row first.
- **`LISTEN/NOTIFY` is not available.** It is session-scoped, and we reach Postgres through a
  transaction-mode pooler, which hands out a connection per transaction. It would not error at
  connect time — it would simply never deliver. **Keep polling**, which this document already says is
  the right answer.

The seam is [`src/jobs.ts`](../../src/jobs.ts): `enqueue`, `listJobs`, `getJob`, `cancelJob`,
`retryJob`, `forgetJob`. Nothing above those six knows there are files.

## They are the same functions the CLI runs

`npm run extract`, `npm run blocks`, `npm run toc` and `npm run arc` still work, and still do exactly
what they did. Each of those scripts is now a thin argv wrapper around an exported function, and the
queue calls the same function — so there is one code path per stage and no way for the two to drift.
That was the point of the refactor, and it is the thing to preserve if anyone changes a stage.

Greg chose in-process over spawning subprocesses (2026-08-25). The cost is real and worth stating: a
stage that throws inside the server process is now the server's problem, and the four stage files
belong to other agents ([architecture.md § Stage ownership](architecture.md#stage-ownership)). The
edits were kept to the smallest shape that could work — lift the body of `main()` into an exported
function, leave everything else alone — and no stage's behaviour or artefacts changed.

## See also

- [library.md](library.md) — the homepage this box sits on
- [pdf-upload-and-storage.md](../plans/pdf-upload-and-storage.md) — the upload the picker is the
  front half of, and the object store under it
- [pdf-ingestion.md](../plans/pdf-ingestion.md) — how a PDF becomes an article once we have one
- [architecture.md](architecture.md) — the pipeline, the storage layout, and who owns which stage
- [content-extraction.md](content-extraction.md) — stages 1–2, and what `meta.json` is for
- [setup-dev.md](setup-dev.md) — the commands, for when you want to run a stage by hand
- [original-version/overview.md](original-version/overview.md) — the project that did this without a
  queue, and what it cost
- [silent-success.md](../reusable/silent-success.md) — why a failed step stops the job
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the process
  behind the p-queue choice
