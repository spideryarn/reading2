---
reports: spya-rntjxu
ending: awaiting
---
# Fuller is hard to follow: write it for someone who has not read the piece

`spya-rntjxu`, from Greg (admin; `feedback-reporter.ts` exit 0, by the sweep), filed 2026-10-05
07:42 UTC from Summary's Fuller view of `2605-20355v1-spya-ygtwkz`. SPIDERYARN-READING2-DE;
Overseer queue item `qi-b5g9a55h`. This session has no Sentry sign-in and did not write the Sentry
status; the next feedback sweep does.

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> Use Sonnet for web research on what makes for a really good summary, and tweak the prompts
> accordingly.

**Ending: Awaiting Greg.** Nothing a reader sees has changed. The one thing needed from Greg is
room on the box's OpenRouter key.

What we did:

- **The research is done**, by a Sonnet subagent:
  [261005c](../research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md).
  Every guide it found asks for a summary that stands on its own, with each term said in everyday
  words where it first appears. It found no evidence that telling a writer "the reader has not read
  this" is enough by itself, so the prompt change is a list of things to check.
- **The prompt change is written and reviewed, and is not on `dev`.** Fuller gains a section,
  "Written for someone who has not read the piece", and a paragraph saying the reader's stated
  background does not cover the terms the piece itself introduces. Brief is unchanged. The plan,
  with the wording and GPT Sol's review of it, is
  [261005h](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md).
- **It has not been measured, which is why it is not shipped.** Every paid model call from the box
  goes through one OpenRouter key, and that key had spent its $300 monthly limit before the first
  summary was written (checked four times between 12:25 and 14:38 BST: limit 300, remaining 0).
  The eval is built and waiting; it would cost about $7. The plan's § What is blocking it says how
  to pick it up, in the worktree `fbrntjxu-fuller-summary-for-new-reader`, where the prompt edit
  is committed.
