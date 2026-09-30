# Citations: the row names the citing words, and a PDF's reference list gives authors and year

[SPIDERYARN-READING2-6J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6J) and
[SPIDERYARN-READING2-6K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6K), two
suggestions from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), both sent from
Citations mode on `dongetal25-spya-vfmvmm`. One batched note for both. The time in the file name is
when this session picked them up; it had no Sentry access and the report text came in the brief.
**No `reports:` header**, because the feedback row ids were not in the brief. The next sweep adds
them.

6J:

> In citations mode, there's a block link for each citation, which is fine, but actually it would be
> more helpful to highlight specifically within the block where the citation is, because sometimes
> there are multiple citations in a block, and somehow citations mode doesn't make it obvious which
> citation corresponds to, you know, which footnote.

6K:

> In citations mode, I wonder if there's a way to include the author names as well somehow, even if
> in somewhat truncated form, and also the date. And/or, you know, provide a tooltip with extra
> metadata like journal/conference/etc. It may be that we would need to make use of the references
> section or something like that in order to get this extra information as part of the citations
> mode generation.

**Ending: Shipped**, both. On `dev`, not deployed. Resolve 6J and 6K. The next feedback sweep does
the Sentry status write.

What we found: on that article, all 80 rows had no authors, no year and no reference. It is a PDF,
and a PDF's reference list is never shown in the reader, so the Citations step never saw it. The
model described each numbered cite instead of naming the work: *"Study on recall of TV episodes"*
for `[8]`, which is really *Chen et al. (2017), Nat. Neurosci.*

What we did:

- **6J.** A row's *first cited* is now the words the article cites the work with, e.g. *“TV episodes
  [8]”*, not a block id. Clicking it scrolls to that phrase and flashes it, not the whole paragraph.
- **6K.** For a PDF, the step now reads the reference list from the PDF's own text. Code splits it
  into its numbered entries, and the AI says which entry number each work is. Code keeps an entry
  only if two checks pass:
  - the text really cites that number (`[8]`, `[7,8]`, `[6–9]`);
  - the title is in the entry.

  Authors and year must also be found in the entry.
- **The row** shows *Chen et al. · 2017*. Hovering the by-line shows the whole entry, which is where
  the journal, volume and pages are. The hover card in the prose shows it too.
- **An HTML article** with a bibliography gets the same tooltip, from its reference block.

**To see it on that article**, re-run Citations from its Metadata page (*Re-run AI processing* →
Citations). That is one model call. Existing lists are not changed until they are re-run.

Not done, and named in the plan:

- An author–year PDF bibliography, like *Tulving, E. (1983) …*. There is no number to check a match
  against, so v1 skips it.
- Using a DOI in a PDF's entry as the row's link.
- A lookup service such as OpenAlex. That would be a new outside service, and it is your decision
  (already listed under 5P in [awaiting-approval.md](awaiting-approval.md)).
- Showing the entry to a visitor on a public article. That means changing `src/public/dto.ts`,
  which is a defence, so it is left for you.

Plan, with GPT Sol's two reviews:
[260930i](../plans/260930i-citations-mark-the-exact-citation-and-read-the-pdf-reference-list.md).
