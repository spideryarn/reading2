# Code review: 261018i, Marginalia notes that save a click

You are reviewing the code built from plan
`docs/plans/261018i-marginalia-notes-that-save-a-click.md`. Read the plan in full first. Your own
plan review is in `docs/plans/261018i-plan-review-sol.md`, and the plan says how each of your
findings F1 to F7 was answered. Then read `CLAUDE.md`, `docs/project/marginalia.md` and
`docs/project/prompting-guide.md`.

The work is two commits on this branch, on top of `dc43a4e8e`:

```
git diff dc43a4e8e..HEAD -- src tests docs
git log --oneline dc43a4e8e..HEAD
```

- **Stage 1 (86cb811de):** the margin's opened Cites line draws the checked citation blurb with the
  `CiteBlurb` component from `src/web/BibliographyPanel.tsx`.
- **Stage 2 (e86448f5a):** origin notes. The relations step (`src/relations.ts`) gets a separate
  optional `sourceNotes` array, `toSourceNotes`, `sourceCap`, and `PROMPT_VERSION` relations/4. The
  types are in `src/types.ts` (`ARTICLE_NOTE_KINDS`, `MARGIN_NOTE_KINDS`). The card is
  `src/web/marginalia/MarginaliaColumn.tsx` (AsideNote) plus `tips.ts`, with the
  `SOURCE_NOTE_LABEL` "AI memory, unchecked" and the CSS. The rest is docs, help, the mode catalogue
  and the export description.

The evidence for the prompt change is in plan § Measurement. The arms are
`evals/results/margin-notes/w99-*.json`, the manifest is `evals/marginalia-sources/cases.md`, the
counting script is `evals/marginalia-sources/report.ts`, and the blind judge's files are
`evals/marginalia-sources/judge-*.{md,json}`. The article dumps in
`evals/marginalia-sources/articles/` are deliberately uncommitted, because they are article prose.

## What to look for

1. **Correctness.** Look at `toSourceNotes` and the shared `taken` set across both arrays, the caps,
   the drop reasons, and the schema (required keys, enum excluding `source`). Does a stored
   relations/3 row still parse and render? Can every reader of `Relations.notes` and
   `MarginNote.kind` handle `"source"`: exhaustive switches, tips lookups, export, chat tools, MCP,
   and any other consumer? Grep for `MARGIN_NOTE_KINDS`, `NOTE_TIPS`, `.kind ===` and `notesDropped`.
2. **Provenance.** Does anything show or hand on an origin note without the "unchecked" label? Think
   of the chat tools, export, MCP, any copy/quote path, and the narrow/phone layout. The plan's rule
   is to tell the article, memory and the web apart.
3. **Security.** Model output is rendered. Check that the origin note goes through the same text-only
   path as the other notes.
4. **The prompt.** Does it follow prompting-guide.md? Do the numbers in § Measurement match the arm
   files? Recount with report.ts if you can do so without the dumps; say if you cannot.
5. **Tests.** Is anything important untested? Did each new test fail before its fix where it should?

You may fix what you find inside this stage (`--sandbox workspace-write`). Keep fixes small, match
the surrounding code, and run the relevant vitest files plus `npm run typecheck`. Do not commit, do
not push, and do not touch the database or call paid models. Report anything wider for me to decide.

## Answer format

End with a line `VERDICT: APPROVE`, `VERDICT: APPROVE WITH FIXES` (you fixed things) or
`VERDICT: REVISE`. Before it, list each finding as: severity, file:line, the problem, the concrete
failure, and what you changed (or "not changed: why").
