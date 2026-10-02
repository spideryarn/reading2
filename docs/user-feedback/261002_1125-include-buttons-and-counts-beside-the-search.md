---
reports: spya-s9fhmw
ending: shipped
---
# The Include buttons beside the search's answer, with counts

Report `spya-s9fhmw`, a suggestion, from Greg (admin), 2026-10-02, relayed by the Overseer with no
Sentry mirror, on `https://www.spideryarn.com/?q=holland`:

> I did a search in the logged-in homepage. It said: "Nothing in the articles' text matches
> 'holland'. Archived articles aren't searched — turn on Include archived to search them too."
> Let's add an extra button right there next to that empty-results-message for including archived
> (and another one for including public), so the user doesn't have to hunt around for it. For extra
> points, (always) include a sense of how many archived and public results would have matched, so
> that the user knows whether it's worth bothering to include them.

**Ending: Shipped**, on `dev`. Plan
[261002b](../plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md)
§ Part D.

What changed: whenever you search the shelf with Include archived or Include public off, a line
right under the answer has a button for each, and says how many each would add: *"2 archived
articles mention it"* (counted on the server, exact) and *"1 public article matches by title,
author, site or description"*. The buttons are there at zero too, and the zero is said. The old
"Archived articles aren't searched" sentence is gone; this line says the same with a number and a
button.

Limits, said rather than hidden: the archived number counts matches in the text, not archived cards
matching only by title; the public number counts card matches only, since public articles' text is
not searched; and a one-letter query gets the buttons without numbers.
