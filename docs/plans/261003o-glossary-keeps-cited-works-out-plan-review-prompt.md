# Plan review: the glossary keeps cited works out

You are reviewing a plan before anything is built. Read-only: do not edit files.

Read, in this worktree:

- The plan: `docs/plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md`
- The code it changes: `src/glossary.ts` (`SYSTEM`, `toEntries`, `buildGlossary`, `dedupe`,
  `inheritIds`, `existingFor`, `PROMPT_VERSION`), and `src/paperwork.ts` (`paperwork("pick")`).
- The docs: `docs/project/glossary.md`, `docs/project/citations.md`,
  `docs/project/prompting-guide.md` § Measuring a prompt change.
- The evidence the plan cites: the recorded glossaries in
  `evals/results/paperwork-modes/after*/*.json` (`outputs.glossary.glossary.entries`), and the
  eval the new one is modelled on, `evals/plain-words/glossary-people.ts`.

The report being answered, from the product's owner:

> It looks as though there is at least one glossary item in this article that's actually a paper,
> Saha et al. I don't think the glossary should include citations. That's what citations are for.

Questions, most important first:

1. **Is the line drawn in the right place?** "Cited as a source" is out; "discussed" stays. Is that
   a distinction a model can apply, and does the plan's reading of the report hold? Name cases the
   rule would get wrong either way.
2. **The `et al` guard in `toEntries`.** Can `/\bet\s+al\b/i` remove a real term? Is `toEntries` the
   right place, given `dedupe`, `inheritIds` (ids inherited by name from the list being replaced),
   the append path (`existing` entries written by an older run), and the reader's own added terms
   (`src/glossary-added.ts`, `src/glossary-lookups.ts`)? Is there another path by which a model's
   entry reaches the stored glossary that skips `toEntries`?
3. **Old glossaries.** The plan says a `glossary/8` list is rewritten the next time its step runs
   and that no read-time filter is needed. Check that claim against `src/pipeline.ts` (`stamp`,
   `sameStamp`) and the read path. Is anything left showing a stale citation entry in a way the
   reader cannot fix?
4. **The measurement.** Will the planned eval tell a real effect from run-to-run wobble, and does it
   watch for the known regression (people dropped from the glossary)? What would you add or cut?
5. **Anything simpler** that the plan missed, or anything it defers that should not be deferred.

Give findings as a numbered list, each with a severity (P0 blocks, P1 should fix before building,
P2 worth considering), the file and line where it applies, and what you would do instead. End with
one line: `VERDICT: build as planned`, `VERDICT: build with the P1 changes`, or
`VERDICT: do not build`.
