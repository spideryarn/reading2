---
reports: spya-hnw9xq
ending: shipped
comment: Summary's links now go to the passage that argues each point, not the abstract or executive summary. Still waiting on you: should an executive summary be folded like the abstract (q-r8kumx)?
---
# Summary links the passage that argues the point, not the abstract

Report `spya-hnw9xq` (#698), from Greg (`feedback-reporter.ts` exit 0, no addenda when re-read
before this note), on `arxiv-2308-08708-spya-xax6v4`, Summary › Fuller. Session
`fbhnw9xq-summary-links-body`.

> Make a minimal update to the way the summary that we generate links to the main text. In this
> example, which you can look at in the production database, the summary that we generated seems
> to mostly link to the executive summary in the main text. Now, firstly, actually, I think
> probably the executive summary in the abstract should be default folded, and I think we now have
> mechanisms, if we were to rerun this import, that would notice them and default fold them,
> because we have our own summary and structure modes that do a lot of this kind of work that we'd
> rather use. But the key point I'm trying to make is that the summary linking to the executive
> summary is less useful than linking to the main part of the text that really lays out the
> argument being linked to in detail. That's more useful.

**Shipped, on `dev`: the links.** One rule in Summary's prompt (`simple-prompt/13`): a link is
where the reader goes for more, so among the passages that support a paragraph it prefers the one
in the body that lays the point out, and uses the abstract or executive summary only where nothing
else says it. On four papers, paragraphs with a link into the front summary went from 13 of 16 to 1
of 16 on Brief and from 20 of 74 to 2 of 75 on Fuller, and a blind judge preferred the new links
14–4. Plan [261024x](../plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md),
measurement [261024f](../investigations/261024f-summary-links-to-the-body-or-the-abstract-measured.md).
His article's stored summary keeps its old links until Rerun on Summary in Metadata; nothing in
production was written.

**The fold: his claim checked, half right, and asked.** Today's `matter` step, run three times on
the local copy, folds the abstract every time and the executive summary never: plan 261018a
decided executive summaries are not folded, "for Greg to overturn". His article has no folds yet,
because it predates the step and he chose no backfill (q-f7zp3t, 1A), so only a re-import would
fold its abstract. Whether to fold executive summaries too is
[q-r8kumx](questions/q-r8kumx.md), recommending B (they and the other author summaries at the
front); queued as `qi-j5sapfw2`, waiting on that answer.
