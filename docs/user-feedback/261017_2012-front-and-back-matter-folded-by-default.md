---
reports: spya-ftsqsn
addenda: spya-k7gm2b, spya-k0w2q7, spya-vskdap
ending: shipped
comment: Shipped: title, authors, abstract, contents, thanks and references found at import and folded to a faint stub with an (i), faint in Structure, for visitors too; the paper shows its authors and year. Older articles stay as they are.
---

# Front and back matter, found at import and folded to a stub

Report `spya-ftsqsn` (#592, `SPIDERYARN-READING2-JE`), from Greg (an admin), filed 2026-10-17,
build `614e42c5`, on `arxiv-2308-08708-spya-xax6v4`. A suggestion, with three addenda.

> In this article, there's a whole bunch of stuff at the top that's not very
> interesting/substantive (e.g a table about the authors & affiliations, acknowledgements,
> abstract, etc etc).
>
> Probably we do still want to include it, but somehow we want to:
> - Mark it up as being less interesting
> - And default-collapse it
> - Perhaps ignore/de-emphasise these sections (e.g. in Structure, Summary, etc)
>
> Perhaps the same applies to stuff at the end of the article (e.g. acknowledgements,
> bibliography).
>
> Or *perhaps* we just skip them altogether, and have a note to say they've been excluded, and
> click to see them in the original? That seems a bit toooo extreme, since sometimes there's
> useful stuff in there, and it's making things too annoying for the user to double-check.
>
> Ideally we do this in a clean, general, robust, reusable way. Ask me questions if there are
> alternatives/tradeoffs to consider.
>
> (I think I've suggested/asked about this before)

`spya-k7gm2b`:

> I'm not so worried about fixing old articles, more about improving this going forwards. But I'm
> happy for you to reset/reimport this article, and then ask me (in the Feedback / Needs Input) to
> look at it […] it may be worth trying to create a little eval […] Make sure to take screenshots
> […] This requires delicate UI (including an information-button/tooltip) […] And to document this
> accordingly […] with minimal signposting from relevant important docs like AGENTS.md

`spya-k0w2q7`:

> Also, I thought we had created first-class metadata for authors? If so, then ideally we'd be
> displaying that nicely in the UI (e.g. along with the publication year, perhaps
> default-collapsed).

`spya-vskdap`:

> I'm leaning towards default-collapsed for the Abstract too, but visible in Structure so that the
> reader can see that there is an Abstract and easily get to it if they want to.

**Ending: Shipped**, on `dev`. Plan
[261018a](../plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md), eval
[261018b](../investigations/261018b-front-and-back-matter-eval.md), area doc
[front-and-back-matter.md](../project/front-and-back-matter.md).

- **Found at import, kept in the article.** A new step, `matter`, runs after the blocks are cut as
  a free follow-on job, so the article opens no later than before. It unites a free rule over exact
  labels with one Haiku 5.5 call (about $0.0013) and holds every stretch to code checks on the
  stored text. Nothing is removed: search, chat, exports and every mode still read every block.
- **Folded to a stub.** Each stretch (*Title and authors*, *Abstract*, *Authors and affiliations*,
  *Acknowledgements, funding and declarations*, *Contents*, *References*) is one faint line with a
  chevron, a count and an (i). It is folded on every arrival, and any jump into it opens it.
  Structure keeps the rows, faint; pressing one opens the stretch. The masthead's old "Show
  authors and details" control is gone.
- **The eval:** 52 articles in three sets, two held out: no prose folded, 67–96% of the matter
  found. Screenshots: `docs/plans/261018a-shot-*.png`.
- **The authors (`spya-k0w2q7`):** the masthead already shows three names, *+ N more* and the
  year. This paper declares no authors on its page, so none reached it. A page that declares none
  now takes them, and the year, from its own arXiv or DOI record, when the titles match exactly.
- **The abstract** is folded, per `spya-vskdap`, and has its own row in Structure.
- **Summary and the other modes:** what they *say* already leaves the paperwork out (the prompts'
  rule, 261003d). Keeping it out of what they *read* is queue `qi-2byhh6nc`, now a filter over the
  stored stretches.
- **The reported article** was re-imported on the local database, not in production: six stubs,
  19 authors, 2023. A production re-import is Greg's to press after the deploy.
- **Answered:** question [q-f7zp3t](questions/q-f7zp3t.md), reply `spya-r8arjm` (2026-10-18):
  *"1A / 2B"*. Existing articles are left alone (no backfill; `qi-erfq52cg` dropped). Visitors get
  the same folds, plan
  [261018l](../plans/261018l-visitors-on-a-shared-link-get-the-front-and-back-matter-folds.md)
  (`qi-8y3tx5tp`, superseding `qi-exhw79tc`). His two principles went into architecture.md
  § Conventions and security-map.md § The allowlist. The misses the eval left, and a split of the
  evidence check the code review asked for, are `qi-nj2cdq8d`.
- **Folded in:** queue items `qi-fddb7wb8` and `qi-ad4wgkaq` asked for this, and are done.
  `qi-2byhh6nc` now says the stretches exist.
- **Code review:** GPT Sol found three P1s, all fixed. One of its fixes was reverted because it
  folded prose on a held-out article (plan § The code review).
