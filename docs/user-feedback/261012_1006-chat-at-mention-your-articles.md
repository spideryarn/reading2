---
reports: spya-a63vmt
ending: shipped
comment: Shipped. In Chat, type @ to bring in one of your own articles, archived and public included; citations of it open it at the passage. Other people's articles are not included.
---

# Chat: @-mention another of your articles

Report `spya-a63vmt` (#578, `SPIDERYARN-READING2-HX`), from Greg. It is an admin's report, proven
by `feedback-reporter.ts` (exit 0). Queue item `qi-c8vnqatv`, which also carried his reply
`spya-zake3w` to [q-jzx20h](questions/q-jzx20h.md) (chat attachments).

> I'd like to be able to @-mention another article in my shelf (including archived and public etc)
> from within a Chat. Look for whether a 3rd-party library (see third-party-library-selection.md)
> would make this easier/better. Then I guess it would have to include that article into the Chat
> context.
>
> — Greg, via Feedback, 2026-10-12 10:06 UTC, from a Search-mode page

**Shipped**, on `dev`; it reaches readers at the next deploy. What was built:

- In typed Chat, `@` opens a list of the reader's own articles, from the shelf and the archive.
  Picking one adds it to the question, and from then on it is in that conversation **whole**. A
  line at the top says so.
- Citations of its passages are buttons that open it at the passage.
- At most three articles in a conversation, each up to 120,000 characters (4% of production's
  articles are longer). Over the limit is a refusal that keeps the draft.

The library question: no library. Tiptap and Lexical would replace the text box, and react-mentions
brings its own markup. The repo's own combobox (`TagEditor`) was copied instead. Ariakit is the
named fallback if phones or screen readers struggle.

**Not done:**

- **Other people's public articles.** "public" was read as the reader's own public articles, and
  the question asks Greg whether he meant others'.
- **The guide, Learn and the other chat kinds.**
- **Reading an over-long article in parts.**

The plan, the reviews and the measurements are in
[261012d](../plans/261012d-chat-at-mention-your-own-articles.md).
