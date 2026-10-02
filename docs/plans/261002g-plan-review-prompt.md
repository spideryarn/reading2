Review the plan docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md
in this repository (Spideryarn, a reading app; read CLAUDE.md for the house rules). Read-only review: do not edit files.

Check the plan against the code, not just its prose. The relevant code:
- src/web/marginalia/MarginaliaColumn.tsx, notes.ts, src/web/styles/marginalia.css
- src/web/BlockLinkCard.tsx (the delegated card; GUTTER_CONTROL branch is the precedent), src/web/Tooltip.tsx (ControlTip)
- src/web/useArc.ts (payload seeding), src/arc.ts (PROMPT_VERSION, isStale, the prompt), src/store/pg.ts (/api/arc staleness ~line 4128, loadArticle ~2681)
- src/web/styles/voices.css, src/web/voice.ts, tests/voices-css.test.ts, docs/project/fonts.md, docs/project/tooltips.md
- src/web/reader/Reader.tsx (liveArc, MarginaliaHead)

Questions I most want answered:
1. § 2 existing arcs: is "useArc ignores a payload arc whose version != current PROMPT_VERSION" correct and safe? Trace: does /api/arc then report stale (so status 'absent' and the unforced run starts)? Does the unforced run actually regenerate on a version mismatch (the step's freshness check)? Any loop risk (e.g. the run writes an arc whose version still mismatches, or a job that fails repeatedly re-arms on every open)? Does any other consumer read capability.arc / article.arc in a way that would now flicker or break? Is there a simpler/better seam?
2. § 2 prompt: is a 20-word hard cap plus rewritten examples the right lever, and how should the measurement be designed so it can show the change failing?
3. § 3: is adding a branch to BlockLinkCard's delegated card the right call versus a per-note Tooltip? Anything in BlockLinkCard (aria, focus, touch, pointer-events, SELECTOR scope, the 'reword' observer) that a marginalia branch would trip over? The shut note is a button that toggles a disclosure; the question note is a <p> (not focusable).
4. § 3 voices: are the voice assignments right per fonts.md (e.g. Debate's headline might sometimes be AI-written — see rowWork / dbt-title-ai)?
5. Anything the plan misses, any silent-success risk, and any simpler option for any part.

Give findings as a numbered list with severity (P0/P1/P2), each with file:line evidence, and finish with a one-line verdict.
