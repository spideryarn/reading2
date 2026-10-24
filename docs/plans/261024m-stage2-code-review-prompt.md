# Code review, stage 2 of 261024m: the citation card starts *Does it say that?* after a rest

You are reviewing AND fixing code in this worktree (Spideryarn: TypeScript ESM, React client in `src/web/`, Express server in `src/`). The candidate is exactly commit `ebbf69930` (`git show ebbf69930 --stat`; `git show ebbf69930`). Start with `src/web/cite-check.ts`, `src/web/ProseHoverCard.tsx` (`CiteCheckSection`, `CiteCard`, the call site that passes `citeCheck`), `src/web/useHoverCard.ts` (`byTouch`, and the moved "pointer inside the card" check), `src/web/chat/effects.ts` (`TurnSink.refused`), `src/web/reader/Reader.tsx` (`checkCitedWork`, `startCiteCheckChat`, `openThreadInChat`, `citeCheckSenders`), `src/web/ChatDialog.tsx`, and the tests `tests/cite-check-card.test.tsx`, `tests/cite-check-loader.test.ts`; that list does not limit scope.

The server it talks to is stage 1 (commits `339091370` and `f33fc3986`, already reviewed by you: `docs/plans/261024m-stage1-code-review-sol.md`). The spec is `docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md` § What we build: option C, overridden by § After GPT Sol's review of option C (C1–C11; your plan review is `docs/plans/261024m-c-plan-review-sol.md`).

**You fix as well as find.** Fix what is inside this stage, narrowly and red-first. Report — do not fix — anything wider. Do not commit; leave changes in the working tree.

These jsdom tests need nothing outside the tree; run them yourself: `npx vitest run tests/cite-check-card.test.tsx tests/cite-check-loader.test.ts tests/glossary-and-bibliography-ask-in-chat.test.tsx` (61 passed for me), plus `npm run typecheck`. The hover-card suites (`ls tests | grep -i -E "hover|touch|prose-card|marginalia"`) are worth running too after any change to `useHoverCard.ts`.

Attack, in particular:
1. **Spend**: can anything send an automatic start the reader did not rest for — a touch open, a card with two works, a reference entry, a visitor, view-as, a warm swap through the card in under 2 s, a re-render that remounts the section, StrictMode double effects, two tabs or two cards on one key, a press racing the timer? Can one rest start two?
2. **Reader isolation (C3)**: after a reader change mid-stream, can any callback, poll or adopted 409 repopulate the loader with the old reader's text?
3. **State correctness (C5)**: the card shows the first assistant answer; refetch on `updatedAt`, a deleted thread, a missing one; the "elsewhere" poll is bounded and stops on unmount/reader change; a cap/stale line kept for the tab is right, or does it hide a chat the reader later starts by pressing?
4. **The `useHoverCard.ts` change** (moving the pointer-inside-card check ahead of the selector match): does it change behaviour for any other card (glossary, links, quotes, cross-references, Marginalia's tooltip), touch, or keyboard?
5. **The press path**: reuse/adopt/start order; Continue in Chat opens the right thread; Chat's list and the item-chat reopen still work for the other origins.
6. Rendering: answer text is model output — React text and `CitedMarkdown` only, no `dangerouslySetInnerHTML`; links scheme-checked as in Chat.

Severity: P0 (ships broken or unsafe), P1 (must fix before landing), P2 (should fix), P3 (nit). An ID on each (T1, T2…), file:line evidence, and what you changed (or "reported, not fixed: wider"). End with a short verdict and the list of files you modified.

My own suspicions, last (spend most of the run elsewhere): the "kept for the tab" cap line may be wrong after midnight or after a press; the module's at-most-two-in-flight counter may leak a slot on an exception path; the `byTouch` flag may be stale on a card that was first tapped and then hovered.
