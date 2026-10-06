Found two P1 blockers and five P2 corrections. No files changed.

**F1 — P1: The judge cannot verify the context the new cue supplies.**  
Plan lines 98–106 give the judge only the quote and ask about preparation and answer leakage. For the reported “latter interpretation” case, that quote omits the very information being supplied. A fluent but invented comparison could therefore win and pass the ship rule. [renderPromptParts](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/skim.ts:1091) confirms generation receives quote records, rather than their paragraphs.

**Instead:** give the blind judge the source paragraph and enough surrounding text to resolve the referent. Add a grounding question: does either cue invent or misidentify context? Require improvement on the reported dangling-reference cases, with no grounding or leakage regression.

**F2 — P1: Controlled Tooltip state does not provide the promised mouse-click pinning.**  
Plan lines 46–48 promise that click or tap keeps the card open until an outside tap. [Tooltip.changeOpen](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/Tooltip.tsx:250) suppresses hover dismissal only for touch; [pointer handling](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/Tooltip.tsx:392) clears that exemption for a mouse. Copying Spine’s pattern leaves mouse-clicked cards subject to hover dismissal.

**Instead:** simplest is to specify desktop hover/focus and persistent touch opening. If mouse pinning is required, explicitly design separate pinned state and dismissal handling. Keep the panel’s shared term/idea selection: independent per-chip state would lose the existing [one-snippet rule](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/tests/skim-panel.test.tsx:801).

**F3 — P2: Reusing Tooltip does not ensure a rich card fits vertically.**  
Plan lines 64–66 require window containment. [Tooltip’s middleware](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/Tooltip.tsx:277) positions the card but supplies no size constraint; [tooltip.css](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/styles/tooltip.css:28) caps width only. [TermCard](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/ProseHoverCard.tsx:2243) includes the complete lookup answer, which can push its actions outside a short viewport.

**Instead:** specify a viewport-height cap and scrolling content. Check a long researched entry in phone landscape, including reaching every action.

**F4 — P2: Successful Hide removes both the focused control and its return target.**  
Plan line 50 introduces Hide here. [setHidden](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/useGlossary.ts:679) refreshes the list before resolving; [shownEntries](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/glossary-shown.ts:29) then removes the chip. Tooltip’s [focus manager](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/Tooltip.tsx:498) has `returnFocus={false}`.

**Instead:** add an explicit keyboard focus destination after successful hiding—another chip or the current stop’s row—and test hiding the final term.

**F5 — P2: Adding paragraphs would not make every stored route stale.**  
Plan lines 90–92 are false against [loadSkim](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/store/pg.ts:4103): hash mismatch counts only when the stored prompt version equals the current version. A version bump makes older routes outdated instead.

**Instead:** correct that conditional-arm explanation. The separate no-banner claim at lines 108–110 is correct: [bannerReason](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/SkimPanel.tsx:334) ignores outdated routes.

**F6 — P2: The cap decision needs evidence the production return value discards.**  
Plan lines 83–85 use an over-limit count to decide between 140 and 200. [cueOf](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/skim.ts:615) replaces rejected cues with null; [validation](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/skim.ts:703) reports a combined `badCue` count. Also, zero overruns cannot reveal context omitted to obey 140.

**Instead:** measure the final cap configuration. Starting at 200 is simpler; otherwise retain raw rejected cues and rerun after changing the cap.

**F7 — P2: Aggregate route metrics cannot establish that the route stayed unchanged.**  
Plan lines 101–102 compare counts and coverage. Those can remain identical while quote choices, depth assignments, or order change; array order defines the route in [SKIM_SYSTEM](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/skim.ts:1033).

**Instead:** compare ordered quote IDs, depths and `again` assignments against the control’s variation, and report unpaired quotes.

Exporting `TermCard` itself looks viable: rendering it does not mount the prose hover or lookup machinery. Its opener must become optional to support the proposed visitor card without navigation.

VERDICT: not ready