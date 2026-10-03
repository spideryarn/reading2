The change should not land until F7 is resolved. I fixed four narrower defects; all edits remain uncommitted.

## Findings

- **F6 — P1, established — fixed.** Reader’s parent passive effect ran after Skim’s child arrival effect, so entering another covering band could create and then immediately delete the incoming landing flash. The cleanup is necessary, but its timing was wrong. It now runs through a parent layout-effect hook in [mode-flash.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/src/web/reader/mode-flash.ts:5). The regression test at [skim-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/tests/skim-panel.test.tsx:186) failed with `incoming landing` before `old flash dropped`, then passed after the fix.

- **F7 — P1, established — reported, not fixed.** Carrying is uncapped despite the plan’s fallback and the investigation’s “not as it stands” conclusion. NEW-b contains a More walk that is 50% carried and repeats all 3 Gist stops; another repeats all 5 Gist stops, while another carries none ([round-two statistics](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/evals/results/skim-coverage-2026-10-03T18-18-47-again-stats.md:9)). This violates the prompt’s “mostly NEW passages” instruction and can reproduce the user-visible repetition the feature was meant to avoid. The investigation offers two materially different fixes—cap Gist→More, or prohibit carrying into Most—neither measured. I did not choose that product trade-off. What remains: choose and test a cap in `validateRoute`, then rerun the relevant measurement.

- **F8 — P2, established — fixed.** The standalone coverage report still treated every shallower stop as walked at every deeper depth, ignoring both `again` and F1’s unoffered-pass rule. It now uses the reader’s `passRoute` definition through [skim-coverage-route.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/scripts/skim-coverage-route.ts:4). Both regression cases in [skim-coverage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/tests/skim-coverage.test.ts:5) failed first, then passed.

- **F9 — P2, reasoned — fixed.** `SKIM_SYSTEM` required depth-2 and depth-3 stops even when one or two offered quotes make that impossible, contradicting `targetsFor`, the schema’s possible outputs, and `growthFailure`. The prompt now permits an absent pass when adjacent targets are equal ([skim.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/src/skim.ts:912)). The prompt assertion failed first, then passed. This qualifier does not affect the measured articles, whose targets all grow.

- **F10 — P3, established — fixed.** Several docs/comments claimed pass sizes did not move, deeper passes contain only “a few” earlier stops, or never contain all earlier stops. Raw NEW-b has four matched runs with changed first-depth sizes, a 50%-carried More, and two all-Gist carries. I corrected the investigation, project doc, help text, plan progress, and stale `Skim` type comments. A prose assertion failed on the five false phrases before the edits and passed afterward.

## Plan-review ledger

- **F1: fixed.** Server validation drops `again` entries whose pass has no first-placed stop; client `walkedIn` independently ignores them.
- **F2: fixed.** The evaluation includes each candidate’s Gist, whole paragraphs, and per-carried-stop classification.
- **F3: fixed in code/tests.** Pips are non-interactive spans, their words are in the row’s accessible name, the position-card overlay moves below them, and the legend is in the band information and `/help`. I did not rerun the browser check.
- **F4: fixed.** The visitor DTO carries `again` while continuing to exclude profile/provenance fields.
- **F5: fixed.** Tests cover an asked pass that walks the stop, one that does not, no requested depth, stale stops, and a same-stop depth change with one pushed history entry and Back restoration.

The suspected current-position, sparkline “done,” and stop-card “also at stop k” cases are correct: all derive from the selected pass’s actual `route`. `locate` also falls back to the named stop’s own pass when the requested depth is unoffered.

## Prompt and measurement

After F9, the prompt, schema, and validator agree on `again`: required array in live output, only depths 2/3 in schema, and deeper/unique/offered-pass semantics enforced during validation. It uses the shared `plainWords("ask")` rule. The remaining prompt problem is F7: “do not carry everything” has no enforced bound.

Independent recomputation from JSON produced:

- Round one: More `21/83 = 25%`; Most `17/123 = 14%`.
- Round two: More `29/88 = 33%`; Most `30/138 = 22%`; Gist→More `29/45`.
- Round-one blind splits: after Gist `6–2–4`; cold `12–0–0`.
- Round-two blind splits: after Gist `8–3–1`; cold `11–1–0`.
- Control: after Gist `5–0–1`; cold `3–1–2`.

Those totals match the investigation, project doc, and plan after the wording corrections.

## Verification

- Requested Vitest files plus the new coverage test: **312 passed**.
- `tests/skim-purpose-line.test.tsx`: **14 passed**.
- `node scripts/typecheck.ts`: all four projects green; all **2,887** source files covered.
- `npm run typecheck` itself could not start `tsx` in this sandbox: `listen EPERM /tmp/tsx-1000/14.pipe`. The underlying typecheck script completed cleanly when invoked directly.
- Scoped lint: no errors; only existing complexity/optional-chain advisories.
- `git diff --check`: clean.
- No commits or state-changing git commands were run.

The unrelated untracked review prompt and five screenshot files were left untouched.

VERDICT: do not land