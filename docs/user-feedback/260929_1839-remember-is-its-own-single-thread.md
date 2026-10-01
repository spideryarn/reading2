---
reports: spya-peszam
ending: shipped
---
# Remember is its own single conversation

Greg's report, filed 2026-09-29 (he is admin; the brief came from his production feedback row):

> The Remember mode should be its own single, special conversation thread (not visible from Chat,
> nor should other Chat threads be visible in Remember mode). It's a special kind of conversation
> thread just for helping the user to remember from the article, with its own special UI (e.g. for
> more Socratic responses, etc).

**Shipped.** On 2026-10-01 Greg chose between two designs and picked keeping Chat's machinery while
separating the two modes on screen. The work is on `dev`:

- There is now one Remember conversation per article, enforced by a database index.
- Chat lists only chats.
- Remember opens its one conversation directly: no list, no `+`, and a **Start over** in place of
  delete.
- Any existing extra Remember threads are folded into the earliest one by the migration. Production
  had none, and the Overseer re-checks that just before deploying.

In the same change, the Overseer's related finding was fixed. On a landscape phone, Remember's
composer used to take 280px of a 338px band at rest. It now rests at two rows and grows to at most
30% of the screen.

Deferred: Remember's own controls beyond these, such as the "more Socratic" ones the report
mentions. This change makes room for them.

Plan, reviews and evidence: [261001m](../plans/261001m-remember-is-its-own-single-thread.md).
