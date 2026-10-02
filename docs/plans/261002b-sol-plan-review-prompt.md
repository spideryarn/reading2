You are reviewing a PLAN (read-only) in this repo before it is built. The plan is docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md. Its evidence: docs/plans/261002b-voices-trawl.md (a code audit with file:line), docs/plans/261002b-ai-typeface-research.md, and the specimen PNGs docs/plans/261002b-specimen-*.png. The v1 it extends: docs/plans/261001d-typeface-per-voice.md, src/web/styles/voices.css, tests/voices-css.test.ts, src/web/useVoiceFaces.ts, styles/tokens.css, src/web/tailwind.css.

Review for:
1. Wrong claims in the trawl that the plan relies on — spot-check the highest-traffic ones (Tweets, Marginalia, Skim, chat stance tag, hover cards, Structure/Spine navLabel children) against the code.
2. The CSS font-matching claim that with Plex Mono at static 400/700, a requested weight of 450 resolves to 400.
3. Whether the VOICES_BY_MODE Record<Mode,...> guard actually goes red on a new mode (where is Mode defined; are tests type-checked by npm run typecheck?), and whether it is the right simplest guard.
4. Any voice judgement calls you think are wrong (e.g. glossary term names as AI, code in answers as AI).
5. Anything missing, risky, or over-built.

Also check the conclusion, not just the method: is Plex Mono a sensible pick given Greg's words quoted in the plan?

Output: a verdict line (approve / approve with changes / request changes), then numbered findings with severity (P0-P3), evidence (file:line), and the concrete change you'd make. Be concise.
