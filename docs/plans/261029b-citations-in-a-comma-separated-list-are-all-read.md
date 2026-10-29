# Citations in a comma-separated list are all read

Two reports from Greg (admin, `feedback-reporter.ts` exit 0), filed on 2026-10-28 while reading
Butlin, Long et al., *Consciousness in Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`,
imported from `arxiv.org/html/2308.08708`) in production:

> A lot of citations in this paragraph are getting missed somehow. How are we doing citations? Are we
> trying to do it with a regex? Because I don't think that'll work. I think it's going to need an LLM
> to pick them out. And then that might do a better job with footnotes as well.
>
> — Greg, 2026-10-28 (`spya-d5e2jk`, at `spya-n7zjq0`)

> We might have fixed this already, I'm not sure, but the diagram here is not importing correctly.
>
> — Greg, 2026-10-28 (`spya-um8d9f`, at `spya-m5keyt`)

Up: [bibliography.md](../project/bibliography.md) § Rows from the text. The step before this one is
[261027b](261027b-citations-missed-in-the-text-filled-by-code.md).

## What production holds (read-only, 2026-10-29)

- The article was imported on **2026-10-17**. Its current revision (2026-10-28 23:24) carries every
  step forward from that day. The bibliography is `citations/6`, `claude-sonnet-5-5`, generated
  2026-10-17 13:07: **70 works, `capped: true`**, $0.30 (92k tokens in, 12k out).
- The paper's reference list is in the blocks (251 paragraphs after the *Bibliography* heading, not
  marked `role: "reference"`): **243 distinct first-author-and-year works**.
- `at=spya-n7zjq0` is the heading *2.3 Higher-Order Theories*; the paragraph under it with citations
  is `spya-bwe935`: *(Carruthers & Gennaro 2020, Rosenthal 2005)* and *(Lycan 2001)*. **None of the
  three is in the stored list.**
- `at=spya-m5keyt` is three blocks above `spya-ymqz9n`, which is an **empty SVG frame, 650 × 1164**:
  the paper's *Box 3: Attention in neuroscience and in AI*, about 450 words and the self-attention
  diagram (`figures/selfAttention.png`). Blocks `spya-wejt97`, `spya-xgh7tw` and `spya-fsaefz` are
  Boxes 1, 2 and 4, empty in the same way.

## The figure: already fixed, for an article imported before the fix

It is not the PDF bug of `spya-m40r6t` (this article is HTML). It is **the bug Greg reported on this
same article as `spya-weuekx`** on 2026-10-24: arXiv draws a titled box as an SVG frame with its
words in `<foreignObject>`s, and the sanitiser deletes `foreignObject`. Plan
[261024w](261024w-figures-and-tables-open-in-the-original-and-a-titled-arxiv-box-keeps-its-words.md)
taught `liftBoxedPassage` (`src/latexml.ts`) the titled shape and let an `<img>` inside come too;
commit `aff7a7ba1`, an ancestor of `origin/main` (checked with `git merge-base --is-ancestor`), so
deployed. Checked again today: today's `prepareLatexml` on the live
`arxiv.org/html/2308.08708v3` lifts all four boxes (`boxedPassages: 4`, no `svg.ltx_picture` left,
Box 3 holding `selfAttention.png`), and `tests/latexml.test.ts` § Box 3 passes. The article shows
the empty frame because extraction ran on 2026-10-17. **Nothing to build**; a re-import would bring
the boxes back (Greg's call, principles.md § 1).

## The citations: how it works, and why these were missed

**It is both, and the model comes first.** One Sonnet call reads the whole article and lists the works
it cites, each with a quote of where; code then checks every quote is really in the article and
throws away anything it cannot find (`src/bibliography.ts`). Since 2026-10-27 code **also** reads
author–year citations itself (`src/citation-author-year.ts`) and adds a row for any the model left
out (plan 261027b), because one call stops early on a long list: close to complete up to about 70
works, a quarter past 100 ([investigation 261027a](../investigations/261027a-how-often-citations-are-missed.md)).

Here, three things stacked:

1. **The model stopped at 70 of about 243 works**, and said so (`capped: true`). Carruthers,
   Rosenthal and Lycan were not among the 70.
2. **Code's fill came ten days after this list was made**, and a stored list is not re-made on its
   own (principles.md § 1). So the article has none of code's rows.
3. **Even today's code, re-run, would still have missed Rosenthal.** It would find Carruthers and
   Lycan, two of the three. It reads a list whose items a *semicolon* separates (`(Craik, 1943;
   Levine, 2021)`), the style of LeCun's paper it was built on. This paper separates them with a
   **comma** and no comma before the year: `(Carruthers & Gennaro 2020, Rosenthal 2005)`. Code read
   the first item and stopped. (Corrected after GPT Sol's plan review, which counted it right.)

(4. Boxes 1–4's citations — Lindsay 2020, Treue & Trujillo 1999, Bahdanau et al. 2014 and others —
are in no block at all, for the figure's reason above.)

## The fix: read the rest of a comma-separated list

In `authorYearCites`, after a parenthetical cite is read, try the **next item straight after its
years**: `, Names Year` (`NEXT_IN_LIST`, a sticky regexp), with the same checks as every other item
(not a month or `Table`, a surname with a lowercase letter), and keep going while items follow. It
starts only from a cite already read, so a year that was not itself a citation (`(founded in 2019,
Kenya 2021)`) never starts a list, and it stops at anything else (`(Lycan 2001, p. 5)`).

**Measured on this article's blocks** (production, read-only; body = the blocks before the
*Bibliography* heading), against the 243 works of its own reference list:

| | distinct works code finds in the body | of the 243 | not in the list |
|---|---|---|---|
| before | 197 | 178 | — |
| after | 236 | 214 | 22 |

The paragraph Greg reported now gives all three. The 22 "not in the list" were each read by hand:
every one is a real citation whose entry is dated or spelt differently (`Vaswani et al. 2017`
against the entry's 2023, `Złotowski` against `Zlotowski`, `OpenAI 2023`), so **no false hits**. Of
the 29 listed works code still does not find, eight are cited only inside Box 3, which this
article's blocks lack.

**What it cannot tell apart:** after a real cite, `(Smith 2020, Kenya 2021)` reads Kenya as an
author, since the words have the same shape. Accepted on the measurement above (39 works added, all
real), and said so in the code; corroborating each continuation (another occurrence, a reference
entry, a model row) would lose the genuine works cited once, which are most of them.

`tests/citation-author-year.test.ts` § *a list whose items are separated by commas*: written first
and seen red (two of four failing: the two that read a list), then green.
`tests/bibliography-fill-from-text.test.ts` takes Greg's paragraph through `buildBibliography`: the
model's Carruthers row still covers its item, and Rosenthal and Lycan get code's rows; and a model
row with no names of its own whose mention spans the whole list covers neither item, the rule a
semicolon list already has (GPT Sol's plan review, 3).

No prompt changes, no new call, no cost. The prompt version is unchanged: the model's call is the
same; code's rows are rebuilt whenever the step runs.

## The model's half, and the question for Greg

Greg's instinct is right for **footnoted and numbered** articles: code reads author–year only, so
past about 70 works a footnoted article (Wikipedia's *Synesthesia*: 42 of 152) is as incomplete as
the model leaves it, and code's author–year rows have no description or scores, because no model has
read them. That work is already written down as **qi-mf9r5hjk** (split a long article across calls;
hand the model code's list as a checklist so those rows get described), proposed by the Overseer on
2026-10-27 and authorised by nobody. It needs model calls, and the box's OpenRouter key is over its
monthly limit until **2026-11-01**, so nothing of it can be measured here.

Greg's answer to [q-knkbsk](../user-feedback/questions/q-knkbsk.md) (*"Use your judgment"*, on where
code's rows sort) accepted a recommendation that said this would come next, but nobody has said yes
to its recurring cost, and the queue item is unauthorised. It adds real cost on every long paper,
so it goes to Greg as **[q-ns76uq](../user-feedback/questions/q-ns76uq.md)**: A, build it after
1 November, measured first on the investigation's six articles (a one-off of a few dollars) and
kept only if recall rises; or B, not now. Recommended: A.

The estimate, from production's own bibliography calls (Sonnet 5.5 at $2 per million tokens in and
$10 out, which reproduces their recorded costs): today a list costs **$0.14 on average** over 16
calls, and the most expensive observed was $0.30. It assumes the calls **partition** the article,
so its text is paid for about once, and ~170 output tokens a work, which is what this article's
call wrote (12k tokens for 70 works). Splitting changes nothing under about 70 works. For one like
this (about 240 works) it is **about $0.60–0.65 instead of $0.30**; for a 100-work article (say 50k
tokens in, 17k out) **about $0.30 instead of $0.20**. The **envelope** is about **$1** for a paper
like this: at the 350 tokens a work the step budgets (`PER_WORK_TOKENS`), or if every call repeats
the whole article. **5 of the 16 lists in production** were capped.

## Passed over

- **Moving detection wholly to the model.** It is what drops works now: one call cannot write 240
  rows. Code is free, deterministic and found 214 of 243 here; the model's job is the rest (notes,
  numbers) and the descriptions. That is the queued item, not a replacement.
- **Reading the author–year reference list in the blocks**, so a code row gets its entry's title.
  Worth it (the list is in this article's blocks, unmarked), but separate from finding citations, and
  `citation-reference-list.ts` reads numbered lists only; left for the model half, which would get
  it too.
- **Re-making this article's list, or re-importing it.** principles.md § 1. *Find them again* on the
  Metadata page re-makes the list with code's fill (one model call, about $0.30, possible once
  production's calls run, which they do); only a re-import brings the boxes and their citations back.

## Reviews

- GPT Sol, plan ([261029b-plan-review-sol.md](261029b-plan-review-sol.md)): six findings. Taken:
  the count of what code would have found (1), the ambiguity after a real cite stated and accepted
  on the measurement (2), the whole-list coverage test (3), the cost's assumptions and envelope (4),
  the question reconciled with q-knkbsk and narrowed to a measured build (5), the deploy evidence
  (6).
- GPT Sol, code ([261029b-code-review-sol.md](261029b-code-review-sol.md)): one defect, fixed by
  the reviewer with a red-first test: a comma list inside an unmarked reference entry
  (`OECD (2020). … (Smith 2019, Jones 2018).`) counted as two hits and so escaped `ENTRY_LINE`'s
  one-shape rule; now only directly matched shapes count there. A 20,000-item list runs in 144 ms.
  The measurement above is unchanged by it (re-run 2026-10-29).
