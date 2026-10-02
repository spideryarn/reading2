---
reports: spya-p6scuf
ending: shipped
---
# Metadata: the contents list on an iPad in landscape

A suggestion from Greg (admin: `scripts/feedback-reporter.ts` exited 0), on
`/read/s41597-021-01033-3-spya-e06dkg/metadata`. The report text came in the brief.

**[SPIDERYARN-READING2-9M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-9M)**
(`spya-p6scuf`):

> The table of contents for the metadata page is not visible on my iPad, even in landscape mode,
> even though there's quite a lot of space on either side.

**Ending: Shipped** — on `dev`, not deployed. Resolve 9M.

What we did: the contents list (and its search box, from
[261001_0948](261001_0948-metadata-contents-opens-flashes-and-searches.md)) now shows from 1024px
wide rather than 1280px, which covers every iPad in landscape. Below about 1152px the centred
margin is too narrow for it, so there the page's column steps right just far enough to clear the
list; from 1152px up the page is centred exactly as before. Still hidden in portrait — a contents
button for narrow windows is named and deferred in the plan.
[261002a-metadata-contents-on-an-ipad-in-landscape.md](../plans/261002a-metadata-contents-on-an-ipad-in-landscape.md)
