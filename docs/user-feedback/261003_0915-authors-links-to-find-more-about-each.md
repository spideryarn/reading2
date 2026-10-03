---
reports: spya-uvxq8e
ending: shipped
---
# Authors: a way to find out more about each, off the site

From Greg (admin), a suggestion filed 2026-09-12 on `/read/entropy-24-00930-spya-bmvfyb`. Overseer
queue `qi-kd4rqz9p`. The time in the file name is roughly when this session received the report.

> Perhaps the newly proposed citations mode, when it runs, should also separately highlight
> information about the authors themselves. Don't know what that would look like. Maybe at the very
> least, just kind of indicate the authors, their affiliations if available, and provide, like,
> something I could click on or expand that would take me to the top few links for them.

**Ending: Shipped**, on `dev`, not deployed.

Most of this had already landed for a later report
([260929_1005](260929_1005-authors-and-affiliations-shown-and-linked.md), plan 260929d). The
authors and their affiliations show in the masthead above every mode, Citations included, and on the
Metadata page, and each name links to your shelf. The missing piece was "the top few links for
them". Now each author's card in the masthead has *Find out more: Google Scholar · Web search*.
The Scholar link is an `author:` search. The web search uses the name plus the first affiliation.
Both open in a new tab without telling Google which article you are in. The card is one you can move
the pointer into, or Tab into. The Metadata page's Authors section shows the same two links under
each name, which is where a phone reader finds them.

Deferred, and named in the plan: a list of the authors inside the Citations band itself (the
masthead already shows them there), and an in-app lookup that fetches three links per author with a
model and web search. The plan says why the free searches come first.

Plan: [261003f](../plans/261003f-authors-outside-links-to-find-more-about-each.md).
