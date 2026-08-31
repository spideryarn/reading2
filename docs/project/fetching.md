# Fetching — stage 1, and the things other people's servers do

Getting the bytes, and knowing what they are. One module,
[`src/fetch.ts`](../../src/fetch.ts), reached three ways: `npm run fetch` for a human diagnosing a
URL, the [ingest queue](ingest-queue.md) for an article being added, and
[`src/extract.ts`](../../src/extract.ts) for `npm run extract`.

This is the stage most exposed to the outside world: nearly every failure in it is somebody else's
misconfiguration arriving as a surprise, and the ones that hurt are the ones that *don't* look like
failures. So the design goal is not "rarely fails" — it is **fails legibly**, with a typed code and
a sentence a person can act on.

> we'll need a web server of some kind … Each article — let's say we pull them from the web.
>
> — Greg, 2026-08-24, [architecture.md](architecture.md#intent)

Where it sits: **stage 1** of [the pipeline](architecture.md#pipeline), feeding
[content extraction](content-extraction.md). Run on its own with `npm run fetch -- <url>`, or let
the [ingest queue](ingest-queue.md) run it.

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
Stage 2 currently passes the *requested* URL to Readability as its base — see
[what's still loose](#whats-still-loose).

A failure carries a `code` you can switch on, a message written for a person, `status` where there
was one, and `retryable`. The codes are `invalid-url`, `unsupported-scheme`, `blocked-address`,
`dns`, `connection`, `certificate`, `timeout`, `too-many-redirects`, `unauthorized`, `forbidden`,
`not-found`, `rate-limited`, `server-error`, `http-error`, `too-large`, `unsupported-type`, `empty`.

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
lies about it. What it bought was skipping a download the cap already bounds at 32 MB. **The cap is
now enforced in exactly one place: bytes that actually arrived.**

**The cap is 32 MB, and the number has a source.** The previous version used 4 MB
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
ceiling.

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
  and `data/noema-mythology-of-conscious-ai`. The function survives for one caller,
  `slugIsSpokenFor` in [`src/jobs.ts`](../../src/jobs.ts), which reads a candidate slug's manifest
  during enqueue.
- **An object that is absent, corrupt, or longer than the manifest says, throws** —
  `RawDocumentUnavailable`, with the reason as a field.

**One thing measured on the day, worth knowing before the first run.** `blobStore()` follows the
credentials: with `SUPABASE_URL` and a service key in `.env.local` it is the container's bucket, and
without them it is `data/_blobs/`. The local corpus was written by processes of both kinds, so nine
of its eighteen manifests name an object the other store holds. Nothing noticed while nothing read
them back. They now fail loudly, with a sentence naming the article, the key, the mechanism and the
fix — which is a re-fetch. The measurement, the two probes that produced it and the counts are in
[260831e-a-write-path-with-no-reader.md](../postmortems/260831e-a-write-path-with-no-reader.md).

**`npm run fetch -- <url> [dir]` still writes its files**, and that is deliberate rather than
left over. The rule the conversion follows is *the generator stops writing and the caller writes*,
and for a command line the caller is `main()` — every other stage CLI in this repo leaves the file
it always left, and a `fetch` that printed a digest instead would be the one that broke the pattern.
It also keeps a property people use: running it by hand under `SPIDERYARN_STORE=files` satisfies the
queue's fetch step, because `writeRawFiles` writes `raw.json` at exactly the path
`PATHS.fetch.raw` reads. It now prints the **object key** as well, which is how the split above
stops being invisible. All of it dies at stage 4 with the filesystem store.

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

1. **Stage 2 still uses the requested URL as Readability's base**, not `doc.url`. After a redirect
   that resolves every relative link and image against the wrong origin.

   This page first called that a one-line fix in someone else's stage, and that was wrong. The
   convenience wrapper `fetchHtml` returns a string, so the final URL is **thrown away between step
   1 and step 2** and there is nowhere for stage 2 to read it from. Fixing it means deciding where
   the resolved URL is written down — the queue calling `fetchDocument` and passing `doc.url` on to
   `runExtract` is the obvious answer, and it touches two stages this one doesn't own
   ([ingest-queue.md](ingest-queue.md), [content-extraction.md](content-extraction.md)). Worth doing
   deliberately rather than quietly.
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
