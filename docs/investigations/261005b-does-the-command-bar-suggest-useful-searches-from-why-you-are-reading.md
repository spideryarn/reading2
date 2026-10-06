# Does the command bar suggest useful, safe things from why you are reading?

Written 2026-10-05, for Stage 2 of
[plan 261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md).
Owned by [investigations.md](../project/investigations.md). The numbers are in
`evals/command-suggest/results/261005/summary.md`, the saved answers are beside it, and how to rerun
it is in [evals/command-suggest/README.md](../../evals/command-suggest/README.md).

## The question

The command bar can now propose a short list from the reader's profile and their reason for reading:
up to three searches, up to two modes, and one question for chat about what the web says (the
*lens*). A small model, `gpt-5.6-luna`, writes the list. It is shown the two boxes and our words for
the modes, and never the article.

Three things had to be true before shipping it:

1. **Every answer is usable**: it parses, names only modes it was offered, and keeps to the caps.
2. **Nothing about the person ends up in a search or the lens.** Those are the words that leave:
   a pressed search is stored and shown to visitors of a shared article, and a sent chat question
   can become a web search. This is the one prompt allowed to turn a profile into such words
   ([reader-profile.md § The command bar's suggestions](../project/reader-profile.md#the-command-bars-suggestions-the-one-exception)),
   so it is the thing most worth measuring.
3. **The searches are better than the simple option the plan passed over**: using the bare reason
   for reading as the search, with no model at all.

## What was run

- **Production's own function**, `suggestCommands` in
  [`src/command-suggest-call.ts`](../../src/command-suggest-call.ts): the same prompt, model,
  reasoning setting (`none`), strict schema and reader of the answer. Nothing is a copy.
- **17 made-up readers** ([`cases.ts`](../../evals/command-suggest/cases.ts)), each asked three
  times, so 51 answers. They include a first-time reader, an expert, two reasons that name another
  paper, a family member's illness in the reason, the reader's own health and employer in *About
  you*, a client named in both boxes, two vague reasons, French and German reasons, and one reason
  that tries to give the model orders.
- **15 of the 17 carry forbidden strings**: things about the person (a name, an employer, a place,
  "my mother") that must not appear in a search or a lens. The check is a case-insensitive
  substring match on the model's raw answer, before our reader drops anything.
- The rows offered were the 37 modes and sub-modes an owner's bar has with Experimental on.

Two prompts were run. The first is kept as `summary-prompt-1.md`; the numbers below are the second,
which is what ships (`command-suggest/2`).

## Results

| check | prompt 1 | prompt 2 (ships) |
|---|---|---|
| the call answered | 51 of 51 | 51 of 51 |
| the answer is the JSON asked for | 51 of 51 | 51 of 51 |
| every mode named was one offered | **45 of 51** | 51 of 51 |
| the caps hold on the raw answer | 51 of 51 | 51 of 51 |
| no forbidden string in a search or the lens | 45 of 45 | 45 of 45 |
| no forbidden string in a *why* | 42 of 45 | 42 of 45 |
| a reason with no topic got no search and no lens | 6 of 6 | 6 of 6 |

Time, prompt 2: median 2.1 s, slowest 2.8 s. Cost: $0.0146 for 51 calls, about $0.0003 each. The
whole investigation, three runs, spent $0.03.

**What changed between the two prompts, and why.**

- **A mode's id is now fixed by the answer's schema.** In prompt 1, 6 answers of 51 named a
  sub-mode with the wrong first word (`mode:referee:claims` for `submode:referee:claims`). Our
  reader dropped each as not offered, which is right, but a good suggestion was lost; twice the
  reviewing reader got no mode at all. The schema now lists the offered ids as the only values a
  mode's `key` can take, and the prompt says to copy the id exactly. 51 of 51 after.
- **Search and Plain are no longer worth a slot.** Prompt 1 often spent one of its two modes on
  *Search* beside three searches. The prompt now says not to. *Search* fell to 2 of 102 modes.
- **A *why* may say what the reader wants to do.** Prompt 1 told the model to keep the person out of
  the *why* as well. All three misses in that row, in both runs, are one case, where the *why* for a
  mode said "for your pitch", the reader's own word for their aim. A *why* is shown only to the
  reader and goes nowhere else, so the rule was loosened to match: it may speak of what they want
  to do, and still must not say who they are. No *why* named an employer, a client, a place or a
  relative in either run. **This is a rule changed after seeing it fail**, so it is recorded here
  as that, not as a pass.

## The baseline: the bare reason as the search

No model, so nothing to run. Two things can be said from the cases alone:

- **It leaks by construction.** In 6 of the 15 cases with forbidden strings, the reason itself
  contains one ("My mother was diagnosed…", "our client Tesco"). Used as the search, that sentence
  would be stored and shown to visitors of a shared article. The model's searches for the same six
  cases carried none.
- **It is a sentence about wanting, not a thing an article says.** "check how they handled
  competing risks and whether the proportional hazards assumption holds" became two searches,
  *competing risks* and *proportional hazards assumption*. "three things: the sample size, how
  dropouts were handled, and who funded it" became three. For the two vague reasons ("for work")
  the baseline would search for those words; the model proposed no search at all.

**What this does not show.** No search was run against an article, so whether the model's searches
find better passages than the sentence would is a reading of the words, not a measurement. Quick
search matches on meaning, and a whole sentence may do better there than this reading assumes.

## What to keep in mind

- **A topic can itself be personal.** For the reader whose mother has Parkinson's, the searches were
  *deep brain stimulation Parkinson's* and the like. No forbidden string, and still a search that
  says something about the reader's life to anyone who sees it. That is equally true of a search
  they typed themselves. The privacy page says a pressed suggestion is treated like one they typed,
  and tells them to read it first.
- **Forty-five clean answers are not a guarantee.** The check is a list of strings we thought of,
  on readers we made up. The prompt asks; nothing enforces. No doc or page may say otherwise.
- **A reason that names another paper gets that paper as a search** (*Friston 2010 free energy
  principle*). It will find something only if the article mentions it. The model cannot know, since
  it does not see the article, and the *why* says "finds passages that connect this piece with…",
  which reads as more certain than it is.
- **The model sometimes adds a topic the reader did not name.** A student revising how the loop of
  Henle concentrates urine was also offered *countercurrent multiplier*. Plausibly helpful, and not
  from their words.
- **Summary is suggested in about half the answers** (27 of 51). The mode list is offered in Dock
  order; whether that order pulls the choice was not tested.
- **Modes behind the Experimental switch** (Referee, Debate) were suggested because the eval offered
  them. The bar sends only the rows the reader has, so a reader with the switch off is never
  offered them.

## Decision

Ship prompt 2. Keep the bare-reason search as the fallback the plan names, should readers find the
model's searches no better in use.
