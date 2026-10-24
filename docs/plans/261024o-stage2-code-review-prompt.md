# Code review: Situate stage 2, the dossier in Investigate and the privacy page (261024o)

You are reviewing **uncommitted code** in this worktree for Spideryarn. House rule: **you fix what
you find** inside this stage, in the working tree, and report anything wider. Do not commit, push,
deploy, touch production, `.env.local`, `infra/` or systemd, or make paid model calls. Never run git
commands that discard work.

**The plan**: `docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md`
(§ The dossier, at the top of Investigate; § Stages item 2). Stage 1, the server step, is committed
(`8cf25115e`, reviewed by you in `docs/plans/261024o-stage1-code-review-sol.md`).

**In scope (stage 2 only)**: new `src/web/useSituate.ts`, `src/web/situate-dossier.ts`,
`src/web/SituateDossier.tsx`, `tests/situate-dossier.test.tsx`; changes (`git diff HEAD -- <file>`)
to `src/web/InvestigatePanel.tsx`, `src/web/modes/sources/SourcesMode.tsx`,
`src/web/styles/reception.css`, `src/web/PrivacyPage.tsx`, `tests/privacy-page.test.ts`,
`tests/reception-lens-in-chat.test.tsx`, `docs/project/privacy.md`, `docs/project/sources.md`,
`docs/project/experimental-features.md`, `src/web/help/pages/modes/sources.md`,
`src/help-corpus.generated.json`.

**Out of scope, do not edit**: `src/web/marginalia/*`, `src/web/BlockLinkCard.tsx` and any other
Marginalia file — another agent is building stage 3 there right now. Server files from stage 1 only
if a stage-2 bug truly needs it; report it.

The builder's departures: the dossier sits under Investigate's pinned question box rather than above
it; the stale banner's dismissal lasts one page view (situate is not in `STALE_NOTICE_MODES`);
findings stay usable when stale; the disclosure names OpenRouter, Exa and OpenAlex.

## Look hardest at

1. **Never runs without a press**: no request to `/api/situate` and no job for visitors, for the
   switch off, or on arriving at Investigate; `ensure` vs `regenerate` (`force`) correct; nothing
   loops (a hook that re-posts a job on re-render, an effect without the right deps).
2. **Model text is untrusted**: rendered as text everywhere; source links safe (`http(s)` only? a
   `javascript:` URL from storage?), `rel`/`target` right.
3. **Ask in chat**: the lens question round-trips so `threadForOrigin` finds the chat again; the
   600-character cap; parity with how other Investigate lenses do it.
4. **Privacy page truthfulness** against what stage 1 actually sends (read `src/situate.ts`: what
   goes to the search engine, to OpenAlex, to the model provider), and the plan's disclosure.
5. **Stale / outdated / profileChanged** behaviour consistent with the other Sources artefacts;
   jobs-tray and `useStepFinished` refresh after a run.
6. Reuse: does it duplicate an existing shared component or helper (docs/project/web-client.md §
   Shared code (client), docs/project/controls.md)?

Grade P0–P3 with IDs (`D1`…), evidence file:line, and what you changed or why not. Run
`npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if the sandbox blocks tsx's pipe)
and `npx vitest run tests/situate-dossier.test.tsx tests/reception-lens-in-chat.test.tsx
tests/privacy-page.test.ts tests/doc-links.test.ts tests/help-corpus.test.ts`; say what is green.
End with a one-paragraph verdict.
