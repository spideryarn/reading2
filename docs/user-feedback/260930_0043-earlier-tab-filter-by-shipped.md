---
reports: spya-bfcvxg
ending: shipped
---
# The Earlier tab says which reports shipped, and filters by it

[SPIDERYARN-READING2-63](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-63) (2026-09-30
00:43 UTC, `kind=suggestion`), from Greg (admin — `feedback-reporter.ts` exited 0 on the issue's
`user.id`), on `dongetal25-spya-vfmvmm`, build `d6266038`.

> In the feedback dialogue, there's an earlier tab, which is great. It would be nice if we could
> provide a way to filter to things that have or have not been achieved and deployed. In the past,
> this might not have been possible because you may not have had access to the production database,
> but I think we do now have the .env.prod database keys, so it should be possible to mark feedback
> rows as achieved, and you have my permission to do that.

**Ending: Shipped** — on `dev`, not deployed. Resolve 63.

What we did: each report in the Earlier tab now says **Shipped** when a change for it has gone out,
and the tab filters **All · Shipped · Not shipped**, on the server, so the filter reaches past the
newest fifty. Nothing is marked in the database. Instead, the status comes from these notes: each
note now starts with a short header naming its report and its ending. A script compiles the headers
into the server. So on production a report reads as shipped only once the note, and the work before
it, has been deployed. All 150 existing notes were given headers; 154 reports, 150 of them shipped.
[260930e](../plans/260930e-earlier-tab-filters-by-done-from-the-notes.md).

**One thing waits on Greg:** adding the header to the rules in `feedback-reports.md`, which is a
rule-bearing doc. Until then, a report finished by a session that does not know about the header
reads *not shipped*. The before/after wording is in the plan's § Proposed rule change.

**Greg's permission to mark production rows was not used**: nothing needed writing there.
