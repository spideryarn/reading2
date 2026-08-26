# Eval results

One file per run, committed. The point is that a later change gets argued against a number rather
than against somebody's memory, so these are kept even when they are superseded — especially the
ones that stop being obtainable once an artefact is regenerated.

New files are named by the harness with a timestamp to the second. The ones below were renamed by
hand to say what they *are*, because they are the baseline the label split is judged against and
"which of these three timestamps was the before" is not a question worth asking twice.

## The label split (`toc-labels.ts`), 2026-08-26

See [docs/plans/toc-scaling.md](../../docs/plans/toc-scaling.md).

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
exactly as the pricing predicts. A reader who searches a piece, asks a question and explains a
sentence crosses it immediately.

These runs also found two real bugs that no unit test could have:

- `cache_write_tokens` was being read from `usage.cache_write_tokens`, one level too high. It is
  nested in `prompt_tokens_details`. Every log line said `cacheWriteTokens: null` — indistinguishable
  from a provider that had not sent the field.
- `tooShortToCache` measured only the marked block rather than the whole prefix, so `writes`
  (an 893-token article whose request caches 2,056 tokens) reported `true` while caching worked.
  A false alarm, which is the costly direction.

Both are fixed and pinned by tests. See
[docs/project/prompt-caching.md](../../docs/project/prompt-caching.md).
