---
reports: spya-pu7536
ending: shipped
---
# /changelog shows each release's date as relative time

SPIDERYARN-READING2-6P, from Greg (admin), a suggestion on `/changelog#release-95`. The time in the
file name is the feedback row's `created_at` (UTC), read from production inside `begin read only`,
because this session had no Sentry access; the row id came the same way.

> In the What's New page, `/changelog`, we show sort of date stamps for when the deploy came out. I
> wonder if we could show them as human readable, e.g. `3d ago`, `3h ago` (perhaps using a library
> as per docs/reusable/third-party-library-selection.md )

**Ending: Shipped** — on `dev`, not deployed. Resolve 6P; the next feedback sweep does the Sentry
status write.

What we did: each release's heading now says `3 days ago`, and the contents list says `3d ago`. The
exact UTC time is on hover and read to a screen reader, and past a month both show the date they
always did. **No library**: the app already had one wrapper around the browser's own
`Intl.RelativeTimeFormat` (the shelf's "3 days ago"), and the changelog now uses it too. Reasoning,
the GPT Sol reviews and what is deferred (a way for a phone reader to see the exact time) are in
[260930i](../plans/260930i-changelog-release-dates-as-relative-time.md).
