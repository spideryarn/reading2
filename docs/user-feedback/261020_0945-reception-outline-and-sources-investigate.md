---
reports: spya-dk4tfq
addenda: spya-x4xpw4
ending: shipped
comment: On dev. Reception opens as an outline: the AI's key sources and themes folded, Every page open with two-line rows. New Sources › Investigate: suggested questions and your own, each sent to Chat with a web search.
---
# Reception as an outline, and Sources › Investigate

Report `spya-dk4tfq` (#645, SPIDERYARN-READING2-M8), a suggestion from Greg with one addendum,
`spya-x4xpw4`. `feedback-reporter.ts` exited 0 on it, and there were no further addenda when I
re-read it before writing this note. Overseer queue item `qi-a4538kz9`, session
`fbdk4tfq-reception-layout`. The plan, both of GPT Sol's reviews and the reasoning are in
[261020n](../plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md).

> The Reception sub-mode UI is really confusing - I can't tell what's what.
>
> Perhaps start with things default-collapsed, so it's easier to see the grouping/hierarchy/relationships?
>
> Look at screenshots. Ask subagents to pretend to be naive users with different goals, and others to
> be product/UI experts, and try and improve it.

> As well as trying to improve the UI, let's also add a new Chat sub-mode to the Sources mode (pick a
> name for it) for basically doing lots of searching …

**Shipped, in two stages.**

**The layout.** Five readers looked at the screenshots: a student, a journalist, a researcher, an
information-architecture designer and a visual designer. They agreed on the cause. The AI's
"threads" looked like a table of contents, but they were filters the list ignored. And every row
was eight lines of the same shape.

Reception now opens as an outline:
- **A frame labelled as the AI's**, with Key sources and each theme as folded sections, each
  showing its count and gist.
- **Every page**, open, with every row. The title-only rows are still listed under their own
  heading, so nothing is hidden behind a press.
- **Cited by**, folded, with its count.

A row is two lines until opened: the title, then the site, the year and one AI word, such as
*disputes it*. The quotation and the AI's reading are one press away. The LINKS / NAMES THIS PIECE
chip is gone, because three of the five readers read it as a verdict.

**The chat sub-mode is called Investigate.** I built it as *Ask*, but a chip with that label took
the command bar's word `ask` away from Chat. It offers:
- five suggested questions;
- up to four of the article's claims (once Claims has listed them);
- the three cited works the piece leans on most;
- a box for your own question;
- *Your questions*, the chats you have started from it.

Each press opens Chat with the question sent and a web search asked for. Reception's angle box
moved here. The tailored rows come from lists the article already has, so there is no extra model
call.

**Deferred, each with its own queue entry:**
- `qi-sfdqyewd`: open the conversation beside Sources rather than in Chat's band.
- `qi-vzwgzqnf`: a browser pass on your Tinbergen article once deployed. The local passes used
  synthetic rows, because no local article has a rich Reception.

Commits: the plan `455ba1957`, Stage 1 `9db351ec8`, Stage 2 `199fc6dfc`.
