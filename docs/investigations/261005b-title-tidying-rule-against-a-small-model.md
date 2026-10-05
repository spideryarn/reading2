# Title tidying: the rule against a small model

Up: [investigations.md](../project/investigations.md) · For plan
[261005j](../plans/261005j-a-small-model-tidies-an-imported-title.md) · 2026-10-05

Greg asked for a small model to tidy an imported title ("e.g. GPT Luna or DeepSeek"), with the rule
from [261005g](../plans/261005g-tidy-an-imported-title-and-keep-the-original.md) kept as the
fallback. This is the measurement behind the build: is a model better than the rule, which model,
and what does it do that it should not.

## The short answer

- **On the titles in production today, the model and the rule give the same answer.** 50 distinct
  titles; three are in capitals and both recase them identically; 47 are left alone by both.
- **On the judged messy-title pairs, the model was preferred in 25 of 26.** 62 real works in the forms they are
  commonly published in: a blind judge preferred the model in 25 of the 26 titles where the two
  differed, the rule in none, and called one a tie. It named a wrong name or acronym in six of the
  rule's titles and none of the model's.
- **DeepSeek, not Luna.** The answers were as good, it is faster and cheaper, and it has a
  zero-retention route already.
- **The model over-cuts, and code has to stop it.** Asked to take a site's name off, it also took
  off an author's name and a sutta's Pali title. The check now refuses any cut at a dash that is
  not the site's name the page declared. The judge reported no harm in the model's accepted
  first-run answers that differed from the rule. This does not assess every answer in both runs.

## Why a separate call, when Greg asked for a piggyback first

"ideally piggybacking on an existing call we're already doing as part of the import process" (Greg,
2026-10-05). The calls considered, and why none carries it: a web page's `extract` makes no model
call; `pdf-frontmatter` (with the PDF's transcription and authors pass) is PDFs only and answers
in block ids; `paper-metadata` is batch-added papers only, and its title is scored on being
"exactly as printed"; `structure` and `reading-difficulty` run after the title is stored, and a
title that changes after extract marks every generated mode stale. So a web page needs a new call
whatever is done, and one shared call is smaller than a new one plus two changed contracts. What a
piggyback would have saved is the figure below: 0.007 cents and about a second an import. **No
piggyback was measured**, because none was built. The full table is in the
[plan](../plans/261005j-a-small-model-tidies-an-imported-title.md).

## What was run

[`evals/title-tidy/run.ts`](../../evals/title-tidy/run.ts) calls production's own
`tidyTitleByModel` (src/title-tidy-model.ts), so the prompt, the schema, the route and the check
are production's.

**The titles.**

- **50 from production**: every distinct title in `article_revisions` on 2026-10-05, read inside
  `BEGIN READ ONLY`, with the site's name and language where the page declared them. They are
  readers' titles and are not in the repo.
- **62 written by hand**, [`evals/title-tidy/wild-titles.json`](../../evals/title-tidy/wild-titles.json):
  real works in the forms a scan, a web page's `<title>` or a word processor gives them, because
  most production titles needed no tidying. Twelve were added after the plan review asked for
  them: a short title with a long site's name, superscripts and symbols, capitals with a mixed-case
  site's name, an instruction hidden in the site's name and in the language.

**The arms.** The rule, with no body text, which is what the model is given too. **This is not
quite today's import**: at import the rule reads the article's body, and keeps a word in capitals
when the body writes it that way twice. So `NASA` in the table below is a win over the rule alone,
and at import the rule would get it right when the article says "NASA" twice. DeepSeek
(`deepseek/deepseek-v4.1-flash`, job `title-tidy`, zero-retention route, no thinking) twice. Luna
(`openai/gpt-6-luna`, the same request as job `eval`, at the provider's default effort) twice, on
the first prompt only.

**The judge.** A fresh Sonnet subagent reading only the pairs file: for each title where the rule
and the model's first run differ, the title as it arrived and the two versions as X and Y, sides
set by a tested coin (`blindCoin`). Two questions: which would you rather see on a shelf, and did
either lose part of the real title or get a name or acronym wrong.

## Three rounds

| round | prompt and check | titles | DeepSeek against the rule, blind |
|---|---|---|---|
| 1 | first prompt; check "the answer's letters are a run of the original's" | 100 | model 23, rule 0, tie 1 (of 24) |
| 2 | after the plan review: stricter check, all fields as JSON, site's name removed before capitals are judged | 112 | not judged: see below |
| 3 | cuts only of the declared site's name | 112 | **model 25, rule 0, tie 1 (of 26)** |

Round 1 also ran Luna: model 20, rule 0 (of 20). The model was X in 14 of 24, 13 of 20 and 16 of
26 pairs, and the judge chose X and Y about equally, so a side preference does not explain it.

**Round 2 was not judged because reading it found the harm.** The stricter prompt made the model
more willing to cut:

| as it arrived | round 2's answer |
|---|---|
| `Home \| The Feynman Lectures on Physics` | Home |
| `MN 10 The Establishing of Mindfulness Discourse \| Satipaṭṭhāna Sutta` | MN 10 The Establishing of Mindfulness Discourse |
| `The Bitter Lesson – Rich Sutton` | The Bitter Lesson |
| `HOW TO READ A PAPER - ACM SIGCOMM Computer Communication Review` | HOW TO READ A PAPER |

The second is a production title, and the first round's judge would never have seen it: the rule
leaves it alone, and so had the model. So round 3 changed the check, not only the prompt: a part
may come off at a separator **only if it is the site's name the page declared**. In round 3 the
model still tried all four cuts, and each was refused and the title left as it came.

**A fourth run, after the code review tightened the check again** (the part cut must be exactly
the declared site's name, where round 3 accepted any part containing it;
[postmortem](../postmortems/261005i-substring-evidence-does-not-authorize-removing-a-segment.md)).
Same prompt, same 112 titles, not judged again: 10 of 224 answers refused, 3 calls timed out at 8
seconds, and 4 of 112 stored titles differed between the two runs. Against round 3's first run, six
titles came out differently, none of them a site's name that round 3 took off and round 4 did not:
they are the ordinary run-to-run kind (a timeout, a refused answer, `.pdf` taken off or left).

## Round 3 in numbers (DeepSeek, 224 calls)

- **Usable first-run answers changed** 41 of 112 titles; differ from the rule on 26.
- **Refused by the check**: 10 of 224 answers (4.5%). Each got the rule's title instead. They were
  the over-cuts above, `The Dhammapada | Project Gutenberg` (no site's name declared, so the cut is
  not allowed and the title stays), and `DIE STRASSE NACH SÜDEN`, which the model wrote with a
  letter the original did not have.
- **Raw answers/refusals across two runs**: 4 of 112 differ. Two because one run was refused and
  the other was not. This is not necessarily four changes to the stored title: production uses
  the rule on refusal. The original report compared raw answers, including null for a refusal;
  the runner now reports stored-title disagreement separately. That revised count has not been
  recomputed from the historical results. Two accepted-answer pairs differ: `and The Lord of the Rings` against `and the Lord of the
  Rings`, and a `.pdf` taken off in one run and not the other.
- **Time**: median 1.0 s, worst 7.1 s. Round 1 had 4 timeouts at 8 s in 200 calls, while the box
  was badly overloaded; rounds 2 and 3 had none.
- **Cost**: $0.016 for 224 calls, 0.007 cents each. About 770 tokens in, 14 out, no thinking.
- **The hidden-instruction cases** in a title, a site's name and a language produced no disallowed
  stored edit. The runner keeps accepted answers and refusal reasons, not rejected answer text,
  so it cannot establish that the model itself ignored every instruction.

What the rule gets wrong and the model right, all from round 3:

| as it arrived | the rule (no body) | the model |
|---|---|---|
| `THE FUTURE OF NASA AFTER THE SPACE SHUTTLE` | The Future of Nasa After the Space Shuttle | The Future of NASA After the Space Shuttle |
| `THE MCDONALD PAPERS: LETTERS FROM O'BRIEN TO MACARTHUR` | The Mcdonald Papers: Letters From O'Brien to Macarthur | The McDonald Papers: Letters from O'Brien to MacArthur |
| `AN FMRI STUDY OF WORKING MEMORY IN ADHD` | An Fmri Study of Working Memory in Adhd | An fMRI Study of Working Memory in ADHD |
| `EL ORDEN DEL TIEMPO` | El Orden Del Tiempo | El orden del tiempo |
| `À LA RECHERCHE DU TEMPS PERDU` | (left in capitals) | À la recherche du temps perdu |
| `LIFE OF PI` | (left in capitals) | Life of Pi |
| `THE ORDER OF TIME \| Penguin Books` | (left) | The Order of Time |
| `Thinking, Fast and Slow – Wikipedia` | (left) | Thinking, Fast and Slow |
| `Microsoft Word - The Economics of Attention.doc` | (left) | The Economics of Attention |
| `Reflections on Trusting Trust  :  Turing Award Lecture` | (left) | Reflections on Trusting Trust: Turing Award Lecture |

## DeepSeek or Luna

Round 1, the same 100 titles and prompt:

| | DeepSeek | Luna |
|---|---|---|
| blind, against the rule | 23–0, 1 tie | 20–0 |
| median time | 1.0 s | 1.7 s (thinking at the provider's default; not tuned) |
| cost per call | 0.007 cents | 0.009 cents |
| route | zero-retention upstreams only | OpenAI |

The answers differed on a handful of titles and neither was clearly better. DeepSeek is what
`paper-metadata` already uses, on a route Greg chose for it (2026-10-01).

## What this does not show

- **Nothing about a typical import.** The production titles are 50, mostly one reader's academic
  papers. On them the model earns nothing over the rule. The case for it is the messy set, which
  was written to be messy.
- **The rule was not given a body**, as above.
- **One judge, one read.** These are that judge's preferences, not an independent measure of
  correctness. A second judge might change the counts or the conclusion.
- **Luna was not re-run** on the final prompt and check.
- **Review tightened the acceptance check again**, requiring the entire removed segment to be
  the declared site's name, distinguishing a bracketed identifier from bracketed prose, and
  checking Unicode cuts before lower-casing. The 224 calls were not re-run against that revision.
- **Equal title text is not equal input.** The original report keyed rows by title alone, which
  could merge equal titles with different site or language context. The runner now assigns an
  input id. The production input/results files are not in the repo, so this review could not
  establish whether the historical combined cohort contained such duplicates.
- **The round-2 harms were found by reading**, not by the judge. A blind read of pairs only sees
  titles where the two arms differ on the first run, and only against the rule.

## How to run it again

```
npx tsx evals/title-tidy/run.ts --arms=deepseek --titles=evals/title-tidy/wild-titles.json --out=output/title-tidy-eval
```

It prints the report and writes the pairs and their key beside it. About 2 cents for two runs of
the 62 titles.
