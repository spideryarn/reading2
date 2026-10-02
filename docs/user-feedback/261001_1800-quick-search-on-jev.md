---
reports: spya-c77zuq
ending: shipped
---
# Quick search: a meaning search in about a second, on Jev

Report `spya-c77zuq`, a suggestion, from Greg (admin), 2026-10-01, relayed by the Overseer with no
Sentry mirror, on `https://www.spideryarn.com/changelog`:

> I really love the idea of our kind of search that can search by concepts or ideas or questions,
> but it's quite slow. And so I was wondering about using TypeSafe.ai's Jev model through OpenRouter
> to at least provide a quick version of it, even if it's not as powerful.
>
> So right now the search mode provides a whole bunch of metadata like confidence and maybe even some
> text as well. If all I wanted was a gore for each block for the degree to which it matches or
> something like that, I think Jev could do that and very quickly, at least up to 255 blocks.
>
> And maybe we could do it. We could call it multiple times for really long texts. So I'd like you to
> try and run some spikes and if it looks like it's working, well, I'm torn between trying to create
> a new mode or add a quick search bar versus adding it as a sort of toggle in the existing mode.
>
> And maybe the quick search bar would have a way to sort of save it, which would add it to the
> existing mode or it would automatically be saved. But then there'd be a way to say flesh this out
> with all the extra metadata. I'm not sure. So I guess why don't we just try and get the first
> version of it live and we can iterate on it afterwards.
>
> So try and get a V1 working that's fun to play with without too much complexity, assuming that
> we'll evolve the UI from there.
>
> Start with some Sonnet web research for background.

**Ending: Shipped**, on `dev`. Plan [261002e](../plans/261002e-quick-search-v1.md); spike
[261002o](../investigations/261002o-quick-search-spike.md).

Jev is real and is the model you meant: TypeSafe's decision model, `typesafe/jev-1.13` on
OpenRouter. The "255" you remembered is its limit on options for one pick-one question.

**What you get.** The Search box now has three choices: **words · ⚡ quick · meaning**.

- **Quick** asks Jev a yes/no question about every paragraph at once ("does this match what the
  reader is looking for?"). The paragraphs it is at least 70% sure of are marked, up to 20, best
  first.
- **Speed and cost.** About 0.4 s for a typical article and 0.6–0.9 s for a 540-paragraph one, sent
  in parallel chunks. Today's meaning search took 5–16 s on the same articles. A quick search costs
  roughly a hundredth as much.
- **Saving.** Quick searches are saved automatically into the same list, with a **quick** tag.
- **Flesh out.** The **flesh out** button on a quick row runs the full meaning search for the same
  words (quotes, reasons, the lot) as a new row, and unticks the quick one.

**How good it is.** It found about three quarters of what the full search finds. On a question like
"why do so many studies fail to replicate?" its top eight were all genuine answers the full search
had not picked.

Its limits:

- It marks whole paragraphs, not a phrase inside one.
- It gives no reason for a match.
- Scores wobble a little between identical searches.
- It can mix up a passage *about* something with one *against* it. For "things Claude should never
  do", the passage about Claude being over-cautious scored almost as high as the hard limits.

**Not done yet.**

- **Search as you type.** At under a second it is tempting, but every pause would save a row and
  spend a call.
- **A standalone quick bar** outside Search mode.

Both are natural next steps once you have played with this.
