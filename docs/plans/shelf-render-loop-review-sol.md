## Verdict

**PROCEED-WITH-CHANGES.** The loop is stopped and `autoResetPageIndex: false` is safe, but fix A is incomplete and the postmortem contains several factual overstatements.

### Findings

1. **Medium — Admin still supplies an unstable `rowId`.**  
   [`AdminPage.tsx:157`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AdminPage.tsx:157) passes `rowId: (u) => u.id`, creating a function every render. [`useSortedTable` keys `ordered` on `rowId`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/DataTable.tsx:181), so Admin recreates `ordered`, its core row model, and its sorted row model every render. Without fix B, this independently recreates the loop even after removing `rawDir ?? []`. Fix B is therefore already protecting a live defect, not merely “the next one.”

   Move the function to module scope, as Library does with [`slugOf`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Library.tsx:423).

2. **Low — The postmortem names the wrong change history.**  
   [`shelf-render-loop.md:82`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/shelf-render-loop.md:82) says `ddd1d80` added both `useSortedTable` and `const dir = rawDir ?? []`. Git shows the latter was introduced by `c2f8132`; `ddd1d80` added the table implementation and was the first buildable commit containing the complete ring. That distinction should be recorded.

3. **Low — The scheduling account contradicts itself.**  
   [`shelf-render-loop.md:41`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/shelf-render-loop.md:41) says the loop never got a frame, while [`:66`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/shelf-render-loop.md:66) says it yielded at rest. Only TanStack’s reset callback is necessarily a microtask; React’s subsequent at-rest work need not be. The safe account is:

   - At rest, resets occurred about 470 times/second.
   - After discrete input, `Input.insertText` stopped returning and the paused stack showed synchronous React work.
   - The exact scheduler transition is an inference, not established merely by CDP remaining usable. Debugger interrupts and compositor screenshots do not prove normal renderer task yielding.

### The six questions

1. **Fix A is complete for Library, not Admin.**

   Library’s identities are stable at rest:

   - `columns`: memoized on stable `shelf` and numeric `now` ([Library:135](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Library.tsx:135)).
   - `shelf`: memoized over state and callbacks ([useShelf:249](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useShelf.ts:249)).
   - `now`: state updated once a minute while visible ([useNow:21](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useNow.ts:21)).
   - `rows`: correctly memoized on `articles`, `query`, and `show` ([Library:160](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Library.tsx:160)).
   - `rowId`: module-stable.
   - `onSortingChange`: stable until one of its real dependencies changes.

   Admin’s `data`, `columns`, sorting, and callback are stable, but its inline `rowId` invalidates [`ordered`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/DataTable.tsx:181) every render.

2. **`autoResetPageIndex: false` breaks nothing currently.**  
   There are only two table call sites, no `getPaginationRowModel`, no page controls, and no page-state reads. TanStack’s pagination model therefore returns the pre-pagination model unchanged. `autoResetAll` is only an override consulted by reset functions; it schedules nothing itself. `autoResetExpanded` is invoked by the grouped-row model, which this wrapper does not install. Revisit this option only if real pagination is later added.

3. **The null change is behavior-preserving.**  
   `dir?.[i]` produces exactly the old `dir[i]` result after callers converted null to `[]`. The recursive `null` and old `[]` both mean “use natural directions.” Invalid or empty `dir` URLs already parse to null ([params.ts:919](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/params.ts:919)). `isAllNatural` and `sortingToUrl` are unchanged. No URL changes interpretation.

4. **The regression test is honest for fix B, but does not cover fix A.**  
   The first row-model evaluation registers auto-reset; a later evaluation with changed memo dependencies starts the loop. The deliberately fresh sorting makes two renders the correct minimum. The `CAP` does not mask failure: it stabilizes at 50, far beyond the `<5` failure threshold.  

   `<5` is adequate as an infinite-loop detector, but `toBe(2)` would catch bounded unexpected table updates too. The test will remain green if `rawDir ?? []` returns, because B contains it; that limitation is intentional but means A lacks regression coverage.

5. **Other identity instances:**

   - [`AdminPage.tsx:162`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AdminPage.tsx:162): fresh `rowId`, causing fresh table data.
   - [`App.tsx:744`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:744): absent glossary creates a fresh `[]`; it invalidates `termSelections` at [`:779`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:779), then article-wide `termMarks` work and the hover-card map.
   - [`DataTable.tsx:223`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/DataTable.tsx:223): fresh `defaultColumn` object handed into TanStack each render. It does not close this ring, but should be stable.
   - The `DiagramPanel` fallbacks occur inside memo callbacks whose dependencies are `layout`, so they do not have this defect.

6. **Postmortem corrections beyond scheduling/history:**  
   “It could not start from one render” should say: *the first row-model evaluation on a table instance only registers auto-reset; a later evaluation whose memo inputs changed can start the loop.* A plain second render with stable inputs does nothing. Also, [`:104`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/shelf-render-loop.md:104) is too broad: unstable sorting or data can trigger the reset; columns and `onSortingChange` are not sorted-row-model dependencies.

Targeted verification passed: 4 test files, 41 tests. No files were changed.