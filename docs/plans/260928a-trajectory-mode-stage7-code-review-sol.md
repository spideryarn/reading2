Verdict: **accept after fixes**. No P0/P1 findings.

- **F90 — P2:** Trajectory row presses still flashed the whole block. Fixed by threading an optional passage through `jumpTo`/`beginJump`; all other callers retain block flashes. Both moved and already-visible branches are tested. [keynav.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/keynav.ts:352), [TrajectoryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:450)
- **F91 — P2:** A row removed without replacement mid-glide ended at its stale pixel and reported `settled`. It now reports `missing`; React replacements are still re-found by block id. [scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/scroll.ts:817)

The adversarial review also established:

- Wheel/touch cancellation remains authoritative.
- Chasing is bounded to 200 ms; shifts after arrival are not followed.
- The current page-height clamp is recomputed each frame.
- Reduced motion makes a corrective second jump only when layout actually moved.
- Reading-position restore/re-anchor does not double-correct or rewrite `?at=` during flight.
- Passage keys match `quoteMarkKey`/`annotate.ts`; fragments, fallback, restart, reduced motion, and held flashes are covered.
- The per-frame rect read costs roughly one layout sample per animation frame for about twelve frames. That is acceptable for a short, user-initiated correctness path.
- The postmortem names the class correctly, `64595ca9` is the introducing Trajectory commit, and its recommendations are sensibly ranked. I updated it for replacement/removal coverage. [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md:61)

Validation:

- Focused scroll/flash/Trajectory plus keynav, swipe, comment-jump, note-arrival and reading-position suites: **14 files, 194 tests passed**.
- Additional passage-restart check: **23 tests passed**.
- Web and test TypeScript projects pass directly.
- The requested typecheck command compiled all four projects successfully, then its coverage guard failed on an unrelated untracked `traj-check.ts`.
- Full `npm test` could not start because local Postgres was unavailable.
- Scoped lint found only existing findings in `keynav.ts` and `useReadingPosition.ts`.

No commit was made. Unrelated untracked files were left untouched.