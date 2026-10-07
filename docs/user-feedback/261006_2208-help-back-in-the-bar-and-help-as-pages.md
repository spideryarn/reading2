---
reports: spya-ucftjt
ending: shipped
parts: 3
---
# Help back in the bar, and Help as many short pages with reader guides

SPIDERYARN-READING2-E9, from Greg (admin, proven by `scripts/feedback-reporter.ts` on the production
row), a suggestion, filed 2026-10-06 22:08 UTC on production from the reading view (Structure mode).
**Part 1 of 3**, Overseer queue item `qi-pvded3hd`. The other two parts are `qi-e6ksaejb` (a Help
chatbot for signed-out readers) and `qi-gjvvvc6n` (a guide agent when an article opens). Each has
its own session and its own note, so the report stays unresolved until all three have ended.

The words this part covers:

> I think in a previous message I suggested that you hide the help icon from the bottom bar. I'm
> second guessing that. Maybe it does make sense to keep it down there towards the bottom right. And
> I think as a larger point, the help page is really long. I wonder if it would make it more sense to
> break it up by modes and themes and stuff like that, with lots and lots of linking between. And
> maybe also try writing some documentations for example, sort of user personas or use cases. So if
> you're a reviewer, or if you're a beginner, or, you know, trying to learn a new topic, you know, a
> student, something like that. Or if you're an expert who's blah blah blah. … And that way the help
> page could sort of have a nice table of contents that'd be nicely structured so you could navigate
> around it as a user. … It strikes me that actually it might help if the help pages themselves were
> .md files that get turned into web pages, and then it would be easier probably to feed those in to
> the help chatbot.

**Ending: Shipped**, on `dev`. Plan
[261007e](../plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md).

- **Help is back in every bottom bar**, near the right-hand end before Feedback, opening the page
  for the mode you are in. Your bar and a visitor's.
- **`/help` is a contents page**: six groups, each page's title and a one-line summary. Each topic
  and each mode has a short page of its own (`/help/spine`, `/help/mode-glossary`), and the questions
  share `/help/questions`. Every page has the contents and search beside it, *See also*, and
  previous / next. Search now also finds a phrase from inside a page.
- **Four guides, under "Ways to read"**: *Your first article*, *Studying a topic*, *Reviewing a
  paper*, *Reading in your own field*. Each is a route through the other pages for one kind of
  reader, and states nothing those pages do not. They are a first draft of published words, and
  yours to rewrite.
- **The words are Markdown**, one file per page under `src/web/help/pages/`, ready for the chatbot
  part to read.
- **Old links still land**: `/help#spine` goes to `/help/spine`.
- The deploy step that keeps Help current still holds; `help-page.md` names the new files.

**One step back, deferred with its own queue entry:** search engines may list `/help` but not yet
the new pages under it, which are served with `noindex`. Listing them is a change to the page list,
`vercel.json`, `robots.txt` and the deploy's checks, and goes separately (`qi-d6btb5rp`).
