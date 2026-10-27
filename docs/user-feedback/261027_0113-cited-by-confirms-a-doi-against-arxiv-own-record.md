---
reports: spya-ufn2xj
ending: shipped
comment: Fixed: Cited by now checks an arXiv paper against arXiv's own record when ours is stale. Production went from 21 to 28 of 28 DOIs confirmed; the one known wrong record (BERT) is still refused. No model call.
---
# Cited by confirms a DOI against arXiv's own record

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 20:24 UTC, a problem filed from Sources on
`arxiv-2308-08708-spya-xax6v4` (Butlin et al., *Consciousness in Artificial Intelligence*). Sentry
SPIDERYARN-READING2-PE (#715). Session `fbufn2xj-doi-confirm`. No addenda when re-read before
acting and before this note.

> "We could not confirm that the DOI on record is this piece's own, so we have not listed who cites it."
>
> Why is this so hard to do? It feels like we should be able to figure out if the DOI is correct, no?

**Ending: Shipped**, on `dev`. Plan
[261027c](../plans/261027c-cited-by-confirms-a-doi-against-arxiv-own-record.md), which has the
measurement and both GPT Sol reviews.

**Why it refused, for this paper.** The DOI was never in doubt: it is arXiv's own,
`10.48550/arxiv.2308.08708`, worked out from the article's arxiv.org address. What failed was the
check that OpenAlex's record of that DOI is this paper, and it failed because **our copy of the
paper's details is wrong**. Production's only version of this article was imported on 2026-10-17,
a day before the arXiv title fix (261017a). It is stored with the title `1Indicator Properties`,
no authors and no year. OpenAlex's record has the right 19 authors and 196 real citers but, oddly,
a merged Zenodo deposit's title. So there was no title and no author on our side to compare with.

**Why not just trust the arXiv address?** Because OpenAlex sometimes files an arXiv DOI under the
wrong paper. On `dev`, BERT's arXiv DOI resolves at OpenAlex to an unrelated 2025 paper about
health-supplement content. Trusting the address alone would have listed that paper's citers as
BERT's.

**What changed.** The fix is to the check's evidence; the bar itself does not move:

- **arXiv's own record stands in when ours is stale.** For an article read from arxiv.org, if our
  title and authors cannot confirm OpenAlex's record, the check now runs again against arXiv's own
  record of that paper (DataCite: free, cached, no model call). For this paper that record has
  Butlin, Long, Elmoznino, Bengio and the rest, which match OpenAlex's, so it confirms. For BERT,
  arXiv's record says Devlin et al. and OpenAlex's says Kefallinos et al., so it is still refused.
- **The record's last author is kept.** We keep 20 of a record's authors. Two Nature papers (Uri
  Hasson's) failed because Hasson was 25th and 32nd. Now the check keeps the first 19 and the last.
- **Footnote marks and arXiv's `--` are read as punctuation.** `Taylor Webb1,*` is now Taylor
  Webb, and `--` is now treated as the `—` it stands for.

**Measured, before and after** (every article with a DOI or an arXiv address, OpenAlex and
DataCite live):

```
production  28 articles   before: 21 confirm, 7 refuse   after: 28 confirm
local       33 articles   before and after: 30 confirm, 2 toy DOIs, 1 refused (BERT, correctly)
```

All 7 production refusals were the piece's own DOI. **No wrong one confirms.** I read every pair
whose titles differ. The only other one, *The Pain Axis*, already confirmed before this change
through the same three authors, and arXiv's own title matches ours. It looks like a paper retitled
between versions.

**Still refused, as it should be:** a cited work's DOI printed on the page, an arXiv DOI that the
address does not name, and a record with a different title whose authors are only some of the
paper's. That last one is a team's other paper; Sol's plan review caught it.

**Worth knowing, not done here.**

- This article still shows the title `1Indicator Properties` on the shelf. Re-extracting it would
  give it the right title, authors and year (note 261023_2327 checked that on `dev`), but that is a
  production write and I have not done it. Its Sources works without it once this is deployed.
- Not deployed: the Overseer deploys.

Reviews: GPT Sol on the plan (four P1s, all taken, each with a test that was red against the
first version) and on the code (see the plan).
