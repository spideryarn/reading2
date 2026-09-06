# Eval results

One file per run, committed. The point is that a later change gets argued against a number rather
than against somebody's memory, so these are kept even when they are superseded — especially the
ones that stop being obtainable once an artefact is regenerated.

New files are named by the harness with a timestamp to the second. The ones below were renamed by
hand to say what they *are*, because they are the baseline the label split is judged against and
"which of these three timestamps was the before" is not a question worth asking twice.

## The label split (`toc-labels.ts`), 2026-08-26

See [docs/plans/260826h-toc-scaling.md](../../docs/plans/260826h-toc-scaling.md).

| File | What it is |
|---|---|
| `incumbent-whole-pass-2026-08-26.json` | **The baseline, and it is not reproducible.** Both articles' trees as one whole-article model call wrote them, before stage 4 split in two. The trees themselves were overwritten by the first split run; these numbers are all that is left of them. |
| `batched-2026-08-26.json` | The same two articles after the split — structure in one call, labels in parallel batches. |
| `batched-noema-rerun-2026-08-26.json` | One of three re-runs of the 141-block article, which is where the ~4-point run-to-run variance on vocabulary retention comes from. Two of the three were lost to a filename that only went to the minute; the harness now stamps to the second, and the three figures are quoted in the plan. |

Both articles are measured by the same harness with heading labels excluded — an earlier version
counted them, and since a heading's label is *required* to be its heading copied exactly, that
measure was largely reporting how many headings each article has.

## Other runs

`reorder-quality-before.md` belongs to a different piece of work and is not part of the above.

## `embedding-retrieval-*` — which embedding model, 2026-08-26

Written by `npm run eval:embeddings`. The write-up is
[embedding-retrieval-2026-08-26.md](embedding-retrieval-2026-08-26.md); the JSONs are the raw
retrieval and per-query scores behind it.

| File | What it is |
|---|---|
| `embedding-retrieval-2026-08-26T0907.json` | The five-arm run, judged by Claude Sonnet 5 (the repo default, `src/models.ts`). |
| `embedding-retrieval-2026-08-26T0908.json` | **The same retrieval, judged again by Claude Opus 5.** Not a duplicate — it is the check on whether the verdict is a fact about the models or one judge's opinion. It is not: the two agree on 84.6% of the 221 pairs and nothing directional moves. |
| `embedding-retrieval-judgements-claude-<model>.json` | One judgement cache per judge. **Named after the judge on purpose** — a single shared cache would let the second judge silently re-read the first one's answers and "agree" with itself. Each file records the judge and the rubric version it was made under, and is discarded rather than half-used if either has moved. |

The judgement caches are the reusable part. The embeddings and the retrieval are deterministic and
cost fractions of a penny to redo; the judgements are the expensive, non-deterministic half, so a
re-run against a new candidate arm only pays for the passages no incumbent had surfaced.

**Absolute scores from these two files may not be quoted beside a run with a different arm set.**
Relevance is judged over the union of every arm's top 5, so adding an arm lengthens the list the
judge calibrates against and it grades a shade more strictly. A two-arm run of this same harness
earlier the same day put `3-small` at P@5 64.4% and `bge-m3` at 42.2%; these five-arm files read
61.1% and 37.8% for identical retrieval. The gap did not move — the scale did. Those two-arm files
were deleted rather than kept, precisely so nobody reads a row across.

## `cost-per-article-2026-09-03.md` — what one article costs us

Written from the ten runs under [`cost/`](cost), each of which keeps its own `run.json`. **An
ingest is $0.03 on a 561-word essay and $0.33 on a 16,855-word one; everything pressed, $0.35 and
$1.55.** The report carries the reproduction command for every figure and the provenance of each —
commit, effort, fixture hash — because a config constant moved mid-ledger once and nearly made an
earlier analysis wrong by 2×.

The `run.json` files are the record and the report is the reading of them. Three things in them are
deliberately *not* prices and the report says so at length: two generations billed in full that
wrote nothing, one round labelled cold that read a cache an earlier run had written, and one call
whose cache state the provider does not report.

## `hierarchy-effort-2026-09-03.md` — does the structure pass need to think at `medium`?

Written by `npm run eval:hierarchy-structure`, on a 16,846-word fixture. **`low` won the blind
judging, and the free heading tree beat both paid `medium` arms** — four judgments, two model
families, two independent draw sets, identical ranking every time. `low` is also 36% cheaper and 47%
faster. Luna came last and one judge called it unusable.

**The document reversed itself and keeps the reasoning, which is the part worth reading.** The
mechanical proxies favoured `medium` (2.6× less repair, no dropped sections) and it first concluded
"keep `medium`". Those proxies describe the model's raw *proposal*; the judges rated the *delivered*
tree, after repair. Two further self-corrections are recorded in it: the "`low` invents its own
boundaries" story is withdrawn (`l1OnHeadings` is 96.7% vs 95.8%), and so is a claimed length
threshold (the short and long runs use different articles, so length and article are confounded).

**Do not flip production on it** — one article — and note the free tree has *no gists*, so it cannot
replace the paid call. The finding it points at is that the author's headings carve better than the
paid call does, which makes `headings-seeded` the experiment nobody has run.

Read the resolution-floor table before quoting any other row: the shipping recipe disagrees with
*itself* by as much as it disagrees with `low` on title retention and heading-boundary fidelity, so
those two rows say nothing. The runs it reads are the six `2026-09-03-09/10-*` directories under
[`hierarchy-structure/`](hierarchy-structure).

The 2026-08-30 runs in that directory are **not** one series with these: their `incumbent` arm was
`effort: "high"` while production ran `"medium"`, which is the bug this run had to fix first.

## `hierarchy-cheap-models-2026-09-03.md` — can a cheaper model carve an article?

Nine models against production Sonnet on three articles, under a zero-retention routing constraint.
**The headline is not a model: most failures were caused by the gateway's provider routing rather
than by the model.** All four DeepSeek failures were served by one upstream (DigitalOcean, returning
reasoning and no answer) while every other DeepSeek call succeeded, including a direct probe of the
identical request — so reported as a model failure it would have written off the cheapest model in
the field. `zdr: true` with no pin load-balances across up to twenty-two upstreams of very uneven
quality, and pinning has its own cost: the pinned arm got 429s.

**The one finding strong enough to act on is about effort, not about a new vendor.** Sonnet `low`
and Sonnet `medium` produced a tree equally often here (6/7 each), `low` costs 45% less and runs
about twice as fast, and `low` was judged better in **eight blind judgements out of eight** across
this eval and the effort eval above — two arm sets, two judge families, two studies. The named fault
against `medium` is *welding*: fusing two of the author's own arguments under one title, which is
valid, silent, and shipped to every reader.

**It also documents its own corrections, which is the part worth reading.** An earlier draft read
one draw per cell as reliability records; a two-draw panel broke three of those readings, including
the load-bearing one — production `medium` failed the control article with the *same* error `low` had
failed on, on a draw where `low` passed. Three arms fail that article by dropping the same 3-block
tail, so it is a fact about the article. Claude Fable, arbitrating, named that inversion as the
least-supported claim in the brief before the panel confirmed it.

Do not rank arms by repair count: `gemini-3.8-flash` held the best mechanical scores in the whole
field — zero repairs, best-balanced carving, 10× cheaper, 8× faster — and was judged **last** by
both judges, and managed 1 of 3 articles. That is the third time here that the mechanical proxies
have pointed the wrong way. Judging materials and all four verdicts are under
[`hierarchy-structure/judging-cheap-2026-09-03/`](hierarchy-structure/judging-cheap-2026-09-03).

## `prompt-caching-*.md` — the article is really being cached

Written by `npm run eval:caching`, 2026-08-26, against the live API. Three articles, each searched
twice. **All three pass**: the second call reads the whole prefix back.

| article | prefix | cold call | warm call | uncached |
|---|---:|---:|---:|---:|
| `constitution` (360 blocks) | 47,739 | $0.11945 | $0.00965 | $0.09558 |
| `noema` (141 blocks) | 18,793 | — | $0.00386 | $0.03769 |
| `writes` (19 blocks) | 2,056 | $0.00524 | $0.00051 | $0.00421 |

The constitution row is the one to read, because it is a genuine cold start. It shows the whole
bargain in two lines: the first call costs **25% more** than uncached ($0.119 against $0.096 — the
1.25× write premium), and every call after it costs **10%** ($0.0097). Break-even is the second use,
exactly as the pricing predicts.

**But "the second use" means the second use of the *same feature*.** An earlier version of this
paragraph said a reader who searches a piece, asks a question and explains a sentence crosses
break-even immediately. That is wrong, and it is the mistake this doc exists to prevent: those are
three different caches, because the three requests differ before the article is reached, so all
three are cold writes and the reader is 25% *down*. It is the second search, the second chat turn,
the second explanation that pays. GPT Sol caught the claim in review, 2026-08-26.

These runs also found two real bugs that no unit test could have:

- `cache_write_tokens` was being read from `usage.cache_write_tokens`, one level too high. It is
  nested in `prompt_tokens_details`. Every log line said `cacheWriteTokens: null` — indistinguishable
  from a provider that had not sent the field.
- `tooShortToCache` measured only the marked block rather than the whole prefix, so `writes`
  (an 893-token article whose request caches 2,056 tokens) reported `true` while caching worked.
  A false alarm, which is the costly direction.

Both are fixed and pinned by tests. See
[docs/project/prompt-caching.md](../../docs/project/prompt-caching.md).

## `summaries/` — the Socratic question wording, 2026-09-05

[`summaries/2026-09-05T18-04-46-socratic-questions.md`](summaries/2026-09-05T18-04-46-socratic-questions.md)
is the promoted `results.md` of the seven-arm run behind
[docs/plans/260905f-…](../../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md#the-result-the-gate-held-and-it-is-anchor-2-that-tripped-it):
854 of 854 calls, $2.5853, and **no ranking**, because the calibration gate
(`MAX_ANCHOR_INVERSIONS = 0`) took fifteen inversions and anchor 2 tripped it. The declared outcome,
not a failed run — and the reason report 24 is still
[awaiting Greg](../../docs/user-feedback/awaiting-approval.md).

The run itself lived under gitignored `output/summaries-runs/`, which is deliberate — judging
materials are real article prose and must not be committed — so **only `results.md` is promoted, by
hand**, and it was promoted here on 2026-09-06 when its worktree was removed. The shape table and
the inversion list are all that survive of it.

[`summaries/trailing-comma/`](summaries/trailing-comma/) is three raw model answers from the same
eval, kept for a different reason — its own README says which.
