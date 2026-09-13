# Send the source file, and the article, with extra diagnostics

Greg's report, SPIDERYARN-READING2-32, 2026-09-12 08:06Z, filed from an iPad in production on
`entropy-24-00930-spya-bmvfyb`:

> Send up more diagnostic information including attaching source file when the user chooses Send
> extra diagnostics to help with debugging. Change the Feedback dialog message re extra diagnostics
> accordingly.
>
> — Greg, 2026-09-12

From an admin, so trusted and built (docs/project/feedback-reports.md § Who sent it). The machinery
is [feedback.md](../project/feedback.md); the rule this changes is its § The one rule.

## Why this matters, in one paragraph

Reports are worked by agents that read Sentry and **have no production database or bucket access**.
Today a report says *which* article (a slug, block ids) and nothing about what is in it, so the
agent cannot see the document the reader was holding, cannot re-run the pipeline on it, and cannot
see what the page rendered. Every "this PDF extracted badly" report so far has ended at that wall.
With the original file and the page's own article payload in the report, an agent can reproduce
locally from Sentry alone.

## What ships (v1)

When — and only when — **all three** hold:

1. the reader ticked **Send extra diagnostics** (`report.consented`, the same consent the
   diagnostics blob already needs and the `feedback_diagnostics_consented` CHECK enforces);
2. the report names an article (`report.slug`);
3. **the reporter owns that article** — resolved through the owner-filtered reads (`ownedSlug`), so
   a visitor, an admin on somebody else's article, or a forged slug gets nothing;

the Sentry mirror adds two attachments:

- **`source.pdf` or `source.html`** — the original document, through the **existing**
  `loadSource(slug)` (src/store/contracts.ts `ArticleReader`), which already returns either kind,
  owner-filters through `currentRevision`, and re-hashes through the shared raw-document resolver.
  No new store method; `SourceStore.readPdf` stays narrow, because serving HTML inline from our
  origin is stored XSS and that is its whole reason to exist. Capped at **10 MiB**, checked before
  the bytes are read where the existing path allows it; above that it is left off and the tag says
  so.
- **`article.json`** — `loadArticle(slug)` (the payload the reading page loaded: blocks, tree,
  arc, labels, assets manifest) plus a **field-by-field pick** from `articleMetadata(slug)` — the
  steps and when each ran, the source's kind and size. **Built, not copied**: `ArticleMetadata`
  carries `profile` and `purpose`, the reader's own "about you" and "why this one" text, and a
  whole-object copy would send both. A test pins their absence. Capped at **5 MiB measured as UTF-8
  bytes** — encoded once, the cap checked on `byteLength`, and those exact bytes attached, because
  `json.length` counts UTF-16 units and undercounts non-Latin text by up to 3×. It gzips well in
  transit.

  The one reader-authored string that does ride along is `meta.title` when the reader has renamed
  the article on their shelf (`titleFor` in src/store/pg.ts). That is the title the page showed
  them, which is what the copy promises, and it is kept.

Two new tags, each a **closed vocabulary**, so Sentry can be filtered on them and a missing file is
visible rather than silent:

| tag | values |
|---|---|
| `source_file` | `attached`, `too_large`, `none`, `failed` |
| `article_json` | `attached`, `too_large`, `none`, `failed` |

`none` covers "no box ticked", "no slug", "not yours" and "no source document held" — the
owner-filtered read deliberately cannot tell the last three apart, and a tag that distinguished them
would be a way to learn whether somebody else's slug exists. `failed` is a read that threw (a
dangling bucket reference or a bad hash) — itself worth knowing.

### What does **not** change

- **Nothing new leaves the reader's browser.** The client, its blob, the request body and its caps
  are untouched; everything added is read server-side from what we already hold.
- **Unticked, nothing is read at all** — not "read and dropped". The gatherer is not called.
- **The Postgres row is unchanged.** No migration; the source is already ours.
- **Logs carry lengths and tags, never bytes** — docs/project/logging.md.
- **The envelope guard's rule is unchanged, its key is not.** It already writes attachments only
  from what `mirrorFeedback` registers (src/feedback-envelope.ts), so the new attachments ride
  through the same seam and nothing ambient can join them. What changes is *what a registration is
  found by*: it was the report id, which the browser mints and which is unique only per owner
  (`(owner_id, id)` is the key, src/db/schema.ts). Two owners filing the same id at once could have
  each other's registration written into their envelope — message, user and now the article. So the
  registration is keyed on a **server-minted random nonce**, carried on the event as a tag the guard
  reads and never writes back. It is not a defence in security-map.md's table, and no defence is
  edited.
- **No Sentry client, no reads** — on a laptop and under `npm test` the gatherer is never reached,
  so nobody pays 10 MiB of bucket reads for a report going nowhere.

### Why 10 MiB

Sentry drops the **whole event** if the compressed envelope passes 20 MB
([Size Limits](https://docs.sentry.io/concepts/data-management/size-limits)). A PDF is already
compressed, so its bytes count nearly in full; the screenshot is at most 400 KB; `article.json` at
5 MiB gzips to well under 1 MiB. 10 MiB keeps a margin that a losing guess cannot cost the reader's
own words — the one failure mode that matters here, since a dropped event takes the message with it.

## The simpler options passed over

- **A pointer instead of the bytes** — send the slug, revision id and source sha256 and nothing
  else. Nothing leaves at all. Passed over because the people who act on reports cannot follow the
  pointer: agents have no production DB or bucket credentials, which is the whole of the problem.
- **The browser uploads the file.** It already holds a copy of the PDF only sometimes, never the
  HTML, and Vercel caps request bodies at 4.5 MB. It would also widen what leaves the browser, which
  the sweep note forbids. The server has every byte already.
- **Source only, no `article.json`.** Cheaper by one store read. Kept `article.json` because
  re-running the pipeline costs model calls and does not reproduce *this* run; the rendered payload
  is what the reader saw.

## Deferred, named

- **Visitors on public articles.** The owner never consented to their article going to a third party
  on somebody else's report; public articles are readable by anyone, so this is probably fine, but
  it is a product call. `none` until Greg says otherwise.
- **Files over 10 MiB.** Could be copied to a bucket of ours with a signed link in the report; not
  worth building until a report hits the cap. The tag will say when one does.
- **More client-side diagnostics** (the log buffer's contents, step errors in the browser). Not
  asked for specifically, and it is the half that changes what leaves the browser.

## The proposed reader-facing wording

Quoted here so it can be read on its own, without a diff. Greg asked for the dialog change; the
`/privacy` change follows because its current last sentence becomes false.

**1. The tick-box in the Feedback dialog** (`src/web/FeedbackDialog.tsx`). Today:

> **Send extra diagnostics.** The last few requests this page made to us and how they went, the
> names of any errors, which article and passages you were looking at, and facts about your browser
> and screen size. *Never* the article's text, your notes, or anything you have typed into a search
> box.

Proposed:

> **Send extra diagnostics.** The last few requests this page made to us and how they went, the
> names of any errors, and facts about your browser and screen size. On one of your own articles,
> it may also send the file the article was made from and our copy of its text, within a size
> limit, so we can reproduce the problem. *Never* your notes, comments or chats, or what you've
> told us about yourself.

Two things dropped on purpose: *"which article and passages you were looking at"* is subsumed by
the article itself; *"anything you have typed into a search box"* is removed because it was only
ever true of the blob — the page's whole address, `?q=` included, goes with every report whether
ticked or not, and `/privacy` already says so. Keeping it in the tick-box's sentence implied the
opposite.

**2. `/privacy`, § If you send us a bug report, last paragraph** (`src/web/PrivacyPage.tsx`).
Today:

> What a bug report never carries is the text of the article you were reading, or your notes on it.
> The diagnostics name paragraphs by their id, not by their words.

Proposed:

> If you tick “send extra diagnostics” on a page of one of your own articles, the report may also
> carry that article: the file it was made from and our copy of its text, with the headings and
> summaries we made for it, up to a size limit. That goes to Sentry with the rest of the report, so
> that we can reproduce what went wrong. Otherwise we don't attach the article's text — though a
> screenshot you add will show whatever was on your screen. A bug report never carries your notes,
> comments, highlights or chats, or what you've written about yourself and why you're reading.

**Why "may", "a page of", and the screenshot clause** — GPT Sol's plan review (R3): the slug rides
from the article's metadata and tweets pages as well as the reading page, so "send it from any other
page" was false; the caps and a missing source make "it also sends" false sometimes; `loadArticle`
is the text, tree, headings and summaries, not every mode's output, so "the page as we showed it"
promised more than it sends; and an absolute "no article text" was contradicted by a screenshot the
reader adds under its own consent. *"What you've told us about yourself"* is the profile and the
per-article purpose — named because `ArticleMetadata` carries both and the build deliberately
leaves them out.

**3. The hover card on the Feedback button** — *"Extra diagnostics go only if you tick the box"* —
stays true and is unchanged.

**4. `docs/project/privacy.md` and `docs/project/feedback.md`** — not reader-facing. § The one rule
gains the fact that the consented, owner-only article is now a fourth thing a report may carry and
why it qualifies under the third clause (*a fact the reader is told, on the page, that we take*).

## Stages

1. **Server.** A gatherer (its own module) that reads through the existing `loadSource`,
   `loadArticle` and `articleMetadata`, builds `article.json` field by field, applies both byte
   caps, returns attachments + the two tags, and never throws; `mirrorFeedback` calling it only with
   a client and consent; the tag keys added to `FEEDBACK_TAG_KEYS`; the guard's registrations keyed
   on a server nonce. Tests on the **final envelope** (tests/feedback-mirror.test.ts): attached when
   ticked and owned; nothing read when unticked; nothing for a stranger's slug (the reads' 404);
   `too_large` for each cap including non-ASCII JSON; `failed`; profile and purpose sentinels
   absent; two owners' concurrent same-id reports each getting only their own attachments. Red
   first. GPT Sol review.

## What the plan review changed

GPT Sol, 2026-09-13, on 9c79abc — *BUILD WITH CHANGES*, five findings, all taken:

- **R1 (P0)** — `ArticleMetadata` wholesale would have sent `profile` and `purpose`. Now a
  field-by-field pick, with a test. (Found independently the same hour by a fact-check subagent.)
- **R2 (P1)** — the envelope guard keys registrations on a client-minted, per-owner-unique report id,
  so two owners' concurrent same-id reports could swap payloads. Keyed on a server nonce now.
- **R3 (P1)** — the wording promised more than the build does. Rewritten; § The proposed
  reader-facing wording says clause by clause.
- **R4 (P2)** — cap the JSON on encoded bytes, not string length.
- **R5 (P2)** — `loadSource` already exists; the proposed `readDocument` would have been a second
  resolver.
2. **Words.** The dialog and `/privacy` sentences above, their tests, and the two docs. GPT Sol
   review.

## Facts checked before building (2026-09-13)

- **The owner box outlives `send`.** `handleApi` wraps all of `serveApi` in one
  `AsyncLocalStorage` run (src/routes.ts ~6370), and `fileFeedback` awaits the mirror inside it, so
  the gatherer's reads are filtered by the reporter's id. With a box and no owner,
  `currentOwnerId()` **throws** (src/owner.ts ~244) — it never reads unfiltered.
- **`loadArticle` and `articleMetadata` are owner-filtered on every path** — both go through
  `currentRevisionQuery`'s unconditional `ownedSlug` (src/store/pg.ts ~1214) and throw a 404 for a
  slug that is not the caller's. No public or admin bypass. The gatherer maps that 404 to `none`.
- **Size before bytes.** `get(key, { maxBytes })` *throws* on an oversized object rather than
  truncating (src/store/blobs.ts ~73), and `raw_sources.bytes` holds every object's length, keyed on
  the same `(sha256, kind)` the revision carries — so the cap is checked with a primary-key read and
  a 50 MiB PDF is never downloaded to be refused.
- **Nothing pins the two sentences being changed** — no test asserts either the tick-box text or
  the `/privacy` paragraph; stage 2 adds pins for the new ones.

## What happened

*(Filled in at the end of each stage.)*
