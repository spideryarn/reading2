# Plan review: 261007h design-system refresh

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
(untracked file in this worktree; base commit `1ae324ee7` on `dev`). Its parent is
`docs/plans/261007a-ui-sweep-umbrella.md` § For Greg, whose three questions Greg answered "yes"
(quoted in the candidate). Read `docs/project/controls.md`, `docs/project/design-css-overview.md`,
`docs/project/loading-spinner.md`, `docs/project/mode.md` for context.

The plan lines up controls that do the same job across the reading view's modes (families F1–F8),
plus a /design section and a docs update. It must stay **polish, not a redesign**: every change
moves an outlier onto a design the app already has.

## What to do

Independent pass first. For each family, check the plan's claims against the code under `src/web`
(locate by content; line numbers are not given), and tell me:

1. Claims that are false (a site that is not where or what the plan says; a "canonical" piece that
   does not do what the plan says; a count that is wrong).
2. Sites the plan misses that belong to the family (e.g. another loading line, another
   part-switcher, another run button, another failure-sentence colour, another text box in a band).
3. Changes that would break something: tests that select the classes; behaviour that rides on a
   class (e.g. `display: contents`, `role="radiogroup"` vs `aria-pressed`, `aria-disabled`); a
   layout that has no slack (Search's band); the 16px iOS field floor; `close-cross.test.ts`;
   `css-tokens` and the Tailwind bridge's text guard if `--color-danger` is added; the palette
   test.
4. Order and file overlap between families: anything that should be merged, split or reordered.
5. Whether any family costs more than it is worth, or has a smaller version that gets most of the
   value.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. Give each finding an ID (`P1`,
`P2`… no — use `R1`, `R2`, … ) and a severity. Refuse ("not ready") only on an established P0 or P1.

## My own suspicions (worth less; spend most of the run elsewhere)

- F1: the line between a "wait" and a "not made yet" sentence at each `.x-quiet` site; whether
  any test asserts loading text synchronously in a way that will need fake timers everywhere.
- F2: whether the joined bar scrolling sideways at narrow widths is achievable without touching
  `ModeSurface`, and whether moving Referee/Learn from `aria-pressed` to a radiogroup changes
  keyboard behaviour (arrow keys) in a way a reader would notice.
- F4: putting `SiteNav` on Help/Changelog/Privacy/Contact/Open source while signed out — the
  padding-top those pages carry, the corner Feedback logic in `App.tsx`, and whether a signed-in
  reader could see a flash of the wrong bar.
- F6: lightening dark `--muted-foreground` globally vs scoping it to raised surfaces.

End with a verdict line: `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`.
