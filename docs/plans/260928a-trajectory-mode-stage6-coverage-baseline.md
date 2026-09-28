# Trajectory stage 6 — a coverage baseline, and the script that produces it

Stage 6 of [260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md): a re-runnable
measurement of how much of an article Trajectory's route actually touches, replacing the
hand-computed numbers in
[stage1-real-runs.md](260928a-trajectory-mode-stage1-real-runs.md). The script is
[`scripts/trajectory-coverage.ts`](../../scripts/trajectory-coverage.ts); this is one baseline run
of it, on the local database, on the same three articles stage 1 used.

## What "in" and "next to" mean

Trajectory's stops are Quotes; a stop's passage is the block its quote sits in
(`Quote.blockId`). An Idea's occurrences each name a block too
(`IdeaOccurrence.blockId`, src/types.ts). For one idea, at one depth:

- **"in"** — some stop visible at that depth sits in the same block as one of the idea's
  occurrences.
- **"in or next to"** — some stop sits in that block, or in the block immediately before or after
  it **in document order** (the blocks array index, never the block id — ids are random,
  [block-ids.md](../project/block-ids.md)). This is the more generous number: an idea whose passage is one
  paragraph over from a stop is still something a reader skimming that stop would likely notice.

Both are computed per idea — true if *any* of its occurrences qualifies — then reported as a share
of all Ideas. "Body words" excludes any block with `treatment === "supplement"` (footnotes,
references); a top-level section with none is excluded from the section-coverage denominator, since
there is nothing there a stop could cover. "Quotes per top-level section" is the coverage
**ceiling**, not a Trajectory number: a stop can only land where a Quote already is, so a section
with zero quotes can never get a stop at any depth. See the script's own header for the full
reasoning and the exact block-range logic.

## The command

```
npx tsx scripts/trajectory-coverage.ts <slug> [<slug>…] [--json]
```

Reads only, through `pgArticleReader` (the same adapter the reading view calls) — writes nothing.
It errors loudly (non-zero exit, one line per failed article) rather than printing zeros when an
article has no Ideas or no Trajectory route; it does not treat `stale`/`outdated` as a reason to
refuse, only to report.

## What was generated to make this baseline current

Two of the three articles had no Ideas yet, and all three routes were on an old prompt version
(`trajectory/3` or `trajectory/5`; current is `trajectory/6`). Generated on the local database,
`claude-sonnet-5`, 2026-09-28, via `scripts/stage.ts` run through `scripts/tmux-job.ts`:

| Article | Step | Result | Cost |
|---|---|---|---|
| Essay (`vb-spya-vu3xen`) | `ideas` (missing → generated, `ideas/3`) | 3 ideas | $0.0650 |
| Long paper (`source-spya-furjgs`) | `ideas` (missing → generated, `ideas/3`) | 8 ideas | $0.1833 |
| Essay | `trajectory --force` (`trajectory/5` → `trajectory/6`) | 2/6/9 stops over 9 quotes | $0.0115 |
| Normal paper (`entropy-24-00930-spya-pywwkq`) | `trajectory --force` (`trajectory/5` → `trajectory/6`) | 5/11/21 stops over 21 quotes | $0.0234 |
| Long paper | `trajectory --force` (`trajectory/3` → `trajectory/6`) | 3/7/13 stops over 13 quotes | $0.0158 |

Total: **$0.299**. The normal paper's Ideas were left as they were (`ideas/2`, current is `ideas/3`
— `loadIdeas` reports it `outdated` but not `stale`) since only Trajectory's freshness was in scope
for this stage; regenerating it is a separate, optional $0.06–0.20.

## Baseline, `trajectory/6`, 2026-09-28

| | Essay: *Life is Short* (`vb-spya-vu3xen`) | Normal paper: *Neural information processing* (`entropy-24-00930-spya-pywwkq`) | Long sectioned paper: *Ball lightning observations* (`source-spya-furjgs`) |
|---|---|---|---|
| Body | 1,687 words, 6 top-level sections | 8,580 words, 9 top-level sections | 9,995 words, 8 top-level sections |
| Ideas / Quotes | 3 / 10 | 8 (outdated) / 26 | 8 / 16 |
| Stops at Gist / More / Most | 2 / 6 / 9 | 5 / 11 / 21 | 3 / 7 / 13 |
| Words (% of body) at Gist | 123 (7.3%) | 773 (9.0%) | 304 (3.0%) |
| Words (% of body) at More | 509 (30.2%) | 1,525 (17.8%) | 715 (7.2%) |
| Words (% of body) at Most | 822 (48.7%) | 2,769 (32.3%) | 1,920 (19.2%) |
| Ideas "in" at Gist / More / Most | 1/3 · 1/3 · 3/3 | 2/8 · 4/8 · 6/8 | 2/8 · 4/8 · 5/8 |
| Ideas "in or next to" at Gist / More / Most | 1/3 · 2/3 · 3/3 | 3/8 · 5/8 · 7/8 | 2/8 · 4/8 · 6/8 |
| Sections with a stop / with body words, at Gist / More / Most | 2/6 · 5/6 · 5/6 | 4/9 · 6/9 · 7/9 | 2/8 · 5/8 · 7/8 |
| Sections with body words but no quote at all | 1 of 6 (Notes) | 2 of 9 (Front Matter, Future Directions) | 1 of 8 (Article overview) |

Full quotes-per-top-level-section, the coverage ceiling:

- **Essay:** Life Actually Is Short 1 · Eliminating Bullshit 3 · Seeking What Matters 2 · Surprised
  by Loss 3 · Savoring the Time You Have 1 · Notes 0.
- **Normal paper:** Front Matter 0 · Introduction 2 · Tracking Information 3 · Information
  Processing 1 · PID 5 · PID in Action 10 · Practical Considerations 3 · Future Directions 0 ·
  Summary 2.
- **Long paper:** Article overview 0 · Historical outline 3 · Methodology 1 · Scientists as
  observers 4 (over 4,587 words, 46% of the body) · Other trained observers 1 (over 1,896 words) ·
  Synopsis of cases 1 · Other notable cases 2 · Conclusions 4.

## Reading it against stage 1

The numbers land close to stage 1's `trajectory/3`/`/5` runs (essay 2/5/9 → 2/6/9; normal paper
5/12/21 → 5/11/21; long paper 4/6/13 → 3/7/13) — the cue-prompt rewrite changed a stop or two per
pass but not the shape of the result. The coverage ceiling is unchanged and is still the real
constraint stage 1 named: **Most reaches only 19–48% of a piece's words**, and the two sections
stage 1 called out as under-quoted — the normal paper's *Future Directions* (636 words, 0 quotes)
and the long paper's *Scientists as observers* (46% of the body, 4 quotes) — are exactly the two
weakest rows here too. Idea coverage is new: even at Most, the normal and long papers only put a
stop in or next to 7–8 of 8 Ideas, and at Gist alone (the pass Greg is most likely to actually read)
only 1–2 of 8 Ideas have a stop nearby on the two papers — the essay's short, single-thread argument
is the outlier, reaching all 3 of its Ideas by More.
