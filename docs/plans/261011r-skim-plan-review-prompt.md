You are reviewing a PLAN (not code) for the Spideryarn reading app, before it is built. Read-only.

Read first:
- docs/plans/261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md (the plan)
- src/skim.ts (the step: targetsFor, growthFailure, growPasses, validateRoute, SKIM_SYSTEM, renderPromptParts, SKIM_OUTPUT_SCHEMA, ANSWER_TOKENS)
- src/skim-passes.ts, src/web/skim-route.ts (walkedIn, passCount)
- src/web/SkimPurpose.tsx, src/web/SkimPanel.tsx (the band), src/public/dto.ts § publicSkim
- docs/project/skim.md (the mode's doc), docs/investigations/261010a-skim-per-pass-targets-and-walked-growth.md (the previous measurement)
- docs/user-feedback/questions/q-vzd2xt.md and docs/user-feedback/261006_0545-skim-cue-should-situate-the-quote.md (history)

Questions:
1. Is the two-phase growPasses repair (lengthen by adding carried entries within maxCarried, then the existing shrink) correct and terminating? Can phase 1 leave a route that phase 2 then breaks the other way, or one growthFailure rejects that a different order would have fixed? Check the targetsFor arithmetic claim (3g+2 <= q for q >= 8, More own target in [g+1, floor(rest/2)]) and the caps (DEPTH_CAPS cumulative 7/15/36).
2. Is a per-pass intro the right shape for Greg's "situate them ... introductory or summary or linking statements ... disorienting and disjointed"? Is there a simpler or better option the plan missed (e.g. something in the prose, the door, or the section path), and is the reasoning against per-stop linking statements sound? Risks: giveaways, drift after the repair moves stops, the intro going stale.
3. The shorter-stops rule: is prompt-only bias plus word counts the right lever, or is there something deterministic worth doing? Does the input-hash claim hold (word count derived from hashed text)?
4. The skim-for box as an in-place edit of the article's purpose: does it race anything (the hold, the profile-changed banner, the automatic run, useSkim.ensure) or break an existing invariant in SkimPurpose.tsx? Is the "Skim-only focus" rejection reasonable for Greg's "if it will add a lot of complexity, push back"?
5. Is the measurement in Stage 2 adequate under docs/project/prompting-guide.md § Measuring a prompt change? Anything missing?
6. Anything else: security (the visitor DTO), types, tests that will break, docs that must change.

Answer with numbered findings, each with severity (high/medium/low), the evidence (file:line), and a concrete fix. End with a one-line verdict: "build as planned", "build with these changes", or "rethink".
