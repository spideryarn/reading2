---
reports: spya-um8d9f
ending: shipped
comment: Already fixed: it is Box 3 of the paper (words and its self-attention diagram), the same fault as your report of 24 Oct. The import ran on 17 Oct, before the fix; a re-import brings all four boxes back.
---
# The empty "diagram" is Box 3, already fixed

Report spya-um8d9f (#729), 2026-10-28 23:46 UTC, kind problem, from an admin (Greg;
`feedback-reporter.ts` exit 0), on Butlin, Long et al., *Consciousness in Artificial Intelligence*
(`arxiv-2308-08708-spya-xax6v4`), at `spya-m5keyt`. No addenda (re-read 2026-10-29, before acting
and before writing this).

> We might have fixed this already, I'm not sure, but the diagram here is not importing correctly.

**Ending: shipped**, as the same bug as `spya-weuekx`
([261024_1655](261024_1655-figures-and-tables-open-in-the-original-and-arxiv-boxes-keep-their-words.md)),
fixed in `aff7a7ba1` and deployed. Not the PDF bug of `spya-m40r6t`: this article is HTML.

Read from production, read-only: three blocks below `spya-m5keyt` is `spya-ymqz9n`, an empty
650 × 1164 SVG frame. On arXiv it is *Box 3: Attention in neuroscience and in AI*, about 450 words
and the self-attention diagram, drawn as an SVG with its contents in `<foreignObject>`s, which our
sanitiser deletes. Boxes 1, 2 and 4 (`spya-wejt97`, `spya-xgh7tw`, `spya-fsaefz`) are empty the
same way. The article was extracted on 2026-10-17, before the fix of 2026-10-24. Checked again on
2026-10-29: today's code lifts all four boxes from the live arXiv page, Box 3 with its image. Nothing
built; re-importing the article is Greg's call (principles.md § 1). Detail in plan
[261029b](../plans/261029b-citations-in-a-comma-separated-list-are-all-read.md) § The figure.
