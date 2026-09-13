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

- **`source.pdf` or `source.html`** — the original document, out of the `sources` bucket, through the
  same revision reference and re-hash `readPdf` uses. Capped at **10 MiB**; above that it is left
  off and the tag says so.
- **`article.json`** — `{ metadata, article }`: `articleMetadata(slug)` (source, steps and when each
  ran, visibility) and `loadArticle(slug)` (the payload the reading page loaded: blocks, tree,
  arc, labels, assets manifest). Capped at **5 MiB** of JSON; it gzips well in transit.

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
- **The envelope guard is unchanged.** It already writes attachments only from what
  `mirrorFeedback` registers (src/feedback-envelope.ts), so the new attachments ride through the
  same seam and nothing ambient can join them. It is not a defence in security-map.md's table, and
  no defence is edited.
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
> names of any errors, and facts about your browser and screen size. If you are reading one of your
> own articles, it also sends that article — the file it was made from and the page as we showed it
> to you — so we can reproduce the problem. *Never* your notes, comments or chats.

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

> If you tick “send extra diagnostics” while reading one of your own articles, the report also
> carries that article: the file it was made from, and the page as we showed it to you, including
> what we had made from it. That goes to Sentry with the rest of the report, so that we can
> reproduce what went wrong. Leave the box unticked, or send the report from any other page, and no
> article text goes with it. A bug report never carries your notes, comments, highlights or chats.

**3. The hover card on the Feedback button** — *"Extra diagnostics go only if you tick the box"* —
stays true and is unchanged.

**4. `docs/project/privacy.md` and `docs/project/feedback.md`** — not reader-facing. § The one rule
gains the fact that the consented, owner-only article is now a fourth thing a report may carry and
why it qualifies under the third clause (*a fact the reader is told, on the page, that we take*).

## Stages

1. **Server.** A `readDocument(slug)` on `SourceStore` (any kind, owner-filtered; `readPdf` becomes
   a narrowing of it, so there is one resolution path), a gatherer that returns attachments + the
   two tags and never throws, `mirrorFeedback` calling it only with a client and consent, the tag
   keys added to `FEEDBACK_TAG_KEYS`. Tests on the **final envelope** (tests/feedback-mirror.test.ts):
   attached when ticked and owned; nothing read when unticked; nothing for a stranger's slug;
   `too_large`; `failed`. Red first. GPT Sol review.
2. **Words.** The dialog and `/privacy` sentences above, their tests, and the two docs. GPT Sol
   review.

## What happened

*(Filled in at the end of each stage.)*
