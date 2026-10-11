You are reviewing code before it is pushed, in the repo at the current directory (Spideryarn). You
may FIX what you find inside this change's own files (house workflow: the code reviewer fixes
within the stage and reports anything wider). Do not run git commands that commit, reset, stash,
checkout or otherwise discard work; do not touch the production database, .env*, infra/.

The plan, including your own earlier plan review and what was done with each finding:
docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md
(your plan review: docs/plans/261011aa-plan-review-sol.md).

The change, as a diff against HEAD: docs/plans/261011aa-code-review.diff. Files:
- src/web/chat-searches.ts (new): the per-tab store that runs a chat's quick search and reads the saved list
- src/web/ChatSearchCard.tsx (new): the card drawn in a search button's place
- src/web/CommandChip.tsx: draws the card for quick-search / find inside ChatSearchHere
- src/web/reader/Reader.tsx: provides ChatSearchHere around the chat band and the dialog
- src/web/CommandBar.tsx: searchRunHref beside findHref
- src/web/styles/mode-band.css
- src/converse.ts (GUIDE_SYSTEM, COMMAND_CHIPS), src/live.ts (SPOKEN_GUIDE): prompt wording
- tests/chat-search-in-place.test.tsx, tests/guide-links-and-searches-prompt.test.ts (new)

Must not be edited (a security defence, docs/project/security-map.md): src/web/chat-commands.ts and
src/web/command-proposal.ts. If a finding needs a change there, report it instead.

Look hard for:
1. Correctness of the store: useSyncExternalStore snapshot identity (no render loops), the key
   (reader, slug, words), the double-press guard, error → retry, a stream that ends without done,
   a done with status error, the reader binding (madeFor) at the press, memory growth.
2. The card: recheck at press (chipFor again), the refusal line, the saved-answer guard (every hit
   block still exists), counting unique passages, the article-order sort, link building, the
   anchor's click handling, the GuideNextSteps SearchStep (its Enter handler clicks
   `button.cmd-chip` in its parent — does that still work, and does the remount-on-words still
   behave), and any surface that has an executor but no ChatSearchHere.
3. Anything a model-written token can now do that it could not before.
4. The prompts: contradictions with the surrounding prompt text (e.g. COMMAND_CHIPS' "one button
   is usual", NEXT STEPS, the guide's YOUR TOOLS paragraph and the web-search paragraph a peer
   added), and anything that would make the spoken voice read ids or tokens aloud.
5. Tests: anything they claim but do not actually check.

Run `npm run typecheck` and `npx vitest run tests/chat-search-in-place.test.tsx
tests/guide-links-and-searches-prompt.test.ts tests/chat-command-chips.test.tsx
tests/guide-next-steps-row.test.tsx tests/live-guide.test.ts` after any fix.

Write your findings as a numbered list, each: severity, evidence (file:line), and whether you
fixed it (and how) or are reporting it. End with a one-line verdict: "ship", "ship after my
fixes", or "do not ship".
