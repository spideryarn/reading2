# A `metadata` re-run keeps what it does not make; the rollback exports the abstract

Up: [plans.md](../project/plans.md) · found by
[261009n](261009n-pdf-quality-warnings-not-stored.md) § For Greg, and the
[261009h postmortem's follow-up](../postmortems/261009h-a-flag-the-store-did-not-keep.md#follow-up-the-metaquality-sibling-and-a-second-sweep).

Two bugs found in a review, not a reader report, so no feedback note. Fixed under Greg's standing
rule:

> You are definitely authorised to fix bugs any time you notice them
>
> — Greg, 2026-10-09

## 1. A standalone `metadata` run wiped how a PDF was read

**The bug.** The `metadata` step (`src/pipeline.ts`, `STEPS.metadata`) builds `meta` from
`paperMeta` and the registry: title, authors, byline, abstract, DOI, journal, date, `source`. Its
`meta` goes to the store through `metaColumns` (`src/store/artifacts-pg.ts`), which writes **every**
column `?? null` on purpose, so a field a step stops producing clears its column. That is right for
the fields the step makes, and wrong for the ones it never makes. Run alone on an article `extract`
had already read in full, it cleared `method`, `pages`, `unverified`, `recall`, `pagesChecked`,
`quality`, and the page's `siteName`, `lang`, `excerpt` and `note`. Only the verified administrator
can run it alone (`src/jobs.ts`), and nothing could bring the values back short of a fresh,
paid-for transcription.

**Reproduced** twice, both seen red:

- `tests/metadata-rerun-keeps-extract-pg.test.ts` — the real thing: an administrator's
  `{ steps: ["metadata"] }` job through `enqueue`, `advanceJobWith` and `claimSession` over an
  article whose published revision holds `extract`'s reading, with only the reader, registry and
  tidier faked. Without the fix the new revision has fifteen columns null — `recall`,
  `pagesChecked`, `quality`, `extractMethod`, `pages`, `unverified`, `siteName`, `lang`, `excerpt`,
  `note`, `byline`, `abstract`, `doi`, `journal`, `publishedAt`.
- `tests/metadata-rerun-keeps-extract.test.ts` — the rules, over `memoryArtefacts`, with a previous
  `meta` typed over every `Meta` field.

**The fix.** `METADATA_STEP_FIELDS` in `src/pipeline.ts`, a
`Record<keyof Meta, "made" | "filled" | "kept">`, says for every field what the step does with it,
and `metadataOverPrevious` (pure, beside it) lays the step's `meta` over the revision's. The step
reads the revision's `meta` (the draft carries the published one's columns, by
`REVISION_CARRY_POLICY`; GPT Sol confirmed the read is bound to that one draft, F3). Because it is a
`Record` over `keyof Meta`, a new `Meta` field does not compile until somebody has said which.

- **`made`** — `slug`, `title`, `titleOriginal`, `source`: the step always says them.
  `titleOriginal` goes with its title; `stepTitleTidier` already holds the pair when the raw title
  repeats.
- **`filled`** — what the run finds replaces what was there; what it does not find leaves what was
  there. In units: **authors and byline** (the run's unless it found none, or the same names in the
  same order — then `extract`'s affiliations and byline stand, since this step reads neither);
  **DOI and journal** (the old journal stands only beside the same DOI); **day and year** (one or
  the other by CHECK; the old pair stands only when the run found neither); **abstract**.
- **`kept`** — everything else, the PDF provenance block and the page's `siteName`, `lang`,
  `excerpt` and `note` among them. `url`, `fetchedAt`, `filename`, `rawSha256` and
  `readingDifficulty` are `kept` too and the write ignores them, since `metaColumns` does not name
  them.

The first draft had only `made` and `kept`, so a re-run that found no byline, date or DOI still
cleared extract's. GPT Sol's plan review (F1) caught it: the same class as the bug.

- **A minimal paper's first run** has no previous `meta`, so nothing is kept (tested). A retry of a
  failed minimal job does not look back into the failed draft (Sol, F3).
- **What this gives up**: a standalone re-run can no longer *clear* a byline, DOI, date or abstract
  that is wrong. Re-extraction still can. That seemed the right side to err on for an
  administrator's repair tool; say if not.

**Simpler option passed over: make `metaColumns` step-aware** — write only the columns the calling
step owns. It would fix every step at once, but it is a change to the one write every stage shares
and to its `?? null` rule, for a bug only one step has, and it could not express "fill"; the
step-level list is one place, typed, and next to the code that produces the fields.

## 2. The rollback's `meta.json` left out `abstract`

`exportArticle` (`src/store/export.ts`) builds `meta.json` field by field and never named
`abstract`, with nothing saying so. For a minimal paper the abstract is the only prose there is. It
is written now, beside `note`; the round-trip corpus has no abstract, so the round trip (which compares parsed, canonical JSON) is unchanged.

`doi` and `journal` stay out: whether the rollback carries them is Greg's open question from
[261004a](261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md). The
omission is now written down in both places that list deliberate losses — a comment at the field
list, and [export.md § Why there are two exporters](../project/export.md#why-there-are-two-exporters) —
and `tests/export-meta-abstract-pg.test.ts` pins it, so deciding it means changing that assertion.
The reader's zip already keeps all three (`content/revision.json`).

Seen red: the abstract was `undefined` in `meta.json`.

## GPT Sol's plan review

[261009p-plan-review-sol.md](261009p-plan-review-sol.md), APPROVE WITH CHANGES, after a first
draft was already in the tree. **F1 taken** (fill rather than clear, above). **F2 taken** (the
Postgres job test, and the impossible fixture with both a day and a year is gone). F3 and F4
found nothing to change. **F5 taken** (wording: the round trip is semantic, not byte-for-byte).

## GPT Sol's code review

[261009p-code-review-sol.md](261009p-code-review-sol.md), APPROVE WITH CHANGES. One finding,
fixed by the reviewer: the DOI comparison was case-sensitive, so the same DOI in other capitals
dropped the journal. It now compares case-insensitively, with a test case. It found the
`Record<keyof Meta, …>` exhaustive and the casts harmless. It could not reach the database from its
sandbox; the three Postgres tests were run outside it.

## For Greg

- **A standalone `metadata` re-run now fills rather than clears** a byline, DOI, journal, date or
  abstract it does not find, so it can no longer remove a wrong one; re-extraction still can.
- **`doi` and `journal` in the rollback's `meta.json`**: still your open question (261004a). Adding
  them is two lines and one assertion.

## Gates

`npm test`, `npm run typecheck`, `npm run lint` on touched files. GPT Sol plan review, and code
review before pushing.
