# Plan review: Structure stage 2, the optional fourth level (read-only)

You are reviewing a plan before it is built. Do not edit anything.

Read `docs/plans/261029a-structure-one-level-deeper.md`, especially **§ Stage 2** and **§ Stage 2 as
built (2026-11-01)**, which is the design under review. Earlier sections are context (stage 1 and 1b,
the reading view, are already on `dev`). Your own earlier plan review is
`docs/plans/261029a-plan-review-sol.md`; findings PR-5..PR-7 were about this stage.

The code it touches:

- `src/structure.ts` — `STRUCTURE_BASE_SYSTEM` (the prompt; the STRUCTURE block's last two bullets are
  what changes), `TOC11_STRUCTURE`/`replacePromptBlock`/`SYSTEM`, `depth2Schema`/`depth1Schema`/
  `STRUCTURE_OUTPUT_SCHEMA`, `questionFor`, `buildTree`, `collapseRestatedRungs`,
  `estimateStructureTokens`, `finishStructureRun` and the `StructureRun` counts.
- `src/structure-prompt.ts` — `PROMPT_VERSION` (to become `toc/14`).
- `src/structure-starts.ts`, `src/start-ranges.ts` — the starts-only answer; the first child's start
  is pinned to its parent's. The plan's claim that "opening prose as a bare paragraph under the
  section" is not expressible rests on this. Check it.
- `src/structure-slices.ts` — the long-document path, which reuses `wholeDocumentRequest`.
- `src/structure-depth.ts` (new, committed) — run counts; `evals/structure-fourth-level/` (new) —
  the measurement harness and its scoring; `tests/structure-fourth-level-eval.test.ts`.
- `docs/project/prompting-guide.md` — the house rules for prompts and schemas.

What I want from you, most important first:

1. **Is the prompt wording right?** Will it make the level where the author's sub-headings divide a
   section, and only rarely elsewhere? Does anything in it fight an existing rule in the prompt
   (the 5-9 target, "~9 blocks" long-run rule, HARD heading boundaries, gist length bands, the
   QUESTIONS depth rule)? Is "the same level as the headings that start the neighbouring sections"
   precise enough, given the model sees tags like `<h3>`? Plainer or shorter wording that says the
   same is welcome.
2. **The opening-prose decision** (own first sub-section, vs folding into the first author
   sub-section, vs code that makes a bare paragraph). Is the simpler choice right? Anything in the
   reading view (stage 1/1b: `src/web/structure.ts`, `src/web/outline.ts`, `src/web/position.ts`)
   that would mis-draw an opening sub-section that does not start at an author heading?
3. **Anything downstream that silently breaks on depth-3 internal nodes** from a real model answer:
   labels (`src/labels.ts` batching and sibling sets), `assertTreeSound`/`tree-invariants.ts`, the
   checkpoint key, the slices seam check, the cascade (off), Arc/Diagram/Skim/Summaries/Marginalia,
   `library-scalars.ts` section counts, the export. Name the file and the line.
4. **The measurement**: is the corpus and the ship rule (median cost and time each < ~20% growth,
   judged against the before-1/before-2 spread) sound? Are the scoring definitions in
   `evals/structure-fourth-level/score.ts` and `src/structure-depth.ts` right, especially
   `swallowedHeadings` (false positives/negatives)?
5. Anything else that would make this a mistake to build as written.

Write findings as a numbered list, each with severity (blocker / should-fix / nit), the file and
line, and what you would do instead. Be concrete; skip praise.
