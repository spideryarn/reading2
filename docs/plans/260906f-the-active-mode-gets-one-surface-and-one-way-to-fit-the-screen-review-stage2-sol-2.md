## Verdict

**Refuse as written.** No P0/P1 findings, and the runtime migration remains correct. Two P2 evidence/delivery defects remain.

### F30 — P2 — established: F27 is still unfixed

[The circuit-breaker test](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/the-band-fallback-must-not-use-modesurface.test.tsx) is still untracked. So are the round-one prompt and answer, despite the plan linking them. `git ls-files` does not find the test, `git status --porcelain=v2` reports all four as `?`, and the staged diff is empty.

The test passes when explicitly run, but still will not ship unless added.

### F31 — P2 — established: the repaired `referee-how-card` assertion passes after deleting the button

[The new slice](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/referee-how-card.test.tsx:257) checks:

```ts
head.includes("RefereeHowButton")
```

But [the new source comment inside that slice](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/App.tsx:5835) also says `RefereeHowButton`. Removing the actual `<RefereeHowButton … />` therefore leaves the test green. I confirmed this against an in-memory mutation of `App.tsx`.

The end anchor is also unchecked: if `className="ref-brief"` disappears, `slice(bandAt, -1)` examines almost the whole remaining file and still finds the comment.

Assert `briefAt > bandAt`, then look for `"<RefereeHowButton"` rather than the bare identifier.

The two repaired regex slices in `referee-band-fits` are sound: both endpoints are required, all five exact tags occur once inside the slice, and a missing match fails non-vacuously.

### F32 — P3 — established: F29’s inventory correction is incomplete

[The corrected paragraph says two preview copies](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:265), but its acceptance criterion immediately returns to [“the five preview copies”](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:273).

The oracle also still says:

- [nineteen stage-two shapes](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:53), now twenty after `QUIZ_NO_SUBMODE`;
- [the eleven bands “has not touched yet”](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:886), after migration.

### F33 — P3 — established: three comments still assert things the code/tests do not do

- [Quiz’s helper comment](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:1471) says the generic `true head` test guards the omitted-`subMode` case. It does not; `QUIZ_NO_SUBMODE` now does.
- [`referee-band-fits`](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/referee-band-fits.test.ts:167) says sharing the regex slice would let the second describe pass over an empty string. It would not: its `toContain` assertions fail on an undefined shared match. The explicit assertions provide the protection, not duplicating the regex.
- [Diagram still claims an `h2` pushes a third child](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/DiagramPanel.tsx:1534), although that header now contains no `h2`. This was the secondary stale statement noted under F28.

## F25–F29

- **F25:** fixed. The replacement mount genuinely omits the prop, and the historical Quiz markup confirms the expected empty row.
- **F26:** fixed in substance. The persistent-versus-absent distinction and four-loading-plus-Diagram count are correct.
- **F27:** not fixed; F30.
- **F28:** primary overclaim fixed; its older `h2` claim remains, F33.
- **F29:** partially fixed; F32.

## Oracle sufficiency

**Reasoned:** it is sufficient as the standing guard for the `ModeSurface` seam. It pins the root, exact class/name, attribute names, wrapper/sibling structure, ordered direct children, loose text, and header contents.

It is not a full-DOM oracle. It cannot see:

- descendants below a non-header direct child;
- attribute values on direct children;
- branches not represented by a mounted fixture;
- portals or geometry.

That is an appropriate boundary, but [“pins every band’s markup”](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/project/new-mode.md:83) overstates it; “pins each band’s surface shape” would be accurate.

## Stage 3

**Reasoned:** this stage neither complicates nor solves A6. It adds no Escape listener and leaves the inventory’s tiers unchanged. The shared surface makes uniform band-level behavior easier, but Escape ownership should not be placed in `ModeSurface`: it cannot know whether a tooltip, drawer, native dialog, or editor currently owns the press.

Verification: focused suite **51/51 passed**; typecheck **green across all three projects**; `git diff --check` green. The doc-links run reproduced only the known missing `shared-site-run-row-gate.test.ts` failure.