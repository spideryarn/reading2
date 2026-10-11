---
reports: spya-s5mzkd
ending: shipped
---
# Sources › Links: the article's own hyperlinks, as a fourth sub-mode

An admin suggestion from Greg (`feedback-reporter.ts` exit 0), report `spya-s5mzkd` (#546,
`SPIDERYARN-READING2-GV`), filed 2026-10-10 08:04 UTC from Sources on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz` (build `29220e7d`). Overseer queue item
`qi-85fzjzm8`.

> Maybe sources should have a submode for external links as well, or perhaps include those in the
> bibliography somehow.
>
> — Greg, 2026-10-10 (`spya-s5mzkd`)

**Ending: Shipped.** On `dev`, not deployed. Plan
[261011d](../plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md), with both GPT Sol
reviews beside it.

**What was built: both halves of the suggestion, as one sub-mode and a join.** Sources has a fourth
chip, **Links**, after Bibliography: one row per web address the article's prose links to, in
reading order, with the author's words for it, the host (and a DOI or arXiv id when the address
carries one), and jumps to the paragraphs that link it. A row whose address is a work in
Bibliography, or the same DOI or arXiv paper at another address, has an **In Bibliography** press
that opens that work's row. It is read off the article's markup in the browser: no model, no fetch,
nothing stored, so it costs nothing and is there the moment the article is.

**Why not fold the links into Bibliography.** Bibliography is a list of *works*, made by one model
call with a safety property on every address; most hyperlinks are not works (Wikipedia, a homepage,
a news story). A fold would either dress them as citations or make Bibliography two kinds of row,
and a derived section under it would vanish when no Bibliography exists. The join gives the
overlap without merging the lists. [sources.md § Links](../project/sources.md#links).

**Checked in the browser on local articles, not on Greg's**, which is in production: a web article
(`scaling-hypothesis`, 247 addresses, 58 works) and three PDF imports, whose list is empty and says
an article read from a PDF never has links of its own. If Greg's article was imported from a PDF,
its list will be that empty one, and its addresses stay Bibliography's.

**Left for later, each on the queue:** `qi-j9prkdfw`, letting a visitor open Sources when the
article's only Sources content is its links (it changes what every public article shows);
`qi-9pk7vqeg`, merging the new browser parse with chat's `articleLinks`, which is also the
link-preview's scope check, a defence this session did not edit (needs Greg).
