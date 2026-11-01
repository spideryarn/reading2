# Citations: every work, cheaply — a Haiku 5.5 eval

Queue item `qi-cypykdrn`, from Greg's report `spya-d5e2jk` and his answer to
[q-ns76uq](../user-feedback/questions/q-ns76uq.md):

> Let's run some evals on a few papers. I'm hoping we can do this with Haiku v5.5, maybe with a
> medium or higher amount of reasoning. Give it a bunch of examples of what citation formats can look
> like, and we definitely want it to find all of the citations, but I also feel like it should be able
> to do this more cheaply. I'm surprised that the model didn't find them all. I feel like that's
> probably a failure of prompting, or we need to pick a different model.
>
> — Greg, 2026-10-29 (`spya-yyvxm0`)

Up: [bibliography.md](../project/bibliography.md). Builds on
[261029b](261029b-citations-in-a-comma-separated-list-are-all-read.md) and
[investigation 261027a](../investigations/261027a-how-often-citations-are-missed.md). The write-up
will be [investigation 261101a](../investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md).

## What we know before spending anything

- **The prompt tells the model to stop.** `src/bibliography.ts` § `SYSTEM`, *HOW MANY*: "At most
  80 rows. If the article cites more than 80 works, keep the 80 it leans on most". And the user
  turn: "List the works this article cites — at most 80." So on a 243-work paper, stopping at ~70
  is partly obedience. Greg's "failure of prompting" is at least half right before we measure.
- **But not only that.** LeCun's list stopped at 23 of 105 with `capped: false`
  (261027a): the model under-listed below the cap, in dense paragraphs (one 14-work parenthesis
  gave one row). That is the recall fault proper, and the one format examples and an
  "every citation, block by block" instruction are for.
- **The cost is the output, and Haiku changes the arithmetic.** Haiku 5.5 is $0.10 / $0.50 per
  million tokens (prompts under 100K; $0.50 / $2.50 above), Sonnet 5.5 $2 / $10 — twenty times
  cheaper. Haiku's output limit is 128K, like Sonnet's. A 240-work list at ~170–350 output tokens a
  row is 40–85K tokens: about $0.02–0.04 of Haiku output, against $0.30 for today's capped Sonnet
  call. **If Haiku can write every row in one call, splitting (q-ns76uq option A) is not needed.**
- The box's OpenRouter key: `limit_remaining` $600 on 2026-11-01 (asked first, per ai-gateway.md).

## The eval

Seven articles, the six of the 261027a hand count plus the paper Greg reported:

| article | style | where |
|---|---|---|
| Butlin, Long et al., *Consciousness in AI* (arXiv 2308.08708) | author–year, commas, ~240 works | local `arxiv-2308-08708-spya-w598t3` |
| LeCun, *A Path Towards AMI* (PDF) | author–year, no list in blocks, 105 | production `10356-a-path-towards-autonomous-mach-spya-jwqnrf`, read only |
| Srivastava et al., *Dropout* (JMLR) | author–year, 36 | local |
| Vaswani et al., *Attention* (arXiv) | numbered `[n]`, 40 | local |
| Layfield et al. (Sci Rep) | glued superscript digits, 70 | local |
| Clark & Chalmers 1998 | author–year and footnotes, 17 | local |
| *Synesthesia* (Wikipedia) | numbered footnotes, 152 | local |

**Ground truth**, written once, before any arm runs, into
`evals/results/citations-recall/261101a-truth/<slug>.json`: every distinct work the body cites,
each with what lets a row be matched to it — the reference block if the article has one, the
entry's number, first-author surname and year. Counts reconcile with the hand count's N for the
six (105, 36, 40, 70, 17, 152); for Butlin, against its own reference list as 261029b counted it.
Built by a subagent from the blocks, not from any model's list, so no arm is graded against
itself. LeCun's blocks are read from production read-only into a gitignored file under `data/`;
only the keys (surname:year) are committed.

**Scoring** (`evals/citations-recall/score.ts`, free, re-runnable): the model's answer goes through
production's own `toDrafts` — so a row counts only if a place verifies, exactly as in the app — and
**before** `keepLeanedOnMost`'s cut, so the model's own recall is measured, not the 80 cap. Each
verified row is matched one-to-one to a truth work: same reference block, or same entry number, or
first-author surname (accent-folded, whole word in `authors` or the title) and year. Reported per
article: recall (truth works covered), rows matching no truth work (each read by hand: a truth gap or
a false row), verification drops, input/output tokens and cost from the call's own usage.
Also the end-to-end number a reader sees: the same answer through `buildBibliography` with code's
fill (`rowsFromText`), cap included, for the arms that keep the cap.

**Arms** (one call an article each; `streamMessage`'s eval `model` override, as
`evals/quiz-models.ts` uses it; the article text and schema exactly production's):

| arm | model | prompt | effort | runs |
|---|---|---|---|---|
| S0 | Sonnet 5.5 | `citations/7`, today's | medium | 1 — today's baseline, fresh |
| H0 | Haiku 5.5 | `citations/7` | medium | 1 — the model alone |
| H1 | Haiku 5.5 | new: every work, format examples | medium | 2 |
| H2 | Haiku 5.5 | new | high | 2 |
| S1 | Sonnet 5.5 | new | medium | 1 — the prompt alone, on Sonnet |

**The new prompt**, changed only where recall is decided (prompting-guide.md read; the `why` stays
under `plainWords("explain")`):

1. *HOW MANY* becomes **every work**: no cap, no "keep the ones it leans on most", and `capped`
   true only if it stopped before the end. The user turn drops "at most 80".
2. A new **WHAT A CITATION LOOKS LIKE** section of examples: parenthetical and narrative
   author–year, lists split by `;` and by `,`, `et al.`/`and`/`&`, letter suffixes (2020a/2020b are
   two works), one author with two years (two works), `see`/`e.g.`/page numbers, *forthcoming*/*in
   press*/*n.d.*, bracketed numbers, ranges `[3–6]` (four works), superscripts flattened into the
   word (`memory1-7`), Wikipedia `[12]` footnotes, footnote markers, linked titles.
3. **How to work**: go through the article block by block, in order; a paragraph that cites ten
   works is ten rows; a work counts once however often it is cited.
4. `max_tokens` sized for 300 works (400 + 300 × 350 = 105,400, plus `budgetFor`'s headroom capped
   at `MODEL_MAX_TOKENS`, 128K).

Rough cost: S0+S1 about $2–3 (seven Sonnet calls each, the two long ones ~$0.30–0.60); the Haiku
arms well under $2 together. Under $10 all in.

## What decides it

- **Ship** (to `dev`, with the measurements) if a Haiku arm reaches **≥ 95% recall on every
  article** (the four short ones, 70 works or fewer, are 99–100% today and must stay there), with **no more false rows
  than S0**, at **lower cost per article than S0**, and its `why`s hold up on a read of 20 rows
  beside Sonnet's for the same works. Shipping then means: `bibliography` pinned to Haiku 5.5
  (`PINNED_MODEL`, its own constant, as the other Haiku jobs), the new prompt as `citations/8`, the
  cap raised so the rows the model writes are kept (`MAX_CITATIONS`; the registry's lookup ceiling is
  already its own constant), and the answer budget raised. Code's fill stays as the safety net.
- **Ask Greg** (q-ns76uq rewritten) if the evidence is mixed: e.g. Haiku finds everything but its
  `why`s are worse, or only `high` effort gets there and costs near Sonnet, or Sonnet with the new
  prompt wins on recall at a cost Haiku does not.
- **Nothing ships unmeasured**, and nothing in production is re-made (principles.md § 1).

## Passed over

- **Splitting a long article across calls** (q-ns76uq option A). More calls and a merge, for a
  limit the prompt itself imposes and Haiku's price may make irrelevant. Greg's answer prefers
  trying prompt and model first; if no single call gets there, splitting comes back with numbers.
- **A detection-only call (no `why` or scores) plus a second describing call.** Cheaper output per
  row, but two calls and a join for a cost that, on Haiku, is cents. Only worth it if one Haiku call
  cannot fit every row in 128K.
- **Haiku at low effort.** Greg asked for medium or higher.
- **Changing what a row is** (fields, schema). The schema stays, so a winning arm is a drop-in.

## GPT Sol's plan review, and what changed

[261101a-plan-review-sol.md](261101a-plan-review-sol.md): nine findings, all taken.

1. **Canonical works, not citation numbers.** The truth gives each work every alias (number and
   reference block), so a correct row for Synesthesia's note 24 also stands for note 66.
2. **Body citations adjudicated on their own.** Truth is what the body cites; reference-list
   entries no body block cites are a separate `listOnly` list, so a model row for one is counted as
   legitimate, not false.
3. **Scored after production's folds, by maximum matching.** `buildBibliography` gained an
   eval-only `cap` option (no production caller passes it), so the score reads the folded list:
   uncapped and without code's rows for the model's own recall, and at 80 and 300 with code's fill for
   what a reader gets. Matching is maximum one-to-one, exact edges first (a reference block only when
   it is one work's alone; an entry number); a bare year stands for a lettered work only where the
   truth marks no ambiguity.
4. **The budget.** The candidate arms send `max_tokens` 128,000 straight, not through `budgetFor`
   (which would throw). Elapsed time is recorded against the job's 740-second claim deadline; a
   truncated answer counts as zero.
5. **`capped` stays truthful.** The candidate keeps a hard ceiling of 300 (`CANDIDATE_CAP`), and
   `capped` means only "cites more than 300". Recall is reported at 300 as well as uncapped.
6. **The model stamp and freshness**, if Haiku ships: a bibliography-specific model constant used
   for the call, the logs, the stamp and the store's freshness check, tested at both powers.
7. **`citation-blurbs` downstream**: if shipping raises the cap, one 240-row list is taken through
   the blurbs job first, for its spend, duration and partial rows.
8. **The ship rule, tightened**: every repetition passes; no short article drops below S0's
   recall on it; a false-row *rate*, not a count; a fixed sample of `why`s read blind; a refused,
   truncated or unparseable answer is zero recall.
9. **Cost as OpenRouter billed it**: each article's call runs under its own `collectSpend`, retries
   included; no prompt caching, so every arm is cold. (OpenRouter lists Haiku 5.5 flat at
   $0.10/$0.50, so the 100K step in the claude-api skill's table may not apply there; the bill
   decides.)

## High-powered AI

`bibliography` is on the capable tier today, so High-powered AI moves it to Opus. Pinning it to
Haiku would mean High-powered AI no longer moves it, as with every other pinned Haiku job. Said here
so it is decided, not inherited; if Haiku wins on recall, a pin is the simple version.
