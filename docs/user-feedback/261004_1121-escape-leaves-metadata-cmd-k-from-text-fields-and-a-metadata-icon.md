---
reports: spya-ynx97n, spya-szdjek, spya-jt4gmg
ending: shipped
---
# Escape leaves Metadata, ⌘-K from inside a text box, and Metadata's own icon

Three reports from Greg (admin; the feedback sweep ran `feedback-reporter.ts` on each, exit 0),
filed 2026-10-04 from `openai-huggingface`, the first at 11:21 UTC. Queue item `qi-dkd9cq76`. The
words are from the reports' production rows.

SPIDERYARN-READING2-CC (`spya-ynx97n`), from the Metadata page:

> If I hit escape while in metadata mode, sort of hide the metadata mode, as if I'd clicked on the
> metadata mode button to take me back to wherever I was before.

SPIDERYARN-READING2-CD (`spya-szdjek`), from Search mode:

> The Command-K keyboard shortcut for the command bar doesn't seem to work when the focus is already
> on the search mode input box. I don't know if this is true of other input boxes, but I want to be
> able to hit Command-K at more or less any time from within the reading view.

SPIDERYARN-READING2-CF (`spya-jt4gmg`), from Timeline mode:

> Can we look for a different icon in the bottom bar for metadata mode? Because that information
> icon is the same one we use elsewhere for information about a mode, and I think they are
> different, and so it's a bit confusing to use the same icon for both.

**Ending: Shipped**, all three. On `dev`, not deployed. Resolve CC, CD and CF; the next feedback
sweep does the Sentry status write.

What we did:

- **Escape on the Metadata page takes you back to the article**, to the same place and mode the
  Metadata button would. If you are typing in a box on that page, or a card or dialog is open in
  front, Escape belongs to that instead and you stay on the page.
- **⌘-K (Ctrl-K) opens the command bar while you are typing in a box**: Search, the quick search in
  the bar, chat, a comment. What you typed is still there when you close the bar, and the press
  does nothing else to the box. Title editing keeps the chord, because opening the bar would
  save the title on blur; on a Mac, a text box also keeps Ctrl-K as its own editing key.
  The command bar stands down while another native dialog is open, including Feedback or a
  full-screen picture, to avoid stacking dialogs.
- **The Metadata button is a document with a cog**, not the (i). The (i) now means only "about
  this". The button has not moved.

Plan: [261004h](../plans/261004h-escape-leaves-metadata-cmd-k-from-inside-text-fields-and-a-metadata-icon-of-its-own.md).
