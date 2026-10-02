---
reports: spya-skxhcz
ending: shipped
---
# Trajectory becomes Skim, and the Marginalia rename is checked

Report spya-skxhcz (no Sentry issue id was given), a suggestion from Greg (admin, verified by
`scripts/feedback-reporter.ts`, exit 0 — the row, not a Sentry event), sent from Trajectory at
`https://www.spideryarn.com/read/jco-2005-01-libre-spya-hk9cc7?mode=trajectory&…`, build `e94f588d`.

> Let's rename "Trajectory" to "Skim" (along with all variables, UI elements, docs, signposts,
> database columns, etc.) But keep "Trajectory" as a keyword in the Commands so that it still
> matches for that.
>
> We also recently renamed Annotations -> Marginalia mode. Make sure equivalently that we've renamed
> all the places in the code and evergreen docs and references, and added it as an alias-keyword in
> Commands.
>
> (You don't have to rename historical plans etc. These instructions should hopefully be covered
> already by rename-or-move.md or something like that. The key point is to make sure we keep
> signposts etc up to date, and that the code and UI and database and docs etc stay in sync (so that
> it's easy to grep, and there's less confusion for an agent reading the code about what's what).

**Shipped** on `dev` — the mode, its code, its CSS, its API path, the database column and step name,
and the docs are all called Skim now. *Trajectory* still finds it in the command bar, and an old
`?mode=trajectory` link still opens it. A few stored spellings keep the old name on purpose, so that
no route already made reads as stale; they are listed in [skim.md](../project/skim.md). The
Marginalia rename had been thorough: the *Annotations* keyword was already in Commands, and one test
and one doc line were all it had missed. The migration renames a column, so the Overseer reviews it
before deploying. Plan, reviews and the reasoning:
[261001r](../plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md).
