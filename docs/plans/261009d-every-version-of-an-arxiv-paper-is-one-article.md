# Every version of an arXiv paper is one article

Report `spya-n50aft` (Greg, an admin, 2026-10-09 02:03 UTC). Note:
[docs/user-feedback/](../user-feedback/) (written at the end).

> I added: https://www.spideryarn.com/add/https%3A%2F%2Farxiv.org%2Fabs%2F2609.01481 which created
> `arxiv-2609-01481-spya-jytq2h` … But we already had `arxiv-2609-01481v1-spya-sjatfv`. Why didn't
> the add/import process notice that we already had the article? If it won't introduce tooooo much
> complexity, let's try and make our deduplication more robust and notice this kind of thing in
> future.
>
> — Greg, 2026-10-09

## Why it happened

It was a decision, not an accident. Plan
[261005l](261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md)
made every *shape* of an arXiv link one article (`abs/`, `pdf/`, `html/`, `export.arxiv.org`,
arXiv's DOI, Hugging Face, alphaXiv, http/https, `www.`, tracking parameters, trailing slash, a
fragment) — but kept the **version** in the key, so `2608.13566`, `2608.13566v1` and `2608.13566v2`
were three articles. Its reasoning: merging two different texts is the expensive mistake `urlKey`'s
header rules out. The article we already had was imported from a `…v1` link; Greg pasted the
unversioned one.

Everything Greg listed other than the version (abs/pdf/html, http/https, `export.arxiv.org`) already
matched, and `tests/ingest.test.ts` pins it.

## The change

`arxivPaper` in [`src/paper-sources.ts`](../../src/paper-sources.ts) builds `key` from `workId`
(never a version) instead of `versionedId`. That is the whole fix. Every dedupe path asks `urlKey`,
and `urlKey` answers `paper.key` for a recognised paper, so it reaches all of them:

- `POST /api/jobs`'s "already on your shelf" (`slugForUrlKey`, src/store/find-article.ts), which
  recomputes `urlKey` over stored `final_url`/`asked_url` on every call — so **articles already in
  the database match too**, with no migration. An article fetched from `arxiv.org/html/2609.01481v1`
  now keys as `arxiv.org/abs/2609.01481`.
- The active-job dedupe (`jobs.source`, src/jobs.ts) — transient, nothing to backfill.
- The link hover cards' "on your shelf" (src/web/link-facts.ts).

What does **not** change: the version still decides what is *fetched* (`candidates`,
`canonicalUrl`, `versionedId`) and the slug (`arxiv-2609-01481v1`). Only "do we already have this?"
forgets it. Slugs carry a random id, so two articles never need different base slugs.

**Cheap extras.** A handful of tracking parameters that are never real parameters join the list
`urlKey` drops: Google Analytics' cross-domain `_gl` and `_ga`, Google Ads' `gclsrc`, `gbraid`,
`wbraid`, `gad_source` and `gad_campaignid`, Merchant Center's `srsltid`, Marketo's `mkt_tok`, and Omeda's `oly_anon_id`/`oly_enc_id`. The generic names the list
deliberately leaves out (`ref`, `s`, `source`, `id`) stay out, for the reason written above the list.
Nothing else looked both missing and safe: `m.`/mobile hosts are a different host by the rule that
`www.` is the only decoration, and path case, query order and decoding were each ruled out on
2026-08-26 for merging pages that differ.

## The trade-off, for Greg

```
   shelf holds        reader pastes        before          after
   2609.01481v1       2609.01481           new article     the v1 article   ← this report
   2609.01481         2609.01481v1         new article     the existing one
   2609.01481v1       2609.01481v2         new article     the v1 article   ← the cost
```

**What it gives up:** a reader who deliberately pastes `v2` while holding `v1` gets their `v1`
article back ("already on your shelf, cost nothing") rather than the revised paper. Refresh does
not help either, because it re-fetches the stored address, which is `…v1`. To read v2 they would
have to delete the v1 article first. An article imported from a link with *no* version is
better off: its stored address is unversioned too, so Refresh fetches the latest (GPT Sol's
review).

**The simpler option passed over** was nothing simpler — this is one line. **The more complex one
not built:** telling versions apart — e.g. an unversioned link matches any version, but `v1` and
`v2` stay distinct; or a v2 paste on a v1 article offers "a newer version exists — import it?".
Both need either asymmetric matching (a key is no longer one string, so `slugForUrlKey`, the
active-job index and the hover cards each need a second rule) or a fetch to learn the latest
version. Not worth it until someone actually hits the v2 case; revisions of a paper are usually
small, and a duplicate the reader did not want was the commoner failure.

**Accepted: one deploy's worth of overlap** (GPT Sol's finding 1, P2). An active job persists a hash of
`urlKey` (`jobs.work_key`, src/store/jobs.ts), so a job enqueued from a `…v1` link before the
deploy and a `{ url, steps }` request for the plain link after it carry different hashes and can
both run. Jobs live for minutes, the case needs two pastes of one paper across a deploy, and the
cost is one duplicate, which is what we had before. No migration or test for it.

## Review

GPT Sol on the plan:
[261009d-…-plan-review-sol.md](261009d-every-version-of-an-arxiv-paper-is-one-article-plan-review-sol.md).
All three findings taken: the deploy overlap accepted above, the refresh sentence corrected, and
`gad_source`, `gad_campaignid` and `srsltid` added.

GPT Sol on the code:
[261009d-…-code-review-sol.md](261009d-every-version-of-an-arxiv-paper-is-one-article-code-review-sol.md).
No P1 or P2. It fixed two comments that overstated themselves (the `ResolvedPaper.key` rule is
arXiv's, not every source's; Marketo's and Omeda's ids are audience ids, not merely email ones).

## Not touched

- The two existing duplicate rows in production (`arxiv-2609-01481v1-spya-sjatfv` and
  `arxiv-2609-01481-spya-jytq2h`) stay as they are; Greg can delete one. After this lands, a third
  paste finds whichever `slugForUrlKey` meets first.
- Cited-work matching already ignored versions (`workId`, `identityOf`).

## Stages

1. Failing tests first: `tests/ingest.test.ts` and `tests/paper-sources.test.ts` assert the version
   *separates* articles; flip them to assert it does not, plus Greg's exact pair, plus the new
   tracking parameters. Watch them go red.
2. The change in `paper-sources.ts` and `ingest.ts`; comments and docs that say "a version is part
   of the key" (`urlKey`'s header, ingest-queue.md § Two URLs, one article, fetching.md if it says
   so).
3. GPT Sol plan review (read-only) before 2; code review (workspace-write) before push.
