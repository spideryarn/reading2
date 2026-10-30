# The citations model under-returned, and no witness could see it

Report `spya-ez2vus` (Greg, admin, 2026-10-26), on LeCun's *A Path Towards Autonomous Machine
Intelligence*:

> Why didn't it notice the citation for Levine 2021 in this paragraph? I feel like citations often
> seem to miss stuff.
>
> — Greg, 2026-10-26

He was right on both counts. The Citations list for that article named 23 of the 105 works its body
cites, and nothing in the pipeline could tell 23 of 105 from 23 of 23. Only the reader saw it. The
fix is [261027b](../plans/261027b-citations-missed-in-the-text-filled-by-code.md); the counts are
[261027a](../investigations/261027a-how-often-citations-are-missed.md).

## What happened

The paragraph `spya-g9ssef` cites *(Craik, 1943)*, *(Bryson and Ho, 1969)* and *(see for example
(Levine, 2021))*. The list has rows for the first two and none for Levine.

Production's log line for that run (2026-10-26T21:45:12Z, job `spya-t5kmwd`, `claude-sonnet-5-5`,
prompt `citations/6`) says which stage lost it: `works: 23`, `capped: false`, 2,777 output tokens,
and **every drop counter at 0** — `unknownIds`, `unquoted`, `unanchored`, `malformed`, `overCap`,
`merged`. No code stage dropped Levine. The model never named it, and said it had not stopped early.

How often: a hand count across six articles found recall of 98.6–100% on the four citing 70 works or
fewer, and 22–28% on the two citing over 100 (LeCun 23/105, Wikipedia's *Synesthesia* 42/152). The
misses cluster in dense paragraphs; one parenthetical citing 14 works produced one row.

A second defect rode in the same run. `referenceListFrom` read the appendix's Table 1 — nine
numbered rows of loss functions, which happen to sit under the `References` heading because LeCun's
author–year list has no numbers — as the article's numbered reference list, and the prompt handed it
to the model as *"Its numbered reference list … here it is"*. None of the nine has a year. Whether
that pushed the model towards a short answer is untested until model calls are possible again (the
OpenRouter key is over its limit until 2026-11-01).

## The class: a completeness check that can only see what the checked thing already reached

Two shapes of the same mistake, both here:

- **The only statement of "this is all of them" was the model's own.** The prompt says *if there are
  more than 80, keep 80 and set `capped: true`*. A model that stops at 23 without noticing reports
  `capped: false` honestly. Asking the producer whether it finished is not a check.
- **The independent witness counted a denominator this input does not have.** `coverageOf` compared
  works returned against the article's notes and `role: "reference"` blocks. A PDF's bibliography is
  not rendered, so both were 0, and 0 of 0 reads as complete. The witness existed, ran, and logged —
  and could not, by construction, see the thing it was there to witness.

It is [silent success](../reusable/silent-success.md): the check shared the code's assumption, here
that an article's citations live in blocks marked as references. Stated as a rule: **a count of what
a model returned is only a witness if the denominator comes from somewhere the model did not read
for you, and is non-zero on the input in front of you.**

## Which commits introduced it

- `85631f9bf` (2026-09-11, plan 260911g, "Citations stage 1") added the step, the 80-cap with
  `capped` reported by the model, and `coverageOf`, commented *"Fable's condition on overruling Sol's
  F5"*. GPT Sol's F5 had said the cap does not give *"a link to all of them"*; Fable arbitrated it
  away and kept the witness so *"a silent under-return on a 60-item bibliography shows up in a run
  rather than nowhere"*. The intent was exactly right; the denominator was chosen from HTML articles,
  which have reference blocks. *Find more / chunking* was deferred in the same plan.
- `021e2e308` (2026-09-30, plan 260930i) made a PDF's numbered reference list readable from its text
  layer. It added `referenceListEntries` to the log line but did not feed the list into the witness,
  and it took the first numbered run under a bibliography heading as the list without asking whether
  the entries looked like references. On this run the log line read `works: 23` beside
  `referenceListEntries: 9` — more works than list entries — and nothing compared them.
- `c66854ae1` (2026-10-10, 261009w) renamed `src/citations.ts` to `src/bibliography.ts`; no change
  in behaviour.

## Why nothing went red

- **The model's flag** agreed, because it is the model's account of itself.
- **The drop counters** all read 0, correctly: they watch code losing rows, and no code did.
- **The coverage witness** read 0 notes, 0 references, both reached — complete, on a PDF.
- **The 260930i work** was about numbered PDFs; nothing in it asked what an author–year PDF with a
  numbered table under its heading would yield.
- **Recall is near 100% below about 70 cited works** (four of the six counted articles), so any run
  on an ordinary article looks fine; the failure appears past about 100.

## What would have caught it, ranked by ease against value

1. **A denominator code computes from the article itself.** Done (261027b):
   `src/citation-author-year.ts` parses author–year citations, and `Coverage` gains `authorYear`
   and `authorYearFilled` on the log line. LeCun's run would have logged 105 against 23.
2. **Close the gap, not just show it.** Done: `buildBibliography` adds a `listedBy: "text"` row for
   each parsed citation no model row covers. On the six articles plus four more, code fills 79 of
   LeCun's 82 hand-counted misses with no false fills.
3. **Refuse a "reference list" that does not look like one.** Done: `referenceListFrom` rejects a
   numbered run in which fewer than half the entries carry a year.
4. **A habit for every model-made list:** before shipping, name the witness's denominator and say
   where it comes from on each input shape (HTML, PDF, numbered, author–year). If it is zero on one,
   the witness is absent there. Costs a sentence in the plan; would have caught both commits.
5. **Measure recall on a long article before setting a cap.** The fixed set now exists (the
   investigation's ten articles); the runs wait for model budget.
6. A second model pass that re-reads the article for missed works — rejected for now. It is the
   producer checking itself again at twice the cost; code reading the citations is deterministic,
   testable today, and is the witness either way.

## The fix that is right for the long term

What shipped is a floor: every author–year citation now gets a row, but code's rows have no *why*,
relevance or influence. The right end state is that the model describes every work, and that waits
for the model budget (2026-11-01):

- a **checklist prompt** that hands the model the parser's list and asks for a row per item;
- **chunking** long articles by section, so one call is not asked for 100+ works in one answer;
- **measuring whether the bogus Table 1 list mattered**, by re-running LeCun with and without it;
- **numbered citations** filled the same way from entry *n*, if the investigation shows misses there.

Each is measured before and after on the investigation's fixed set, so the fill's counts become the
regression check.

## The thing I would tell myself

The plan said the witness existed so an under-return would show up "in a run rather than nowhere",
and then the witness was checked on the articles where there was nothing to under-return. The
question I did not ask was the boring one: on a PDF, what is this denominator? It is zero. A check I
had never seen fire on the input that mattered was not evidence, and I counted it as some.
