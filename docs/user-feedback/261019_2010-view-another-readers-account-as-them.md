---
reports: spya-k06kam, spya-vm5enm
ending: awaiting
comment: Planned, not built, because it changes a security rule. Two options: view the app as a reader, read-only, with a bar and Stop; or inspect one article on an admin page. Question q-kyhvkm is waiting for you.
---
# Seeing other readers' articles, and viewing the app as them

Two suggestions from Greg (admin; `feedback-reporter.ts` exit 0 on both production rows), 2026-10-19:

- `spya-k06kam`: #629, `SPIDERYARN-READING2-KT`, 20:10 UTC, from `/`.
- `spya-vm5enm`: #641, `SPIDERYARN-READING2-M7`, 20:31 UTC, from `/admin/articles`.

Overseer queue item `qi-tgm93qpt`, shared with `spya-zt7u0h`
([261019_2035](261019_2035-admin-articles-untitled-and-not-shared-was-your-failed-import.md)).
Addenda: none.

> As an Admin, I want to be able to make sure things are working for other people, and/or reproduce
> problems that other people are experiencing.
>
> Create a way for me to log in as someone else? e.g. in /admin/users - so that I can browse the site
> as if I'm them.
>
> This can be tricky though, so use Sonnet for web research on best practice for this kind of
> login-the-admin-as-another-user behaviour. e.g. how do I log back out? Perhaps some kind of special
> bar at the top that stays visible while I'm in logged-in-as-another-user mode?
>
> Avoid making this tooooo complex if you can.

> If I'm an admin, I should be able to see everything about other users' articles

**Ending: Awaiting Greg.** Letting an admin read another reader's article, or act as them, edits a
defence: admin.md's "never a title … or a sentence of anybody's reading", and the owner gate in
`src/routes.ts`. An unattended run does not edit a defence. So it was researched, planned and
reviewed, and nothing was built.

- Research (Sonnet):
  [261019a](../research/261019a-admin-impersonation-best-practice.md).
- Plan, with GPT Sol's plan review and Opus's critique folded in:
  [261019n § Parts 2 and 3](../plans/261019n-admin-sees-other-users-articles-and-views-as-them.md#parts-2-and-3-seeing-other-readers-articles-and-viewing-the-app-as-them-proposed).
  Option A is a read-only *view as*, with a server-side session, a reason, a 30-minute expiry and
  an allowlist of routes. Option B is an *Inspect* page for one article. Login-as was passed over.
- Question: [q-kyhvkm](questions/q-kyhvkm.md), on A or B, and on the privacy page's wording.
