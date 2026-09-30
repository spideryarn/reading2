---
reports: spya-xw9bd4
ending: shipped
---
# ⌘-K did nothing on the Metadata page

**[SPIDERYARN-READING2-66](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-66)** · from an
admin (Greg), on `/read/dongetal25-spya-vfmvmm/metadata` · kind: problem. The time in the file name
is when this session picked the report up, not Sentry's First Seen, which this session could not
read (no Sentry sign-in on this account).

> The Cmd-k Command shortcut doesn't work in Metadata mode.

**Ending: Shipped** — on `dev`, not deployed. Resolve 66; the next feedback sweep does the Sentry
status write.

Why: it was deliberate. The command bar, its ⌘-K key and its Commands button were all switched off
wherever the bottom bar had no modes to switch, and the Metadata page is one of those places. The
reasoning was that a command would have nothing to do there. That was wrong: the bar on that page
already shows every mode as a link back to the article, and most of the command bar's other entries
are pages anyway.

What we did:

- **⌘-K / Ctrl-K and the Commands button now work on the Metadata page**, for the article's owner.
  Visitors to a shared article still get no command bar, anywhere.
- **Picking a mode there takes you back to the article in that mode**, the same place that mode's
  button in the bar goes. Like that button, it does not start anything on the way. So picking
  Glossary on an article with no glossary yet lands you on Glossary with its button to build one,
  rather than building it for you. Tweets, and some of Diagram's pictures, are the exception:
  they start their own work when they open, however you arrive.
- Library, Profile, the changelog, Feedback and the rest work there as they do in the article.

Plan: [260930a](../plans/260930a-cmd-k-on-metadata-page-and-full-wordmark-animations-on-the-shelf.md)
§ 66. If you would rather picking a mode from the Metadata page started it, as pressing the button
does inside the article, that is a one-line change. Say so.
