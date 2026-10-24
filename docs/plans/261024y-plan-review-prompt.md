# Plan review: 261024y — a second press on a page already on the shelf opens it

You are reviewing a plan, read-only. Do not edit files.

Read:
- docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md (the plan)
- docs/plans/261024q-chrome-extension-one-click-add-the-page.md (the extension it extends; § Stage 4)
- src/web/AddFromExtension.tsx, src/web/extension-handoff.ts (the receiving page)
- src/store/find-article.ts § slugForUrlKey, src/saved-from.ts, src/urls.ts § savedSource
- src/routes.ts: the `/api/library/tags` row and the `POST /api/jobs` repeat-paste block (search "A repeat paste is free")
- docs/project/security-map.md (the saved-from row) and docs/project/auth.md § whose data is whose
- src/web/AddPage.tsx (search REPEAT_PASTE_ON_THE_SHELF) for how a repeat paste is shown

Questions:
1. Does the new read-only route touch or weaken any defence in security-map.md? Is the owner scoping real (follow ownedByReader)?
2. Is the client-side meta reading (DOMParser on the head slice) safe and equivalent enough to the server's?
3. Races: reader change mid-ask, StrictMode double mount, the `asked`/`spendAsk` once-guard, the ONE_UPLOAD_AT_A_TIME retry path. Does adding an awaited `have()` before `send` break any of them?
4. Anything simpler that does the same job; anything missing from the tests.

Answer as numbered findings, each with severity (blocker / should / nit), the file and line, and a concrete fix. End with a verdict: GO, GO WITH CHANGES, or REWORK.
