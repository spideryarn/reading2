---
reports: spya-f6dpj5
ending: shipped
---

# A question in the margin says its title twice

A suggestion from Greg (admin, relayed by the Overseer with the report's row), 2026-10-04 17:00 UTC,
on `bitterlesson-spya-pbag4p`, `?mode=structure&margin=1`. Queue item `qi-9gtawaxd`.

`spya-f6dpj5`:

> In the Marginalia mode for a question-on-a-block, it says "question about this paragraph" collapsed. Ok, so I clicked on that, and then it says "question about this paragraph" again underneath when expanded.

**Shipped**, in
[261004k](../plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md) § 7. A lone question's
line, opened, now shows only *Open the conversation*; the line above it already shows its words in
full once open. A line holding several comments and questions still gives each its own heading,
because that is how they are told apart.

The test is in `tests/marginalia-shut-notes.test.tsx`, seen red first. The browser check's
screenshot is [261004k-shot-8](../plans/261004k-shot-8-lone-question-opened.png).
