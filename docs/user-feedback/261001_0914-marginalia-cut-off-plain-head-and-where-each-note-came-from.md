---
reports: spya-hut48h, spya-g4yrew, spya-atv4nx
ending: shipped
---
# Marginalia: cut off at the right, a plainer head, and every note says where it came from

Three reports from Greg (admin; `feedback-reporter.ts` exit 0 on each), all 2026-10-01, about the
right-hand column then called Annotations, now Marginalia. Overseer queue `qi-2cxmnb4d`. This session
ran on a pool account with no Sentry sign-in, so the Sentry status writes are the next sweep's.

> Annotation mode gets cut off by the right margin
>
> Use Playwright screenshots to test.

spya-hut48h (problem), 09:14Z.

> And in Annotations mode, that rail at the top that shows where you are - the language is too
> complex. Can you make it shorter and simpler.

spya-g4yrew, 09:16Z.

> It has a "schema representations..." annotation, but I can't tell what that Annotation is from or
> why or whether AI-generated (if so, it should be in the AI-generated font). Make sure all
> annotations have rich tooltips (see tooltips.md) explaining their origin, and anything else that
> might be helpful for the reader.

spya-atv4nx (suggestion), 09:55Z.

**Ending: shipped, all three.** Plan
[261002g](../plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md).

- **Cut off (hut48h): already fixed, by aec8ff52f** (261002a, deployed 2026-10-02). On a Mac with a
  mouse plugged in, the page has a 15px scrollbar, and the reading view was laid out 15px too wide —
  so the column at the right edge ran under it. Playwright with real scrollbars, before and after:
  [before](../plans/261002g-shots/before-1280-margin.png) cuts "the claim" to "the clain" and
  scrolls sideways; [after](../plans/261002g-shots/after-1280-margin.png) is clean at every width,
  with or without a panel open.
- **The head (g4yrew)**: the part and section titles were already short; the hard words were the
  arc's sentence under them, 30-odd words on average. The arc's prompt now asks for at most 20, spent
  on what is settled and what is still open. Measured on five articles: a blind judge found the new
  ones plainer in 33 of 35 parts, about as good at saying where the argument stands, and none wrong
  ([261002p](../investigations/261002p-arc-sentences-shorter-and-plainer.md)). The head now shows
  four lines of it, not three. An arc written by the old prompt is rewritten the next time you open
  the article; the old one stays until then.
- **Where each note came from (atv4nx)**: every note — questions, idea stamps, FAQ, Debate,
  Citations, comments — and the head's path and arc have the house card: what it is, which mode made
  it, who wrote the words (AI, the author or you), and why it sits beside this passage. A question
  opens its card on a tap too. Each note's words are in their writer's face; the "schema
  representations" one was an idea stamp, whose name was already in the AI face since 261002f, and its
  card now says "From Ideas mode, written by AI".

Not done, named: at the column's narrowest (a window about 900–1000px wide) a four-line head still
cuts most arcs; the whole sentence is in its card. A shut line's card opens on hover and focus but
not on a tap, because a tap opens the note itself.

Also closes the margin half of queue item `qi-bm8fpvy4` (SPIDERYARN-READING2-9A, typeface by voice in
Marginalia): the notes 261002f had not voiced are now voiced.
