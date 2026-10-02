# Plan review: Brief summary plainer for a reader in a hurry (261002h)

You are reviewing a plan, read-only. Repo: Spideryarn (AI-assisted reading). Read:

- docs/plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md (the plan)
- src/simple-summary.ts (PITCH, NOTCH_UP, simpleSystem, SYSTEM_TAIL, SIMPLE_PROMPT_VERSION)
- src/profile.ts (PROFILE_RULES, profileSection)
- docs/project/prompting-guide.md (§ Measuring a prompt change)
- evals/simple/probe.ts and evals/simple/readers.json (the harness)
- For the 9P claim: src/web/modes/summary/SummaryMode.tsx (SummaryControls), src/web/useAutoRun.ts,
  src/web/activation.ts (MODE_TARGET.summary), docs/plans/261002a-summary-generates-on-open.md,
  docs/plans/261002c-summary-opens-on-brief.md.

Questions:
1. Is the conclusion that 9P needs nothing built correct? Trace: on a fresh article with nothing stored,
   (a) press Summary on the bar, (b) arrive by URL with ?mode=summary then move the slider straight to
   Brief (pointer drag, keyboard, end-icon click), (c) press Summary then move the slider while the job
   starts. Is there any path where the owner still sees an idle "Write it" button? Look hard for an
   edge (useAutoRun's one-attempt-per-session, claim/consume ordering, pointer events, touch).
2. Is the prompt change likely to fix Greg's jargon complaint without hurting fidelity? In particular
   the precedence between Brief's "even when the request describes an expert" and the shared
   PROFILE_RULES "Assume the background they claim", which stays in the same system prompt. Will the
   model obey the Brief override? Is there a cleaner way that does not edit PROFILE_RULES?
3. Is the measurement sound (arms, control, screens, blind judge, ship criterion)? What would make it
   lie?
4. Anything that breaks: version bump consequences, caching (system prompt per level is constant),
   tests, the outdated/stale flags.

Answer with findings labelled P0/P1/P2, each with file:line evidence, and a one-line verdict.
