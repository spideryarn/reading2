You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only: do not edit files.

Plan: docs/plans/261011l-shelf-add-box-and-search-box-look-like-different-things.md
Code it touches: src/web/AddArticle.tsx (the add box render, ~lines 255-470), src/web/Library.tsx (`SearchBox`, ~lines 1170-1320, and where it is placed ~line 700-760), src/web/UploadPicker.tsx (the File button), src/web/router.ts (`addHref`), src/ingest.ts (`slugFromUrl`, `normaliseUrl`). Docs: docs/project/library.md, docs/project/controls.md, docs/project/narrow-windows.md, docs/project/icons.md, src/web/help/pages/shelf.md and adding-articles.md, src/web/help/help-images.ts.

Questions:
1. Does the design actually answer the report (two full-width fields readers confuse)? Is anything better and equally small?
2. Narrow windows: the shelf has no breakpoints and rows wrap. Will max-w + ml-auto on the search box, and max-w on the add card, behave at 320/390/768/1280? Anything in the job list or upload status inside the add card that breaks at 42rem?
3. The pasted-link offer in the search box: is /^https?:\/\/\S+$/ the right rule, or should it reuse slugFromUrl? Any risk (billing: /add/<url> starts an ingest that counts against a free allowance — it fires only on a button press)? Interaction with the URL-state `?q=` (a link in q), Escape/Enter handling, focus.
4. Anything the plan forgot: tests that assert the old placeholder or classes, the help picture, accessibility (aria-label, the label's htmlFor), the `ADD_URL_ID` link from an empty shelf, controls.md rules.

Write findings, most severe first, each with file:line and a concrete fix. End with a one-line verdict: BUILD AS IS, BUILD WITH CHANGES, or RETHINK.
