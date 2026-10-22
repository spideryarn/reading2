# Plan review prompt: 261020n

Please review the plan at `docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md`
before it is built. This is a read-only review: edit nothing.

Read these first:
- `CLAUDE.md`, especially § Working agreements: simplest version first, prefer simple over easy, and
  let the types catch it.
- `docs/project/reception.md`, `docs/project/sources.md`, `docs/project/chat-from-a-mode.md` and
  `docs/project/mode.md`.
- The panel `src/web/ReceptionAndClaimsPanel.tsx`. Its file header has rules about headings and
  tallies, and the render, `Threads`, `Row`, `ReceptionList` and `ClaimsList` are the parts this plan
  changes.
- `src/web/sources-counts.ts`, `src/web/reception-threads.ts`, `src/web/reception-levels.ts` and
  `src/web/modes/sources/SourcesMode.tsx`.
- In `src/web/reader/Reader.tsx`: `handToChat`, `lensInChat`, `openOrigin` and `reopenItemChat`.
- In `src/web/chat-handoff.ts`: `askReceptionThroughLens` and `askToCheckClaim`.
- `src/web/thread-source.ts`, plus `params.ts` § `sourcesParam` and `visitorSourcesView`.
- The postmortem `docs/postmortems/261003h-*`.

Look for:
1. **Correctness and feasibility.** Anything the plan asserts about the code that is false, such as
   origins, counts, the visitor path, activation, the way back, or `?receptionthread=`.
2. **Silent failures.** Something that would report success while doing nothing. Examples: a mark
   that never appears because the bundle is built from the wrong list, or a section whose count
   disagrees with its rows.
3. **Rules the plan breaks.** Does any of it break a rule recorded in the panel header or in
   reception.md? Look especially at "a heading is a claim we stand behind", the title-only rows
   never being hidden by default (postmortem 261003h), and the AI fence.
4. **Missing places.** Anything the sub-mode checklist in mode.md, or the chat-from-a-mode steps,
   requires that the plan leaves out.
5. **Defences.** Anything that would edit a defence named in `docs/project/security-map.md`. Those
   must be planned and asked about, not built.
6. **A simpler design.** Anything that meets Greg's two quotes with fewer parts.

Write your findings first to
`docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode-plan-review-sol.md`. Number
each finding F1, F2 and so on, give each a severity (blocker, should-fix or nit) and a file:line for
evidence, and end with an overall verdict.
