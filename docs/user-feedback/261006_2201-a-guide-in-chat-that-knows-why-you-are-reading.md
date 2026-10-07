---
reports: spya-tddvg2, spya-kfjrzv
ending: shipped
---
# A guide in Chat that knows why you are reading, and the command bar as a door to it

`spya-tddvg2` (SPIDERYARN-READING2-E7, filed 2026-10-06 22:01 UTC from `/changelog`) and
`spya-kfjrzv` (SPIDERYARN-READING2-EA, 22:12 UTC, from an article), both from Greg (admin;
`scripts/feedback-reporter.ts` exited 0 on each production row). The guide-agent third of
`spya-ucftjt` has [its own note](261006_2208-the-guide-agent-part-3.md). Overseer queue item
`qi-gjvvvc6n`. This session did not write the Sentry status; the next sweep does.

> perhaps instead of flashing it up as a modal, we could kick off a chat in the left-hand sidebar
> and think of it as a chat less about the content and more about the reading experience. So more
> about a guide for the user about how to use Spideryarn and how to make the most of its features
> and also how to read this article given their needs. […] Pretty much anything that you can do in
> the UI, it has a tool for. […] how many articles they've already read. Because if the answer is
> zero, then it should probably be more kind of an introductory user guide. […] tutorial and
> explore, if they don't already, should take into account the user's profile and why they're
> reading it.
>
> — Greg, `spya-tddvg2` (abridged; the plan quotes more)

> the command bar, you could think of it as the guide agent. […] reusing a lot of the same
> machinery and maybe even more or less identical. […] let's look for the, you know, 80-20, rather
> than bending over backwards trying to meet the letter of the suggestion
>
> — Greg, `spya-kfjrzv` (abridged)

**Ending: Shipped**, the 80/20, on `dev`, not deployed. The plan is
[261007j](../plans/261007j-the-guide-a-conversation-about-how-to-read-this.md).

- **The guide**: one conversation per article, pinned at the top of Chat's list, about how to read
  this piece rather than what it says. It knows your *About you*, your reason for reading, and
  roughly how many other articles you have opened (none, a few, many), and pitches the
  introduction to that. Its greeting is ours and free, and holds the "why you're reading this" box
  itself, so you can answer there.
- **Its tools** are the article's own, and **buttons** you press: open any mode or sub-mode you can
  see, quick search, and chat's existing ones (find, glossary, tags, bookmark). Chat gets the two
  new buttons too. Nothing runs without your press.
- **First open from the add page with no reason given** now opens the guide in the left band
  instead of the modal, where a band fits; on a phone the modal stays.
- **The command bar**: when the fast pick cannot tell what a sentence meant, a row *Ask the guide:
  "…"* sends it there. The fast pick still goes first.
- **Tutorial and Explore already took your profile and reason for reading into account** (every
  conversation kind is sent both, each turn); nothing to change.
- Measured: [261007a](../investigations/261007a-the-guide-prompt-first-measurement.md).

**Deferred, each with its own queue entry**: the guide acting without a press (`qi-kc47m5pw`;
question `q-tyvutf`); the guide as the first band on every first open, or speaking first
(`qi-yfa6gs7m`; question `q-kgrhm4`); the Help pages in its prompt once 261007e lands
(`qi-7cgxpdda`); one agent behind the whole bar (`qi-263b6cpp`).

One more question, about wording a rule doc: `q-jb5cnd` (security-map.md's two new rows).
