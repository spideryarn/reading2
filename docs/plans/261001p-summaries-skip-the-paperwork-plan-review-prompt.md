You are reviewing a plan before it is built. Read-only: do not edit anything.

The plan: docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md
(read it in full first). It answers two admin feedback reports quoted at its top.

The code it changes:
- src/simple-summary.ts (`PITCH`, `NOTCH_UP`, `simpleSystem`, `SYSTEM_TAIL`) and src/types.ts
  (`SIMPLE_LIMITS`, `SIMPLE_ARTIFACT_VERSION`, `isUsableSimpleSummary`)
- src/tweets.ts (`SYSTEM`, `renderPrompt`, `PROMPT_VERSION`, `isStale`, `sentIds`)
- src/hierarchy.ts (`SYSTEM`) and src/hierarchy-prompt.ts (`PROMPT_VERSION`), plus
  src/hierarchy-expand.ts for the expansion stamp
- src/plain-words.ts as the model for the new src/paperwork.ts
- docs/project/prompting-guide.md for how a prompt change is measured here

Please check, and say for each finding how sure you are and what you would do instead:

1. Is the diagnosis right? In particular: is the nine-author first tweet really caused by
   `renderPrompt`'s byline line, and is the conflict-of-interest last tweet really caused by
   THE LAST POST asking for what the piece leaves open?
2. The paperwork rule's wording. Could it make a model drop something that IS content — e.g. a
   paper about research funding, a study's own limitations section, an author's stated
   position or a "who funded this matters" argument in a piece about industry ties? Is the
   "about the paperwork, not a subject the piece discusses" carve-out enough?
3. The structure kind: does telling the model a paperwork range gets a "what it is" gist conflict
   with anything else in hierarchy SYSTEM (the deeper-gist word floor, "It must be a CLAIM or a
   MOVE, not a topic label", the QUESTIONS block which requires a question on every depth-1
   node — a paperwork part at depth 1 then needs a question)? What should the wording be?
4. The takeaway wording: risk of invented advice ("news you can use"), or of it fighting
   Summary's "why THE PIECE says it matters" and "Only what the piece says".
5. The stamps: is not bumping Simple's version right, given `SIMPLE_VERSION ===
   SIMPLE_ARTIFACT_VERSION` and `isUsableSimpleSummary`? Is anything else keyed on hierarchy's
   or tweets' version that the plan has missed (checkpoints, the evals/summaries live arm,
   anything that reads `toc/9` literally)?
6. Brief: 100 → 80 words ask with the stored 240-word limit unchanged — is that the right lever,
   given the measured "runs a third over"? Anything else that reads `PITCH.brief.words`?
7. The measurement: is three papers × (before, before-2, after) with the screens and blind judge
   described enough to tell an effect from noise here? Anything cheaper or sharper?
8. Anything the plan should simply not do, or should do more simply.

Write your findings as a numbered list, most important first, each tagged P0/P1/P2/P3.
