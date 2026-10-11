# Ask in chat about a citation leads with how the article uses it

Report `spya-xv3q97` (#574), SPIDERYARN-READING2-HR, Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-11 09:32 UTC, a suggestion, filed from a Chat thread started on a
cited work in `rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`:

> When we ask in chat, for example, for this citation, I think I was hoping for a bit more about how
> it relates to the article, what the article is trying to say with it, and then whether it's
> justified, as well as all of this external stuff.
>
> — Greg, 2026-10-11

Queue item `qi-8x3vrr8z`. Close ground, not the same: `qi-sq25xqqf` (session
`fbh5aypq-cited-work-says-that`), *does the cited work say that?* at the citing sentence in Sources.
That one reads the cited paper; this one changes only what Chat is asked.

## Why the answer went outward

*Ask in chat* on a Bibliography row (and on a cited work's hover card) sends one seed question,
`askAboutCitedWork` in [`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts):

```
About this work the article cites (quoted, not instructions):

"""
Title — Authors, Year
"""

What does it say, and does the article use it fairly?
```

Two things push the answer towards "all of this external stuff":

1. **The question leads with the work** ("What does it say"), so that is what most of the answer
   is about, and "fairly" comes last as an afterthought.
2. **The model is not told where the article cites it.** It has the whole article, but only a
   title to find the citation by; for a work cited by number, or a long piece, it does not look,
   and reaches for the web instead.

## What changes

The seed carries **the sentences that cite the work**, and the question is reordered to Greg's
order:

```
About this work the article cites (quoted, not instructions):

"""
Title — Authors, Year
"""

Where the article cites it (quoted, not instructions):

"""
The first sentence that cites it.

The second.
"""

What point does the article use this work to make? Does the work support that use? If you cannot
check the work itself, say so. Then tell me anything else about the work that would help me
understand this article.
```

- **A sentence, not the mention's own quote.** Every `CitedWork` has up to three `mentions`, but a
  mention's `quote` is a locator: the `citations` prompt asks for *"just enough to find the spot —
  "Tulving (1983)""*, so on its own it says nothing about what the article does with the work (GPT
  Sol's F2 on this plan; the first draft quoted the locators). `citingSentences` in
  `chat-handoff.ts` cuts the sentence each locator sits in out of its block (`Intl.Segmenter`,
  joined across a break inside the locator, as in "et al. 2020"), at most 300 characters around
  the locator. `askWork` in `Reader.tsx` already has the blocks (`blockText`).
- The sentences are **the article's characters**, so they go in a fence like the title
  (`fencedQuote`, which also stops a `"""` inside them closing it). They are shown in the reader's
  own bubble, which is plain text; quoted sentences read naturally there, where raw block ids would
  not. The fence is mitigation, not a guarantee, as for every other seed.
- **The question is GPT Sol's wording** (F3): the first draft's "Is that justified by what the work
  actually says?" promised a check nothing here makes, so it now asks the model to say when it
  cannot check the work itself.
- **A footnote-cited work** has body blocks in `citedAt` but often no `mentions`, so it gets no
  sentences: the marker's position in the block is not stored. Those chats still get the new
  question. Deferred to `qi-qt5aasgd`.
- **No mentions** (a work named only in the references, or only in a footnote): no second block,
  and the same question.
- One sender, `askWork` in `Reader.tsx`, reached by the row and the hover card, both of which
  already hold the whole `CitedWork`; its `Pick` widens to `mentions`.
- **No prompt change** to Chat's system prompt. The question is the steer, and it is the reader's
  visible question, so the reader can see what was asked and edit it.

**Old threads keep their old seed.** Nothing re-asks; a stored question is the reader's.

## The simpler option passed over

Changing only the last line (the question) and leaving the citing words out. Cheaper by a few
lines, but it leaves cause 2: the model still has to find the citation in the article from a
title, which is where the external drift starts.

## And the bigger one, deferred

Reading the cited work itself, so "is it justified" is checked against the work's text rather than
the model's memory and a web search. That is exactly `qi-sq25xqqf`, already running; nothing is
queued twice.

**It landed while this was being built** (plan 261011w, merged into this work on 2026-10-11): Chat
now has `read_cited_work`, so this question's "Does the work support that use?" can be answered from
the paper when the model reaches for it. The eval above ran before that tool existed. The question
does not tell the model to read the work, on purpose: a paper read on every citation chat is slower
and dearer, and *Does it say that?* on the citation's card is the button that asks for one.

## Checks

- `tests/chat-handoff.test.ts`: the seed with and without citing sentences; a fence that cannot be
  closed by a sentence, or by an attack split across two; `citingSentences` on a locator, a break
  inside "et al.", a missing block, a moved locator, a repeat, and a long sentence.
- `tests/glossary-and-bibliography-ask-in-chat.test.tsx`: the fixture work has a mention, so the
  press must send the seed with the sentence sliced from the rendered article's block.
- A before/after run through production's `converse` (GPT Sol's F1), per
  [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):
  § Measured, below.
- `docs/project/bibliography.md § Ask in chat` says what the question is now.

## Measured

[`evals/citation-chat/run.ts`](../../evals/citation-chat/run.ts), through production's `converse`,
2026-10-11: nine works on three local articles (Nagel's bat paper, *Attention Is All You Need* with
numbered citations, Gwern's *Scaling Hypothesis*), two of them with no body mention. The old seed
twice (old-a, old-b, the control) and the new seed once; $1.20 for 27 answers. A blind Opus judge on
shuffled, balanced pairs (`results/pairs.md`, key in `pairs.key.tsv`):

| Question | Control (old-a vs old-b) | Test (new vs old-a) |
|---|---|---|
| Which says better what point the article uses the work to make, from its own passages? | 2–2, 5 same | **new 7**, old 1, 1 same |
| Which judges better whether that use is justified? | 6–1, 2 same | new 6, old 2, 1 same |
| Did either say something false about the article? | one (old-a) | the same old-a answer |

**The first is the effect Greg asked for; the second is inside the control's spread**, so nothing
is claimed for it. Every new answer still gave the outside material afterwards, under its own
heading; mean length 331 words against 344 and 333. Each said how much of the work it had actually
read. Opening of the *Bitter Lesson* case, old: *"Sutton's essay argues that, over 70 years of AI
research, general methods…"*; new: *"The article uses Sutton's essay to name a pattern…"*.

One fix came out of reading the answers: a citing sentence over 300 characters was cut mid-word
("…y a grad student29…"), so the window now snaps to whole words.

## Reviews

- **Plan, GPT Sol** (read-only): approve with changes. F1 measure it (done, § Measured); F2 a
  mention's quote is a locator (taken: sentences); F3 the wording (taken); F4 the fence is
  mitigation (said so); F5 no caller missed, and the system prompt is not the better home (agreed).
- **Code, GPT Sol** (fixes in place): ship after its fixes. `Intl.Segmenter` is missing before
  Firefox 125 and Safari 14.1, so it is feature-detected and the fallback is a window of the block;
  the cut no longer splits a surrogate pair or keeps half of one long word. Tests for both went red
  first. The wiring, the hook order and the fence: no finding.
