# Fetching — stage 1, and the things other people's servers do

Getting the bytes, and knowing what they are. One module,
[`src/fetch.ts`](../../src/fetch.ts), reached one way: the [ingest queue](ingest-queue.md), whether
an article is being added from a browser or from `npm run ingest -- <url>`
([setup-dev.md](setup-dev.md#the-stage-commands-are-one-script-and-they-drive-the-queue)).

It was reached three ways until 2026-09-05. `npm run fetch` was a human's way of diagnosing a URL,
and it is gone — see [below](#npm-run-fetch-is-gone-and-what-went-with-it); `npm run extract` took a
URL and fetched it through `fetchHtml`, and now takes a slug and reads what stage 1 stored.

This is the stage most exposed to the outside world: nearly every failure in it is somebody else's
misconfiguration arriving as a surprise, and the ones that hurt are the ones that *don't* look like
failures. So the design goal is not "rarely fails" — it is **fails legibly**, with a typed code and
a sentence a person can act on.

> we'll need a web server of some kind … Each article — let's say we pull them from the web.
>
> — Greg, 2026-08-24, [architecture.md](architecture.md#intent)

Where it sits: **stage 1** of [the pipeline](architecture.md#pipeline), feeding
[content extraction](content-extraction.md). It is not runnable on its own — see
[below](#npm-run-fetch-is-gone-and-what-went-with-it) for why a fetch-only job is a thing the queue
cannot express. `npm run ingest -- <url>` runs it, and everything after it.

## What it does that a bare `fetch` doesn't

Five things, each of which was an observed bug rather than a precaution. The evidence for each is in
[the evidence](#the-evidence) below.

| It does this | Because |
|---|---|
| Counts bytes **as they arrive** | `Content-Length` describes the *compressed* size, and often isn't sent at all |
| Decodes with **the page's own encoding** | `res.text()` always assumes UTF-8, and is silently wrong on a Shift_JIS page |
| Uses a **spec-conformant decoder**, not Node's | Node's legacy multi-byte decoders are ICU's, and ICU is not the WHATWG index |
| Checks the **bytes** before believing a content type | Publishers serve PDFs as `application/octet-stream`, and bot walls serve HTML as `application/pdf` |
| Reads `err.cause.code` | Every network and TLS failure in Node is the same `TypeError: fetch failed` |

## The shape

`fetchDocument(url, options)` returns a `FetchedDocument`, or throws a `FetchFailure`.

```ts
const doc = await fetchDocument("https://example.com/piece");
doc.kind      // "html" | "pdf"        — decided by the bytes
doc.url       // where we ENDED UP, after redirects
doc.chain     // every hop, in order
doc.text      // decoded HTML, or null for a PDF
doc.encoding  // the WHATWG encoding actually used
doc.bytes     // always present, whatever the kind
```

**`doc.url` is the URL to keep, not the one you asked for.** It is what relative links resolve
against, and a `doi.org` or `t.co` address is not what anyone means by "where this article lives".
Stage 2 resolves against it since 2026-10-05.

A failure carries a `code` you can switch on, a message written for a person, `status` where there
was one, and `retryable`. The codes are `invalid-url`, `unsupported-scheme`, `blocked-address`,
`dns`, `connection`, `certificate`, `timeout`, `too-many-redirects`, `unauthorized`, `forbidden`,
`not-found`, `rate-limited`, `server-error`, `http-error`, `too-large`, `unsupported-type`, `empty`.

**That message is not what the job card shows.** It can name the host, and a stored failure is not a
place for a reading history ([logging.md](logging.md)). When the pipeline's fetch step fails, each
code is given a sentence and a kind of its own by `fetchFailed` in
[`src/messages.ts`](../../src/messages.ts), and the kind decides whether Retry is offered:
[ingest-queue.md § The failures Retry is not offered under](ingest-queue.md#the-failures-retry-is-not-offered-under).
The diagnostic that reaches the log is rewritten at the same place, from the code and the status
alone. The other callers (link previews, figures, the bibliographic lookups) classify a failure
their own way and are unchanged.

**Everything it touches from outside is injectable** — the fetch, the clock, the sleep, the DNS
lookup, the jitter. That is not ceremony. It is the only reason
[`tests/fetch.test.ts`](../../tests/fetch.test.ts) can pin an incomplete certificate chain, a
redirect loop, a lying `Content-Length` and a 4.9 MB PDF without a network. A fetcher tested against
the live web is tested against whatever the web is doing this morning.

## The evidence

Everything below was measured on 2026-08-25 against real URLs, not reasoned about. Greg named three
representative hard cases; two of them turned out to be load-bearing, and the third is the exact URL
that broke the previous version.

### Size, and the header that lies about it

`google.com` sends `content-length: 86616` and hands over **285,514 bytes**. The header describes
the compressed wire size; what arrives has already been decompressed by undici. Under chunked
encoding there is no header at all. So the cap is enforced by **counting bytes off the stream**, and
`cancel()`ing the socket the moment it is exceeded rather than politely draining the rest.

There was a second, cheaper check here — refuse before downloading anything if the declared length
already exceeds the cap — justified as safe in one direction, since decompressed can only be bigger
than compressed. **It was removed on review, and the reasoning is worth keeping.** It is not sound:
compressing incompressible input can add overhead rather than remove it, and more to the point a
server that simply overstates would have had a real article refused, with a confident figure in the
error message and no way to tell from outside that the figure was invented. It was also quietly at
odds with this very section — the header is a claim by the same server we have just finished saying
lies about it. What it bought was skipping a download the cap already bounds. **The cap is
now enforced in exactly one place: bytes that actually arrived.**

**The cap is 50 MiB, and it is the upload's number, not a second one.** `DEFAULTS.maxBytes` in
`src/fetch.ts` is `MAX_UPLOAD_BYTES` from `src/uploads.ts`, the constant the upload dialog reads
when it says "up to 50 MB", so a file chosen and an address pasted stop at the same size and cannot
drift. Until 2026-10-04 it was a second literal, 32 MiB, and a document fetched by address was
refused at a size the dialog had just called fine.

> make them consistent (and perhaps reuse the same protection-machinery)
>
> — Greg, 2026-10-04

The machinery is shared too. The streaming counter is `readStreamCapped` in `src/read-capped.ts`,
and both the fetch (`readCapped`) and the store's own read (`get` in `src/store/blobs-supabase.ts`)
go through it; omitted Storage caps default to `MAX_UPLOAD_BYTES`, while explicit limits can
name the size of stored UTF-8 HTML. The store used to read the whole body and check its length
afterwards. It is still a
defence ([security-map.md](security-map.md)): a hard stop on bytes that arrived. What a body at the cap
holds in the fetch itself is the chunks plus one joined copy, up from about 64 MiB to about
100 MiB; past that point an upload at 50 MiB already sends the same bytes down the same pipeline.
**That is a bounded increase, not a measured capacity**: nobody has confirmed Vercel's memory
ceiling for a 50 MiB import, by either route (`src/pdf-read.ts` says the same of its own numbers).
Only the pipeline's own document fetch uses the default: link
previews, paper text, figures and the bibliographic lookups each pass a tighter cap of their own.

**What the reader is told.** Over the cap, the job card shows `FETCH_TOO_BIG` (`[fetch-big]` in
`src/messages.ts`), which names the limit and is `blocked`, so no Retry is offered for the same
over-limit document. The content at an address can change;
this refusal does not predict its future size. The plan is
[261004k](../plans/261004k-one-size-limit-for-an-upload-and-an-address.md). It was the first fetch
failure to have a sentence of its own; every other code has one now, through `fetchFailed`.

**The number also has a floor with a source.** The previous version used 4 MB
([original-version/extraction.md](original-version/extraction.md#the-fetch-and-one-hard-won-fix)),
and Greg's own example — `sas.upenn.edu/~cavitch/pdf-library/Nagel_Bat.pdf`, Nagel's *What Is It
Like to Be a Bat?* — is **4,930,377 bytes**. Their cap would have refused it. A limit picked without
a real document in front of you refuses real documents; `tests/fetch.test.ts` asserts the default
clears that exact size, so shrinking it means looking at this paragraph.

### Character encoding

`res.text()` always decodes as UTF-8. The Aozora Bunko edition of Natsume Sōseki's *I Am a Cat*
serves `Content-Type: text/html` with **no charset parameter**, and declares `Shift_JIS` only in a
`<meta>` tag. Naively decoded, its title comes out as `�Ėڟ��� ��y�͔L�ł���` — mojibake, with
nothing raised and every downstream stage none the wiser.

So: the HTML spec's own sniffing algorithm — BOM, then the `Content-Type` charset, then a prescan of
the first kilobyte for `<meta charset>`, then a default — via
[`html-encoding-sniffer`](https://github.com/jsdom/html-encoding-sniffer), which is the
implementation jsdom itself uses. It was already in the tree as jsdom's dependency; we declare it
directly rather than reaching through jsdom for it.

The default when nothing declares anything is **windows-1252**. The spec is softer than that sounds
— it makes the default implementation- and locale-dependent, and windows-1252 is the suggested value
for "all other locales", which is the one that applies to us. It costs nothing on an ASCII page,
which is what undeclared pages nearly always are — `paulgraham.com` is one.

XHTML is decoded by XML's rules instead: UTF-8 by default, and no `<meta>` prescan. Running XML
through the HTML algorithm is a quiet way to mangle a perfectly ordinary UTF-8 document, because
windows-1252 decodes *any* byte sequence and so can never fail loudly.

One small thing worth knowing: Instagram serves `charset="utf-8"` with the quotes *inside* the
header value. A regex that doesn't strip them hands the decoder a charset name that doesn't exist.

### The decoder is not Node's

**The most surprising thing found on this task, and the reason there is a second dependency.** The
finding has since half-expired, and how it expired is the more useful half of the story.

**What was found, 2026-08-25.** `new TextDecoder("windows-1252")` in Node reported
`.encoding === "windows-1252"` and then decoded the C1 range the way ISO-8859-1 does:

```
byte          0x80  0x91  0x92  0x93  0x94  0x96  0x97
Node          0080  0091  0092  0093  0094  0096  0097   ← C1 control characters
WHATWG        20AC  2018  2019  201C  201D  2013  2014   ← € ‘ ’ “ ” – —
```

Those seven bytes are the euro sign, both pairs of curly quotes, and the en- and em-dash — **the
punctuation of ordinary English prose**. A legacy page would arrive with invisible control characters
where its quotation marks should be. Nothing throws, nothing is logged, and the text looks nearly
right. That is [silent success](../reusable/silent-success.md) in its purest form. So the decoder
became [`@exodus/bytes`](https://www.npmjs.com/package/@exodus/bytes), which implements the WHATWG
indexes properly and is what `html-encoding-sniffer`'s README tells you to pair it with.

**Node has since fixed that.** [#60893](https://github.com/nodejs/node/pull/60893) added a real
windows-1252 decoder and [#61093](https://github.com/nodejs/node/pull/61093) reimplemented *all* the
single-byte encodings in JavaScript against the WHATWG index tables, dropping ICU from that path
entirely. They shipped in **24.13.1** and **25.4.0**, in January 2026, and were backported down the
LTS lines. Measured here on Node 26.7.0: Node and `@exodus/bytes` now agree byte for byte on every
single-byte encoding, on UTF-8, UTF-16 and GBK/GB18030, and on `iso-2022-jp`.

**The dependency stays anyway, and the reason is the multi-byte encodings.** They still reach ICU,
and ICU is not the WHATWG index. Measured on Node 26.7.0, over every one- and two-byte sequence:

| Encoding | Where they differ | Who is right |
|---|---|---|
| `shift_jis` | 0x1A → U+001C, 0x1C → U+007F, 0x7F → U+001A; 0x80 → U+FFFD | **Node is wrong.** The spec says an ASCII byte or 0x80 decodes to itself. ICU carries IBM's control-code rotation |
| `big5` | 0x80 → U+0080, 0xFF → U+F8F8 | **Node is wrong.** Both are decoder errors; U+F8F8 is an ICU private-use invention |
| `euc-jp` | 0x80–0x9F pass through as C1 controls | **Node is wrong.** Not lead bytes; the spec says error |
| `euc-kr` | 0x80–0x9F pass through as C1 controls | **Node is wrong.** Same |

Same failure shape as the original, different alphabet — and Shift_JIS is not hypothetical here: the
[Aozora Bunko page above](#character-encoding) is the worked example this whole section is built on.
Its title happens to decode identically either way; a page with a stray 0x1A in it would not.

To re-check whether the dependency can go, compare the two decoders directly rather than trusting
this table — it was true on one day:

```
node -e 'import("@exodus/bytes/encoding.js").then(({TextDecoder:S})=>{
  for (const e of ["shift_jis","big5","euc-jp","euc-kr"]) {
    const n=new TextDecoder(e), s=new S(e); let d=0;
    for (let a=0;a<256;a++) for (let b=0;b<256;b++) {
      const u=new Uint8Array([a,b]); if (n.decode(u)!==s.decode(u)) d++;
    }
    console.log(e, d ? d+" sequences differ" : "agrees");
  }})'
```

**And there is no `engines` pin.** [Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
offers 20.x, 22.x and 24.x, defaulting to 24.x, and picks the version from project settings when
`package.json` says nothing — so the deployed runtime is not something this repo currently decides.
The 20.19.5 on this laptop still has the original windows-1252 bug. That does not change the answer
above, but it is why "Node fixed it" is not on its own a reason to drop anything.

**The test that pinned this was itself the bug.** It asserted that Node decoded windows-1252
*wrongly*, so Node getting better turned it red — a green suite went red with nothing in this repo
having changed, and the red looked like our defect. Worse, the obvious reading of it ("Node is fixed,
the dependency can go") would have deleted a decoder that is still load-bearing for four encodings
the test never mentioned. **Assert what you require, never somebody else's defect.** The replacement
tests assert only that `decodeHtml` is right — including on the four Shift_JIS bytes Node currently
gets wrong, which still catches the import being swapped for the global, and which will keep passing
rather than going red if Node ever catches up there too.
[docs/postmortems/260826b-windows-1252-node-caught-up.md](../postmortems/260826b-windows-1252-node-caught-up.md).

### What kind of document it is

The bytes are consulted first, and a header is believed only where they don't contradict it. Not
quite "the bytes always win": a `%PDF-1.7` found part-way into something the server called
`text/html` is treated as a page *about* PDFs, because that is what it nearly always is. What the
rule actually says is that a **PDF header at the very start** beats any label, and a vague or absent
label loses to document markup:

- Academic publishers serve real PDFs as `application/octet-stream` and `text/plain`. A `%PDF-`
  magic number is still a PDF.
- A Cloudflare challenge page served from a `.pdf` URL is still HTML. `doi.org/10.1145/1629575.1629587`
  redirects cleanly to `dl.acm.org` and is then met with *"Just a moment…"*.
- `httpbin.org/status/401` sends **no `Content-Type` header at all**, so "the header is absent" is a
  case, not an edge case.

Anything that is neither HTML nor PDF is refused by name — an image or a JSON document should get a
sentence, not a Readability run over garbage.

### Certificates, and the case that looks like it works

Node has no AIA fetching. When a server sends its own certificate and omits the intermediate above
it, browsers and curl repair the chain silently by fetching the missing certificate; Node fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. **So the page opens perfectly in the browser the reader just
checked it in, and fails here** — the most confusing shape a bug can have. Reproducible today
against `incomplete-chain.badssl.com`, where curl succeeded and Node failed on the same machine at
the same moment.

That curl comparison needs one qualification: whether curl recovers depends on its TLS backend, not
on curl. The run above was macOS curl going through the system trust store, which does chase the
missing certificate; curl's own FAQ lists incomplete chains as a standard works-in-a-browser,
fails-in-curl case, so a Linux build would more likely fail alongside Node.

We do **not** try to repair it. Three options were weighed:

| Option | Verdict |
|---|---|
| `ssl-root-cas`, which the previous version used | **Dead** — last published around 2019. Their fix has rotted |
| `NODE_EXTRA_CA_CERTS` | Adds trusted *roots*; does not supply a missing *intermediate*. Wrong tool for this failure |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disables verification process-wide. Never |
| Fetch the AIA URL from the leaf and retry | What browsers do. Real work, no maintained package, not yet warranted |

So the error message does the work instead: it says the certificate is incomplete, says browsers
paper over it and Node doesn't, and suggests `NODE_OPTIONS=--use-system-ca`, which sometimes works
because the system trust store may already hold the missing certificate. **Build the AIA repair when
a page Greg actually wants hits this**, not before.

Worth knowing: `Nagel_Bat.pdf` — the URL that produced the previous version's TLS bug, and which
still has a live integration test over there asserting a 502 — **now fetches cleanly**. The server
was fixed at some point in the intervening year. The lesson survives the fix.

### Every network failure is the same error

```
DNS not found          →  TypeError: fetch failed   cause.code = ENOTFOUND
connection refused     →  TypeError: fetch failed   cause.code = ECONNREFUSED
certificate expired    →  TypeError: fetch failed   cause.code = CERT_HAS_EXPIRED
self-signed            →  TypeError: fetch failed   cause.code = DEPTH_ZERO_SELF_SIGNED_CERT
self-signed in chain   →  TypeError: fetch failed   cause.code = SELF_SIGNED_CERT_IN_CHAIN
missing intermediate   →  TypeError: fetch failed   cause.code = UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

Code that matches on the message learns **nothing**, and the previous version matched on the message
— `error.message === 'fetch failed'` was their test for a TLS chain problem, which matches every one
of the six. `classifyNetworkError` reads `cause.code`, and the table above is a test.

There is a second shape, and it cost a bug: `dns.lookup`, which the address guard calls before any
fetch, hangs `code` on **the error itself** rather than on `cause`. Reading only `cause.code` — the
obvious spelling, and the one this had first — reported every unresolvable domain as a generic
connection failure, with the giveaway `getaddrinfo` text sitting in the message and nothing acting
on it. Found by running the module against a real dead domain, not by reading it.

### Redirects, followed by hand

`redirect: "manual"`, and the loop is ours. That is more code than `follow`, and buys three things:
a hop cap we chose (5), a check of **each new address** before dialling it, and the chain kept on
the result. The chain is worth keeping — "this resolved somewhere else" is most of the explanation
when an article turns out to be a paywall notice. A repeat of any URL already in the chain is a
loop, and says so rather than grinding to the hop limit.

### Timeouts, and where the headroom is thin

One deadline of 30 seconds covers a whole attempt, redirects included. That is deliberately simpler
than the alternative — undici's separate connect, headers and body stall timeouts, which need
`undici` as a direct dependency and a custom dispatcher — and a stall is bounded by the deadline
anyway.

**The one measurement that argues with this:** the Nagel PDF took about 19 seconds. It is 4.9 MB
from an elderly Apache box, and it succeeded with roughly eleven seconds to spare. So a large PDF
from a slow academic server is the case that will hit this limit first, and the symptom will be a
`timeout` — which is marked retryable, so it will be tried three times before failing. If that
starts happening, raise `timeoutMs` for the queue rather than reaching for a stall timeout: the
deadline is doing its job, the document is just genuinely big and the server genuinely slow.

### Retries

Two to three attempts, because a person is waiting. 429 (honouring `Retry-After`, capped), 502, 503,
504 and the transient socket errors are retried; 401, 403, 404 and our own refusals are not — they
will fail identically. Backoff uses **full jitter**, a delay drawn uniformly from zero to the
ceiling. A `Retry-After` that is not a positive wait (`0`, a date already past) counts as none, so
the backoff applies (`src/retry-after.ts`).

## What stage 1 leaves behind, since 2026-08-31: nothing on disk

**`writeRaw` writes no files.** It used to write `data/<slug>/raw.html` (or `raw.pdf`) and a
`raw.json` manifest beside it; it now returns the manifest and the *store* decides where that goes —
`raw.json` on the filesystem, columns on `article_revisions` in Postgres. The bytes go where they
were already going: the content-addressed `sources` bucket, under `canonicalKey(storedSha256, kind)`,
through [`src/store/blobs.ts`](../../src/store/blobs.ts), which is itself selected (`blobs-fs.ts`
locally, `blobs-supabase.ts` deployed).

Stage 2 gets them back with **`readRawBytes(manifest)`** in [`src/fetch.ts`](../../src/fetch.ts),
which follows the content address and checks the object hashes to its own name before handing it
over. That is deliberately *not* a second method on `SourceStore`: `readPdf` there looks an article
up by slug through `articles.currentRevisionId` and `ownedSlug`, and stage 2 runs against a **draft**
revision inside a job — on a fresh ingest there is no current revision at all, so a sibling method
there would answer `null` on the ordinary path.

Three things follow, and all three are refusals rather than fallbacks:

- **A manifest with no `storedSha256` is refused.** Those are manifests written before 2026-08-27,
  and the answer is a re-fetch (Greg, 2026-08-30: the corpus is expendable).
- **`readRaw(dir)` returning `null` no longer means "assume HTML".** It meant that until this change
  and stage 2 fell back to reading `raw.html`; nothing writes `raw.html` now, so the fallback had
  nothing to fall back to. Two articles in the local corpus were relying on it — `data/constitution`
  and `data/noema-mythology-of-conscious-ai`. `readRaw` itself is gone too, deleted 2026-09-05 along
  with its last caller, `loadSource` in `src/api.ts`, and the filesystem store both belonged to
  ([`src/fetch.ts`](../../src/fetch.ts) § *`readRaw(dir)` was here*). (`slugIsSpokenFor` was a similar
  one-caller survivor, retired on 2026-08-31 when every slug gained a short id and the collision
  question it answered stopped existing.)
- **An object that is absent, corrupt, or longer than the manifest says, throws** —
  `RawDocumentUnavailable`, with the reason as a field.

**One thing measured on the day, worth knowing before the first run.** `blobStore()` follows the
credentials: with `SUPABASE_URL` and a service key in `.env.local` it is the container's bucket, and
without them it is `data/_blobs/`. The local corpus was written by processes of both kinds, so nine
of its eighteen manifests name an object the other store holds. Nothing noticed while nothing read
them back. They now fail loudly, with a sentence naming the article, the key, the mechanism and the
fix — which is a re-fetch. The measurement, the two probes that produced it and the counts are in
[260831e-a-write-path-with-no-reader.md](../postmortems/260831e-a-write-path-with-no-reader.md).

### `npm run fetch` is gone, and what went with it

**Retired 2026-09-05**, in stage E of
[260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md). It took a
URL and wrote `data/<slug>/raw.html` (or `raw.pdf`) with the `raw.json` manifest beside it, off
`process.cwd()` and by hand — which satisfied the queue's fetch step under the filesystem store
and, under Postgres, wrote files nothing reads.

**A fetch-only job is not a thing the queue can express**, and that is the reason it became
`npm run ingest -- <url>` rather than moving across as it stood. Publication happens once, when the
job settles, and `reasonsNotToPublish` refuses a draft with no blocks and no tree
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)). So a fetch-only job on a **new**
article fetches, pays, and fails at publication. On an **existing** one it is worse, because it
*succeeds*: the draft carries the published revision's blocks and tree, so it publishes new raw bytes
beside stale derived content and calls that a success. The workflow being given up — *write the fetch
output now, let another process continue later* — worked only because a file was a durable handoff
between two processes, and Postgres has no such handoff. Re-fetching cascades instead: **`npm run
ingest -- <url> --force`** forces `fetch`, and `cascadeForce` forces every step after it. Without
`--force`, an address already on the shelf is adopted and every step says `skipped` — which is the
honest answer, and was the *whole* answer until GPT Sol pointed out on 2026-09-05 that the command as
first written could not re-fetch at all.

**And `fetch` on its own is refused by name.** Deleting the npm script removed the name;
`scripts/stage.ts` takes any step, so `scripts/stage.ts fetch <slug> --force` was still exactly the
incoherent job this section is about. It now stops with the sentence — a rule stated only in
`package.json` is a rule the next argument list walks round.

**Renamed rather than aliased**, so `npm run fetch` fails with *"Missing script"* instead of quietly
doing something else.

**The one real loss is the diagnostics.** That command printed the redirect chain, the type, the
encoding, the network-vs-stored size, the object key and the credentials that chose the blob store —
which is what made it the thing to reach for when a URL would not come in, and how the split
described above stopped being invisible. `fetchDocument` still returns every one of those fields and
nothing prints them today. `missingObjectAdvice` and `credentialsSeen` in
[`src/fetch.ts`](../../src/fetch.ts) still report the credentials from inside the failure that needs
them.

`writeRawFiles` outlives the command by one caller —
[`tests/stage2c-raw-bytes.test.ts`](../../tests/stage2c-raw-bytes.test.ts), which is still the only
thing comparing what it writes against what `PATHS.fetch.raw` reads. It dies with the filesystem
store.

## A paper source: one paper, several addresses

> If I include a link like this, the right move is to grab either the html or the pdf, rather than
> reading in this exact link.
>
> — Greg, 2026-10-05, of an `arxiv.org/abs/…` link with tracking parameters on it

Until 2026-10-05 that link imported arXiv's abstract page: 304 words under the paper's title, and
nothing to say it was not the paper. Now the fetch step asks
[`src/paper-sources.ts`](../../src/paper-sources.ts) first.

`resolvePaperSource(url)` is pure string work. For an address a source recognises it answers with
the paper's id, one key and one slug for every shape of its link, and **candidates**: the
addresses to try, in order, each saying what kind of document it must be. For anything else it
answers `null`, and the step makes the one request it always made.

```
 candidates = resolvePaperSource(url)?.candidates ?? [{ url }]
 for each, in order:   doc = fetchDocument(candidate.url)        ← unchanged
     the kind it promised (and, for HTML, carrying its marker)   → this is the document
     a 404 or a 410, or the wrong kind, and another candidate    → try the next
     anything else                                               → fail, as a pasted address does
```

Four things about it that are deliberate:

- **`fetchDocument` is called exactly as before, once per candidate.** Every defence below runs on
  every one, and a candidate's address is a fixed string built from the matched id, never text
  copied from what was pasted.
- **Only absence moves on.** A timeout, a rate limit, a blocked address or an oversized body is the
  step's failure. Falling back past those would hide the cause and could quietly spend money on a
  costlier rendering.
- **The last candidate must be what it promised too.** A PDF address that serves an HTML error page
  stores nothing and fails with `[fetch-incomplete]`, which offers Retry.
- **It resolves in the step, from the job's own address**, so a retry and a refresh fetch the paper
  too.

**arXiv's candidates are its HTML rendering, then its PDF.** It recognises `abs`, `pdf`
(with or without `.pdf`), `html` and `format` paths on `arxiv.org`, `www.`, `export.` and
`browse.`, old-style ids, a version (kept: `v1` is a different article from the latest), and
arXiv's own DOI at `doi.org/10.48550/arXiv.<id>`. It matches an origin, so a non-default port or
credentials in the address is not arXiv.

> run evals to figure out whether html or pdf is better. Then even if someone gives us a link like
> this, automatically download the actual paper (either html or pdf as you decide).
>
> — Greg, 2026-10-05

The HTML goes first because reading it is free and takes seconds, where a model reading the PDF
costs about ten cents and two minutes, and because on the five papers compared it was the better
article once stage 2 knew LaTeXML's shapes
([content-extraction.md](content-extraction.md#a-latexml-page-arxivs-html), and
[261005e](../investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md)
for the comparison). arXiv has no HTML for a paper its converter could not handle and answers 404,
which is what sends the step on to the PDF: 4 of 36 recent papers probed. The HTML candidate's
marker is `ltx_document`, LaTeXML's own class, so an error page served with a 200 is not taken for
the paper. **A `pdf/` link gets the HTML too**: the choice is about the paper, not about which
button on arXiv's page the link was copied from.

**Adding a source is adding one object to `SOURCES`**, when the paper and its candidates can be
read off the pasted address. A link that names its paper only once it has been followed (a short
link, a `doi.org` link that redirects to a publisher) is not a source and needs no object:
[§ A link that leads to a paper](#a-link-that-leads-to-a-paper).

### The sources

Since 2026-10-06 there are seven, and two sites that are shapes of the first. Every one was chosen
because its landing page imported as a stub of a few hundred words under the paper's title
([261005e](../research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md)
has the measurement and the ranking, and
[the plan](../plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md) says
which sources were left out and why). NBER came a few hours after the other five, in
[261006i § Stage 3](../plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md#stage-3-nber-and-osf-decided-by-the-probe),
which also says why OSF is still not one.

| Source | What it recognises | What it fetches, in order |
|---|---|---|
| `arxiv` | arXiv's own addresses, above. Also the pages *about* an arXiv paper: `huggingface.co/papers/<id>`, and `alphaxiv.org/abs/<id>` and `/overview/<id>` with or without `www.` | `arxiv.org/html/<id>`, then `arxiv.org/pdf/<id>` |
| `acl` | `aclanthology.org/<id>`, with a trailing slash or `.pdf`; `doi.org/10.18653/v1/<id>` | `aclanthology.org/<id>.pdf` |
| `pmlr` | `proceedings.mlr.press/v<N>/<name>.html`, `/v<N>/<name>.pdf`, `/v<N>/<name>/<name>.pdf` | `/v<N>/<name>/<name>.pdf`, then `/v<N>/<name>.pdf` |
| `neurips` | `proceedings.neurips.cc` and `papers.nips.cc`: `/paper/<year>/hash/<hash>-Abstract[-<track>].html` and `/file/<hash>-Paper[-<track>].pdf`, with or without `/paper_files` in front | `proceedings.neurips.cc/paper_files/paper/<year>/file/<hash>-Paper[-<track>].pdf` |
| `cvf` | `openaccess.thecvf.com/<collection>/html/<name>.html` and `/<collection>/papers/<name>.pdf`, the collection written `content_cvpr_2016` or `content/ICCV2021` | `/<collection>/papers/<name>.pdf` |
| `jmlr` | `jmlr.org/papers/v<N>/<name>.html` and `/papers/volume<N>/<name>/<name>.pdf`, with or without `www.` | `jmlr.org/papers/volume<N>/<name>/<name>.pdf` |
| `nber` | `nber.org/papers/w<N>`, with a trailing slash or `.pdf`, and `/system/files/working_papers/w<N>/w<N>.pdf`, with or without `www.`; `doi.org/10.3386/w<N>` | `www.nber.org/system/files/working_papers/w<N>/w<N>.pdf` |

**A Hugging Face or alphaXiv page is the arXiv paper**, not a source of its own: it resolves to
exactly what the arXiv link resolves to, so it is the same article, and its source link afterwards
opens arXiv. The three other places that ask "is this an arXiv paper?" ask the registry's
`arxivIdOf` too (`identityOf` in `src/cited-in-spideryarn.ts`, `keysOf` in `src/citations.ts`,
`arxivPdfUrl` in `src/paper-text.ts`), so a work an article cites by its Hugging Face page matches
the arXiv article on the shelf and is read from arXiv's PDF.

The rules every source follows, each held by `tests/paper-sources.test.ts` for every source:

- **It matches an origin**: `http` or `https`, the named host exactly, no port, no credentials.
- **A candidate is a fixed `https://` address on the source's own host**, built only from pieces
  that a closed character class matched. No pattern lets through a dot segment, a percent sign, a
  backslash or a doubled slash.
- **The landing page, the PDF's own address and every candidate resolve to one paper.** The
  article's address afterwards is the PDF's, and "do we already have this?" asks that address. A
  source whose PDF ended somewhere its own pattern does not know would be imported, and paid for,
  on every paste. `evals/paper-sources/resolve-live.ts` checks this on real fetches; its last whole
  run is [`261005m-evidence/resolve-live.txt`](../plans/261005m-evidence/resolve-live.txt), and
  NBER's is [`261006i-evidence/resolve-live.txt`](../plans/261006i-evidence/resolve-live.txt).
- **Every candidate is the paper, as a PDF. The landing page is never one.** A stub stored under
  the paper's key could not be replaced by pasting the PDF.
- **The key holds the whole id and the slug is cut to 60 characters.** A CVF file name runs to 90.
  The key is what `urlKey` gave the landing page before the source existed, so it has no `www.`
  (`nber.org/papers/w30000`) even where the site's own address does.
- **A name keeps the case it was pasted in**, because these servers are case-sensitive. ACL's ids
  are the exception: a DOI is case-insensitive, so `n19-1423` is spelled `N19-1423`. NBER's
  numbers are the other, for the same reason: `W30000` is spelled `w30000`.
- **NeurIPS's ending is read off the link, never guessed.** The file is `-Paper.pdf` in some years
  and `-Paper-Conference.pdf` or `-Paper-Datasets_and_Benchmarks.pdf` in others, and the abstract
  page's own name carries the same ending.

**What that costs.** Each of these serves the paper as a PDF only, and a PDF is read by a model:
about ten US cents and one to three minutes, where the landing page took seconds and nothing. That
is the price of the paper rather than its announcement, and the same as pasting the PDF's address.

### A link that leads to a paper

A short link (`bit.ly`, `t.co`) or a DOI no source knows by its pattern names no paper until it
has been followed. Until 2026-10-06 such a link imported whatever page it ended on, which for an
arXiv paper was the abstract page. Now `fetchByAddress` in
[`src/pipeline.ts`](../../src/pipeline.ts) looks once more, after the fetch:

```
 paper = resolvePaperSource(url)
 if a paper                → its candidates, as above
 doc = fetchDocument(url)                                  ← as it always was
 if doc.url is where we asked (ignoring a fragment)        → keep doc
 paper = resolvePaperSource(doc.url)
 if none                   → keep doc, one request, as it always was
 else                      → that paper's candidates, as above, with doc in hand
```

- **Only the address the fetch ended on is asked about**, never a hop on the way, and only when
  it is not the address that was asked for.
- **The document already fetched is not fetched twice.** When a candidate's address is the one
  the document ended on, the document stands in for that request, and is held to the candidate's
  promise like any other answer. "The same address" is `sameTarget` (`src/urls.ts`): one request,
  differing at most by a fragment. So a short link to `arxiv.org/pdf/<id>` asks for arXiv's HTML
  first and, when there is none, uses the PDF it holds. A link to a landing page fetches the
  candidates, since a landing page is never one.
- **Nothing new is trusted.** The redirect only says which paper, by the same patterns a pasted
  address goes through. What is fetched are the registry's own fixed addresses.
  [security-map.md](security-map.md).
- **From there on it is that source's fetch**: its name on the job card (`312 KB, ACL Anthology
  PDF`), and its failure and `warn` line, below.

The article's address afterwards is the paper's, not the short link's, so the shelf finds it by
the link through `articles.asked_url`:
[ingest-queue.md](ingest-queue.md). The reasoning, and what the review changed, is
[the plan](../plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md#stage-2-the-redirect-look);
four real redirecting links are in
[`261006i-evidence/resolve-live.txt`](../plans/261006i-evidence/resolve-live.txt).

### A paper that is not where the rule says

The grammars were learned from a few papers per site. When the last candidate answers 404 or 410,
the import fails, where before 2026-10-06 it would have imported the abstract page. The card shows
`FETCH_PAPER_MISSING` (`[fetch-paper-missing]`, `blocked`, no Retry): the site did not have the
paper where it usually keeps it, so check the link, or download the PDF and upload it. It is not
`[fetch-not-found]`, which says there is no page at the reader's address, because for these
sources their address is usually fine and the missing one is ours. Nothing
is charged: the fetch is the first step and a failed import releases its slot.

Any other failure of a paper source keeps the sentence that failure always had. Either way
`fetchFromPaperSource` in [`src/pipeline.ts`](../../src/pipeline.ts) writes one `warn` line: the
source's name, how many candidates were asked, and the failure's bracketed code. A rule that keeps
missing shows up as one source's name repeating. No address is logged. An address no source
recognises fails exactly as it did, with no such line.

**The article's address is the one its text came from.** `doc.url` of the candidate that was used
is what the store keeps (`final_url`), so an arXiv article's source link opens arXiv's HTML (or
its PDF, when that is what was read), not the abstract page. Keeping the abstract page's address
as well would need a second address column, which is a question for Greg in
[the plan](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md). What makes that address and a freshly pasted `abs` link one article is `urlKey`,
which answers with the source's key for every shape
([ingest-queue.md § Two URLs, one article](ingest-queue.md#two-urls-one-article)).

## Not everything gets fetched: `RawManifest` has an origin

Since 2026-08-27 an article's raw document can also come off a **reader's own disk**
([ingest-queue.md § Uploading a PDF](ingest-queue.md#uploading-a-pdf)). Nothing in this file runs
for one — there is nothing to fetch — but the artefact it writes is shared, so `RawManifest`
changed in three ways worth knowing before you read one:

- **`origin`** is `"url"` or `"upload"`, and **absent means `"url"`**, which is what every manifest
  written before this is.
- **`requestedUrl` and `url` are optional.** They used to be required, which is the assumption that
  would have taken the time: filling them with `file://…` or `upload://…` for an upload reads as an
  *address* to everything downstream — `GET /api/source/:slug`, import/export, the metadata page —
  and not one of them would have said anything. Making the typechecker ask instead is the whole
  benefit, and it turned out to be four call sites.
- **`uploadId` and `filename`** are there for an upload. The filename is the reader's own string,
  kept to show them and to feed the last rung of the PDF title ladder; nothing derives a key or a
  path from it.

Both origins produce the same manifest with the same `sha256` over the same bytes, which is what
lets stage 2 onwards stay ignorant of which ran. See
[content-extraction.md](content-extraction.md).

## The user-agent question

We send a **browser** string, not an honest one. This is the least comfortable decision here and it
is deliberate.

The argument for honesty — `Spideryarn/1.0 (+…)` — is real: a tool should say what it is. The
argument against is that a meaningful share of publishers serve a stub or a 403 to anything that
doesn't look like a browser, and the thing being done here is one person opening one page they asked
for. That is what a browser is for. It is not crawling: one URL, one request, human-initiated.

Two findings that bear on it:

- **A user-agent alone isn't what gets you through anyway.** curl is blocked by LinkedIn and Zillow
  while sending the *identical* Chrome string that Node's `fetch` sails through with. The difference
  is the rest of the header set — Node sends `Accept-Encoding`, `Accept-Language` and `Sec-Fetch-Mode`
  by default, and curl sends almost nothing. Some walls check for those, not for the name.
- **Glassdoor's Cloudflare challenge blocks both.** Where there is a real JS challenge, no header
  makes any difference, and pretending otherwise would just be dishonest *and* broken.

So the value is a one-line override, `USER_AGENT` in [`src/fetch.ts`](../../src/fetch.ts), and
nothing depends on it. If this ever fetches unattended or at volume, change it — the reasoning above
stops applying the moment a human is no longer waiting for the page.

**robots.txt is not checked**, for the same reason: it governs automated crawling, and a round trip
per add would protect nobody from a single human-initiated read. If an unattended mode ever arrives,
revisit this in the same breath as the user-agent.

## Addresses we won't dial

Scheme allow-list — http and https only, so a pasted `file:///etc/passwd` is a sentence rather than
a read. Then `localhost`, and one DNS lookup rejecting loopback, private, link-local, carrier-grade
NAT, multicast and reserved ranges, including an IPv4 address wearing an IPv6 coat
(`::ffff:127.0.0.1`) and the cloud metadata address `169.254.169.254`. Every redirect hop is checked
too, not just the first.

**DNS rebinding is closed, since 2026-08-29.** It was the known gap here for months, and the
argument for leaving it open was that the URL comes from Greg's own text box, so an attacker would
need a domain's DNS *and* his clipboard. [Hosting the article's own
images](../plans/260829b-hosting-the-articles-images.md) ends that argument — those URLs come from the page,
so a publisher picks them, and there can be hundreds per article.

So `guardAddress` now **returns** the addresses it approved, and the connection is pinned to them
through an undici dispatcher (`pinnedAgent`). The hostname is untouched, so it still goes into the
`Host` header, the TLS SNI and the certificate check — only the address the socket opens against is
ours to choose. One agent serves a whole redirect chain, and each hop adds what *its* own guard
approved, so a redirect is pinned to its own answer rather than the first host's. A hostname absent
from that map is refused rather than resolved: anything reaching the socket unguarded is a bug above
that line, and the safe reading of a bug is *do not dial*.

`undici` is now a declared dependency rather than one reached through Node's internals — the same
call made for `html-encoding-sniffer` above.

The rest is still a cheap baseline rather than a hardened boundary, and the difference is worth
stating: the app is one person's, and everything else here refuses by name rather than by proof.

The previous version had **no check at all** beyond the protocol
([original-version/extraction.md](original-version/extraction.md)), which is worth closing on
purpose rather than reproducing by default.

## Dependencies, and the ones we didn't take

Two were added, both already present in the tree as jsdom's transitive dependencies, so neither cost
an install:

- **`html-encoding-sniffer`** — the spec's charset sniffing, as jsdom implements it.
- **`@exodus/bytes`** — a WHATWG-conformant `TextDecoder`. Taken because Node's got windows-1252
  wrong; kept because Node's Shift_JIS, Big5, EUC-JP and EUC-KR are still ICU's. See
  [the decoder is not Node's](#the-decoder-is-not-nodes) for the measurements and for the check to
  re-run before dropping it.

Deliberately not taken, each considered and rejected:

- **`undici`** as a direct dependency, for `headersTimeout`/`bodyTimeout` stall detection and custom
  TLS options. One whole-request deadline via `AbortSignal.timeout` is simpler to reason about, and
  a stall is bounded by it anyway. Add it if per-hop stall detection or AIA repair ever becomes
  worth building.
- **`iconv-lite` / `chardet`** — Node has shipped full ICU since v13, so the decoding table is
  there; the gap was conformance and detection, not coverage. `chardet` guesses statistically, and
  we always have headers and markup, so the deterministic algorithm is strictly better.
- **`ssl-root-cas`** — dead, and the wrong fix regardless. See above.
- **`request-filtering-agent` / `ssrf-req-filter`** — both built on Node's legacy `http.Agent`,
  which global `fetch` doesn't use. They would need unverified glue for a threat model that doesn't
  need them.
- **`file-type`** — fifty formats for a two-format problem.

The house rule this follows is [third-party-library-selection.md](../reusable/third-party-library-selection.md):
prefer long-lived, heavily-documented libraries, then write the decision down.

## What's still loose

Honest list, none of it blocking:

1. ~~**Stage 2 still uses the requested URL as Readability's base**, not `doc.url`.~~ **Closed,
   2026-10-05.** The `extract` step hands `runExtract` the manifest's final URL, which the store
   keeps as `final_url`, and falls back to the job's address only for a manifest with none. It
   became necessary rather than tidy when a paper source arrived: the job's address is whatever
   was pasted, and arXiv's HTML names its figures relative to the address it is served from. It
   changes an existing article only when it is refreshed, and then only one that was redirected
   and uses relative links, where the old answer was wrong.
2. ~~**The queue writes `raw.html` as a UTF-8 string** rather than the bytes, and has no PDF path.~~
   **Closed, 2026-08-26.** The queue calls `fetchDocument` and `writeRaw`, which stores the bytes for
   a PDF and the decoded string for HTML, and returns the manifest recording `kind`, the requested
   and final URLs, the content type, the encoding, the byte count, the SHA-256 of what arrived and
   the SHA-256 of what was kept. HTML is still stored decoded, deliberately, since every later stage
   wants text; the manifest is what stops that being a silent loss — the two hashes are different
   numbers for any page that was not already UTF-8, and that is the point of there being two. See
   `RawManifest` in [`src/fetch.ts`](../../src/fetch.ts).
3. ~~**PDFs are fetched and stored and nothing reads them.**~~ **Closed, 2026-08-26.** Paste a PDF
   URL into the add box and it becomes an article. Stage 2 branches on the manifest — never on the
   URL, because a `.pdf` address that served a Cloudflare page is HTML — and a PDF goes to
   [`src/pdf-read.ts`](../../src/pdf-read.ts) instead of Readability, producing the same
   `article.html` + `meta.json`. What the previous version learned still held:
   [original-version/extraction.md](original-version/extraction.md#pdfs-out-of-scope-but-the-lesson-transfers)
   says *don't parse structurally when a multimodal model will read the bytes*, and that is what was
   built. [../plans/260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md).
4. **A JS-rendered page returns its shell**, and we report success. `x.com` gives 193 KB of HTML
   with no post text in it. Detecting this needs the two-sided extraction ratio check, which belongs
   to stage 2 and is [on the borrow list](original-version/borrow-list.md).
5. **No AIA certificate repair**, by choice. Above.
6. **Nothing pins the Node version.** No `engines` field, no `.nvmrc`, no CI. Which Node this runs on
   is whatever Homebrew installed locally and whatever the Vercel project settings say remotely, and
   the two have already diverged by six major versions. It has cost one confusing red build so far
   ([the postmortem](../postmortems/260826b-windows-1252-node-caught-up.md)) and nothing worse, because the
   decoder is a dependency rather than a built-in. Pinning it belongs with the deploy work
   ([260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md)) rather than with stage 1.

## See also

- [architecture.md](architecture.md#pipeline) — where stage 1 sits, and what it writes
- [content-extraction.md](content-extraction.md) — stage 2, the one caller that matters
- [ingest-queue.md](ingest-queue.md) — the queue that runs this in the server process
- [testing.md](testing.md) — why this stage is testable at all, and what is still not tested
- [original-version/extraction.md](original-version/extraction.md) — what the previous version did
  here, what it got right, and the fix of theirs that has since rotted
- [../reusable/silent-success.md](../reusable/silent-success.md) — the failure family the decoder
  bug belongs to
- [../postmortems/260826b-windows-1252-node-caught-up.md](../postmortems/260826b-windows-1252-node-caught-up.md) —
  Node fixed the bug this stage's decoder was chosen over, the test that pinned it went red, and why
  believing the test would have deleted something still load-bearing
