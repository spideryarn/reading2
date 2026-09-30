---
reports: spya-qdjdsb
ending: shipped
---
# What the grey line beside some blocks means

SPIDERYARN-READING2-4S, from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=diagram&term=spya-ksm3qc&stop=spya-revz3p&depth=2`. Overseer queue
`qi-kga43a9m`. The time in the file name is roughly when this session received the report; it could
not read Sentry.

> Some of the blocks seem to have a vertical grey line to their left. I can't figure out what that
> means! I assume it's deliberate. How can we make it discoverable for the user what it means? At the
> least, a tooltip? Or something else when the block is activated by a click?

**Ending: Shipped** — on `dev`, not deployed. Resolve 4S (the next feedback sweep does the Sentry
status write).

What it is: [reading time](../project/reading-time.md) — a hairline beside each passage, darker the
longer you have spent reading it. Owner only and behind the Experimental switch, which is why Greg
sees it.

What we did: the line now has a tooltip on hover — *"Reading time: this line gets darker the longer
you spend reading here. Only you see it."* Only rows you have spent time on can be hovered.

**Deferred:** nothing on touch yet (a tooltip does not show on a tap), and nothing on clicking a
block — Greg's second idea is the touch answer, and waits for him to see the tooltip first.

Plan: [260929c](../plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md) § 5.
