---
reports: spya-zt7u0h
ending: shipped
comment: That article is yours: its PDF import failed this morning on the NUL bug, since fixed. Your own failed import now shows its card with Retry instead of Not shared, and the table says Not published rather than Untitled. Press Retry.
---
# /admin/articles: "Untitled", and "Not shared", were your own failed import

`spya-zt7u0h` (#644, problem, `SPIDERYARN-READING2-MA`), from Greg (admin; `feedback-reporter.ts`
exit 0 on the production row). Filed 2026-10-19 20:35 UTC from `/admin/articles`. Overseer queue
item `qi-tgm93qpt`, shared with `spya-vm5enm` and `spya-k06kam`
([261019_2010](261019_2010-view-another-readers-account-as-them.md)). Addenda: none.

> I tried opening this:
>
> https://www.spideryarn.com/read/conscious-artificial-intelligence-and-biological-spya-drhjjm
>
> But I just get a "Not shared" page...
>
> What's going on with it?
>
> It's named "Untitled" in the table

**Ending: Shipped**, on `dev`. Plan
[261019n § Part 1](../plans/261019n-admin-sees-other-users-articles-and-views-as-them.md#part-1-not-shared-and-untitled-built).

- The article is Greg's own PDF upload. Job `spya-k0ytd8` failed at `extract` at 10:08, on the
  NUL bug Greg reported as `spya-u5azdm`, which is fixed and deployed
  ([261019_1015](261019_1015-a-pdf-with-a-nul-in-its-transcription-imports.md)). Nothing ever
  published, so the table had no title to show.
- "Not shared" was a bug. The owner's page for an unpublished import showed only a live or
  finished import, never one that had already failed. It now reads the newest import of the slug,
  and draws a failed one's card, with the reason and Retry.
- `/admin/articles` says *Not published: its import failed or has not finished* instead of
  *Untitled*. It says this only on rows it already shows a title for.
- Not re-run from here, because that is a production write. **Retry on the article's page is safe**,
  and pays only for the three chunks that failed.
