---
reports: spya-vwf00u
ending: shipped
---

# The contents list and its search box, above the page on a phone

A suggestion from Greg (admin, proved against its production row by `feedback-reporter.ts`, exit
0), 2026-10-06 22:13 UTC, from a Metadata page. Sentry SPIDERYARN-READING2-EB. Queue item
`qi-pmv7krdb`.

`spya-vwf00u`:

> In the metadata page, and maybe other places as well, perhaps the profile, we have a table of contents that's visible in the left-hand side if the page is wide enough. Actually, that table of contents is really nice. I think it even has a search bar as well. On something like a portrait iPhone, obviously it's not wide enough. So perhaps we should then put the search bar and table of contents above the actual contents of the page, like the metadata or the profile page, because I think that's a useful piece of functionality for helping people navigate.

**Shipped**, in
[261007c](../plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md). Below
1024px wide, Metadata and `/profile` now draw the search box above their first section, and under
it a *Contents* button that opens the list. They are the only two pages that share the component;
`/help` already did this with its own list.

One choice was made for Greg: the list starts shut. Metadata's is about a phone's whole first
screen when open. The plan says how to flip it.

Nothing of the report is deferred. The review turned up one unrelated follow-up, queued as
`qi-927n8tjp`: seven older text fields whose touch-screen type floor is weaker than the one this
work used.

The Sentry status write is left for the next sweep; this session has no Sentry sign-in.
