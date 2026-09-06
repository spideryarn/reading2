You are reviewing a PLAN, before it is built, for a TypeScript/React reading app called Spideryarn.

Read these files (you are at the repo root):

- docs/plans/260906a-opening-a-mode-starts-it-generating.md   <- THE PLAN UNDER REVIEW
- src/web/activation.ts
- src/web/useAutoRun.ts
- src/web/jobEngine.ts   (just `beginAutoAttempt` and the `autoAttempts` set)
- src/web/useIdeas.ts    (the reference wiring: `ensure` / `regenerate` / `useAutoRun`)
- src/web/useQuiz.ts
- src/web/useClaims.ts
- src/web/useChat.ts     (the load effect and the returned `loaded`/`loadFailed`)
- src/web/CandidatesPanel.tsx  (`CandidatesBand` and `startBrief`)
- src/web/Tweets.tsx
- src/web/Link.tsx
- src/web/Dock.tsx       (`MODES_UI`'s diagram row, the Tweets `DockLink`, and the `armActivationForMode` call)
- tests/modes-that-start-themselves.test.tsx
- tests/referee-candidates-press.test.tsx

Background: the user's instruction was "Make sure that each mode automatically starts generating
when I open it. Most of them do, but a few still require an extra button-click after opening the
mode, e.g. Tweets, Diagrams. By opening the mode, the user is implicitly indicating that they want
what's already generated, or to generate it if needed." The user then chose the widest scope,
including the sub-mode chips inside Remember and Referee.

What I want from you, in order of how much I care:

1. **Where will this spend money it should not?** The activation token exists so that only a real
   press starts a paid run. For each of the five new surfaces, is the plan's gesture seam actually
   a press, or is there a path (Back/Forward, a pasted URL, a re-render, StrictMode's double
   effects, a remount, a query-state write) that reaches it without one? Be specific about the
   code, not the prose.

2. **Where will it spend money TWICE?** `work_key` is computed from the request including `force`,
   so an unforced automatic run and a forced button press in the same second are two requests and
   `enqueueOrGet` does not collapse them. Stage 3 splits `useQuiz.write` into `ensure`/`write`.
   Stage 2 relies on `Tweets.write(force = false)`. Are those right? Any other double-spend paths?

3. **Claims and Candidates are streams, not jobs.** They have no `StepName` and no job row. Does
   mapping them onto `useAutoRun`'s four-state `ArtefactStatus` actually work, given how
   `useClaims` and `useChat` really behave? Specifically: (a) `useClaims` sets `run` to a
   `{status:"pending"}` placeholder synchronously inside `pull` — does that break the
   `status === "none"` gate or the `ready` retirement? (b) `useChat`'s `reload` dispatching a
   second `load.started` — is that actually safe, and does `loaded`/`loadFailed` settle in a way
   `useAutoRun` can read? (c) is `beginAutoAttempt` (one attempt per session) enough for a stream
   that can fail mid-flight?

4. **The `Link.onNavigate` seam** for the Tweets DockLink. Is that the right place, and does the
   Tweets page mount in a way that preserves the module-level activation token across the
   navigation?

5. **The vocabulary widening.** Is the `Record<Exclude<AutoRunTarget, StepName>, true>` trick
   actually load-bearing under this repo's tsconfig (strict, noUncheckedIndexedAccess), or is it
   theatre? Is there a better way to keep the step-shaped targets honest?

6. Anything the plan has missed entirely — a sixth surface, a test that will go red, a doc that
   asserts something the change makes false.

Be concrete and skeptical. If a stage is wrong, say what to do instead. Do not rewrite the plan
wholesale; give me findings I can check one by one.
