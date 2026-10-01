---
reports: spya-rsgpfm, spya-pppdan, spya-a5yxnt, spya-nr6gqu, spya-hkf2bs
ending: shipped
---
# Summary in one row, with a three-level plain-words slider shaped by who is reading

Five reports from Greg (admin, verified by account id) about the same Summary-mode controls, on
`/read/dongetal25-spya-vfmvmm?mode=summary&summary=simple`, build `fe57a1ea`, handled as one entry
(Overseer queue `qi-pnsnh6yy`): SPIDERYARN-READING2-78 (`spya-rsgpfm`), -7A (`spya-pppdan`), -7B
(`spya-a5yxnt`), and two that arrived mid-build and were folded in, -7J (`spya-nr6gqu`, 23:21Z) and
-7F (`spya-hkf2bs`, 23:15Z). The time in the file name is 7F's, the earliest this session was given;
it runs on a pool account and could not read Sentry.

> In Summary mode, move the new Gists and Simple pill to the same row as Parts and Sections. Remove
> the "Article" pill, and the "View" text. (78)

> In the Summary mode, let's somehow group Parts & Sections together, get rid of the Gists button
> (since clicking on Parts or Sections is enough), and perhaps remove the "Simple" button and replace
> it with a couple of grouped buttons for something like Very-Simple and Moderately-Complex (but come
> up with better names). ... the main thing I'm trying to do is avoid wasting vertical space, and use
> the UI design to give the user a clue about how they work and are related to each other. Also, the
> Very-Simple and Moderately-Complex summaries should take into account User-Profile and
> Why-are-you-reading-it. ... If it's ELI12, maybe it should be ELI15, and then the
> Moderately-Complex might be +3 or something. (7A)

> Remove "Written by AI in plain words to help you get your bearings. The article says it better, and
> each paragraph links to where." from Summary mode. And make a note in the new-mode.md (or similar)
> that we don't want these mode descriptions - they waste space. Either put them as tooltips for an
> (i) icon, or just try and make things self-explanatory. (7B)

> For the Very-Simple summary, tweak the prompt to output slightly shorter in length. The
> Moderately-Complex summary can be about the current length or ever so slightly longer. (7F)

> Ok, I've slightly changed my mind re Summary mode UI & buttons yet again. For the new sub-modes
> that show simple text summaries, let's provide a UI-slider with 3 level (short & very-simple,
> just-under-current-length and fairly-simple, just-over-current-length and moderately-complex). (7J)

**Ending: Shipped.** On `dev`, not deployed. Resolve all five; the next feedback sweep does the
Sentry status writes.

What we did:

- **One row**: `[ Parts | Sections ]  ○──●──○ Simple  ⓤ`. Parts and Sections are one joined control;
  Sections lights Parts as *included*, because Sections adds to Parts. No Article pill, no Gists, no
  View or Depth labels. The slider has three stops — **Brief** (short, very simple), **Simple**
  (fairly simple, just under the old length), **Fuller** (moderately complex, just over it). It
  rests faint while the outline shows; touching it opens a level. ⓤ is the *written for you* badge.
- **Your profile and your reason for reading shape every level.** What you say you know is not
  explained; the goal decides what leads. On a synthetic CTO reader, a blind judge found the new
  Simple spent fewer words on what the reader knew in 5 of 5 pairs, and picked out which of two goals
  a text was written for in 11 of 12.
- **The description line is gone**, its sense moved into the slider's hover card, and
  [new-mode.md](../project/new-mode.md) has the rule in your words.
- **One press writes all three levels**, one model call each, side by side, in about 8–28 seconds.
  After that, moving the slider is instant.

Choices you can overturn:

- **The names Brief · Simple · Fuller.** One table in `SummaryMode.tsx`.
- **About three times the cost of the old Simple**, $0.06–0.22 a press, because each of the three
  calls pays for the article. Staggering them to share a cache would save most of it and add a few
  seconds. Not built.
- **With no profile, the new Simple is a shade less plain than the old one** (a blind judge: easier
  1, harder 3, same 2). That is the "fairly simple" middle stop you asked for, with Brief now the
  very simple one, but a reader with no profile will notice it.
- **A visitor to a public article sees your version**, pitched at your profile, as with a
  personalised glossary. The *make public* dialog now says so.
- **The paragraphs written before today don't show** until the next press rewrites them. The old
  shape had one level.

Plan, measurements and both GPT Sol reviews:
[261001b](../plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).
