# Move the Design link into /admin

**[SPIDERYARN-READING2-1T](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1T)** · reported
2026-09-05 09:36 UTC · *shipped*

## What the reader said

> Move the Design link on the logged-in Homepage into /admin

## What we did

Exactly that. The link is a third `Entry` on the `/admin` index
([`AdminPage.tsx`](../../src/web/AdminPage.tsx)) beside Users and Feedback, and it is gone from the
shelf's masthead ([`Library.tsx`](../../src/web/Library.tsx)). `DESIGN_HREF` did not move; only its
call site did.

**Moving the link gates nothing**, and that was decided rather than overlooked: `/design` is still
open to any signed-in reader, for the same reason
[admin.md § The three refusals](../project/admin.md#the-three-refusals-and-only-one-of-them-is-a-gate)
already gives about the Admin link — drawing a link is a courtesy, the page is in everybody's bundle
either way, and this one reads no data at all. If it should be gated, that is a separate report.

[The plan](../plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
§ Stage 1; [admin.md § The page itself](../project/admin.md#the-page-itself) is the doc.
