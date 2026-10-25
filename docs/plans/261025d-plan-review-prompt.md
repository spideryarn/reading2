Review a plan, read-only. Do not edit any file. Repo: the current directory (Spideryarn).

The plan: docs/plans/261025d-citation-web-note-looser-page-rule.md. Read it in full.

It changes the rule for which web page a cited work's one-search note may be written from. Read
the code it changes before judging it:

- src/citation-web-note.ts (the press: `pageIsTheWork`, `readWebNote`, `WEB_NOTE_SYSTEM`,
  `makeCitationWebNote`)
- src/citation-web-note-shown.ts (`shownWebNote`, `searchedRecently`, the versions)
- src/citation-lookup.ts (`titleNamesWork`, `resultIsTheWork`, `surnameOf`) — `titleNamesWork` is
  shared with *Find it* and other callers
- src/citation-blurbs.ts (`checkSystem`, `CheckEvidence`, `WEB_EXTRACT_EVIDENCE`, `checkRequest`)
- src/citation-blurb-words.ts (labels), src/store/citation-web-note-row.ts,
  src/store/pg-citation-web-notes.ts, the `citationWebNotes` table in src/db/schema.ts
- docs/project/bibliography.md § "A note from one web search" and § Deferred
- the prior plan docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md
  (its R1 and stage-2 review #2 are what this loosens), and the question
  docs/user-feedback/questions/q-x9srvv.md
- G6 in docs/plans/261017h-stage-3-design-citation-blurbs.md (privacy of title searches)

The product owner has decided to loosen the rule ("I think we want to be looser"); do not argue
for keeping it strict. Judge whether this loosening is the right shape and safe:

1. Is the `looks-like` acceptance rule sound? What page kinds slip through that should not
   (encyclopedia, review, citing paper, syllabus, a different same-titled work, an erratum or
   comment), and which legitimate pages (publisher, PhilPapers, a university repository, an
   author's homepage PDF, Semantic Scholar's or Google Books' page) it wrongly refuses? Is the
   refused-host list the right length?
2. Is the `titleNamesWork` "reviews" change safe for its other callers (grep them)?
3. Privacy: is gating title-only searches on `importedFromAPublicAddress` right and sufficient?
4. Storage: the `page_basis` column, its CHECK and backfill; keeping /3 notes but not /3 nones;
   the `own` host cross-check. Any migration, export, rollback or transfer path that must learn
   the column?
5. The check's new `alsoFalse` line and `WEB_LOOKALIKE_EVIDENCE`: right, or does it weaken the
   abstract notes' check (which must stay byte for byte)?
6. Anything missing: tests that would not go red, a label that overclaims, a cost or abuse path.

Answer as a list of findings, each with a severity (P0–P3), the file and line it concerns, what is
wrong, and the fix. Then a one-line verdict: proceed, proceed with fixes, or rework.
