# Plan review: Skim deeper passes always longer, and a previous-stop door

You are reviewing a plan before it is built, in the repo you are running in. Read-only.

Read: docs/plans/261010t-skim-deeper-passes-always-longer-and-a-previous-stop-door.md (the plan),
then src/skim.ts (`targetsFor`, `validateRoute`, `maxCarried`, `visibleCounts`, `growthFailure`,
`buildSkim`, the SKIM_SYSTEM prompt section 2 and RULES, `renderPromptParts`), src/web/skim-route.ts
(`walkedIn`, `offeredDepths`, `passRoute`, `doorAfter`), src/web/modes/skim/SkimMode.tsx (`step`,
`SkimControl`, `DoorView`), src/web/SkimPanel.tsx § SkimDoor, src/web/reader/Reader.tsx around
`afterBlock`, and docs/project/skim.md §§ "Each pass walks only its own stops" and "A stop may be
walked at more than one depth".

Questions:
1. Is the diagnosis right — is the cumulative growth check the cause of a deeper pass walking fewer
   stops, and is there any other path (client-side offeredDepths, rule 7/8, caps) that could still
   make a walked deeper pass shorter after the plan's repair?
2. Is the repair algorithm (drop carried entries into the shallower pass latest-first, then move the
   shallower pass's lowest-priority own stop one pass deeper, Gist→More then More→Most, loop)
   correct, terminating, and does it preserve every cap and rule 7 (an `again` naming an unoffered
   pass)? Can moving a stop deeper ever empty a pass, unoffer a depth, or invalidate another stop's
   `again`? What should happen for fewer than 8 quotes?
3. Is the new `targetsFor` formula sound? Check g<m<n and caps for every q in 8..120; flag any q
   where it fails or gives an odd split. Is a smaller Gist for 8–14 quotes the right trade?
4. Is changing the prompt (skim/12) justified versus validator-only, and is the planned measurement
   enough?
5. The previous-stop door: hidden on stop 1 of a pass — right? Any interaction with the end-of-pass
   door, the carried-stop-first case, the narrow-window "All stops" button, keyboard/StepTip?
6. Anything simpler that achieves the same guarantee?

Answer as numbered findings, each with severity (high/medium/low), the evidence (file:line), and a
concrete recommendation. Be concise.
