# Trajectory stage 6 — does the route that sees the Ideas cover more of them?

Investigation write-up: [docs/investigations/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md](../investigations/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md).

Stage 6 of [260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md), item 3 of
"Stage 6 as it will be built": the before/after measurement Sol's F65 asked for, against the
[baseline](260928a-trajectory-mode-stage6-coverage-baseline.md). OLD is `trajectory/6` (the route
prompt as of `faa44576`, quotes only); NEW is `trajectory/7` (the current `src/trajectory.ts`, given
the Ideas through code-computed quote↔Idea associations and the top-level outline).

**Verdict in one line:** NEW puts a stop on 7 of 21 Ideas at Gist where OLD puts one on 5, in both
runs of both arms, and holds 13–14 at More where OLD scatters 9–13 — a real but small gain, paid for
with ~35% more per call and no loss of section or word coverage beyond noise.

## Method

- **Script:** [`scripts/eval/trajectory-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts).
  Each arm is that version's own `generateTrajectory`: it renders its own prompt, calls the model
  through `streamMessage` (the gateway, `CAPABLE_MODEL`, effort `low`, same token budget), parses and
  validates with its own `buildTrajectory`. NEW gets `trajectoryInput` exactly as
  `src/pipeline.ts`'s step builds it; OLD is called as `faa44576`'s pipeline called it
  (`usableQuotes`, the whole list for the hash). The OLD module was `git show
  faa44576:src/trajectory.ts` written to `src/trajectory-v6-eval-tmp.ts` so its relative imports
  resolved; it typechecked against the current tree **unchanged**, and was deleted afterwards.
- **Writes nothing to the database** — reads through `pgArticleReader`, spend collected with no
  sink. Both arms `profile: null`.
- **Two runs per arm per article**, all 12 calls on 2026-09-28. OLD-vs-OLD is the noise control.
- **Same inputs for both arms:** the stored Quotes and the Ideas snapshot below. The normal paper's
  Quotes are no longer the baseline's (26, `quotes/5`): they were re-chosen during the stage-5
  browser check (F38) and are now 23, `quotes/7`. Both arms see the same 23.
- **Metrics**, per depth (Gist ≤1, More ≤2, Most ≤3), the coverage script's, except adjacency:
  - **in** (primary) — a stop on the same block as one of the Idea's occurrences.
  - **beside (F65)** — also a stop whose nearest body, non-heading block either side, within the same
    top-level section, holds one (`trajectoryInput`'s walk).
  - **±1** — the coverage script's "in or next to": the adjacent array index, across headings and
    section boundaries. The two adjacencies are not nested, so the brief's "use the stricter" was
    settled empirically: **±1 was ≤ F65 in every cell**, so it is the stricter here, and it is shown
    too. It changes no conclusion (it differs from F65 only on OLD's More row for the normal paper).
  - **sections** — top-level sections with body words that hold a stop; **words** — the stop blocks'
    words, and their share of non-supplement words.

## Step 0 — the Ideas, made current and snapshotted

The normal paper's Ideas were `ideas/2` (outdated); regenerated through the app's own step, `npx tsx
scripts/stage.ts ideas entropy-24-00930-spya-pywwkq`, job `spya-cmhwmg`: 8 → **10 ideas**, $0.1539.
The other two were already `ideas/3`. The script refuses if any article's Ideas are stale or
outdated. The snapshot (ids, names, block positions) is in the results JSON under `snapshot`; in
short:

| Article | Ideas (`ideas/3`) |
|---|---|
| Essay, *Life is Short* (`vb-spya-vu3xen`) | I1 choose your way out of forced obligations · I2 counting turns time into felt scarcity · I3 self-chosen distractions are harder to escape |
| Normal paper, *Neural information processing* (`entropy-24-00930-spya-pywwkq`) | I1 inferred links stand in for wiring · I2 undirected similarity vs directed flow · I3 synergy marks computation · I4 Shannon alone cannot split information; supply a redundancy rule · I5 computation concentrates in hubs · I6 loops among inputs boost synergy · I7 synergy peaks at intermediate similarity · I8 the balance shifts with behaviour · I9 moment-by-moment decomposition · I10 multiple targets / across time |
| Long paper, *Ball lightning observations* (`source-spya-furjgs`) | I1 physical after-effects as stand-ins for measurement · I2 professional training upgrades eyewitness reliability · I3 popular imagery distorts the facts · I4 may be several phenomena · I5 isolated research fragments the field · I6 detection data corroborate testimony · I7 elite samples reveal reporting biases · I8 shock trauma splits into immediate and lasting effects |

## Results

Each cell: **stops · Ideas in / beside (F65) / ±1 · sections with a stop · words (% body)**.

### Summed over the three articles (21 Ideas, 23 content sections, 20,262 body words)

| Arm | Run | Gist | More | Most |
|---|---|---|---|---|
| OLD | 1 | 9 · **5**/5/5 · 8 · 999 | 25 · **13**/14/13 · 16 · 3,100 | 42 · 15/17/17 · 19 · 5,364 |
| OLD | 2 | 9 · **5**/5/5 · 8 · 999 | 22 · **9**/10/9 · 15 · 2,508 | 42 · 15/17/17 · 19 · 5,364 |
| NEW | 1 | 9 · **7**/7/7 · 8 · 1,253 | 22 · **14**/16/16 · 15 · 2,765 | 42 · 15/17/17 · 19 · 5,364 |
| NEW | 2 | 9 · **7**/7/7 · 8 · 1,253 | 22 · **13**/15/15 · 15 · 2,870 | 42 · 15/17/17 · 19 · 5,364 |

### Essay (3 Ideas, 6 sections, 1,687 words)

| Arm | Run | Gist | More | Most |
|---|---|---|---|---|
| OLD | 1 | 2 · 1/1/1 · 2 · 123 (7.3%) | 6 · 3/3/3 · 5 · 519 (30.8%) | 9 · 3/3/3 · 5 · 822 (48.7%) |
| OLD | 2 | 2 · 1/1/1 · 2 · 123 (7.3%) | 5 · 1/1/1 · 4 · 420 (24.9%) | 9 · 3/3/3 · 5 · 822 (48.7%) |
| NEW | 1 | 2 · 1/1/1 · 2 · 123 (7.3%) | 5 · 3/3/3 · 4 · 430 (25.5%) | 9 · 3/3/3 · 5 · 822 (48.7%) |
| NEW | 2 | 2 · 1/1/1 · 2 · 123 (7.3%) | 5 · 1/1/1 · 5 · 361 (21.4%) | 9 · 3/3/3 · 5 · 822 (48.7%) |

### Normal paper (10 Ideas, 9 sections, 8,580 words)

| Arm | Run | Gist | More | Most |
|---|---|---|---|---|
| OLD | 1 | 4 · 2/2/2 · 4 · 572 (6.7%) | 12 · 5/6/5 · 7 · 1,626 (19.0%) | 20 · 7/8/8 · 7 · 2,622 (30.6%) |
| OLD | 2 | 4 · 2/2/2 · 4 · 572 (6.7%) | 10 · 4/5/4 · 6 · 1,295 (15.1%) | 20 · 7/8/8 · 7 · 2,622 (30.6%) |
| NEW | 1 | 4 · 3/3/3 · 3 · 679 (7.9%) | 10 · 7/8/8 · 6 · 1,557 (18.1%) | 20 · 7/8/8 · 7 · 2,622 (30.6%) |
| NEW | 2 | 4 · 3/3/3 · 3 · 679 (7.9%) | 10 · 7/8/8 · 5 · 1,520 (17.7%) | 20 · 7/8/8 · 7 · 2,622 (30.6%) |

### Long paper (8 Ideas, 8 sections, 9,995 words)

| Arm | Run | Gist | More | Most |
|---|---|---|---|---|
| OLD | 1 | 3 · 2/2/2 · 2 · 304 (3.0%) | 7 · 5/5/5 · 4 · 955 (9.6%) | 13 · 5/6/6 · 7 · 1,920 (19.2%) |
| OLD | 2 | 3 · 2/2/2 · 2 · 304 (3.0%) | 7 · 4/4/4 · 5 · 793 (7.9%) | 13 · 5/6/6 · 7 · 1,920 (19.2%) |
| NEW | 1 | 3 · 3/3/3 · 3 · 451 (4.5%) | 7 · 4/5/5 · 5 · 778 (7.8%) | 13 · 5/6/6 · 7 · 1,920 (19.2%) |
| NEW | 2 | 3 · 3/3/3 · 3 · 451 (4.5%) | 7 · 5/6/6 · 5 · 989 (9.9%) | 13 · 5/6/6 · 7 · 1,920 (19.2%) |

**Most is identical in every run** because every offered quote is a stop at Most (9/20/13 = the
offered, same-block-collapsed quotes). Most is the Quotes ceiling, so no route prompt can move it;
only Quotes can.

## The Gist passes, run 1

- **Essay** — both arms chose the same two stops (the closing "prune bullshit, don't wait, savor"
  summary and the 52-weekends passage, I2); only the cue wording differs, NEW's as questions. Yes,
  it gives the headline — the essay's three-part thesis is the summary line — though I1 and I3
  (choosing out of obligations; self-chosen distractions) wait until More.
- **Normal paper** — OLD: synergy defined (I3), the limits of transfer (I3 again), rich-club hubs
  (I5), the closing "neurons do not blindly sum". NEW keeps three of those and swaps the second I3
  stop for the finding that the balance shifts during movement (I8), so four stops reach three
  distinct Ideas instead of two. Both give the headline — synergy is real and concentrates in hubs —
  but neither Gist reaches I4, the method's pivotal caveat that a redundancy rule must be supplied.
- **Long paper** — OLD's three stops are all framing (why it is hard to pin down, randomness versus
  method, what a database would need): nothing of what the paper found. NEW keeps the
  paradigms-versus-chaos conclusion (I3, I5) and adds "numerous witness reports but little evidence"
  (I4, I5) and the case against one "ball lightning norm" (I4), which is closer to a claim. Neither
  reaches I2, the claim the title is about (trained observers are more reliable witnesses), or I1,
  the physical after-effects, so Gist gives the paper's frame but not its headline finding.

## Cost and latency

| | OLD (6 calls) | NEW (6 calls) |
|---|---|---|
| Cost | $0.0998 ($0.011–0.022 per call) | $0.1318 ($0.014–0.029 per call) |
| Input tokens per call | 3,653 / 5,995 / 4,674 | 4,993 / 8,496 / 6,664 (+37–43%) |
| Latency per call | 5.3–13.6 s | 5.2–13.6 s |

The route calls came to $0.2315, plus $0.1539 for the Ideas: **$0.385 in all**.

## Verdict

At **Gist**, NEW beats OLD beyond OLD's own noise: OLD's Gist pass was identical across its two
runs on every article (5/21 Ideas "in"), and NEW's was identical across its two (7/21). It gains an
Idea on each paper and ties on the essay, where both chose the same two stops. At **More** the gain
is real on the normal paper (7/10 in both NEW runs against OLD's 5 and 4). Elsewhere it sits inside
the noise: the essay swings 3 ↔ 1 in *both* arms, and the long paper is 4–5 in both. Summed, NEW
gets 13–14 against OLD's 9–13, so NEW's worse run roughly equals OLD's better run. Section and word
coverage do not suffer. Gist sections tie (8/23; NEW loses one on the normal paper and gains one on
the long paper), Gist words go up (999 → 1,253), and More's sections (15 vs 15–16) and words
(2,765–2,870 vs 2,508–3,100) sit inside OLD's range, though OLD run 1 took three more stops at More.
Most cannot differ, since it is the Quotes ceiling. This is a smoke set of three articles and two
runs, so the defensible claim is narrow: **`trajectory/7` makes Gist reliably carry more of the key
points and makes More steadier, for ~$0.005–0.008 more per route.** It keeps the version. It does
not fix the long paper's Gist leaving out the claim its title makes, and that is a route choice
rather than a missing quote. Two offered quotes carry I2, and NEW run 1 put one at More (in
*Scientists as observers*) and the other at Most. The prompt asks for "the headline few at Gist"
but does not say which Ideas are the headline ones, so the model picks by its own reading.

Results: `evals/results/trajectory-coverage-2026-09-28T14-38-13.json` (every run's stops, cues,
per-stop Ideas and metrics, and the Ideas snapshot).

## Abstract excluded

Greg, 2026-09-28: *"Slight tweak to Trajectory mode - prefer not to include the Abstract as part of
a trajectory, since that's kinda obviously already a good place to get the gist, and it's dense."*
Folded into `trajectory/7` (unreleased): quotes under an *Abstract* heading (or an opening
*Summary*) are not offered (`inAbstract`), and the prompt says why. One NEW-only run per article,
`npx tsx scripts/eval/trajectory-coverage-eval.ts --runs=1 --new-only`, $0.072.

**On these three articles it changes nothing the route can stop at.** The two papers do have an
abstract under a heading — *Front Matter › Abstract and Keywords* (normal paper) and *Article
overview › Abstract* (long paper), both detected — but Quotes chose no quote in either, so 0 offered
quotes were excluded on each; the essay has no abstract. The stage-6 NEW runs had 0 abstract stops at
every depth for the same reason, and so does this run. Only the prompt's new sentence differs.

| Article | Quotes in abstract (excluded) | Abstract stops, stage 6 NEW → now | Ideas "in", Gist / More / Most: stage 6 NEW (runs 1, 2) → now |
|---|---|---|---|
| Essay | 0 | 0/0/0 → 0/0/0 | 1,1 / 3,1 / 3,3 → 1 / 1 / 3 |
| Normal paper | 0 | 0/0/0 → 0/0/0 | 3,3 / 7,7 / 7,7 → 3 / 7 / 7 |
| Long paper | 0 | 0/0/0 → 0/0/0 | 3,3 / 4,5 / 5,5 → 3 / 4 / 5 |

Every number sits inside the stage-6 NEW range, as it should for an unchanged set of offered
quotes. The exclusion itself is pinned by tests/trajectory.test.ts, not by this run.

Results: `evals/results/trajectory-coverage-2026-09-28T15-39-48.json`.
