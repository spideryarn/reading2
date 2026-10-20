---
id: q-je2p9y
report: spya-u8stc4
status: open
asked: 2026-10-20
title: Search marks already show on the spine — where did you not see them, and which other modes should paint it?
refs: qi-cz29kr96 · qi-bp4ez3yc · SPIDERYARN-READING2-KY · docs/plans/261020e-spine-card-explains-the-spine-and-keys-its-colours.md · docs/user-feedback/261020_0220-spine-card-key-and-search-on-the-spine.md
---
Search results already paint the spine and follow the threshold slider, so two questions: where were they missing for you, and which other modes should also paint it?

1. Where were the search marks missing? A one-line answer is enough: a chat answer's search button, a phone, Search mode itself, or somewhere else.
2. Which other modes should mark the spine? Pick any:
   A. Search buttons inside a chat answer. Their results would mark the spine while the chat is open. It needs a rule for several search cards in one conversation, for example the latest one only. (Recommended)
   B. Ideas and Timeline before you press a row. Today they mark only the row you pressed. This would mark every idea or event at once, in one colour, and still mark the pressed one more strongly. The article's own text would stay as it is.
   C. Glossary terms: where each term appears in the article.
   D. FAQ and Sources: the passages that answer a question, or that cite a work.
   E. None for now.

Details

You filed this on 2026-10-19 (spya-u8stc4), a minute after asking for the spine's card to explain the spine and its colours (spya-ah5ws6).

The explanation is built and on dev. Every spine card now ends in a short key: one sentence on what the spine is, then a small swatch for each kind of mark on the rail at that moment. When a search is on, the key shows a "search matches" swatch in each search's colour. Until now nothing on screen said what those marks were, which may be why they looked absent.

Search on the spine: Search mode has done this since 2026-08-26, with one narrow lane per search down the spine's right edge. On 2026-10-20 I checked it in a browser. Moving the Prioritised threshold to 30, 69, 88 and 92 left 20, 7, 4 and 1 results in the list, and the same 20, 7, 4 and 1 marks on the spine. That is by design, because the list, the highlights in the article and the spine all read the same filtered results. The quick-search box in the bottom bar opens Search mode, so it paints too.

What does not paint the spine today:
- A search started from a button in a chat answer. It shows its results inside the conversation and never reaches Search mode. If you were using chat, this is the likely gap, and A fixes it.
- Ideas and Timeline. They mark the spine only after you press a row, and then only that row's passages. B fills in the rest, but the spine would need its own list separate from the article's highlights, so it is a moderate change.
- Glossary, FAQ and Sources mark nothing on the spine or in the article. Each would be its own small piece of work.

Every option adds coloured marks to a 12px strip. More kinds at once make each harder to read, which is why I recommend only A for now.
