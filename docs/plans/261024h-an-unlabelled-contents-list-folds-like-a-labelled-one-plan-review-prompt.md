You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only.

The plan: docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md

Context to read: docs/project/front-and-back-matter.md, src/matter.ts (especially `contentsRun`,
`contentsExplained`, `isContentsEntry`, `entryText`, `headingNames`, `stretchEvidence`,
`holdStretches`, `labelledSection`, `combineMatter`), src/matter-labels.ts (`matterByLabels`, the
`placed` rule), and the eval harness scripts/matter-eval.ts. The repro of the missed case is
tmp/repro-toc.ts (run against a saved copy of
https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/).

Questions:
1. Is the diagnosis right — no source proposes an unlabelled contents run, while the evidence check
   would accept one? Anything in `holdStretches` or `combineMatter` that would still drop or mangle
   the proposed stretch (e.g. the masthead echo, `contentsCut`, the union's partition with the
   model's adjacent title/dateline/figure stretch, the one-short-block rule)?
2. Is the proposed rule (every block exactly a later own heading after `entryText`, >= 3 entries,
   >= 3 distinct headings, opening placement) safe against folding prose? Construct concrete
   counterexamples if you can — articles where a run of short lines equals later headings but is not
   a table of contents and should stay visible.
3. Is it too strict to catch common real-world unlabelled TOCs (Hugo/Ghost/Docusaurus/WordPress
   plugins, Substack, Wikipedia-like pages, PDFs)? E.g. entries carrying numbering, nested lists
   flattened into one block, entries that are links with trailing characters. Say which relaxations
   are worth it and which are not.
4. Is putting the rule in matter-labels.ts (the free rule) the right home versus matter.ts, given
   `matterByLabels` is also what a failed model call falls back to?
5. Anything simpler that does the same job?

Write findings in order of severity, each with the file/line and a concrete failure scenario. Be
specific; do not restate the plan.
