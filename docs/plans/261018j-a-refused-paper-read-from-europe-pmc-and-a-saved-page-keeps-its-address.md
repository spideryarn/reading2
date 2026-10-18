# A refused paper read from Europe PMC, and a saved page keeps its address

Up: [plans.md](../project/plans.md). Queue item `qi-pfnjyj6d`. Greg's reply `spya-qy8mgg`,
2026-10-18, to [q-emrf2p](../user-feedback/questions/q-emrf2p.md) (reports `spya-x5e966`,
`spya-tqsw3u`):

> maybe the best thing for the user would be to try Europe PMC first and then fall back to the
> bookmarklet. Let's do that if it's not too complex. Because I guess actually the XML format might
> be better than a PDF anyway. Run some spikes and if it's not too complex, let's try and do A and
> then B for number one. As for number two, Yes, keep the address. I assume that's better. I think we
> had a way with (eg) Arxiv to keep track both of the page they originally tried to download from
> *and* the page that we actually downloaded from. See if that makes sense in this context too.

Follows [261017b](261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md)
(the bookmarklet, the two new bot-check recognisers) and its measurement,
[investigations/261017a](../investigations/261017a-which-refused-paper-links-have-a-free-copy-the-server-can-read.md).
**This reply is Greg's permission for both defence edits**: a fixed Europe PMC door in
`src/fetch.ts`, and the upload path reading an address out of a saved page. Each lands with its
security-map row and a security-risks entry in the same commit.

## The spikes, 2026-10-18

From the box, plain `curl`, scratch files only.

- **Europe PMC's `fullTextXML` answered 200 `application/xml` for all six** recoverable papers of
  the 261017a sample, 130–480 KB each, all JATS with `<front>`, `<body>` and a reference list.
  Every one carries a CC licence in `<permissions>` (the open-access subset is what this endpoint
  serves; the Neuron paper, which has a PMCID but is not in it, answers 500).
- **The address alone identifies 20 of the 29 refused links**: 14 carry a DOI in their path
  (`/doi/10.…`, `/article/10.…`), 6 an Elsevier PII (`/pii/S…`, `/fulltext/S…(…)…`, and the
  Lancet's `PIIS…`). The other 9 (OUP, IEEE, JSTOR, JAMA, BMJ) do not. **Of the six with a free
  copy, four are found this way** (cell.com, SAGE, PNAS, ACS); OUP's and BMJ's are missed.
- **A PII becomes a DOI through Crossref**, which we already call:
  `api.crossref.org/works?filter=alternative-id:S1364661315001801` (the PII with its punctuation
  removed) gives exactly one work, `10.1016/j.tics.2015.08.003`. The punctuated form gives none.
- **DOI → PMCID** is Europe PMC's search, `…/rest/search?query=DOI:"…"&format=json&resultType=lite`:
  `pmcid`, `isOpenAccess`, `inEPMC`, and the `doi` back, which we compare.
- **The figures are on PMC's open-data bucket**, `pmc-oa-opendata.s3.amazonaws.com/<PMCID>.<v>/<file>`,
  200 for three papers tried (`binary/octet-stream`; stage 4.5 sniffs the bytes, so that is fine).
  `europepmc.org/articles/…/bin/…` answers 403 to us. The version is the XML's
  `article-id[pub-id-type=pmcid-ver]` where present, else `.1`.
- **Nothing in `src/` reads JATS** today, but [`src/upload-convert.ts`](../../src/upload-convert.ts)
  is exactly the precedent: a text, Markdown or Word upload is turned into an HTML document in
  stage 1, stored as `html`, and from then on is a web page for Readability and the sanitiser.

**Verdict: not too complex.** One fixed door, one converter of a well-specified format, and a
fallback in the fetch step. About a day, as estimated.

## The two addresses, and how arXiv already keeps them

What arXiv does ([`src/paper-sources.ts`](../../src/paper-sources.ts), `src/store/find-article.ts`):

```
 reader pastes            arxiv.org/abs/2401.01234      → articles.asked_url
 we fetch                 arxiv.org/html/2401.01234v2   → article_revisions.requested_url / final_url
 source link, Refresh     final_url (a paper source, so Refresh resolves it again)
 pasted again             matches asked_url, because final_url resolves as a paper source
```

**For Europe PMC it fits exactly**, once Europe PMC is a paper source like arXiv:

```
 reader pastes            cell.com/fulltext/S1364-6613(15)00180-1  → articles.asked_url (as today)
 cell.com refuses (403, or a recognised bot-check page)
 we fetch                 www.ebi.ac.uk/…/rest/PMC4595480/fullTextXML      → requested_url
 the article's address    europepmc.org/article/PMC/PMC4595480             → final_url
 source link              "View the original at europepmc.org" — the copy we actually read
 Refresh                  final_url resolves as a Europe PMC paper source → the XML again
 pasted again             asked_url matches, because final_url resolves (no code change there)
```

And a reader who pastes a `europepmc.org/article/PMC/PMC…` link gets the same import directly.

**For a saved page it fits half-way, and the other half on purpose.** We fetched nothing, so there
is no `final_url`, and there must not be one: `final_url` is the base stage 2 resolves against, what
Refresh *fetches*, and what stage 4.5's images and link previews are scoped by. The page's address
came out of a file, so it is a claim, and Greg's yes was to an address "shown as a link and never
fetched". So it gets **a column of its own beside the fetched pair**, on the revision:

```
 reader on cell.com clicks the bookmarklet → file carries <meta name="spideryarn-saved-from" content="https://www.cell.com/…">
 reader uploads it                          → article_revisions.saved_from_url (new), final_url stays null
 source link                                "Saved from www.cell.com" — worded as what it is
 Refresh                                    re-reads the stored file (as for every upload); never fetches it
 pasted again                               matches saved_from_url, this reader's own shelf only
```

**Why not `articles.asked_url`?** It is "the address the reader pasted", written once when the
article row is made, which for an upload is before the file has been read; and it is per article,
where a re-upload of a different file should replace the claim. The claim belongs to the bytes, so
it lives with the bytes' revision. (Simpler-looking, and the plan review is asked to check it.)

## Stages

### Stage 1: the Europe PMC door and the converter

- **`src/fetch.ts`: `fetchEuropePmc(input, as: "json" | "xml")`**, beside `fetchBibliographicJson`
  and built the same way: `https:`, no port, no credentials, host exactly `www.ebi.ac.uk`, **path
  starting `/europepmc/webservices/rest/`**, all checked before DNS; the same guarded `fetchBytes`
  (address guard and pin); no redirects; one attempt; the honest `BIBLIOGRAPHIC_USER_AGENT`.
  JSON: 1 MiB, 8 s, `application/json`. XML: 20 MiB, 30 s, `application/xml` or `text/xml`,
  returned as bytes decoded strictly as UTF-8. Tests: every refused shape (other host, `ebi.ac.uk`
  without `www`, a path outside the prefix, `http:`, a port, a redirect) refused before a socket.
- **`src/europe-pmc.ts`**: the lookups, all through the fixed doors.
  - `paperIdsInUrl(url)`: a DOI in the path (`10.\d{4,9}/…`, decoded, with a trailing `/full`,
    `/abstract`, `/pdf`, `/epdf`, `.pdf` removed), or an Elsevier PII (`/pii/S…`, `/fulltext/S…`,
    `/PIIS…`), plus whatever `identityOf` already gives (a `doi.org` link). Pure; tested on the 29.
  - `doiForPii(pii)`: Crossref `alternative-id`, the PII with its punctuation removed, through
    `fetchBibliographicJson`; exactly one item, or nothing.
  - `openPmcidForDoi(doi)`: the search; the first result whose `doi` equals ours
    (case-insensitive), with `isOpenAccess === "Y"`, `inEPMC === "Y"` and a `pmcid`; or nothing.
  - `europePmcFullText(pmcid)`: the XML, refused unless it parses and has an `article` root with a
    `body` that has text.
- **`src/jats.ts`: `jatsToHtml(xml, pmcid)`**, pure. Parsed with jsdom as XML (no external entities,
  no DTD fetch; jsdom's parser loads neither, and a test proves an external entity stays unexpanded).
  It **builds** an HTML document element by element, never copying markup across: text escaped,
  attributes only ours. `<head>`: `<title>`, and the `citation_*` metas the metadata reader already
  reads (title, each author, date, journal, DOI). `<body><article>`: the title as `h1`, the authors,
  the abstract as a section, the body's `sec`s as sections with `h2`/`h3`/… by depth, `p`,
  `italic`/`bold`/`sup`/`sub`/`sc`/`monospace`, `ext-link` as a link (http(s) only), `xref` to a
  reference as an in-page `#` link, `list`, `def-list`, `disp-quote`, `boxed-text`, `fig` as
  `figure` + `img` on the open-data bucket + `figcaption`, `table-wrap` with its `table` rebuilt cell
  by cell (`colspan`/`rowspan` kept), maths as `<math>` carrying its TeX where the XML has
  `tex-math`, else the MathML elements rebuilt by name; `ack`, `fn-group` and the `ref-list` as
  back-matter sections, each reference as a list item with its id. An unknown element contributes
  its children; `supplementary-material`, `journal-meta` and `processing-meta` contribute nothing.
  Tested on all six captured XMLs (kept as fixtures, trimmed where large): the text of the body
  comes through (every `p`'s text present), headings nest, figures and tables are there, references
  link, and the whole thing read by `readArticle` gives the right title, authors, date and
  sections.
- **Europe PMC as a paper source** in `src/paper-sources.ts`: `europepmc.org/article/PMC/PMC<n>`
  (and `europepmc.org/abstract/PMC/PMC<n>`, and the `fullTextXML` address itself) resolve to
  canonical `https://europepmc.org/article/PMC/PMC<n>`, key `europepmc.org/article/pmc/pmc<n>`,
  one candidate with a new `expect: "jats"`. The candidate fetch in `src/pipeline.ts` branches on
  `"jats"`: `fetchEuropePmc(…, "xml")`, `jatsToHtml`, and a `FetchedHtml` whose `requestedUrl` is
  the XML address and `url` the canonical article address. `fetchDetail` says *"Europe PMC's free
  full text"*.

### Stage 2: the fallback when a site refuses

- In the fetch step's `fetchByAddress`, when the address is not already a paper source and the
  fetch **fails as `forbidden` or `unauthorized`**, or **succeeds with an HTML page `challengeIn`
  recognises** (the four bot checks, so cell.com's 403 and Springer's "Client Challenge" page both
  qualify): try `paperIdsInUrl` → (`doiForPii`) → `openPmcidForDoi` → the Europe PMC paper source's
  candidate. On any miss or failure along the way, **the original outcome stands**, unchanged: the
  same failure (and so the same sentence, the Upload button and the bookmarklet), or the same
  challenge page for stage 2 to refuse. A redirect chain is tried against both the pasted and the
  final address (a `doi.org` link that ends at a refusing publisher has its DOI in the first).
- Log, without prose: the host, which identifier kind was found, and which step ended it.
- **Nothing else changes for an address that is not refused.** A page that imports today never
  reaches this code.
- Tests (red first): a refused cell.com address with stubbed Crossref and Europe PMC answers
  imports the converted article with `final_url` the Europe PMC address and `asked_url` the
  cell.com one; pasting the cell.com address again finds it; a closed paper (search says
  `isOpenAccess: "N"`), a DOI mismatch, a Europe PMC 500 and a refused non-paper page each end with
  today's failure, byte for byte; a 404 never tries the fallback.

### Stage 3: a saved page keeps its address

- **The bookmarklet** writes `<meta name="spideryarn-saved-from" content="…">` into the clone's
  `<head>`: `location.href` without its fragment, only if `http:`/`https:` with no credentials, and
  after removing any such meta the page itself carried. Tests in the existing bookmarklet suite.
- **The upload path** (`acquireUpload`, for an HTML upload only, not a converted one): read that
  one meta out of the file's `<head>`; accept it only if it parses as `http:`/`https:`, has no
  credentials, and is at most 2,048 characters; else ignore it. Recorded in the manifest as
  `savedFrom` and in **`article_revisions.saved_from_url`** (an additive migration, nullable, no
  default). **Never** written to `requested_url`/`final_url`, never a base for stage 2, never
  fetched: the comment on the column says so and a test proves the extract step still gets
  `url: null` for such an upload.
- **Shown**: `Meta.savedFrom`; the masthead's origin line, when there is no web source, says
  *"Saved from &lt;host&gt;"* as a link (`rel="noopener noreferrer nofollow"`), on the reader's view
  and the public page alike. The "guess the web address" lookup for an upload
  (`useSourceGuess`) does not run when the address is known.
- **Found again**: `slugForUrlKey` also matches this reader's upload whose published revision's
  `saved_from_url` has the same `urlKey`, after the `final_url` pass and the `asked_url` pass, so a
  fetched copy still wins. Owner-scoped like every other pass, so a claim in one reader's file can
  never decide what another reader's paste opens.
- **Export** carries the column (`docs/project/export.md`).

### Stage 4: docs, security, bookkeeping

- `security-map.md`: a row for the Europe PMC door (fixed host and path prefix, no redirects, caps)
  and one for the saved-from address (a claim from a file; shown, matched on the owner's own shelf,
  never fetched). `security-risks.md`: one entry, **Low**, for the saved-from address: a file can
  say it came from any address, and on a published article "Saved from nytimes.com" is then a claim
  a stranger reads; bounded by the wording, by the uploader being able to write anything in the
  article itself, and by never being fetched. Decision: accepted by Greg's yes (quoted).
- `fetching.md`, `content-extraction.md` § the document with no address, `article-images.md` (the
  bucket), Help's *Adding articles* (a refused paper may come in from Europe PMC; the bookmarklet's
  file now remembers where it came from).
- q-emrf2p: the reply quoted, `acted: spya-qy8mgg`, `status: answered`; the note for
  `spya-x5e966`/`spya-tqsw3u` updated; `npx tsx scripts/feedback-endings.ts`.

## GPT Sol's plan review, 2026-10-18

[261018j-plan-review-sol.md](261018j-plan-review-sol.md), verdict *BUILD AFTER FIXES*, nine
findings, all taken. **They override the stage text above where they differ**:

- **S1** A converted document is not a `FetchedHtml` (whose `text` is the decoding of its `bytes`).
  The Europe PMC acquisition gets its own seam, like `acquireUpload`: the manifest records the
  XML's byte count, hash and content type, the stored raw is the generated UTF-8 HTML, kind
  `"html"`. `"jats"` on a candidate names an acquisition method, not a `DocumentKind`.
- **S2** `fetchFirstCandidate` turns every `FetchFailure` into a stage failure before
  `fetchByAddress` sees it, so the one-address fetch gets a raw-outcome seam: keep the original
  `FetchFailure`, try Europe PMC, and on a miss map that exact failure as today. A challenge page
  that misses returns the same document object. Every successful HTML page is now parsed once in
  stage 1 to ask `challengeIn`, with the silent `VirtualConsole` parser of `src/extract.ts`; stage 2
  stays the authoritative refusal.
- **S3** The saved address on a public page goes only through `publicSourceUrl`
  (`src/urls.ts`: no query, public host), into `PublicMeta.savedFrom`; owner-side through a
  validated `savedSource` helper, checked again on read, not trusted from upload time. Canaries for
  a signed query, credentials, localhost, a private IP. **Low** for the register entry holds only
  with this.
- **S4** `saved_from_url` through its whole lifecycle: migration, schema, `RawManifest`, raw
  write/read adapters (`src/store/artifacts-pg.ts`), revision selects, **the carry policy
  (`savedFromUrl: "carry"` in `src/store/pg-revisions.ts`)**, owner `Meta`, duplicate query,
  export, public DTO. Tested: upload → publish → force extract → publish keeps it; a new saved file
  replaces or clears it.
- **S5** jsdom's XML parser **does** expand internal `<!ENTITY>` declarations. Before parsing,
  refuse any internal subset or entity declaration, while allowing the PUBLIC JATS doctype two
  fixtures carry; an external entity is a parse refusal; a test proves no request is made. Bounds on
  element count and output size. JATS parsing joins **R19** (server-side parsing of third-party
  files, Medium) rather than a new Low entry.
- **S6** No generic DOI-suffix stripping: narrow, host-and-route extractors for the shapes in the
  sample (`/doi/<doi>`, `/doi/full/<doi>`, `/article/<doi>`), each result through `parseWorkId`;
  adversarial DOIs that really end in `.pdf` or `/full`. A PII lookup also requires the one
  Crossref item's `alternative-id` to equal the PII.
- **S7** Readability reads the date from `article:published_time` and the site from
  `og:site_name`, not `citation_*`; emit those, plus `citation_author` and `citation_doi`. Tested
  through `runExtract` with the registry stubbed out.
- **S8** The fixtures need: author `contrib-group`s whose `contrib`s carry no type; a `ref-list`
  inside a body `sec` (four files have no `<back>`) rendered once, in place; bare namespaced MathML
  (PMC7357184, 17 formulas, no TeX) rebuilt with `createElementNS` and an attribute allowlist; a
  `table-wrap` holding only a graphic, drawn as a figure; epub/ppub dates before a collection year;
  the `content-type="image"` graphic, never the thumbnail; filenames as encoded opaque path
  segments. The "every `p` survives" test is scoped to what is kept.
- **S9** One integration matrix for both routes: requested, final and saved addresses, base,
  source link, Refresh and duplicate, with a second owner and a force-extract successor revision.

## Built, 2026-10-18

Two Opus subagents in parallel, one per half, in `d5aafcd19`.

- **Europe PMC** (`src/europe-pmc.ts`, `src/jats.ts`, `fetchEuropePmc` in `src/fetch.ts`, the
  paper source, the fallback in `fetchByAddress`). The challenge check runs only on an address that
  already names a paper, so an ordinary page is not parsed twice. Identifier routes: `/doi/…` on the
  sample's Atypon hosts, `/article/<doi>` on Springer, PIIs on ScienceDirect, cell.com and the
  Lancet: 21 of the 29 refused links (the plan said 20; the Lancet's makes 7 PIIs). The XML itself
  is not kept; the manifest's `bytes`/`sha256`/`contentType` describe it, `storedBytes`/
  `storedSha256` the page. The key keeps Europe PMC's upper-case `PMC`, because a key must match
  what `urlKey` gave the address before the source existed. **Live from the box**: cell.com (by
  PII), PNAS and SAGE (by DOI) each come in with title, authors, date, journal, figures (3, 5, 8)
  and the source link `europepmc.org/article/PMC/…`; the closed Cell paper and the Neuron paper end
  `no-open-copy`, i.e. today's failure. Red first: the fallback stubbed to `null` turned 10 of 16
  fallback tests red.
- **Saved page** (`src/saved-from.ts`, `savedSource` in `src/urls.ts`, migration
  `20261018120458_revision_saved_from_url`, applied locally only, `Target: 127.0.0.1:54362`). One
  meta exactly, or none believed. The masthead says *Saved from &lt;host&gt;* in place of *Uploaded
  from a file*. **A saved address with a query (PLOS's `?id=…`) gets no public line**, because
  `publicSourceUrl` refuses any query; the owner still sees it; Help says so. The private-copy offer
  on a public page still uses only a fetched address. Article transfer runs the claim through
  `publicSourceUrl`. **Seen in a browser** (Sonnet, Playwright, own dev server): a PLOS article
  saved with the bookmarklet's function and uploaded shows *Saved from journals.plos.org*, and
  pasting the PLOS address then finds it on the shelf instead of importing again.
- **Sol's code review** ([261018j-code-review-sol.md](261018j-code-review-sol.md), *SHIP AFTER
  FIXES (MADE)*): C1 the path checked whole, not by prefix (encoded separators); C2 an explicit
  `:443` refused; C3 XML declared as another charset refused; C4 a nesting-depth bound before the
  recursive converter. Each red first. Nothing found in the fallback, the manifest, the saved-address
  lifecycle or the public boundary. It could not reach the database or bind sockets in its sandbox;
  those suites were re-run here, green.

## The simpler options passed over

- **For (1), the bookmarklet alone** (q-emrf2p's recommended answer). Greg chose otherwise: no step
  for the reader where a free copy exists, and the JATS is better than any PDF.
- **Fetch the Europe PMC PDF and send it through the PDF path.** It does not exist for most of these
  (`hasPDF: "N"` for Greg's paper), costs a model call, and loses the structure the XML has.
- **Store the XML as the raw and convert in stage 2** (a third document kind). Truer to "the raw is
  what arrived", but every reader of `kind` would need a third case; the upload converters already
  set the precedent of storing the converted HTML.
- **For (2), put the address in `final_url`** so every existing source-link and Refresh path just
  works. Rejected: Refresh, stage 2's base and the image fetch would then fetch an address a file
  chose.

## Done means

A refused cell.com link imports Europe PMC's copy on the dev server, end to end, seen in a browser;
the other refusals end exactly as today; a bookmarklet-saved file uploaded shows "Saved from" and is
found again by its address; `npm test` and `npm run typecheck` green; GPT Sol has reviewed the plan
and the code; the question answered and the notes updated.
