# Trajectory stage 2: do the deeper passes add detail? (measured, not kept)

Stage 2 of [260929b](260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md).
Greg, SPIDERYARN-READING2-51:

> For Trajectory mode, let's assume the reader has read the coarser levels already, so the
> more-detailed levels should be adding extra detail/subtlety/complexity.

**Verdict in one line:** the candidate `trajectory/8` prompt did not beat `trajectory/7`. The blind
read came out 2–2 with 2 ties, and old against old came out 3–2 with 1 tie. Coverage held, so
nothing broke, but nothing improved either. **It is not kept**: `src/trajectory.ts` stays at
`trajectory/7`, and only a comment records the attempt. The cause is structural. A route prompt
cannot do what the report asks, because Most is every offered quote (see *Why* below).

## The prompt change that was tried

Against `trajectory/7` (HEAD `b55353e0`), plus `PROMPT_VERSION = "trajectory/8"`:

```diff
@@ WHAT YOU DECIDE, 2. THE DEPTH
    Each pass must ADD stops to the one before it.

+   A reader at MORE has already read the GIST stops, and a reader at MOST has
+   already read the MORE stops. So the stops a deeper pass adds should bring
+   what the pass before left out: the ideas it did not reach, and for the ones
+   it did, the method, the evidence behind a headline, the caveats, the
+   exceptions, the subtleties and complications — not a second telling of a
+   point the reader has already met.
+
    EACH PASS COVERS AS MANY KEY IDEAS AS THE QUOTES ALLOW. …
@@ 3. A CUE
    … because a reader can arrive at any stop from anywhere.
+   The cue of a stop a deeper pass adds should say what it adds — the method,
+   the caveat or the exception to look for — still without naming another stop.
```

Nesting, quote-only stops, Idea coverage, the cue rules, the Abstract rule and `plainWords("ask")`
were all left as they were. A test for the new wording was written first and failed as expected,
then passed once the wording was in. It was removed along with the change.

## Method

Everything followed [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).

- **Script:** [`scripts/eval/trajectory-coverage-eval.ts`](../../scripts/eval/trajectory-coverage-eval.ts),
  generalised to take two modules of the same shape (Sol's F2 on this plan). OLD was `git show
  HEAD:src/trajectory.ts`, written to `src/trajectory-v7-eval-tmp.ts`, which typechecked unchanged
  and was deleted afterwards (checked with `test -e`, exit 1). NEW was the candidate in
  `src/trajectory.ts`. Each arm used its own `trajectoryInput` and `generateTrajectory`, went
  through the gateway, and ran with `profile: null`. **Nothing was written to the database.** The
  spend collector had no sink.
- **Command:** `npx tsx scripts/eval/trajectory-coverage-eval.ts --runs=2
  --old=src/trajectory-v7-eval-tmp.ts --old-version=trajectory/7 --new-version=trajectory/8`, run
  through `tmux-job`, which ended with EXIT=0. That is 12 calls on 2026-09-29.
- **Same snapshot for both arms:** the stored Quotes and Ideas of the three articles in
  [260928a](260928a-trajectory-mode-stage6-coverage-after.md): the essay `vb-spya-vu3xen`, the
  normal paper `entropy-24-00930-spya-pywwkq` and the long paper `source-spya-furjgs`. The
  snapshot is in the results JSON.
- **The blind read:** [`scripts/eval/trajectory-depth-blind.ts`](../../scripts/eval/trajectory-depth-blind.ts).
  Each article gives two pairs, one at More (depth 2) and one at Most (depth 3). Each side of a
  pair shows that arm's own pass before (every stop at a shallower depth), then the stops added at
  this depth, each with its cue, quote and whole paragraph. This follows Sol's F3: the judge must
  see the earlier pass to spot a repeat.
  - **Shuffling:** sides were shuffled per pair by a Fisher–Yates shuffle with `crypto.randomInt`
    over a list balanced by construction. The key came out 3/6 old-on-A in both files, and it was
    written before any judging.
  - **Scoring:** every added stop was marked **D** (adds detail, subtlety or complexity), **F**
    (new, but framing or background) or **R** (repeats the pass before). Then one side was picked,
    or a tie called.
  - **Control:** OLD run 1 against OLD run 2, prepared the same way.
- **The judge was me,** as the brief asked: no subagent, and the keys stayed unopened until both
  judgment files were saved. There are three caveats:
  - I wrote the candidate prompt, so I am not a neutral judge.
  - OLD run 1 appears in both files, so identical sides can be matched across them. The blind
    judgment was saved before I read the control file.
  - Before judging I saw one line of the run log, which showed a NEW run's coverage numbers but no
    stop text.

## Idea coverage (must not fall)

Each cell reads **stops · Ideas in / beside (F65) · sections with a stop · words**. The totals are
over the three articles: 21 Ideas and 23 content sections.

| Arm | Run | Gist | More | Most |
|---|---|---|---|---|
| OLD `/7` | 1 | 9 · **7**/7 · 7 · 1,230 | 22 · **12**/15 · 16 · 2,654 | 42 · 15/17 · 19 · 5,364 |
| OLD `/7` | 2 | 9 · **8**/8 · 8 · 1,208 | 22 · **13**/14 · 16 · 2,843 | 42 · 15/17 · 19 · 5,364 |
| NEW `/8` | 1 | 9 · **8**/9 · 7 · 1,131 | 22 · **13**/16 · 15 · 2,788 | 42 · 15/17 · 19 · 5,364 |
| NEW `/8` | 2 | 9 · **7**/7 · 9 · 1,101 | 22 · **13**/14 · 15 · 2,779 | 42 · 15/17 · 19 · 5,364 |

The same, per article: Ideas "in" at Gist / More / Most.

| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| Essay (3) | 1 / 1 / 3 | 1 / 1 / 3 | 1 / 1 / 3 | 1 / 1 / 3 |
| Normal paper (10) | 3 / 7 / 7 | 3 / 7 / 7 | **4** / 7 / 7 | **2** / 7 / 7 |
| Long paper (8) | 3 / 4 / 5 | 4 / 5 / 5 | 3 / 5 / 5 | 4 / 5 / 5 |

**Coverage holds.** Every summed cell sits inside OLD's own range or one above it. The one per-cell
dip is NEW run 2's normal-paper Gist at 2/10, against OLD's 3 and 3. NEW run 1 on the same article
got 4, so it is spread rather than a drift. Section counts at More were 15 against OLD's 16. Most
is identical in every run, because it is the Quotes ceiling.

## The blind read (run 1 of each arm)

Judgments are in `…-blind-judgment.json` and the key in `…-blind-key.json`. The notes below were
written blind; the arm names were added after the key was opened.

| Pair | Side A · Side B | Pick | Arm picked | Note |
|---|---|---|---|---|
| Essay, More | D R D · D R D | tie | — | same three stops; the cues differ only in wording |
| Essay, Most | D D D D · D D D D | tie | — | same four stops |
| Normal paper, More | D D D D D D · F D D D D F | A | **new** | new adds the 7% synergy peak and the no-mechanism caveat; old adds history and a headline result |
| Normal paper, Most | F F F D D D D D D D · F F F F D D D D D R | A | **old** | old keeps the caveats for Most; new ends on the closing summary, a retelling |
| Long paper, More | D D D F · R D D D | A | **new** | new adds Gerlach's measured speed; old re-adds "hard to observe, anecdotal" |
| Long paper, Most | R D D D D D · D D D D D D | B | **old** | new's Most opens on the "random, anecdotal" line again |

**NEW 2 · OLD 2 · tie 2.**

Per added stop, over all six pairs:

| | D | F | R |
|---|---|---|---|
| NEW run 1 | 25 | 5 | 3 |
| OLD run 1 | 26 | 5 | 2 |

## The control (OLD run 1 against OLD run 2)

| Pair | Pick |
|---|---|
| Essay, More | old#2 |
| Essay, Most | tie |
| Normal paper, More | old#2 |
| Normal paper, Most | old#1 |
| Long paper, More | old#2 |
| Long paper, Most | old#1 |

**old#2 3 · old#1 2 · tie 1.** Per stop, D/F/R was 26/5/2 against 25/6/2. Scored in a different
file, OLD run 1 got exactly the 26/5/2 it got in the blind read, so the judge was self-consistent.

Two samples of the same prompt produce a decisive pick in 5 of 6 pairs. The candidate produced one
in 4 of 6, split evenly. **The difference is inside the noise.**

## Why a route prompt cannot deliver this

**Most is every offered quote**, as in 260928a. So a route prompt only decides which quotes land at
More and which at Most, and within one article the two are complements. That is why the table
flips: whichever arm wins More on the normal paper and the long paper loses Most on the same
article, because the stops it took early are the ones the other arm had left for Most.

The repeats the judge found are in the Quotes themselves:

- the long paper's "random in time and space, … anecdotal" restates its Gist quote;
- the normal paper's closing "neurons do not blindly sum" restates the synergy definition;
- the essay's "just don't wait" restates the Gist summary.

Every route has to put them somewhere. There are two levers that could act on Greg's report:

1. **Quotes.** Pick quotes that carry method, evidence and caveats rather than second statements of
   a headline.
2. **Let the route drop a restating quote from Most.** The RULES already say "Leave one out only if
   it adds nothing a stop already gives", and in this run no arm ever did. This would be a change
   to what the route does rather than to its wording, and it is not tested here.

## Cost

| | OLD (6 calls) | NEW (6 calls) |
|---|---|---|
| Cost | $0.1388 | $0.1556 |
| Input tokens per call | 5,045 / 8,548 / 6,716 | 5,230 / 8,733 / 6,901 (+185) |

In all it came to **$0.294** of the authorised $1.

## Files

- Results: `evals/results/trajectory-coverage-2026-09-29T02-48-07.json`: every run's stops with the
  full quote and paragraph, the cues, the per-stop Ideas and the metrics, plus the snapshot.
- Blind read: `…-blind-pairs.md`, `…-blind-key.json`, `…-blind-judgment.json`.
- Control: `…-control-pairs.md`, `…-control-key.json`, `…-control-judgment.json`.
