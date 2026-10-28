---
reports: spya-nkq6rj
ending: awaiting
comment: Explanations of confusing passages are built behind the experimental switch, untried until the AI key resets on 1 Nov. Two questions for you: run them on every import (~10-15¢), and should Sources' search start by itself?
---
# Explanations of confusing passages in the margin, and Sources feeding it

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-28 10:24 UTC, filed from the margin on LeCun's
*A Path Towards Autonomous Machine Intelligence* (`10356-a-path-towards-autonomous-mach-spya-jwqnrf`).
Sentry event 4c7bc62d09814d61ae03c88a3ec30329. Session `fbnkq6rj-marginalia-explanations`. No
addenda when re-read before acting and before this note.

> Basically I would just like to lean into that. So I think ideally sources would run more
> proactively, require fewer options from the user, and populate the marginalia mode more.
>
> … So actually what I'd love is if it did it proactively, in much the same way that the glossary
> is proactive. There's just a little underlying waiting for me.
>
> And so one way to figure out what's confusing might be to run a small model like Haiku on the
> whole article and ask it what it finds confusing, and then use our bigger model, perhaps Opus, to
> generate short explanations for each of the confusing sections to the extent that you can. And if
> Opus is unsure itself, it should say so. And there should be an option to sort of, you know, ask
> in chat for more information. I suppose it should be allowed to search the web if that will help,
> but it should be clear if some of its responses are based on stuff that came from out the
> article.
>
> … Model the UI for it on the glossary mode, and perhaps put it as a mode within the more three
> dots. … and probably that explanation mode should run automatically on for all new articles. And
> I guess you should take into account readers' backgrounds, etc.

(Full text: `npx tsx scripts/feedback-unswept.ts --show spya-nkq6rj`.)

**Ending: Awaiting Greg**, on two questions, with the clear-cut half built and on `dev`. Plan
[261028c](../plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md),
with GPT Sol's plan review and both code reviews beside it.

**Explanations (the second idea): built, experimental, not yet tried.** A mode under *More* after
Glossary and a shut *Explained* line in the margin beside each passage: the few places a reader
would get stuck, each with up to 60 words of the missing piece, written for the reader's profile,
labelled *Not sure* and *Draws on AI memory, unchecked* where they apply, with *Ask in chat*.
Behind the experimental switch, owner-only, written when the owner presses into the mode. One AI
call, not the Haiku-then-Opus pair, until the pair beats it on real articles; no web search inside
it yet; the underline in the prose is the next stage. [explanations.md](../project/explanations.md).

**Cost on every import**, which is what q-gkrkf5 asks about: an estimate of **about 10–15 cents an
article** at standard power (20–30 on Opus), against about $1.15 an import costs today — a
tenth more. It is built from production's ledger for comparable steps, because nothing could be
measured: the OpenRouter key is over its monthly limit until 1 November. **Not switched on for
imports**, and no backfill (89 articles, about $11, over principles.md § 1's $5 line).

**What waits for 1 November**: the first live run read by a person, the one-call versus two-model
and Sonnet versus Opus comparison, and the real cost from the ledger (queue item `qi-k738ybv4`).
Also queued: the prose underline (`qi-ym6872mj`); web search, a visitor's copy and a chat thread per
explanation (`qi-f88947hx`).

**Sources (the first idea): nothing built**, because running its literature search sooner reverses
Greg's 25 October rule that paid Sources work waits for the mode to be opened. Question q-sxfwqq
asks when it should start; the recommendation is the press that turns the margin on.

Questions: **q-gkrkf5** (Explanations on every import?) and **q-sxfwqq** (Sources' search by
itself?).
