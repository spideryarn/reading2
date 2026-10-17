---
reports: spya-zzvm6e, spya-s8pf4r
ending: shipped
comment: The marks were already on your paper's two parts but too faint to see; now darker and bigger. Tables were already in Skim's Figures; a table published as a picture now counts as a table too.
---
# Structure's figure marks you can see, and a table drawn as a picture is a table

Two admin suggestions from Greg (`feedback-reporter.ts` exit 0 on both, no addenda), filed
2026-10-15 20:40 UTC from Structure on his
`mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb` (build `f84dc434`). Overseer queue
item `qi-647czja2`. Follow-ups to
[261010_0803](261010_0803-jump-to-figures-tables-and-media-in-skim-and-structure.md), whose work was
deployed in that build.

> Perhaps indicate where there are figures/tables/etc in Structure mode somehow
>
> — Greg, 2026-10-15 (`spya-zzvm6e`, #585, `SPIDERYARN-READING2-J6`)

> Do we include Tables as well as Figures in Skim mode?
>
> — Greg, 2026-10-15 (`spya-s8pf4r`, #586, `SPIDERYARN-READING2-J7`)

**Ending: Shipped**, both. On `dev`, not deployed. Plan
[261015b](../plans/261015b-figures-follow-ups-tables-as-pictures-louder-structure-marks.md), with
GPT Sol's plan and code reviews beside it.

- **#585.** On his paper (read from production, read-only) the three figures were all found, and the
  two parts holding them each carried a mark. They were there and not seen: a 12px icon in the
  faintest ink. Now 14px in an unread title's ink, checked in the browser in both themes.
- **#586.** Yes: a `<table>` was already a stop in the Figures walk, and his paper has no tables. But
  a table that arrives as a picture (a PDF table the model could not copy cell by cell, a journal's
  table published as an image) was counted as a figure. It is now a table when its caption starts
  *"Table N"*. Making it so, GPT Sol found that a table's caption could go to the picture before
  it. That is fixed too, and a table's own `<caption>` now counts.

The third report from the same minute, figures inside the Gist · More · Most route (`spya-c8z66b`),
is [261015_2040-figures-in-the-skim-route.md](261015_2040-figures-in-the-skim-route.md).

Sentry: `SPIDERYARN-READING2-J6` and `-J7` set to resolved by this session, 2026-10-15.
