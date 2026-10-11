---
reports: none
ending: shipped
comment: Referee has a sixth chip, Notes: sort your own notes major or minor and copy them out in your words. Sorted notes stay on a shared link as before, as you chose (q-dkz7au, A).
---
# Referee › Notes: your own notes, sorted major and minor by you, copied out in your words

Not from a reader, so there is no Sentry id. Built from Greg's answer to
[q-fkq30v](questions/q-fkq30v.md) part 4 (reply `spya-dbfeqh`, 2026-10-10), Overseer queue item
`qi-5fn7stsv`, session `fbh5aypq-referee-notes-skeleton`:

> 4 all? Use your judgment based on that combination of ease and value.

This was idea D: *"Your own notes, sorted major and minor by you, taken out as a skeleton in your
words (Referee)."*

**Ending: Shipped**, to `dev`, not deployed. Plan
[261011f](../plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md), with GPT Sol on
the plan (BUILD WITH CHANGES, ten findings, nine taken) and on the code.

- **What a reviewer sees.** A sixth Referee chip, **Notes**, after Mirror. It lists every note of
  theirs with words on it, under *Not sorted yet*, *Major* and *Minor*, in reading order, each with
  the passage it is on and a jump to it. A Major / Minor pair sorts each note; pressing the lit one
  again un-sorts it. **Copy notes** puts plain text on the clipboard for a journal's form: a bare
  *Summary* heading, then *Major*, *Minor* and anything not sorted yet, numbered, each with
  `On: “the quote”`. Highlights and bookmarks with nothing written are counted and left out.
- **Why it is not the report scaffold you ruled out on 2026-08-31.** Only the reviewer's words go
  out: the code that builds the text cannot read a model's answer on a comment, and no AI writes,
  suggests or sorts anything. There is no sentence of ours in the copied text, not even under an
  empty heading.
- **Underneath.** A `severity` column on comments (major, minor or empty) with a time stamp, set
  only by its own request. Help pages updated.

**For Greg:** [q-dkz7au](questions/q-dkz7au.md). A note on no criterion still goes out on a shared
link after it is sorted (the word Major or Minor never does). Should sorting keep it off, like a
criterion note? The query that decides that is a security defence, so it was not changed without
you. Recommended: yes. GPT Sol rated this P0 and would not land without it; Opus, asked to arbitrate,
found nothing in this change that makes anything public that was not public before, and said land
it with the question open, **answered before a deploy carries Notes**.

**Not built, on purpose:** sorting from inside the comment box. One place to sort, at the moment of
writing up, is the simpler version; it is the next step if a reviewer asks for it.
