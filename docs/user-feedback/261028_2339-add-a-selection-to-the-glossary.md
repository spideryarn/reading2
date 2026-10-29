---
reports: spya-turkg3
ending: shipped
---
# Add a selection to the glossary

Report `spya-turkg3` (#728, Sentry `SPIDERYARN-READING2-PX`), from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before acting and again before this note), a suggestion filed
2026-10-28 23:39 UTC on `arxiv-2308-08708-spya-xax6v4`, build `a3d0f98e`. Session
`fbga6m76-top-bar-select-to-glossary`, which also took `spya-ga6m76`
([its note](261028_2332-a-reminder-bar-at-the-top-while-you-scroll-back.md)).

> When I highlight a piece of text, it gives me the option to highlight or comment it. Okay, great.
> Can we also have the option to add it to the glossary?

**Ending: Shipped**, on `dev`, not deployed. Plan
[261029d](../plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md), Part 2,
with GPT Sol reviews of the plan and the code.

## What we did

- **On a touch screen, the chip under a selection has a second button, *Add to glossary***, below
  *Highlight or comment*. **With a mouse**, the box a selection opens has an *Add to glossary* link
  beside *Copy, don't highlight*; it takes the fresh highlight off again, as Copy does.
- **It does what *Look up "X"* in the command bar does**: if one glossary entry already names the
  words, it opens that entry; otherwise it opens Glossary and looks the words up there, and the
  finished answer adds the term to your glossary, marked *added by you*, underlined in the text,
  seen only by you. The definition is the one Glossary already writes for a term you add.
- **Offered only when it can work**: your own article, a glossary already made, and a selection
  short enough to be a term (80 characters). On an article with no glossary yet there is no button,
  because pressing it would have to generate a whole glossary first.

**Not checked end to end from the box**: the look-up is a model call, and the box's model key is
over its monthly limit until 1 November. Production's own key is unaffected. The tests drive the
whole path against a stubbed answer; a real look-up from a selection waits for the reset or the
deploy.
