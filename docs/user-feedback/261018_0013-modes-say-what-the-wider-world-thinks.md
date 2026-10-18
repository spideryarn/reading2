---
reports: spya-h5mteu
ending: shipped
comment: Chat, Recall, Tutorial and Quiz now say when the article is wrong or disputed, in a separate sentence marked as from memory or with a link. Live and Explain are queued to get the same.
---
# Modes say what the wider world thinks, labelled

`spya-h5mteu` (#604, suggestion, Sentry SPIDERYARN-READING2-JV), from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row, no addenda). Filed 2026-10-18 00:13 UTC from
Quiz on `rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`. Queue item `qi-q23f2m47`.
This session ran on a pool account with no Sentry sign-in and did not write the Sentry status;
the next sweep does.

> Okay, so this is a point that spans multiple modes. There's been a few cases where the modes have
> said, This is what the article says, and restricted their commentary or their responses to what is
> in the article. Well, on the one hand, I really, really appreciate that. That's what we're trying
> to do here. On the other hand, I'm also keen to sort of situate the article in terms of the wider
> world. And if the article is wrong or if there's disagreement, I also want to be aware of that.
> Now, it may be that the AI, from its pre-training, already knows that things aren't so simple, or
> even that the article is incorrect. Or it may be that it needs to do a web search and that it
> kicks that off more often than it currently does. Either way, I do want to distinguish between
> what is in the article versus what's in the pre-training versus what's in the web search. But I
> don't want to restrict it into black and white away to what's in the article.

**Ending: shipped** on `dev`. Plan
[261018h](../plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md); measurement
[261018c](../investigations/261018c-modes-say-when-the-piece-is-wrong.md).

- **What changed.** One shared prompt section, `widerWorld()` in `src/wider-world.ts`, is now in
  Chat, Recall, Tutorial and Quiz marking. These four answer or mark the reader and otherwise keep
  to the article.
  - **When it speaks up:** unasked, but only when a checkable fact in the piece is wrong, or when a
    consensus or live dispute bears on a central claim.
  - **How it labels the three sources:** the article's words carry their passage chip, the model's
    own knowledge is said to be from memory, and a web search is linked.
  - **What it never does:** use the outside view against a reader who read the piece right.
  - **Search:** Recall and Tutorial may now search to check a point they already doubt. They still
    never go looking for objections, and never put the reader's words in a query.
- **What it did.** The committed eval article dates the Antikythera mechanism to "2,000 BCE"; the
  usual dating is about 150–100 BCE. Before the change only Chat said so. Now all four do, each in
  a labelled sentence. No outside note was added to a passage that needed none.
- **Deferred, each queued:** Live conversation (`qi-6rmzd7xs`), Explain (`qi-5ehbcza5`), and a
  visible mark for outside sentences if words prove not enough (`qi-jfwgfa29`). Summary, FAQ and
  Glossary stay closed by design. The Marginalia report `spya-w99qsz` can build on the same section.
