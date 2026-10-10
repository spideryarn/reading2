---
reports: spya-pdpnjf, spya-fy05y6
ending: shipped
comment: Ask in chat now reopens the item's chat instead of starting another, the item shows the chat's summary in the button's place, and the button is the chat icon with a card. Quotes and Timeline are still queued.
---
# Ask in chat resumes its thread, shows one exists, and becomes an icon

Reports `spya-pdpnjf` (#526, SPIDERYARN-READING2-G6) and `spya-fy05y6` (#527, SPIDERYARN-READING2-G7),
Greg (admin, provenance proved by `feedback-reporter.ts`), 2026-10-09 23:06 UTC, filed from Sources ›
Bibliography on `arxiv-1706-03762`. Both quoted in full in the plan,
[261010s](../plans/261010s-ask-in-chat-resumes-its-thread-and-becomes-an-icon.md). In short:

> I tried clicking Ask in Chat again. I think for the same citation, and I'm 99% sure it somehow
> created a new chat rather than resuming the existing one for that citation. […] Can we get rid of
> the words Ask in Chat and just show the chat icon with a rich tooltip?

> I think I might have been accidentally looking at the wrong citation in the UI, so it may be that
> some of that is already implemented.

**What was there already.** #527 was right about half of it. The *Back to …* line in the chat and a
mark on the item (the number of questions and how the latest answer began) were built the day
before (plan 261009k). What was not: pressing Ask in chat on an item that already had a chat
started a second one. The test file even pinned that behaviour.

**Shipped**, to `dev`:

- **One chat per item.** Ask in chat on a Glossary entry, a cited work, an idea or a claim reopens
  that item's chat when it has one, from the row, the prose hover card or Skim's term chip, and sends
  nothing. Pressing it twice quickly, before the list has caught up, no longer makes two.
- **It shows that a chat exists, with a summary.** Once there is a chat, the item shows its mark in
  the button's place: the count, and the chat's **gist**, a one-line summary of what the
  conversation covered. A small model was already writing this after every answer for the AI's own
  use; it is now shown, at no extra cost. Until the first gist lands, the mark shows how the
  latest answer begins.
- **An icon with a rich card.** Ask in chat is Chat's two-bubble icon with a card saying what it
  does, on the rows and on the hover cards. On a phone, the first tap shows the card and the second
  sends.
- **The pattern is written down**: [chat-from-a-mode.md § One chat per item](../project/chat-from-a-mode.md#one-chat-per-item),
  and a line in [mode.md](../project/mode.md) as Greg asked.

**Other places that would benefit**: Quotes and Timeline, already queued as `qi-bd6h2fnd`. Not
built here. GPT Sol's review found them larger than they looked (a quote hidden by the threshold
needs revealing, Timeline rows have nothing to scroll to), and their migration edits the same two
database checks as the contract migration queued from plan 261009w (`qi-mzfxw3q2`). Sol's three
findings are in the plan's § Stage 2 for that session. FAQ waits on ids that survive a re-run.

**Left over:** the Help pages' Glossary and Sources screenshots still show the old labelled button
and want reshooting at the next help-page pass.

Checks: a red-first test for each of the three behaviours, GPT Sol's plan and code reviews (its
code review fixed a second Claims list that still drew both controls, phantom chats after a refused
first send, and touch), and a browser pass on the box (Bibliography and the hover card, desktop and
390px; screenshots `261010s-shot-*.png` beside the plan).
