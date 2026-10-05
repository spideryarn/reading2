No P0/P1 findings. The implementation is sound after the documentation/comment corrections below.

- **P2 — Known wider contrast gaps remain.** [plan](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger.md:78) — quotes over `--muted`, captions, glossary/cross-reference rules, and active spine parts can remain below their intended contrast floors; the stronger fill slightly worsens some pairings. Left for Greg because resolving them requires a broader surface/ink design decision and is already recorded and queued.

- **P2 — Brightest light-tier arithmetic was slightly low.** [plan](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger.md:34), [quotes.md](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/project/quotes.md:473), [annotations.css](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/annotations.css:484) — `quoteAlpha` rounds to hundredths, so a score just below 0.80 can reach 0.88. Fixed the ranges to 0.14–0.18 light and 0.20–0.25 dark, and corrected the plan distances from 0.131/0.179 to 0.132/0.181.

- **P3 — Several explanations misstated what the measurements showed.** [quotes.md](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/project/quotes.md:515), [annotations.css](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/annotations.css:495), [tokens.css](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/tokens.css:115), [quote-fill.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/tests/quote-fill.test.ts:245) — the OKLab change is mostly lightness, not chroma, and soft ink does not bind the dark heavy tier; the blue search outline does. Fixed.

- **P3 — One Greg quotation was shortened.** [plan](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger.md:69) — expanded it to the approved exact wording and removed the partial quotation from the CSS comment. The quotation audit is otherwise clean.

Light mode remains unchanged. Every application route shares the import chain that loads `styles/tokens.css` before `annotations.css`; this covers marketing, `/design`, private/public readers, and the public shelf. There is no separate rendered export/embed path. No attribute defaults to dark; System resolves to `light` or `dark` in JavaScript before paint. A literal `data-theme="system"` also falls back to dark rather than leaving tokens undefined.

All four new tests were mutation-checked and turned red:

- Wrong tier token wiring: wiring assertion failed.
- Dark light strength restored to 0.20: OKLab distance failed at 0.106739.
- Dark heavy strength raised to 0.38: search-colour test failed.
- Light strength changed to 0.21: exact light-preservation test failed.

Changing only the later light `--cat-4-rgb` declaration left the dark search test green, confirming the parser reads dark `92 143 232`, not light `0 114 178`. Screenshot pixels also confirm the test’s gamma-encoded sRGB compositing matches Chrome.

Independent recomputation now agrees with all documented numbers. Focused Vitest: 158 passed, 3 skipped. The exact `npm run typecheck` launcher hit the sandbox’s `tsx` socket restriction before running; `node --import tsx scripts/typecheck.ts` passed all projects and all 3,113 covered source files.

Files edited:

- `docs/plans/261005f-dark-quote-fill-stronger.md`
- `docs/project/quotes.md`
- `src/web/styles/annotations.css`
- `styles/tokens.css`
- `tests/quote-fill.test.ts`
- `styles/colourscales.css` was temporarily mutation-tested and restored; it has no final diff.

VERDICT: ship after the fixes I made