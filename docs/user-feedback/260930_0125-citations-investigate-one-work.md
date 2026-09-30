---
reports: spya-wtm6qx
ending: shipped
---
# Citations: an *Investigate* button for one cited work, on demand

SPIDERYARN-READING2-5Q (`spya-wtm6qx`), from Greg (admin, verified by
`scripts/feedback-reporter.ts`, exit 0), sent from Citations mode on `9689-full-spya-m43th2`. The
time in the file name is when this session picked the report up; it had no Sentry access, and the
report text came in the brief.

> Re Citations mode:
> - In previous Feedback, I had suggested that it should search the web and provide extra information
>   about whether the cited paper corroborates the claims and how else it relates to the current paper
>   (with an addendum based on the User Profile and "Why you're reading this one" information).
> - That would still be ideal, but it's probably too expensive to do for every single paper. Perhaps
>   instead, in a citation-item in Citations mode, provide an "Investigate" button that triggers this
>   deeper dive, i.e. don't do it automatically for every single paper every time we run Citations
>   mode.

It follows [5G](260929_1835-citations-say-whether-we-read-the-paper.md), which was already on `dev`
when this started, so this was built on top of it.

**Ending: Shipped.** On `dev`, not deployed. Resolve 5Q; the next feedback sweep does the Sentry
status write.

What we did:

- Every row the reader owns now has **Investigate** beside *Look it up*. One press gives one answer
  that streams in and is kept on the row. It runs a few web searches and covers: *does it back the
  claim*, *how else it bears on this article*, and *for you* when the reader has written a profile
  or *why you're reading this one*. Nothing runs automatically. A press costs about 12¢ (15¢ at
  worst in the real runs), and each reader and the whole site have a daily limit.
- **5G's rule is kept.** Under the answer, code (not the AI) says what was read: how many search
  extracts, from which sites, and how long the longest was. It does not claim "we didn't read the
  paper", because one real extract was most of a PDF. It says whether *Look it up* had matched one
  of those pages to the work. If none was matched, it says we could not confirm any result is the
  work.
- **It never quotes a source.** Quoted words appear only once code has found them in the article or
  in *Look it up*'s checked quotes. Otherwise the answer is stopped and nothing is kept. Verbatim
  evidence stays with *Look it up*.

Two calls are left for Greg, listed in [awaiting-approval.md](awaiting-approval.md):

- whether to offer *Investigate* only after *Look it up* has identified the work;
- whether to build reading the paper itself (5G's proposed stage).

Plan: [260930a](../plans/260930a-citations-investigate-one-work-on-demand.md).
