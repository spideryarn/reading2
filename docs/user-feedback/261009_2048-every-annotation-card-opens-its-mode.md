---
reports: spya-zux9w6
ending: shipped
comment: The citation, glossary and quote cards now each end in Open in Sources / Glossary / Quotes. Cards on comments, chat anchors and search-style highlights are queued as their own piece of work.
---

# Every annotation card on the prose opens its mode

Report `spya-zux9w6` (#521), a suggestion from Greg, 2026-10-09, in the reading view of
`arxiv-2609-01481-spya-jytq2h` (build `8bd1e67b`). Overseer queue item `qi-qp9r7eyk`.

> Citation tooltips should include a link to take you to the citations mode, just like I think
> quotes do, and hopefully the glossary as well. Anything else that's an annotation on the text
> should, you know, should have a tooltip, and there should be a way to take you to its mode.

**Ending: shipped**, on `dev`, as plan
[261010d](../plans/261010d-every-annotation-card-opens-its-mode.md). Every mark on the prose was
surveyed, and the table now lives in
[tooltips.md § Every card on a mode's mark has a way into its mode](../project/tooltips.md#every-card-on-a-modes-mark-has-a-way-into-its-mode).
The three cards on a mode's mark now end in the same button:

- **Citations:** *Open in Sources* is new. It opens Bibliography with the work's row in view.
- **Glossary:** *Open in Glossary* (was *Open glossary*) now also brings the row into view, for a
  visitor too.
- **Quotes:** *Open in Quotes* (was *open Quotes*) is now shown in Quotes mode as well.

**The deferred half is queued:** a card on comment and highlight marks, chat anchors, and the
search-style hits. It is Overseer queue item `qi-yr7hx7t8`, proposed and awaiting Greg's
authorisation. GPT Sol's plan review cut it from this plan because each needs its own design.

This session had no Sentry sign-in, so the Sentry status is left for the next feedback sweep to
mark resolved.
