# Code review 3 — Trajectory stage 3, the scrapbook (v2)

You are the reviewer **and the fixer** for this stage. The house rule: fix what is inside this stage, narrowly and red-first, and **report, do not fix**, anything wider you notice. Do not commit. Do not touch any database or the network.

## The candidate

Commit `eeb16ed7`. Use `git show eeb16ed7 --stat`. Start with:

- `src/web/stop-card.ts` (new), `src/web/TrajectoryPanel.tsx`, `src/web/modes/trajectory/TrajectoryMode.tsx`, `src/web/reader/Reader.tsx` (`openFromStopCard`);
- `src/web/useIdeas.ts`, `useFaq.ts`, `useTimeline.ts` (the read-only hooks split out of them);
- `src/trajectory.ts` (the cue, `trajectory/5`);
- the tests `tests/stop-card.test.ts`, `tests/artefact-read-hooks.test.tsx`, `tests/trajectory-panel.test.tsx`, `tests/trajectory.test.ts`.

The list does not limit your scope.

The spec is the plan `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md` § "Stage 3 in detail", **and its sub-section "Revised after GPT Sol's stage-3 plan review", which overrides it**. That is your own review, F18–F25, in `docs/plans/260928a-trajectory-mode-stage3-plan-review-sol.md`. Check each of F18–F25 was actually honoured in the code.

## Evidence already gathered by me

- `npm run typecheck` exited 0.
- 8 scoped files, 137 tests, passed. The implementer's wider scoped run was 30 files.
- A Playwright browser check at 1440, 820×1180 and 420 on a real article with glossary, ideas, FAQ and timeline passed:
  - the card shows only non-empty clusters;
  - term, idea and event links open their modes on the right item, and Back returns to the same stop;
  - "also at stop k" is correct;
  - the next stop's line shows under the door;
  - there is no crowding at iPad width;
  - **only GETs, no job POSTs**, for the four artefacts while stepping;
  - no Trajectory console errors.
- **The real model run of the cue prompt could not happen.** The dev OpenRouter key is out of credit (402). So `trajectory/5`'s prompt is unmeasured; read it closely against the rules (a cue says what to look for, never what the passage found, never mentions another stop, ≤ 140 characters, plain words).

## What to attack

- The card's gathering function: term matching over rendered text, the stale rule, "also at stop k" semantics, and performance with 20+ terms × 30 stops.
- The read-hook split: are the mode hooks byte-for-byte equivalent in behaviour, including retries and auto-run?
- `openFromStopCard`: history, and the experimental and visitor gates.
- Accessibility of the chips and the expandable meaning.
- Old artefacts with `role` and no `cue`.
- The cue prompt text itself.

## One thing I'd like fixed if you agree

The implementer reports that the FAQ question's "To the passage ›" jump goes to the current stop's own paragraph — the one the reader is already on — so it does nothing useful. If so, drop the jump and show the question as text only. Keep it if the matching passage can genuinely be elsewhere.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0/P1. IDs continue from **F26**. You can run pure test files yourself.

## Output

For each finding: the ID, the severity, the evidence, and either **fixed** (with the red → green test) or **reported**. End with a verdict and the list of files you changed.
