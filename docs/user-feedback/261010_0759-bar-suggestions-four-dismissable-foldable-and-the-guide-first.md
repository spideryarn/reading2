---
reports: spya-yf23zk, spya-xasbd3
ending: shipped
comment: The bar shows at most four suggestions, each can be dismissed for good with × or Delete, the list folds to one line, and Guide is the first row of all.
---

# The bar's suggestions: four at most, dismissable, foldable, and the Guide first

Two admin suggestions from Greg, 2026-10-10, both from the Landscape of Consciousness article
(`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`, build `29220e7d`), both about the
command bar's *Suggest what to do here*. Admin provenance proved by `feedback-reporter.ts` (exit 0 on
both). Queue item `qi-na7p6xy4`.

Report #542, `spya-yf23zk` (SPIDERYARN-READING2-GQ, 07:59 UTC, `?mode=ideas`):

> I clicked suggest what to do here in the command bar, and it added some useful suggestions. I
> think three or four should probably be enough. I don't know. It should be possible to dismiss some
> of them so that they don't come up again if they're not helpful. And it should also be possible to
> collapse them as well. Once they'd been added, they seem to stay, and then they kind of pushed
> everything else down.

Report #543, `spya-xasbd3` (SPIDERYARN-READING2-GR, 08:00 UTC, `?mode=summary`):

> And following up from my last feedback report, I quite like these suggest what to do here
> suggestions in the command bar, but I still want an easy way to get to the guide chat, somewhere
> near the top of the command bar.

**Shipped** as
[261010u](../plans/261010u-bar-suggestions-capped-dismissable-collapsible-and-the-guide-at-the-top.md):

- **At most four**, taken in turn (a search, a mode, the question for chat, a search) so the cap
  never costs the list its mode or its question. The model may still write six; a dismissed one
  makes room for the next.
- **Dismiss for good**: the × on a suggested row, or <kbd>Delete</kbd> with it highlighted. The bar
  says so in its status line, and puts the row back if the save fails.
- **Fold**: *From why you're reading* is now a row that folds the list to its one line and opens it
  again. Folded is remembered in this browser (`localStorage`, `spya.cmdbarSuggestions.folded`), a
  device convenience, not a fact the server keeps.
- **Less height**: a suggested search lost its description line, which repeated its label. The
  question for chat keeps its line, because that is the one saying nothing is sent until you press
  Send.
- **Guide first**: on an empty box *Guide* is the first row of all, above the suggestions.

**Where a dismissal is stored, as asked.** A new table, `command_suggestion_dismissals`: one row per
article, holding the fingerprint of the profile the list was written from and up to 50 hashes, one
per dismissed suggestion. **Hashes, never the words**: the words are written from the reader's
profile and would otherwise outlive an edit of it. It is **per article and per profile**: editing
*About you* or the reason for reading clears the slate, as it already threw the list away. Nothing
about a dismissal is sent to the model, so a reworded version of a dismissed search can come back;
that was chosen over sending profile-derived text to the model a second time (GPT Sol, plan review
F2). No undo and no page listing them in v1. The article's export carries them, and deleting the
article deletes them. The reasoning lives in
[reader-profile.md § The command bar's suggestions](../project/reader-profile.md#the-command-bars-suggestions-the-one-exception).

**The guide half overlaps `spya-q3pzyn`** (queue `qi-dp2tphkd`, session
`fbq3pzyn-guide-in-command-bar`, not started yet), which also asks for a clearer name and one guide
icon everywhere. Only the placement was built here; the name and the icon stay that session's.
