---
reports: spya-ejzr4b, spya-u7yfns
ending: shipped
---
# *Why you're reading* higher in Metadata, and the publication date in the masthead

Two suggestions from Greg on `mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb`, build
f84dc434. `scripts/feedback-reporter.ts` exits 0 on both (admin); re-read just before this note, no
addenda. The time in the file name is when this session picked them up.

SPIDERYARN-READING2-J3 (`spya-ejzr4b`, #582), from the Metadata page:

> Move "Why you're reading" further up in Metadata

SPIDERYARN-READING2-J4 (`spya-u7yfns`, #583), from the reading view:

> Please include the publication date at the top of the article along with the other metadata
>
> And maybe hide some of the less-likely-to-be-useful metadata behind a default-collapsed section

**Ending: Shipped.** On `dev`, not deployed. Resolve J3 and J4. The next feedback sweep does the
Sentry status write.

What we did:

- **Metadata: *Why you're reading* is the second section, directly under *In one sentence*.** It
  was the first card inside *Your reading*, sixth section down. The read-only *About you* moved
  with it, since the two answers are meant to be read side by side. *Your reading* keeps Comments
  and Where you left off, lower down. Searching the page for "purpose" or "intent" finds it.
- **The masthead's facts line now says where and when**: authors · journal · site · *Published 10
  Apr 2005* · ~16 min. This is the same order and wording as the Metadata page, and a visitor to a
  shared article sees it too.
- **The word, part and section counts are behind *Show counts***. It's a dotted text button like
  *Fold all* beside it, and it starts shut on every load. Opus and I judged those three the least
  useful there: the read time already turns the word count into the answer, and nobody decides
  to read on a count of parts. They stay on the Metadata page. The PDF transcription note stays
  in view, because it's a trust signal. *Fold all* and *Show authors and details* also stay,
  because they're controls.

Choices Greg can overturn in one line each:
- Drop parts and sections from the line outright, with no button. GPT Sol argued for this simpler
  version.
- Keep the word count visible.
- Remember *Show counts* across reloads.

Found on the way, not fixed here: on a phone, *Show counts*, *Fold all* and *Show authors and
details* are each a 13px-tall target, short of the 40px rule for a finger. Two of the three were
already like this. They need fixing as a group, because three separate 40px targets would overlap
and send a tap to the wrong button. Queued as `qi-ratx9etm`.

Plan, both GPT Sol reviews and the browser shots:
[261015c](../plans/261015c-why-you-are-reading-higher-in-metadata-and-the-publication-date-in-the-masthead.md).
