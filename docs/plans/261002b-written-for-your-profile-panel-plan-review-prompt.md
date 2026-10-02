Review the plan docs/plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md in this repo (read-only; do not edit files).

Read the code it touches before judging: src/web/ProfilePanel.tsx, src/web/WrittenForYou.tsx, src/web/ProfileBox.tsx, src/web/useAutosavedText.ts, src/web/useProfile.ts, src/web/purpose.ts, src/web/PurposePrompt.tsx (the Done latch), src/web/useDictationField.ts, and the mode callers: src/web/modes/summary/SummaryMode.tsx, src/web/SimplePanel.tsx, src/web/GlossaryPanel.tsx + useGlossary.ts, src/web/QuotesPanel.tsx + useQuotes.ts, src/web/IdeasPanel.tsx + useIdeas.ts, src/web/Tweets.tsx + useTweets.ts, src/web/SketchView.tsx + useSketch.ts, src/web/SkimPanel.tsx + useSkim.ts. Also docs/project/reader-profile.md sections on the profile panel and provenance.

Questions:
1. Are the two text-loss holes (dismiss while unsaved; dismiss mid-dictation) actually closed by the design? Any other way words are lost (e.g. FloatingPortal unmount on route change, the panel's trigger unmounting when the mode re-renders or the artefact reloads, the badge disappearing when profileHash changes or a job starts, two panels open at once, the offline cache of /api/reader)?
2. Is the Regenerate gating right — can a regenerate run against the old profile? Is `savedThisVisit` the right signal? Does each mode's named regenerate do the right thing (forced replace, not append; not discard reader data unexpectedly)?
3. Anything in Skim's stricter staleness rule or Sketch's "no paid redraw beside the picture" comment that should change the plan?
4. A simpler design that still meets Greg's words?

Give findings as P0/P1/P2 with file:line evidence, then a short verdict.
