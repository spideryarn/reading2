# Plan review: 261003i — quick search eval, "thorough" replaces a quick row, colour key, no wash

You are reviewing a **plan**, read-only. Change no file.

**Candidate (live, pre-commit).** Base `428054781` on branch `worktree-fb-search-quick-2610`. One
untracked file is the whole candidate:

- `docs/plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md`

Nothing else has changed yet. The plan answers five feedback reports from Greg (the product owner),
quoted at its top. Read the plan, then the code it will change. Start with these; they do not limit
scope:

- `docs/project/search.md` (§ Quick search, § Search as you type, § Several searches at once)
- `src/quick-search.ts`, `docs/investigations/261002o-quick-search-spike.md`
- `src/routes.ts` § search (`revises`, around line 4383), `src/searches.ts` § `withRun`,
  `src/store/pg-searches.ts`
- `src/web/useSearch.ts`, `src/web/modes/search/SearchMode.tsx`, `src/web/quick-session.ts`
- `src/web/SearchPanel.tsx` (the saved row, around lines 940–1160), `src/web/styles/search.css`
- `src/web/search-hits.ts`, `src/web/annotate.ts`, `src/web/styles/annotations.css` (`mark.hit`,
  `td.text.has-hit`), `src/web/spine-marks.ts`

## What to do

Make an independent pass first. Attack the plan: where will it produce wrong behaviour, lose a
reader's data, race, or cost far more than a simpler version that gets most of the value? Where does
the plan describe the existing code wrongly? Greg asked explicitly for the simplest version that
gets most of the value, so "this stage should be smaller" is a welcome finding.

For Stage A (the eval), say whether the design can actually answer "why did a one-word topic query
miss, and would a different wording, floor or model fix it" — what arm, control or measurement is
missing, and what would make its numbers misleading.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, the file and line it rests on, and the change you
would make to the plan. End with a one-line verdict: ready to build, or not, and what blocks it.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- B2: deleting the quick row server-side at the meaning run's finish. Is there an attempt fence, a
  trim, or a public-read path that makes "delete another row in the same write" awkward or racy? Is
  the tab that is still typing in that quick row's session handled (the client calls `rowGone`)?
  Would a second tab resurrect the deleted row with a `revises`?
- B2: is inheriting the colour really cheap, given colour is hashed from the row id unless chosen?
- B4: is "whole paragraph by design" available where marks are made (`ActiveRun.kind`), distinct
  from the `whole` flag that means quote placement failed? Does anything else (Ideas, Quotes,
  Referee, the open-hit ring, scroll-to-hit) rely on the wash being present on a `mark.hit`?
- B3: a swatch a few pixels from the checkbox and the palette button in a 288px band.
