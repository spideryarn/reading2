K2-REVIEW-7f3a91

Found two behavioural defects and census errors. Both fixes are applied, red-first, and uncommitted.

- **K2-F1 — P1, established: composing Escape escaped seven handlers.** With nonempty Annotate, Comment follow-up, shelf, Help or contents text; a changed Comment note; or open TagEditor suggestions, either composition flag let Escape reach `document`. Ordinary Escape was contained. Fourteen cases failed on this difference. **Smallest fix, made:** move each existing conditional `stopPropagation` before the composition guard, preserving its original condition.

- **K2-F2 — P1, reasoned browser consequence; missing cancellation established.** Open the drawer, focus DockQuickSearch, and press composing Escape. Capture prevents the input handler running, leaving `defaultPrevented` false. Two tests established that failure; Chrome clearing follows from the supplied browser measurement, without a new browser run. **Smallest fix, made:** the drawer cancels composing Escape when its target is a search input, while retaining containment.

- **K2-F3 — P3, established: the census was incomplete and overstated some conclusions.** Source inspection found omitted `useMetadataChord`, ModeHerald’s dismissal listener, and the new-password form. ShelfTags’ dismissal requires hidden suggestions; Floating UI already tracks composition events. The changed-handler count was fourteen, not twelve. **Smallest fix, made:** correct the plan’s census and conclusions. Wider code remains untouched.

**Question 1:** The candidate had the two unintended composition behaviours above. After these fixes, I found no unexpected ordinary-key or visual change. TitleEditor’s ordinary Enter remains uncancelled and its form still saves; the inset contents focus mark matches the plan.

**Question 2:** The original census was inaccurate; the identified omissions and qualifications are now recorded. The eager-graph comment is supported by the source and passing graph test. I established no implicit-submit defect in the untouched forms, and have no engine-specific evidence that cancelling search Escape blocks candidate dismissal.

Validation: **330 tests passed across eleven single-file runs**. All four TypeScript projects passed using `node --import tsx scripts/typecheck.ts`; the npm wrapper encountered the sandbox’s IPC restriction. Scoped lint had no errors, three informational complexity notices. `git diff --check` passed.

Every file changed:

- `docs/plans/261007a-ui-sweep-k2-composition-keys.md`
- `src/web/AnnotateDialog.tsx`
- `src/web/CommentDialog.tsx`
- `src/web/Dock.tsx`
- `src/web/Library.tsx`
- `src/web/PageContents.tsx`
- `src/web/TagEditor.tsx`
- `src/web/help/HelpPage.tsx`
- `tests/help-page.test.tsx`
- `tests/metadata-contents-reveal.test.tsx`
- `tests/one-escape-closes-one-surface.test.tsx`
- `tests/shelf-search-clear.test.tsx`
- `tests/tag-editor.test.tsx`

**ready with these fixes**