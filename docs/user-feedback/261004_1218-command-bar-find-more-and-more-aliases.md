---
reports: spya-rbxrgc, spya-uzkmn3
ending: shipped
---
# Command bar: Find more as a command, and more aliases

Greg (admin), 2026-10-04, two suggestions two minutes apart on
`/read/bitterlesson-spya-pbag4p`. Sentry SPIDERYARN-READING2-CM and SPIDERYARN-READING2-CN;
provenance proved from the production rows. Overseer queue qi-d5ndf8y4.

spya-rbxrgc, 12:18 UTC, in Glossary mode:

> There are lots of cases where we have a sort of find more button, for example in the glossary
> mode. Let's make that be part of the command bar as well.

spya-uzkmn3, 12:20 UTC, in Structure mode:

> In the command bar, add more aliases. So, for example, structure mode could have aliases for
> hierarchy, table of contents, TOC, headings, etc.

**Ending: Shipped**, on `dev`. Plan
[261004k](../plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md).

**Find more.** Typing `find more` in the command bar now offers *Glossary › Find more* and
*Quotes › Find more*. Enter opens that mode and presses its own Find more button once. Those are
the only two modes with a button that adds to a list; every other mode's "again" button writes the
thing afresh, and those were already in the bar as *‹name› › Run again*. A Find more row is shown
only while the list can be added to, so it never replaces a list and never starts a first run.

**Aliases.** Every mode answers to more words, six to twelve each. Structure: `table of contents`,
`headings`, `headers`, `sections`, `chapters`, beside `hierarchy` and `toc`, which it already had.
Others include `tldr` and `gist` for Summary, `jargon` and `vocabulary` for Glossary, `q&a` for FAQ.

Deferred, with its own queue entry (qi-ca3kxyg9): more words for the rows that are not modes
(pages, actions, sub-modes), and two older ties to settle (`source`, `annotations`).
