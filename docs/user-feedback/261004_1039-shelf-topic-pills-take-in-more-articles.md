---
reports: spya-d4tp0y
ending: shipped
---
# Shelf topic pills take in more articles

Two reports from Greg (admin, each proved by `feedback-reporter.ts` exit 0), both about the shelf's
topic pills, handled in one session. This note carries the one that shipped; the other is
[its own note](261004_1000-topic-pills-on-the-public-shelf.md), because the two ended differently.
This session had no Sentry sign-in; the words are from the reports' production rows.

SPIDERYARN-READING2-C8 (`spya-d4tp0y`), filed 2026-10-04 10:39 UTC from `/?archived=1`:

> The new topic pills are great. The only thing is they seem slightly too tight. So, for example, I
> think there was a topic pill on learning and memory or something, and it didn't include the Levin
> article about self-improving something something. You can look in my production database to see
> what I mean. I wonder, I think it's better if these topic pills are quite inclusive, sort of err on
> the side of inclusiveness, because you can always use a tabula to focus it down. Whereas if one is
> too tightly bound, then there's a risk that it'll exclude stuff that actually I think should have
> been included.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve C8; the next feedback sweep does the
Sentry status write.

What was wrong, read from the production tree (read-only): *Memory & Learning* had been made inside
*AI & Computing*, by a step that only ever saw AI & Computing's articles. Levin's *Self-Improvising
Memory* was under *Cognitive Science*, so nothing could have put it in that pill. What we did:

- When the topics are worked out, every article is now also shown every topic, as one plain list,
  and added to each one it belongs in. So a pill means its own name across the whole shelf.
- The instructions lean towards including an article: in if it discusses the topic, gives evidence
  about it or makes a claim about it, even when that is not its main subject.
- New articles are sorted in by the same rules.
- Everyone's topics are worked out again the next time they open their shelf.

Measured on Greg's own shelf: the average article went from about 2 topics to about 3, and the
Levin paper landed in the memory pill in 7 of 8 tries. The cost: pills are less sharp, and some
finer pills now hold articles their broad pill does not.

"tabula" was taken as a dictation slip for choosing a second pill to narrow down; nothing was built
for the word. Not checked in a browser: nothing on screen changed, only which articles a pill holds.

Plan: [261004j](../plans/261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md).
Measurements: [261004d](../investigations/261004d-shelf-topics-inclusive-filing.md).
