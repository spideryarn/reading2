---
reports: spya-qmev0s
ending: shipped
---
# Your own tags on articles: on the shelf, on Metadata, and as a filter

Report `spya-qmev0s`, a suggestion, from Greg (admin), 2026-10-01, relayed by the Overseer as queue
item `qi-aq9x8k9h`, on `https://www.spideryarn.com/`:

> In non-logged-in homepage shelf, add a way for me to easily add/edit my own tags to an article
> (with a nice combo-dropdown that enables me to type and/or select).
>
> These tags should be part of the topics-pill faceted-filtering interface for the Library shelf so
> I can filter by one or more etc.
>
> Also add this near the top of the article's Metadata page, reusing machinery.
>
> If you have ideas for how to improve/build on this, go for it. But avoid introducing too much
> complexity for the v1.

**Ending: Shipped**, on `dev`. Plan
[261003d](../plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md), with
GPT Sol's plan and code reviews and the browser screenshots; the reader-facing account is
[library.md § Your own tags](../project/library.md#your-own-tags).

What changed:

- **On a shelf card** (and at the end of a table row's grey line), a small **Tag** button beside the
  chips opens a type-or-select box: type a new tag, or pick one you already use, with Enter or a comma.
  Backspace in the empty box takes the last one off. The card shows its tags as chips.
- **Near the top of Metadata**, under the title, the same box.
- **A Tags row above Topics** on the shelf: choose one or more tags, alone or with topics, and the
  shelf narrows to articles with all of them. `?tags=` in the address, so it is a link.
- Tags are **private** (no public page or listing carries them), in both exports, and stored
  **lowercase**: `AI` and `ai` are one tag. That was the simpler of two ways to keep one spelling per
  tag; the other was a vocabulary table, which would have kept your capitals.

"Non-logged-in homepage shelf" was read as the homepage shelf: tags are your own, so a signed-out
visitor has none to edit.

**Deferred, with its own queue entry:** the command bar's "add a tag of X" (`qi-qkjnkwce`) — the
write it needs is built and shared. Also not built: renaming or deleting a tag across every article,
and clicking a tag on a card to filter by it.
