# Plan review: 261002c — Metadata search aliases, and keeping its search current

You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React).
Read the plan: docs/plans/261002c-metadata-search-aliases-and-keeping-its-search-current.md

Then read the code it changes: src/web/page-search.ts, src/web/PageContents.tsx, src/web/Metadata.tsx
(§ Section, every `<Section`, RERUN_LABEL, RerunSection), src/web/CommandBar.tsx (§ articleRows) and
src/web/command-match.ts, tests/page-search.test.ts, and the Help page's use of searchSections
(src/web/help/HelpPage.tsx, help-content.tsx), since the OR fallback changes Help's search too.

Greg's report, verbatim: "Add lots more keyword-aliases for Metadata page search to make it more
flexible/forgiving (e.g. I tried searching for "regenerate" to find ways to regenerate the AI
processing, and nothing matched). And update docs so that any time we update the Metadata page, we
keep that search and ToC up-to-date."

Check especially:
1. Is the diagnosis right? Is there any other path by which "regenerate" on a deployed Metadata page
   could have shown nothing (e.g. PageContents index timing, the aside, the narrow-window variant)?
   Also check the conclusion itself, not only the evidence for it.
2. The OR fallback: does it break the "second word narrows" property in a way readers would notice,
   or the Help page? Is "rank by count of words hit, then score" right?
3. The typed record replacing the `keywords` prop: is it sound, simpler than the alternatives, and
   does the source-order test genuinely fail when a section is added without words or when the
   record drifts? Name any way it passes while wrong.
4. Synonym groups: risks of putting broad words (update, fix, model, start, generate) in groups —
   false positives that would rank a wrong section first. A word may sit in only one group.
5. Anything simpler that does the same job.

Answer with numbered findings, each P1/P2/P3, with file:line evidence, and a one-line verdict.
