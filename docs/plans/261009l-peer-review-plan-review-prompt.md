# Plan review: 261009l Peer review mode (read-only)

You are reviewing a PLAN, read-only, in the repo at the current working directory, revision 802190b49 (branch worktree, plan committed).

Read first:
- docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md (the plan under review)
- docs/user-feedback/questions/q-xf2xvb.md (the question Greg answered; his reply is quoted in the plan)
- docs/plans/261004b-citation-hover-card-offers-dig-deeper.md § Part 2 (the options B, C1, C2)
- docs/project/mode.md (§ The client, § Moving a mode in or out of the switch, § Retiring a mode, § Renaming a mode)
- docs/reusable/rename-or-move.md § A rename on screen is a rename all the way down

Then check the plan against the code: src/modes.ts (MODES, RETIRED_MODES, modeFromParam), src/mode-catalog.ts, src/web/sub-modes.ts, src/web/params.ts (debateParam, citeOrderParam, citeBarParam, CHAT_FROM_WORDS), src/web/router.ts (liftLegacyTweets, liftLegacyDebateBy, settleAddress, liftedLegacyHref), src/web/activation.ts (MODE_TARGET, activationForDebate, modeStep, bandTarget), src/web/auto-modes.ts + src/auto-mode-steps.ts, src/web/reader/Reader.tsx (openOrigin, focusModeWas, subModeViews, modeBand), src/web/reader/ModeBoundary.tsx, src/web/modes/debate/DebateMode.tsx, src/web/modes/citations/CitationsMode.tsx, src/web/DebatePanel.tsx (DebateViews, claims list), src/web/CitationsPanel.tsx, src/web/useCitations.ts, src/web/visitor.ts POLICY, src/web/last-view.ts, src/types.ts (ListedClaim, CitedWork.citedAt, ThreadOrigin), src/web/help/.

Questions to answer:
1. Is the merge shape (a wrapper band, a shared 3-chip row passed as `head` into the two existing panels) sound? Anything in ModeSurface/head/(i)/tests (mode-surface-changes-no-markup, every-mode-draws-its-surface, a-broken-mode-leaves-the-article-readable WITNESS) that makes it harder than the plan says?
2. Is `peer-review` (with a hyphen) a safe Mode word everywhere it travels: URL, modeFromParam, help anchors `mode-peer-review`, CSS classes, last-view keys, feedback payload, command bar, `/read/x/<mode>` paths if any? Or is a single word safer?
3. Old links: does the lift plan cover every live form (?mode=citations, ?mode=debate, ?debate=claims, ?debateby=claim, path forms, popstate, last-view restore of mode=debate/citations, help anchors, Dock's debateInSearch, chat origins' way back)? Ordering hazards with liftLegacyDebateBy?
4. Auto-run and spend: once out of the switch, is queuing only `citations` on import via DELEGATED_MODE_STEPS right and consistent with tests/auto-modes.test.tsx? Can any path now buy the Reception web search without a press on its chip (the Peer review button press arming the landing view; last-view restore; command bar)? Is there anything stopping one reader repeatedly buying Reception searches (forced re-run), now that every reader can see it?
5. C1: is `work.citedAt.includes(claim.blockId)` the right join? Is citedAt present for owner and visitor reads, and for older stored citations artefacts (absent field → crash)? Is the citeFocus hand-off reusable from inside DebatePanel?
6. The deferred deep rename (Stage 3): is holding it until Greg confirms the name a defensible reading of his rule, or a "sentence is not a fix" (docs/reusable/written-down-is-not-checked.md)? What must stage 1 do now so that the held stage is not silently forgotten or made harder?
7. Anything missing from Stage 1's list that the suite would catch only late, or nothing would catch.

Severity scale: P0 (wrong/broken for readers or spends money wrongly), P1 (likely bug or significant gap), P2 (worth fixing), P3 (nit). Give each finding an ID (F1, F2…), severity, the file:line evidence, and a concrete fix. End with a one-line verdict: BUILD AS PLANNED / BUILD WITH CHANGES / DO NOT BUILD.

My own suspicions, last: the counts on the chip row need reads from both halves at once; the visitor band composition (VisitorBand, visitorGap) may assume one artefact key per mode; and `RETIRED_MODES` maps to BandMode only.
