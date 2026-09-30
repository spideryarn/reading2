# Chat, comment and question answers, a little briefer

[SPIDERYARN-READING2-6X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6X), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Chat on
`pmc13013618-spya-uekgh6`. The time in the file name is when this session picked the report up. It
had no Sentry access and the report text came in the brief. **No `reports:` header**, because the
feedback row id was not in the brief. The next sweep adds it.

> Make a minimal tweak to the prompt for chat and comment responses and question responses etc to be
> a little bit briefer.

**Ending: Shipped.** On `dev`, not deployed. Resolve 6X; the next feedback sweep does the Sentry
status write.

What we did, measured in words per answer against two runs of the old prompts:

- **A comment's answer, a question on a selection, and the glossary's *Check the web*** are about
  **15% shorter** (274 → 233). They now aim for one or two short paragraphs, not two or three, and
  never more than three.
- **Chat is about 28% shorter** (365 → 262), and so is **the "?" in the gutter** (471 → 341). Chat
  ignored every change to its main instructions: it wrote fewer paragraphs and made each one longer.
  It now also gets a one-line reminder next to your question, with a soft budget of 300 words that
  gives way when you ask for more. A section-by-section summary still covers every section.
- **Remember mode is unchanged.** The same tweak there made no measurable difference, and its replies
  are already the shortest of the three (about 210 words), so it was reverted rather than shipped.

A blind judge preferred the new answers 9 to 6 (3 ties). The two points it found missing from new
answers are the same two that the old prompt drops when compared against itself.

Plan, both GPT Sol plan reviews, the code review and every number:
[260930g-briefer-chat-and-explain-answers.md](../plans/260930g-briefer-chat-and-explain-answers.md).

**Not done:** Remember briefer (the lever that worked on chat is named in the plan, if wanted).
