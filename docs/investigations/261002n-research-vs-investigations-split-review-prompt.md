# Review: splitting docs/research/ into research (external) and investigations (internal)

You are reviewing commit `d089731fc` in this worktree (`git show d089731fc`, or
`git diff d089731fc~1 d089731fc`). Today is 2026-10-02. You may edit files to fix what you find;
report anything wider than that for me to decide.

## Background

Greg, 2026-10-02, verbatim: "I realise that my instructions were incorrect. I think we should use
docs/research/ for research about external stuff (e.g. deep dive web searches), and
docs/investigations/ for internal/evals stuff. Update accordingly, and then consider minimal updates
to relevant docs approved."

The split I applied:
- **investigations (internal)**: evals, model comparisons, prompt or effort measurements, audits of
  production data, spikes against our own code or data.
- **research (external)**: web or literature deep dives, library or vendor selection, best-practice
  surveys. A mixed doc stays where most of its substance is.

I moved 28 entries with `git mv` (filenames kept), relinked every reference repo-wide, and added
`docs/project/investigations.md` as the folder's owner doc.

Borderline calls I made — please challenge each:
- **Moved**: 260826c (an audit of our own call sites; its siblings 260826b/d are vendor docs and
  stayed), 260830a (code reading plus measurements on our articles), 260831b (latency measurements of
  our box and laptop link), 260903b-facts-that-were-wrong (a trawl of our own session transcripts),
  260904a (Nano Banana: a spike generating images with a vendor model, i.e. a model eval).
- **Stayed**: 260909a usage-history dead ends and 260909b shared team box (internal design options,
  not evals); 260910a reader study protocol (a study design, not run); 260928a shelf facet terms
  (mostly web, one small Opus spike); 260928b academic bulk import (options doc, code facts plus web
  sources); the 260902k positioning materials and 260828b/c decorated-mode idea catalogues (neither
  external research nor evals); 261002a-a-nicer-typeface (web research).

## What to check

1. **Misclassified files.** Read the first screenful of every file left in `docs/research/` and in
   `docs/investigations/` and say which, if any, is in the wrong folder under the rule above, with a
   one-line reason. Do not move anything yourself; list it.
2. **Broken links or stale paths.** Any reference, anywhere in the repo (docs, plans, postmortems,
   evals, src comments, tests, scripts, AGENTS.md), that still points at an old `docs/research/<x>`
   path for a moved file, or a relative link inside a moved file that no longer resolves (for
   example a link from a moved file to a sibling that stayed in research). Fix these.
3. **The new and edited docs**: `docs/project/investigations.md`, `docs/project/research.md`,
   `docs/project/vision.md`, `AGENTS.md` § The other folders, `docs/reusable/engineering-manager.md`
   § Along the way (Spikes bullet), `evals/README.md` top paragraph. Are they accurate, minimal, and
   consistent with each other? Is Greg quoted exactly?
4. `scripts/plan-name.ts` DIRS and `tests/plan-name.test.ts`: is the new test meaningful?

Run `npx vitest run tests/doc-links.test.ts tests/plan-name.test.ts` after any edit.

## Answer format

A verdict line, then numbered findings, each marked FIXED (with the file) or FOR YOU (with the reason
you did not fix it). End with the list of files you changed.
