# Review request: A7 stage 1a — the instrument and the measurement it produced

You reviewed this job's plan twice plus one scoped check (F1–F13, all accepted, none overruled).
This is the **end-of-stage review of stage 1a**, which delivered the instrument and the number the
decision rule was applied to. **Stage 2 — the optimisation itself — is being written now and is not
part of this review.**

## The candidate

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure`.

**Committed candidate**, two commits on branch `worktree-a7-annotation-measure`:

- `89955db2` — the plan and the three review artefacts (docs only)
- `6a33c2d8` — **the stage under review**: the instrument and the stage-1a write-up

```
git diff 6eecb377f24d92446086a006d5b3103daae40aef..6a33c2d8
```

Changed paths in `6a33c2d8`, all of them:

- `src/web/annotation-cost.ts` (new) — the instrument
- `tests/annotation-cost.test.ts` (new)
- `src/web/annotate.ts` — `renderedText`, `resolveMark`, `annotateHtml` instrumented
- `src/web/zoomable.ts` — `addZoomHandles` instrumented
- `src/web/perf.ts` — `startPerf()` starts it; `window.__perf` exposes it
- `src/web/TableView.tsx` — three lines inside each of two `useMemo` bodies
- `docs/plans/260905i-measure-annotation-computation-before-optimising-it.md` — § Stage 1a result

Start with `src/web/annotation-cost.ts` and the plan's § "Stage 1a result". That is not a limit on
scope. **The working tree also contains uncommitted stage-2 work in progress — ignore it; review the
committed diff above.**

## What the stage claims

Production build, `vite preview`, bundle hash checked against the served page, Playwright against
system Chrome, five repeats per gesture with the first discarded, mode `"counts"`, on
`replication-crisis-spya-hrjamq` (551 rows, 20 distinct glossary terms, 5 distinct comments, 20,346
nodes — all counted in the loaded page before timing).

| gesture | end-to-end median | attributable median |
|---|---:|---:|
| glossary press | 285 ms | 29.9 ms |
| open a comment | 232 ms | 30.4 ms |
| close a comment | 211 ms | 24.9 ms |
| find-box keystroke | 33 ms | 0.00 ms |
| hover two rows | 67 ms | 0.00 ms |

Length control at 186 blocks: comment open 5.4ms attributable against 30.4ms.

Diagnostic `"full"` run, labelled perturbed: inside `proseHtml`, `annotateHtml` n=96 ≈ 20.6ms and
`addZoomHandles` n=551 ≈ 15.3ms. On comment open, `renderedText` n=5 and `resolveMark` n=5.

Conclusions drawn: **optimise** (8ms threshold, precommitted); Stage 1b skipped; annotation is only
**10–14%** of the gesture and the rest is A8's ground; and the plan's third optimisation — a shared
rendered-text cache — was **cut**, because anchor resolution is five parses.

## What to attack

1. **Is the instrument honest?** Read `annotation-cost.ts` and every call site. Can it undercount —
   a path that skips a `noteCost`, an early `return` outside a wrapped worker, a re-entrancy that
   loses a sample, a memo that React invoked but whose timer did not run? Undercounting is the
   dangerous direction: a small number is the answer this job would most like to hear.
2. **Can it overcount or misattribute?** The two memo timers are inclusive. Is anything charged to
   `proseHtml` that is not annotation, beyond the figure-handle scanning the plan already declares?
3. **Does `"counts"` mode do what the docstring says** — no clock read at any leaf — and is the
   `NO_CLOCK` sentinel safe against a real `performance.now()` ever returning it?
4. **Do the measured numbers actually support the conclusions drawn from them?** Especially: is
   "annotation is 10–14% of the gesture" supported, and is cutting the shared rendered-text cache on
   the strength of `n=5` sound, or is that generalising from one article's comment count to every
   reader?
5. **Is the stage-1a write-up in the plan accurate against the diff and against what was actually
   run?** Name anything it claims that the evidence does not carry.
6. **Is the test in `tests/annotation-cost.test.ts` capable of going red** for each thing it asserts?
7. **Anything in the diff that will age badly**, or that a future reader will misread.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file. Refuse only on an **established** P0 or P1. Give every
finding a stable ID — continue the existing series, so new ones start at **F14**, and reuse an
earlier ID only for the same finding. Finish with an explicit verdict line.

You have no network. You may run anything in the tree that needs nothing outside it — the vitest
files here need no database. Say which findings you established by running something.

## My own suspicions, worth less than yours

- The measurement I trust least is the **streaming** one. The path the plan named as the worst case
  (`useComments`' own `send()` streaming) turned out to be unreachable without seeding, so what got
  measured was the chat path instead, which is cheap for a structural reason. The write-up says the
  comment-streaming case is unmeasured rather than disproved — check I have not quietly let that
  slide into "fine".
- I am least confident about **cutting the shared rendered-text cache**. It is justified by `n=5` on
  one article. A reader with a hundred comments is a different shape, and I may be optimising for
  the article I happened to have.
- The `"full"`-mode diagnostic numbers are perturbed by design, and I have used their *ratio*
  (55/40 between `annotateHtml` and `addZoomHandles`) to steer stage 2. Tell me if that ratio is
  itself distorted by the leaf clocks — `addZoomHandles` is called 5.7× more often than
  `annotateHtml`, so it eats more clock-read overhead, which would inflate its share.
