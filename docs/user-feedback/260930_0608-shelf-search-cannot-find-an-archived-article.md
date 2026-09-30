# Shelf search cannot find an archived article, and the Archived chip is ambiguous

SPIDERYARN-READING2-72, from Greg (admin), on `/?archived=1`. The time in the file name is when this
session picked the report up; it had no Sentry access, and the report text came in the brief.

> In the logged in home page I tried searching for Wolfram, expecting to find the article on bigger
> brains. I was looking for it because I just archived it by accident, and I was trying to unarchive
> it. So I searched for it, but I didn't find any articles, so I figured, okay, that's because it's
> been archived. So then I clicked the button archived near the search box, figuring that would
> include the archived articles. But it was very confusing the way that button worked. I couldn't
> tell if that button meant, when clicked, include both active and archived, or only include
> archived. And anyway, either way, it still didn't find the Wolfram article. So I couldn't find a
> way to find that Wolfram bigger brains article with the search box when it was archived, and it
> felt like a bug. It may also be something about the UI that's confusing to users.

**Ending: Shipped** — on `dev`, not deployed. Resolve 72; the next feedback sweep does the Sentry
status write.

What we found: the chip reached the card filter but not the passage search, and that article's card
has no author or site name, so "Wolfram" was only in its text — which the passage search never
searched for an archived article, chip or no chip.

What we did:

- With the chip on, the passage search now searches archived articles too, and marks each passage
  from one **Archived**.
- The chip now reads **Include archived**, and its tooltip says archived articles are listed and
  searched as well as the rest.
- With the chip off, a passage search that finds nothing says archived articles were not searched,
  and names the chip.

Greg's production article was not touched; a local article reproduced it.

Plan: [260930d](../plans/260930d-shelf-search-finds-archived-articles-and-the-archived-chip-says-include.md).
