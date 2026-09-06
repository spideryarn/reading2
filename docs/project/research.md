# Research docs

`docs/research/` holds **the working behind a decision**: the options weighed, the sources, the dead
ends. A plan says what we're doing; a research doc says what else we could have done and why not, so
that reopening the question later costs an hour rather than a week.

**How to write one is [write-deep-dive-as-doc.md](../reusable/write-deep-dive-as-doc.md)**, and
[third-party-library-selection.md](../reusable/third-party-library-selection.md) when the question is
which dependency to take.

## Naming

The same convention as a planning doc — `yyMMdd<letter>-kebab-description.md`, from
`npx tsx scripts/plan-name.ts --dir=research "<topic>"`.
[write-planning-doc.md § File naming conventions](../reusable/write-planning-doc.md#file-naming-conventions).

## A few principles

- **Every fact carries its source and its date.** A research doc ages faster than anything else here,
  and the reader six weeks later needs to know whether to believe it. Record the URL, when you
  fetched it, and how confident you were — [why](../research/260903b-facts-that-were-wrong.md).
- **A number is a dated example, not a fact.** Record the command and the scope that produced it, so
  the next reader can re-run it instead of trusting it.
- **Write down the dead ends.** The option you rejected in ten minutes is the one somebody will
  otherwise spend a day rediscovering. That is most of the value of the directory.
- **It is not where the decision lives.** When the research settles something, the decision goes in
  the plan and then in the `docs/project/` doc that owns it; the research doc keeps the working.

## See also

- [plans.md](plans.md) · [postmortems.md](postmortems.md) · [tutorials.md](tutorials.md)
- [open-questions.md](open-questions.md) — the calls nobody has made yet. A research doc is often
  what turns one of those into an answer.

---

Up: [vision.md](vision.md)
