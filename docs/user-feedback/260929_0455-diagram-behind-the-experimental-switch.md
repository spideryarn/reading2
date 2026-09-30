---
reports: spya-cyzsy4
ending: shipped
---
# Diagram mode goes behind the Experimental switch

SPIDERYARN-READING2-4R, from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=diagram&at=spya-q4f4dh&term=spya-ksm3qc&stop=spya-revz3p&depth=2`.
Overseer queue `qi-w7pz76zk`. The time in the file name is roughly when this session received the
report; it could not read Sentry.

> Move all of Diagram mode into the "Experimental features". It's just not good enough yet.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4R (the next feedback sweep does the Sentry
status write).

What we did: Diagram is `experimental` in the mode catalog, so its button is drawn only with the
switch on (or while you are in it by URL, as for every hidden mode). Inside the mode, a switched-on
reader still gets all five pictures. The row and the reason are in
[experimental-features.md](../project/experimental-features.md), and the Features page caption says
it is experimental.

Plan: [260929c](../plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md) § 4.
