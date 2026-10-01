# Results: before, after, and how much of the difference is noise

All scores are out of 15 on the final rubric ([scoring.md](scoring.md)), from blind scorers who saw
two results per task under shuffled names (`blind/`, `blind2/`; mappings kept by the orchestrator).
Before: `4a7862f3`. After: `b4f4e9f4`, two independent runs (`after-*`, `after2-*`).

## The numbers

| Task | Before | After (run 1) | After (run 2) |
|---|---|---|---|
| P01 | 11.1 | 9.4 / 8.8 | 10.8 |
| P02 | 10.2 | 11.0 / 10.5 | 9.5 |
| P03 | 12.9 | 13.5 / 13.2 | 11.4 |
| P04 | 9.4 | 11.3 / 11.7 | 11.8 |
| P05 | 6.7 | 10.1 / 9.9 | 9.7 |
| P06 | 12.3 | 9.4 / 9.2 | 12.0 |
| P07 | 10.4 | 10.4 / 10.8 | 8.5 |
| P08 | 10.1 | 9.4 / 8.7 | 9.6 |
| P09 | 12.4 | 11.3 / 10.7 | 11.8 |
| P10 | 12.2 | 10.4 / 9.0 | 13.0 |
| P11 | 9.1 | 8.2 / 8.5 | 8.3 |
| P12 | 10.1 | 10.6 / 10.2 | 10.3 |
| **P mean** | **10.58** | **10.42 / 10.10** | **10.56** |
| H1 | 9.1 | 11.7 / 11.9 | 7.9 |
| H2 | 11.7 | 11.2 / 10.9 | 12.2 |
| H3 | 11.8 | 12.8 / 11.8 | 13.8 |
| H4 | 11.5 | 12.0 / 11.5 | 12.4 |
| **H mean (held out)** | **11.03** | **11.93 / 11.53** | **11.58** |

Run 1 was scored twice, once paired with *before* and once with run 2, so it carries two numbers;
the gap between them is the scorer's own noise (0.2–1.4).

## What it says

- **The aggregate did not move by more than the noise.** Two runs of the same probe on the same
  tree differ by 1.5 points on average (0.1–4.0); before and after differ by 1.3. On the held-out
  four the after rounds are 0.5–0.9 higher, which is the direction hoped for and smaller than the
  noise. One run per arm cannot show an effect of this size: it would take three to five runs per
  task per arm.
- **The one targeted failure did go away.** Before, 2 of 12 probes planned a second copy of code that
  exists (P04 a Citations-only copy of the shared wrap row, P05 a third clipboard helper), each
  costing 2 points. After, 0 of 24 runs did. That is the reuse problem this sweep was most directly
  aimed at. **But it is not clean evidence**: the diagnosis ([diagnosis.md](diagnosis.md)) traces
  most of P05's gain to one sentence in `quotes.md` naming `CopyButton` as the copy button to lift —
  a true and general pointer for anyone adding copy to Quotes, but exactly P05's answer, so under
  the rubric's leak rule its credit does not count. The P04 gain went through
  `narrow-windows.md` § A row that pushes a phone page sideways, which the diagnosis calls
  borderline rather than a leak. Two other leak-shaped sentences (`faq.md` for P07, `ideas.md` for
  P11) carried no score.
- **The one change with held-out evidence** is `ingest-queue.md`'s new lead block, *Where a job's
  life is decided*, which helped P03 and the held-out H3.
- **The rest of the misses are stable across runs**, which makes them the useful output: the
  security/visitor side of P11 (`security-map.md` and postmortem 260929a unopened in every run), the
  browser-check docs on P04, and traps that live only in plans. See [diagnosis.md](diagnosis.md).

## What would make the measure better next time

Three runs per arm, one scorer for all of a task's runs, and a same-tree control pair built in from
the start — the noise run here was added after the first result, which is the right order to have
learned it in and the wrong order to plan it in. [documentation-policy.md § Checking that the
signposts work](../../reusable/documentation-policy.md#checking-that-the-signposts-work) now says to
hold tasks back and to repeat each run.
