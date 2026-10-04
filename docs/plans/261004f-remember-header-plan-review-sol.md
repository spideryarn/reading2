## Findings

1. **P1 — Explore’s proposed card overstates the context automatically sent to the model.**  
   The plan says, “It is sent what you have highlighted, saved and discussed.” Earlier conversations are initially supplied as an index; the model must explicitly open one to read its contents ([converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/converse.ts:1222), [reader-notes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/reader-notes.ts:304)).  
   **Suggested change:** “It is sent your highlights and notes, plus a list of your earlier conversations. It can open one of those conversations and may search the web when useful.”

2. **P1 — The inventory misses two user-facing/doc consumers that will become inaccurate.**  
   The help copy still promises a small visible “written for you” label ([help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/help/help-topics.tsx:731)). Also, `mode.md` explicitly instructs new modes to pass `compact` to `WrittenForYou`, although the plan removes that prop ([mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/docs/project/mode.md:213)). The plan currently makes the `mode.md` edit conditional.  
   The catalogue’s `how` also appears directly on the generated Help page ([HelpPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/help/HelpPage.tsx:96)), covered by [help-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/tests/help-page.test.tsx:230), neither of which is in the validation inventory.  
   **Suggested change:** add `help-topics.tsx` and an unconditional `mode.md` update; include the Help page and its test in validation.

3. **P1 — The badge card largely repeats its heading instead of explaining it.**  
   “Written for your profile” followed by “This was written with your profile in mind” spends the card’s first paragraph restating the label. That conflicts with the card rule that the body should explain what the control/state means ([tooltips.md](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/docs/project/tooltips.md:215), [mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/docs/project/mode.md:294)).  
   **Suggested change:** use the body for the operational fact, for example: “The AI used both parts of your profile — About you and Why you’re reading this one — when it wrote this.” For the older state: “The AI used an earlier version of those details.”

4. **P2 — Quiz’s proposed card describes the marking source too narrowly.**  
   “Marked … against the passages the question came from” implies that only those passages are authoritative. The marker receives the whole article, with the reference answer and evidence passages as additional guidance ([quiz-mark.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/quiz-mark.ts:151), [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/routes.ts:2291)).  
   **Suggested change:** “A model compares each answer with the article, using the question’s reference passages.”

5. **P2 — “Remember is the only one without cards” is true only for registered sub-modes.**  
   The central registry confirms that Remember is the only formal sub-mode toggle lacking cards ([sub-modes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/sub-modes.ts:38)). However, visually similar controls remain without rich cards: Quotes’ ordering chips use native titles ([QuotesPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/QuotesPanel.tsx:1133)), and Skim’s depth selector has no card ([SkimPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/SkimPanel.tsx:445)).  
   **Suggested change:** say “the only registered sub-mode toggle without cards” and explicitly leave ordering/depth controls out of scope. Do not expand this small change to retrofit them.

6. **P2 — The Tooltip composition is safe, but “never both” is slightly stronger than the implementation.**  
   `Tooltip` merges the child ref and event props before cloning it, so `ProfilePanel` retains its click/dismiss handlers, dialog `aria-*`, label and focus target ([Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/Tooltip.tsx:345), [ProfilePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/ProfilePanel.tsx:274)). This wrapper is the simplest correct shape.  
   Once the panel opens, `enabled={!open}` closes the tooltip, but its 80ms exit transition can leave the fading card mounted briefly ([Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/Tooltip.tsx:340)). Also, an uncontrolled Tooltip does not set Floating UI’s hover interaction to `mouseOnly` ([Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbpmjy40-remember-header-tooltips/src/web/Tooltip.tsx:298)), so a long touch may momentarily activate hover before the click opens the panel. An ordinary tap should still finish with only the panel open.  
   **Suggested change:** soften “never both” to “the tooltip begins closing when the panel opens,” and add a real touch-tap check plus assertions that one click opens the panel and preserves `aria-haspopup`, `aria-expanded`, Escape dismissal and focus restoration.

The remaining central claims hold:

- Quiz is the sole `WrittenForYou` caller without `compact`; no other live mode header independently prints those words.
- Summary, Structure, Debate, Referee and Diagram give every registered sub-mode chip a card.
- Recall, Tutorial and Explore reach `MODE_CATALOG.remember` through `ChatPanel` → `ModeSurface`; Quiz correctly uses its own `QuizAbout`.
- Recall and Tutorial’s new sentences are supported by their prompts and activation behavior.
- The new catalogue-level `how` is true on the band, Dock and Help/visitor surfaces: it describes intrinsic behavior rather than promising that opening Remember starts work.
- The profile definitions, current/older-profile states and regeneration action are supported by `ProfilePanel` and `WrittenForYou`.
- Splitting the `(i)` copy into an overview plus four items directly answers the report; it is not unnecessary scope.

VERDICT: approve with changes