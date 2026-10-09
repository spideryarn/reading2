# Skim: a cue only where it helps (`skim/11`), measured

Written and run 2026-10-09 for
[plan 261009j](../plans/261009j-skim-question-optional-and-the-border.md). Up:
[investigations.md](../project/investigations.md). The mode is [skim.md](../project/skim.md); the
previous measurement of the same field is
[261006b](261006b-skim-cue-situates-the-quote-eval.md).

**In one paragraph.** Greg asked for the question before each Skim quote (the *cue*) to be
optional, and never an echo, meaning a question that turns the quote into a question and adds
nothing. Both blind judges agree that most of `skim/10`'s cues are echoes: GPT Sol marked 85–98% of
them, and a Claude judge 18–82% depending on what it was comparing them with. `skim/11` keeps about
a third of the cues: 24–35 of 99 per run, and none of the six articles is left with none. Removing
an echo is judged a tie, as the judge's brief says it should be. Only 3–10 omissions per run were
judged to have needed a question. Where both prompts wrote a cue, the new one is usually preferred.
**The predeclared ship rule was not met, and it was overridden.** That rule was that both judges
prefer the new prompt to both control runs by more than the control's own split. Overall pairwise
preference swings between runs and judges, from 21–6 for the new prompt (round 2) to 19–13 against
it (round 3, GPT Sol, in both runs), and is mostly not significant. Where only the old prompt wrote
a cue, the old cue usually won the pairs that were not ties. The wording was revised twice inside
the measurement, and the third wording is the one built, for the reasons under
[§ Round 3](#round-3-the-built-wording). Spend $1.50 on routes (nine runs) plus the judges.

## What was asked

> So maybe we should say that the question is optional, but that when we include it, it should
> perhaps contextualize the quote. [...] the key thing is that if one were to read the question,
> then the quote, that it should make more sense or be easier to process.
>
> — Greg, 2026-10-09 (`spya-qpgvq9`)

> I think there's no point in having a question that sort of almost verbatim sets up the quote as
> the answer, because that adds nothing.
>
> — Greg, 2026-10-09 (`spya-zdkqx4`)

## How it was run

The method is
[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
with the fixes from GPT Sol's plan review
([261009j-plan-review-sol.md](../plans/261009j-plan-review-sol.md), F1–F4).

- **Production's own `generateSkim`**, through
  [`skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts), Sonnet, effort low, no
  profile. Nothing was written to any database except the `ai_calls` ledger.
- **Six articles, about 97 stops per run.** Greg's `arxiv-1706-03762-spya-wyt7j0` (the report's
  article) and `2608-13566v1-spya-yurten` were read from production read-only by
  [`skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts). The other
  four are local: `entropy-24-00930-spya-pywwkq`, `arxiv-2010-spya-tkm7nm`, `cargocult-spya-rz663q`
  and `source-spya-furjgs`.
- **Arms.** A1 and A2 are `skim/10` twice (the control). Each candidate wording was run twice (B1,
  B2), so it has a spread of its own (Sol F3).
- **Pairs** by [`skim-cue-optional-pairs.ts`](../../scripts/eval/skim-cue-optional-pairs.ts):
  - one population for every comparison, the quotes that are a stop in all four arms (Sol F2);
  - s1 is A1 v A2, s2 is A1 v B1, s3 is A2 v B2, with sides by `blindCoin` and the balance checked;
  - each side is the arm's cue or "(no question)";
  - the judge is shown the records the model saw (section, quote, the key ideas it carries) apart
    from the article's paragraphs (Sol F4).

  Per pair the judge gives:
  - **better**: 1, 2 or tie. A question that adds something beats none, a needed question that is
    missing loses, and an echo is no better than none;
  - for each cue: echo, give (states the finding), unlicensed (not supported by the records, or
    asks what the quote does not answer), untrue (wrong about the article);
  - for each empty side: **needed** (Sol F1).
- **Judges**: three fresh Claude subagents (one per comparison) and GPT Sol (all three files), each
  reading only the pairs files.

## Round 1: the first wording (exploratory)

The judge's brief was simpler (no records, no `needed`). B, one run, kept **35 of 99** cues. Claude
preferred it 25–6 over A1 and 21–11 over A2, against a control split of 14–24. GPT Sol preferred it
25–14 and 22–17, against 26–30. Where both had a cue, B won 24–6 and 20–7 (Claude), and 21–12 and 21–13 (Sol).

**What was wrong with it.** Sol flagged 8–9 of B's 35 cues for giving the finding away or claiming
something unsupported, against 2–5 of A's 97. Claude flagged 4–5. Read by hand, the flagged ones
were nearly all the new "why this passage" kind, describing the passage's place in the argument in
the model's own words: *"This is the counterview the authors are responding to"* over a passage
that is no such thing, and *"borrowed from how a hidden factor is estimated in other fields"*.

## Round 2: why-this-passage only from the records

The third way a cue earns its place now needs the records: the quote carries a key idea, or is the
reason for a choice the quote names. A list of forbidden characterisations was added. The cues kept
were B1 32 and B2 24.

| | Claude | GPT Sol |
|---|---|---|
| s1 A1 v A2 (control) | 17–15, p 0.86 | 29–25, p 0.68 |
| s2 A1 v B1 | **B1 21–6, p 0.006** | B1 22–15, p 0.32 |
| s3 A2 v B2 | B2 11–8, p 0.65 | A2 13–9, p 0.52 |
| both have a cue (s2; s3) | B 19–2; 9–4 | B 19–12; A 11–8 |
| B's cues flagged give / unlicensed / untrue | 0/2/1 of 32; 0/3/0 of 24 | 4/5/0 of 32; 0/3/0 of 24 |
| A's cues, the same | 1/6/1 and 0/4/1 of 96 | 1/5/0 and 0/4/0 of 96 |
| B's empty sides judged needed | 7 of 64; 7 of 72 | 3 of 64; 4 of 72 |

**And a regression, found by reading.** On *"Our evidence supports the latter interpretation"*, the
quote behind Greg's report of 2026-10-06 (`spya-jghnva`) and the reason for `skim/10`, **both B
runs gave no cue**. The quote reads clearly after its colon, so the model treated it as standing
alone. Sol's give-away flags also clustered on statements that described the passage (*"This passage
says how to treat cases…"*, *"This sets up a test…"*).

## Round 3: the built wording

Two additions. First, a quote that says "the latter", "this approach" and so on, whose referent the
records hold, **gets a cue**: "the one case where a cue is expected". Second, **prefer a question**:
a statement only names what "this" stands for or which idea the quote carries, and never describes
the passage. Both runs now set up the "latter" quote (*"Two readings of SWE-bench gains are on
offer: a general coding improvement, or skill tied to the benchmark itself. Which does the evidence
back?"*). Cues kept: B1 32, B2 26.

| | Claude | GPT Sol |
|---|---|---|
| s1 A1 v A2 (control) | 10–17, p 0.25 | 20–25, p 0.55 |
| s2 A1 v B1 | A1 13–10, p 0.68 | A1 19–13, p 0.38 |
| s3 A2 v B2 | B2 14–8, p 0.29 | A2 19–13, p 0.38 |
| both have a cue (s2; s3) | B 8–3; 12–4 | A 11–10; A 13–10 |
| only A has a cue (s2; s3) | A 10–2; 4–2 | A 8–3; 6–3 |
| B's cues: echo, then give / unlicensed / untrue | B1 14, 1/4/2 of 32; B2 11, 0/0/0 of 26 | B1 22, 1/2/0 of 32; B2 16, 0/1/0 of 26 |
| A's cues, the same | 76–77, about 1/3–6/1 of 96 | 84–94, about 0/1–5/0–1 of 96 |
| B's empty sides judged needed | 7 of 64; 5 of 70 | 5 of 64; 6 of 70 |

Sol preferred the control in both runs (not significant). Claude was split. "Prefer a question"
also pushed some cues back towards bare pointer questions, so Sol counts more of the kept cues as
echoes than in round 2 (16–22, against 3–8). B1 was flagged on 7 of its 32 cues by Claude, about
22%, against roughly 10% of A's. So the plan's third clause, no more give-aways or unsupported
claims, holds only on raw counts, and B2's flags are near zero.

**The decision.** The plan's rule was not met in any round. After three rounds the change was built
anyway, on an Opus arbiter's recommendation, for these reasons:

- The rule's first clause tests overall pairwise preference, and the brief scores "echo against no
  question" as a tie. So most pairs tie, and the verdict rests on a remainder that moves as much
  between two control runs (10–17, then 20–25) as between the arms.
- Both judges agree on what Greg asked for: most of the old cues are echoes, and two thirds of them
  are gone.
- Round 2 is ruled out by its regression on Greg's own reported quote.
- Another round would not settle it, because the spread between runs is larger than the effect.

**The cost** is the omissions that lost: where only the old prompt had a cue, the judges preferred
it 10–2, 8–3 and 6–3. That is the trade-off Greg is told about.

## What it shows, and what it does not

- **The old cues were mostly echoes**, by both judges, and the new prompt drops about two thirds of
  them. That is what Greg asked for, and removing an echo is not judged a loss.
- **Where the new prompt keeps a cue, it is usually the better cue**, more clearly by the Claude
  judge than by Sol.
- **The omissions cost a little**: 3–10 per run of about 65–70 were judged to have needed a question.
- **Overall preference is not established.** Across three rounds, two runs a round and two judges,
  the new prompt's overall lead ranges from clear (21–6) to a small loss (13–10), and it is inside
  the control's spread more often than not. The plan's rule was not met. It was built anyway, for
  four reasons: the change is the one Greg asked for in so many words; nothing measured got
  significantly worse, though some omissions lost to the old cue and B1's flag rate was higher; old
  routes keep their cues (a prompt version makes a route outdated, not stale); and it is one
  prompt section to revert.
- Six articles, of which two are Greg's, and the judges are models. Rare harms cannot be measured at
  this size, so every cue the built wording kept was also read by hand (below).

## The cues the built wording kept, read by hand

All 58 kept cues of round 3 (B1 32, B2 26) were read against their quotes.

- **Nearly all are questions now**, as the wording asks. Of the statements that remain, most name a
  referent (*"Two readings of SWE-bench gains are on offer: …"*) or the section's subject (*"The dot
  products are divided by a scaling factor."*, over a quote in *Scaled Dot-Product Attention* that
  never says so).
- **Some add what the quote leaves out**:
  - *"Why does a step-by-step design get in the way of training…?"* over *"This inherently
    sequential nature…"*;
  - *"Which strategy is 'this simple, yet scalable' one, and what must it be paired with to work?"*;
  - *"Where did the deadly image of ball lightning come from, if not from ball lightning itself?"*,
    which sets the question the passage answers.
- **A residue are still echoes or bare pointers**, mostly on number-heavy results: *"Note the count
  of degradations against improvements."*, *"Note the percentage at which the peak occurs."* That
  matches the judges' 10–14 per run.
- **Three are weaker than the rule wants.**
  - *"'The latter' is the second one."* (B1) is clumsy, though correct.
  - *"Rich-club neurons are the unusually densely interconnected hubs."* (B2) defines a term,
    which the cue section says not to do.
  - *"What did Mr. Young's rat work show, and why did other researchers ignore it?"* (B1) asks more
    than its quote answers.
- **None states a finding outright.** None was judged untrue in B2. Two were judged untrue in B1,
  and on reading both are arguable rather than wrong.

## The route itself

Not this change's question, and not judged. The Opus study that started the plan also saw
near-duplicate stops (the abstract and the conclusion of the Attention paper both on one route) and
one stop placed before the stop it depends on. Those come from section 2 of the prompt.

## Files

- Results: `evals/results/skim-coverage-2026-10-09T09-46-59-j-a1.json` and `-j-a2.json` (control);
  `…T09-54-33-j-b.json` (round 1); `…T10-00-58-j-b1.json` and `-j-b2.json` (round 2);
  `…T10-19-23-j-c1.json` and `-j-c2.json` (round 3, the built wording).
- Pairs, keys, judgments and screens: `evals/results/skim-cue-optional-2026-10-09-*` (round 1, the
  first brief), `…-r2-*` and `…-r3-*`.
- Script: [`skim-cue-optional-pairs.ts`](../../scripts/eval/skim-cue-optional-pairs.ts). Round 1
  was scored by an earlier version of it with a simpler brief. Its numbers are above, and its files
  are kept.
