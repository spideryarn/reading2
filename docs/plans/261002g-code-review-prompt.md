Code review of commit 1816def1f (plan docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md; your own plan review is docs/plans/261002g-plan-review-sol.md). The scoped diff is docs/plans/261002g-code-review.diff. Read CLAUDE.md for house rules.

You may FIX what you find inside this change (workspace-write): edit the files, keep fixes small and in the house style, and run the relevant tests (`npx vitest run <files>`) and `npm run typecheck`. Do NOT commit, do NOT run git commands that change history or the index, do NOT run the full suite. Report anything wider than this change for me to decide.

Check especially:
1. src/web/useArc.ts + src/arc-version.ts: the outdated-arc path. Does keeping the payload arc drawn while starting an unforced run actually end with the new arc on screen (refresh after the job → /api/arc → stale? the new arc's sourceHash and version)? Any case where status stays 'ready' with the old arc forever, or a run starts for a visitor, or twice? Is `isArcOutdated` right for "arc/10" vs "arc/9"?
2. src/arc.ts prompt arc/6: contradictions inside the prompt (e.g. "exactly one sentence" vs the two-halves rule; examples that break its own rules); whether the 20-word rule and "never claim more than shown" read clearly. The measurement is docs/investigations/261002p-arc-sentences-shorter-and-plainer.md — check that its conclusion follows from the numbers in evals/results/arc-length/ (ask: is "ships" justified given the missed fit criterion?).
3. BlockLinkCard MARG_NOTE branch + MarginaliaColumn: aria-describedby on the shut button, focus behaviour, any note left with a native title, the question button's CSS (marginalia.css .marg-question) keeping the old look (border in the gap, AI face from voices.css not overridden by `font: inherit`).
4. Voices: are the classes right per docs/project/fonts.md; does `.marg-open-answer` or any added class misvoice another kind; `withVoice` on an element voices.css already names (see voice.ts warning).
5. The copy in src/web/marginalia/tips.ts: true to what the code does (e.g. does a question really get written "when the article's structure was built"? does FAQ really place it beside the *first* passage that answers it? does "All your notes are in the drawer at the foot of the window" hold?). Check against src/web/marginalia/notes.ts and the structure step.
6. Anything silently succeeding: tests that could pass while the feature is broken.

Write findings (P0/P1/P2, file:line, what you changed if you fixed it) and finish with a one-line verdict.
