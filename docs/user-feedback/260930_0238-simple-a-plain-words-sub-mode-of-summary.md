---
reports: spya-ka7ysy
ending: shipped
---
# Simple: a plain-words sub-mode of Summary

SPIDERYARN-READING2-6E (`spya-ka7ysy`, the row id read from production's `feedback` table,
read-only), from Greg (admin: `scripts/feedback-reporter.ts` exits 0 for the issue's user id), on
`/read/dongetal25-spya-vfmvmm?mode=trajectory`. The time in the file name is when he sent it (01:38Z).
The session had no Sentry sign-in, so the report text came in the brief.

> Add a sort of sub mode to the summary mode for something like, explain it to me like I'm 12 or 15.
> I'm not sure quite what the level is. You could call the sub mode simple, or even just ELI12 with a
> tooltip. And I guess the idea is that it would give a summary of, at most, I suppose, a few short
> paragraphs using simple language, kind of minimizing jargon, or if it uses jargon, very sparingly
> and with a clear explanation. It just helps the reader orient, like, okay, what is this about and
> why is it important, and what are the key ideas or whatever. You basically provide a short, really
> digestible summary. And maybe actually we include an ELI12 and an ELI15 or something, where one is
> shorter and simpler, and the other is just a little bit longer and just allows itself just a little
> bit more of the complexity. But in both cases, try and use clear language.

**Ending: Shipped.** On `dev`, not deployed. Resolve 6E. The next feedback sweep does the Sentry
status write.

What we did:

- **Summary mode has a `Gists | Simple` switch.** Simple is two to four short paragraphs in everyday
  words: what the piece is about, why it matters, its key ideas. Its tooltip says it is pitched at a
  curious 15-year-old.
- **Every paragraph links back to the passages it rests on**, with the same hover-and-jump chips as
  the rest of Summary. A paragraph the model could not tie to a passage is thrown away.
- **It is made the first time you press Simple**, about 11 seconds, and kept, so later visits are
  instant. A visitor to a public article sees one that has been made.

Choices Greg can overturn:

- **One level, ELI15, not two.** ELI12 is deferred until you have read ELI15 on a real paper. The
  probe ran ELI12 on three articles for comparison, and the outputs are in
  [evals/simple/results-260930.md](../../evals/simple/results-260930.md).
- **It does not stream.** You wait about 11 seconds behind a progress line the first time. Streaming
  and storing would need a second path beside the job; the plan explains why, and asks whether that
  wait is fine.

Plan: [260930i](../plans/260930i-simple-summaries-eli15-sub-mode.md).
