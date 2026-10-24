---
reports: spya-p8h7r3
ending: shipped
comment: On dev. Help's question box now grows as you type, so the whole question stays visible, and goes back to two lines when emptied. It is the same fit the Feedback, Quiz and Add boxes use.
---
# Help's question box grows with its words

Report #680 `spya-p8h7r3` (SPIDERYARN-READING2-NC), a suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda when
re-read before this note), filed 2026-10-23 22:26 UTC from `/help` (build `db758ed8`). Session
`fbp8h7r3-help-input-and-history`, with its sibling
[261023_2227](261023_2227-help-question-history-declined.md).

> The input box for when I ask a question doesn't seem to expand. It stays pretty small. I think it
> should get larger.

**Shipped.** Plan and both GPT Sol reviews:
[261024e](../plans/261024e-help-box-grows-with-its-words-and-a-costed-history.md).

- The box was a two-row textarea that scrolled inside itself. It now calls the shared
  `useFitTextarea` (`src/web/useFitTextarea.ts`), the hook the Feedback reply box, the Add page and
  Quiz already use: as tall as its words, two rows as the floor, never a scroller of its own, and no
  drag handle to fight the fit.
- Sol's plan review found the shared hook sized an empty box from its placeholder, which Chrome
  counts in `scrollHeight` (Chat's composer already guarded against it). Fixed in the hook, so an
  empty box sits at its rows in every caller.
- Test first: `tests/help-one-box.test.tsx` § grows with its words, red before both changes.
