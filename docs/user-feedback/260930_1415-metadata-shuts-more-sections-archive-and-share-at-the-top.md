---
reports: spya-t8az6f
ending: shipped
---
# Metadata: more sections shut, and Archive and Share… at the top

SPIDERYARN-READING2-6Z (`spya-t8az6f`, the row id read from production's `feedback` table,
read-only), from Greg (admin: `scripts/feedback-reporter.ts` exits 0 for the issue's user id), on
`/read/pmc13013618-spya-uekgh6/metadata`. The time in the file name is when this session picked the
report up. The session had no Sentry sign-in, so the report text came in the brief.

> In the metadata mode, I think we can have more of the sections be default collapsed, like
> authors, export, delete. I think perhaps we could add a button to archive near the top because
> that's going to be quite a common action, and also a button to publicly share. Although I guess
> if you click that, it'll probably have to take you to the section for public sharing because that
> has its own kind of confirmation tick box. But I think the archive button, because it's
> reversible, I guess in an ideal world archiving it, well, just says, okay, it's archived, but you
> could carry on reading, I guess, so it doesn't need to kick you out of the article itself.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 6Z. The next feedback sweep does the
Sentry status write.

What we did:

- **Authors, Export and Delete this article are shut by default.** Click the heading to open one.
  Authors still shows its count on the shut heading.
- **Archive and Share… sit under the title.**
  - **Archive** is the same control as the one at the foot of the page, and the two always agree.
    After you press it, it says *"Archived just now — off the shelf, and you can carry on
    reading."*, offers Put back, and leaves you on the page.
  - **Share…** only takes you down to *Access & sharing*. The confirmation and the rights tick-box
    there are still the only way to publish.
- One change you might notice: if the page's metadata check fails, neither Archive button is
  offered until you reload. Before, the foot one could still be offered from an older answer.

Choices Greg can overturn in one line each: only the three sections he named are shut (*What it
cost* and *Your reading* stay open). Share… always reads *Share…*, even when the article is already
public.

Plan: [260930h](../plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md).
