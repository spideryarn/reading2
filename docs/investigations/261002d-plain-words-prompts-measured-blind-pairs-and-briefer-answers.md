# Plain words: the summary, glossary, answer and shared-rule prompts, measured with blind pairs

Written 2026-10-02 from [260926a](../plans/260926a-plainer-summaries-and-glossary.md) (2026-09-26 to
09-28) and [260930g](../plans/260930g-briefer-chat-and-explain-answers.md) (2026-09-30); nothing
re-run. The question: does a prompt change make the output plainer without bending claims, and how
would we know? Raw arms and judged pairs are under `evals/results/plain-words/`; the harnesses are
`evals/plain-words/{run,answers,artefacts,unblind,glossary-people}.ts`. The Simple-specific work is in
[261002b](261002b-how-simple-is-written-effort-levels-one-call-or-three-and-opus.md) and
[261002c](261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md).
The Socratic-question variants in `evals/summaries/` and `evals/results/summaries/` are a separate
earlier eval and are not covered here.

## The prompt

> we want the summaries to really use simpler language, because half the problem is we may not know
> what the jargon means, and the glossary as well especially should explain in simpler language.
>
> — Greg, 2026-09-26 (260926a)

The 2026-09-03 rule ("keep the article's own words for things it names") exempted exactly the jargon.
The change: keep the name as a handhold, never leave it bare. The design guard: plainer is the same
claim in commoner words, never a looser one.

## How it was measured

Production's own structure request and `generateGlossary` on three jargon-heavy articles (the PID
paper, Olah's *A4*, the Noema consciousness essay), before and after, plus a `before-2` run of the
old prompt as the wobble control. Two screens (share of words outside the 6,000 commonest forms,
words per line) and then the real evidence: matched pairs shuffled with a seeded coin and judged by
a fresh model that saw only the pairs file, asked which is easier and whether either bent a claim.
Fable judged stage 1-2; Opus judged stage 3 after Fable was retired, with its own control.

## The numbers

- **Stage 1: three prompt versions.** First-sentence length of a glossary `senseHere` (before 33.3
  words, 4.91 hard types): v1 37.1/5.32, v2 34.2/4.91, **v3 28.2/3.16**. v1 and v2 did almost nothing:
  the loophole (article-named words exempt) and a wrong-field worked example. The share-of-hard-words
  screen flattered them (explanations add common words), so the per-entry screens decided.
- **Regressions the rule caused**, each guarded: outside knowledge moved into `senseHere` (`background`
  fields 7-18 down to 1 in `after-4`, back to 10-12 after the guard), and people dropped / terms fused
  (`after-6` restored 3 of the missing people).
- **A broken shuffle invalidated the first reads.** The seeded coin put the new arm on one side 99
  times in 100 (JavaScript precision), found in Sol's round 2; recorded as not valid blind evidence.
  Fixed (`blindCoin`, 32-bit) and re-read.
- **The valid reads** (`pairs-*-vs-*.{md,key.tsv,judged.txt}`): control old-vs-old 55-46, 12 same;
  `before` vs `after-8` (what shipped) **70 plainer, 13 old, 8 same**, fidelity flags 4 new / 3 old.
  Stage 1b: depth-1 questions split 6-5 until the QUESTIONS bullet was made explicit; then 10-1.
- **The cost, named**: longer lines. Depth-1 gists over 25 words rose from 1/23 to 8/23; the glossary's
  20-word first sentence is mostly ignored (33 of 39) though hard words still fell (2.9 types against
  4.9). Greg, 2026-09-28: plain beats short, so depth-1 went to 30; `after-9` read **67-16-4** against
  `before`.
- **Chat, Explain, *Check the web***, one bullet (stage 2): 13-5 then 9-9 against a 6-9 control; not
  a reliable effect. The shared rule with its worked example and self-check (stage 3) gave 12-6 and
  13-5 against an 8-10 control, fidelity 1/5 and 0/3.
- **Artefacts** (15 generators on one essay, `evals/plain-words/artefacts.ts`): 77 new plainer, 45 old,
  116 same, against a 51-48 control; flags 12 new / 9 old. Ideas 14-1, tweets 8-0, FAQ 3-0, but
  quote reasons 4-7, labels 5-6. Hard types per 100 words: tweets 18.5 to 9.6, sketch 21.3 to 13.2.
- **Summaries and glossary with the shared core** (`after-10`): **76-14-5**, flags 4 / 1.
- Spend: stage 1 about $5-6 estimated from per-block cost, not read from the ledger; stage 3 about $6
  planned. I did not find a ledger total.

## Decision and where it lives

Plain wins wherever the words explain or ask; the author's key term wins in a label, heading or
title, with ordinary words around it. The rule is one fragment, `plainWords()` in `src/plain-words.ts`,
wired into 29 prompts in 27 files with a coverage test, documented in
[prompting-guide.md](../project/prompting-guide.md). Greg on the trade-off (260926a):
*"(a) is more important (especially for summaries, explanations), though perhaps (b) plays more of a
rule in headings? Not sure. Use your judgment."* Greg, 2026-09-28: *"Plain beats short: keep the plainer
depth-1 line and raise the word limit a little … about 30"*.

## Briefer chat and Explain answers (260930g)

Greg, 2026-09-30: *"Make a minimal tweak to the prompt for chat and comment responses and question
responses etc to be a little bit briefer."* Arms `before-30`, `before-31` (control), `after-30..34`.

| surface | before (two runs) | after | change |
|---|---|---|---|
| Explain, 12 cases | 280, 268 words | 233 | -15% |
| Chat, 6 cases | 357, 373 | 262 | -28% |
| Remember, 32 replies | 209, 225 | 210 | none; reverted |

Chat took three attempts: paragraph count alone made paragraphs twice as long (342 words, -6%); a
250-word budget gave 324 in `SYSTEM` but 247 beside the question; 300 shipped (the model treats a
number as a target). Blind Opus read of `before-30` vs `after-34`: 9 new, 6 old, 3 tie; two omissions
in new chat answers, but the old-vs-old control found four including the same two.

## Dead ends and caveats

- The loophole examples above; a sixth glossary round was declined as tuning to three articles.
- One sample per arm; a single arm's outlier looks like a regression (deep gists over 32 words:
  14 of 65 in `after-10`, 1 of 73 in `after-11` on the same prompt).
- The judge said plainer sides are "systematically longer", so part of 76-14 may be length preference.
- Fable and Opus judges are not comparable; reads are never mixed. Referee claims failed on the essay
  under the old prompt (a separate defect).
- Not measured: live conversation, and answers built from web results.

## Re-running

`npx tsx evals/plain-words/run.ts --arm <name>`, `answers.ts`, `artefacts.ts`, then the `pairs` and
`unblind` subcommands; method in [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).
Each arm costs a few dollars.

Up: [research.md](../project/research.md)
