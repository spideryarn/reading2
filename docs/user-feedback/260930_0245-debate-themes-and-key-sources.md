---
reports: spya-r5gks8
ending: shipped
---
# Debate picks out the themes its sources share, and the key sources

SPIDERYARN-READING2-6M (`spya-r5gks8`), from Greg (admin), 2026-09-30 02:45 UTC, a suggestion sent
from the landing page.

> In Debate mode, I wonder if there's a way to somehow highlight key themes from other people and
> commentary and whatever, and key nodes, i.e. the critical papers that really responded or moved
> things forward or take a different view or whatever.
>
> (I might have already suggested this)

**Ending: Shipped** — on `dev`, not deployed. Resolve 6M; the next feedback sweep does the Sentry
status write.

**Not a repeat, though close to 5P.** 5P ([260929h](../plans/260929h-debate-mode-clearer-sources-and-orders.md))
gave Debate its orders: *by claim* groups sources under the article's own sentences, *stance* puts
critical ones first, *prioritised* orders by relevance. None of those says what the *sources* have
in common, or which of them matter most. That is the part built here.

What changed:

- **A "Threads across these sources" box above the list.** It holds up to four themes that at least
  two different works pick up, each with a label and one plain sentence, and a **Key sources**
  button. Press one and the list narrows to those sources (`?debatethread=`, so it survives a
  reload). Press it again, or *show all*, to clear it.
- **Key sources are marked on their rows**: *"Key source · takes a different view"*, then a
  sentence saying why. The four reasons are your three (*takes it on*, *moves it forward*, *takes a
  different view*) and a fourth, *where the claim comes from*, added because the model kept filing
  the original study behind a claim as a reply to it. About one key source per three works, so it
  stays a pick.
- **How:** one more AI call after the two searches, with no search of its own, over the sources the
  searches kept. It can only point at those sources, and code checks every pointer. It adds about
  ten seconds and a cent or two to a debate's ~$0.25. If it fails, the list is kept and one quiet
  line says the threads could not be made.
- **Your existing debates need a re-run** from Metadata to get threads, as with 5P.

Measured on nine of production's stored debates, read-only, and one real local run. Two GPT Sol
reviews, of the plan and of the code. The plan, the numbers and the screenshots are in
[260930j](../plans/260930j-debate-themes-and-key-sources.md).

Left for you:

- **Visitors don't see threads.** The public article view is a security boundary, and an
  unattended run does not widen it. It would be one field, re-checked the way the panel already
  re-checks it.
- **"Key nodes" had a second reading that this does not cover:** the landmark papers of the field,
  whether or not the search found them. That would be a new paid search whose importance claims
  cannot be checked against a page. Deferred in the plan.
- The debates are small (3–6 sources on every stored one), so the box is often one theme and one
  key source. That is the searches' limit, not this step's.

## Follow-up, 2026-10-01: visitors

**Visitors now see the threads and key sources**, with one exception. If the public boundary held back any of the debate's sources (one with a password or a private address in its link), a visitor gets no threads at all. The threads were written with every source in view, so one could describe a source the visitor is not shown. Greg approved widening the public DTO (a listed defence), relayed by the Overseer. Shipped in `6c1b2cd2`, with GPT Sol's code-review fixes in `7431f0fd`. Plan: [261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md).
