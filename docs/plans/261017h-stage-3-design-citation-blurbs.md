# 261017h Stage 3 design: a blurb per cited work (arm A)

Up: [261017h](261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md). Drafted by
Opus (read-only) on 2026-10-18 from the plan, the spike
([261017c](../investigations/261017c-citation-blurbs-cost-and-quality.md)) and the code; decisions
marked *Decided* are the orchestrator's.

## Decided before the design

- Arm A only: Claude Haiku 5.5 writes ≤2 sentences per work **from that work's abstract alone**,
  fetched from a public catalogue. No web search (the spike: 17% unsupported, $0.32 an article).
- Runs for every work whenever a Bibliography is made, after the list is published, going forward
  only (no backfill). Greg's own condition, *"a few cents for all the citations"*, is met at ~$0.01.
- Not Semantic Scholar and not OpenAlex title search in v1 (keyless rate limits; keys are question
  `q-ny49p3` (docs/user-feedback/questions/, committed with the feedback note)).

## Findings that changed the plan

1. **No arXiv API.** DataCite's record for `10.48550/arxiv.<id>`, which `lookupWork` already
   fetches (polite, cached), carries the author's abstract as `descriptionType: "Abstract"`, the
   same text as arXiv's `<summary>` (checked live on 1706.03762 and 2308.08708).
2. **Without Semantic Scholar the reported paper falls under the 60% gate**: ~39/70 ≈ 56% on
   Butlin (54% once the Searle reprint is refused); the coding paper stays ~76%. So the keys
   question decides whether the reported article clears the gate; the recommendation in q-ny49p3
   is now *get the keys*.
3. **Crossref title search is a stated exception to a written rule.** `src/bibliographic.ts` and
   plan 261001a say *"Identifiers only, never a title search"*, an engineering reading of Greg's
   *"If it's free, great. … But don't abuse them."* (2026-10-01). *Decided*: a bounded exception
   — at most 60 title queries a run, Crossref's polite pool (`mailto`), the shared spacing and
   cooldown, the answer kept per entry so an unchanged work is never asked again — written into
   both places so nobody "fixes" it back.

## 1. Step, trigger and rerun

**A pipeline step of its own, `citation-blurbs`**, after `bibliography` in `STEP_ORDER` (before
`crossrefs`), writing an artefact `citationBlurbs`, with a `stamp()`: `inputHash` over each row's
identity fingerprint in list order; `promptVersion` `citation-blurbs/1`; `model`
`CITATION_BLURBS_MODEL`. The identity fingerprint is `entryId`, title, authors, year, `url` +
`linkFrom`, and the registry verdict's kind and source, **not** the bibliography's `sourceHash`, so
a re-made list with the same works leaves blurbs current.

**Runnable alone**: `POST /api/jobs { slug, steps: ["citation-blurbs"] }`. With no current
bibliography it fails clearly rather than pulling `bibliography` in (as `illustrated` does).

**Trigger: one rule at publication.** In `publishRevisionIn` (`src/store/pg-revisions.ts`), beside
the labels successor: if the fenced job's steps include `bibliography` and not `citation-blurbs`,
and the draft has a bibliography, `enqueueSuccessorIn(tx, { steps: ["citation-blurbs"], … })`. That
covers import, a Metadata re-make, *Find them again*, the command bar, MCP and the CLI; the list is
published first, so nobody waits for it. `STEP_SHARING["citation-blurbs"] = { column:
"citationBlurbs", reads: ["bibliography"] }`. Successors are driven by the owner's open tab, as
labels and auto-modes are: accepted.

**Rerun**: `RERUN_STEPS` row (*Notes on cited works*). An unforced run reuses every entry whose
identity fingerprint, prompt version and model match and retries missing and transient ones; a
forced run re-asks everything (~a cent). Also `FORCE_ONLY_WHEN_NAMED`, `RESET_ROLE: "extra"`,
`STEP_BUDGET_MS`, the migration CHECKs.

*Passed over*: a second phase inside `bibliography` (as `attachCitationRegistry` is) — simplest,
but the list would publish a minute or two later, one stamp would govern both (re-running blurbs
re-buys the capable-model list), and a blurb failure could not be retried alone.

## 2. Storage

**A jsonb artefact column `article_revisions.citation_blurbs`, entries by entry id**, attached per
entry at read time only while its stored identity fingerprint equals the one recomputed from the
current row. Artefact columns get carry-forward (`REVISION_CARRY_POLICY: "carry"`), sharing,
receipts, export and public projection with no new write path.

```
CitationBlurbs = { version, model, generatedAt, entries: Record<entryId, BlurbEntry>, counts }
BlurbEntry (each carries identity, promptVersion, model, at: ISO) =
 | { state: "blurb", text, quote, evidence: Evidence }
 | { state: "declined", evidence: Evidence }
 | { state: "failed-check", why: "quote-not-in-evidence" | "repeated-index" | "too-long", evidence: Evidence }
 | { state: "no-evidence", why: "no-identifier-or-title" | "label-only" | "unpublished" | "not-found" | "no-abstract" | "not-identified" | "conflict" }
Evidence = { kind: "author-abstract" | "registry-reconstruction",
             source: "crossref" | "datacite" | "openalex", via: "id" | "title",
             workId: "doi:…" | "arxiv:…", url (built by code), host, readAt, evidenceHash }
```

**Transient outcomes are counted, never stored** (registry busy or cooling, over the lookup budget,
model timeout, cut off, unparseable, an index missing) so the next run retries them. The abstract
itself is not stored in the artefact, only its hash and the quote.

**Attach by identity only** (a narrowing of Sol's F7): prompt version and model decide reuse at
write time but do not hide an old entry at read time, or every prompt bump would erase paid-for,
checked blurbs until a re-make, against the no-backfill rule.

**The abstract cache**: `bibliographic_records` gains `abstract text` (`plainRegistryText`, ~4,000
cap) and `abstract_read_at timestamptz`; `freshSql` treats a found row with null
`abstract_read_at` as not fresh (the `cited_by_count_read_at` precedent). `parseCrossref` keeps
`msg.abstract` (JATS stripped, entities decoded, a leading "Abstract" dropped); `parseDatacite`
keeps the `descriptionType === "Abstract"` description. `registryWorkOf` picks fields explicitly,
so the abstract never reaches the Bibliography artefact (a test pins it).

*Passed over*: rows in a `citation_blurbs (article_id, entry_id)` table — a second write path
outside the step's transaction, its own public query, export and carry story, for safety the
per-entry fingerprint already buys.

## 3. Lookups

A pure module, `src/citation-evidence.ts` (no model, injected deps). Per row:

1. **DOI or arXiv id** (`rowWorkId`), registry verdict not `conflict`: `lookupWork(id)`. Found with
   an abstract: `author-abstract`, Crossref or DataCite.
2. **DOI and still no abstract**: OpenAlex by DOI through `inServiceTurn("openalex")` and
   `fetchBibliographicJson` with `mailto` → `registry-reconstruction`. **Refused** when OpenAlex's
   `type` is `book-chapter` or `book` (the Searle reprint). The first 429/401/403 cools the service
   and turns OpenAlex off for the run, as transient.
3. **Title-only row** (`linkFrom === "search"`, not an author–year label, `registryTitleIsDistinctive`,
   no *in preparation / under review / submitted / forthcoming / unpublished / personal
   communication*): one Crossref `query.bibliographic` (title + first author's surname, `rows=5`,
   `select=DOI,title,subtitle,type,abstract,author,issued`). **Strict rule**: titles equal or equal up to a subtitle;
   no object qualifier (`titlesDifferByObjectQualifier`); **the first author's surname must agree**;
   year ±1 when both give one; type not `peer-review`, `component`, `dataset`; a book-looking entry
   (ISBN, *Press*, *Publishers*, *Books*, *(Ed./Eds.)*) matches only a book-type record. At most 60 a
   run. → `author-abstract`, `via: "title"`.
4. Otherwise `no-evidence` with its reason.

Evidence capped at 2,500 characters for the prompt. Identifier lookups and title searches at
concurrency 2 each; `LOOKUP_BUDGET_MS = 120_000` (stop *starting* lookups after it; the rest are
transient). Model: batches of 20, two in flight, each with a 120 s abort; no batch started that
cannot finish before the job's deadline less 20 s. `STEP_BUDGET_MS["citation-blurbs"] = 360_000`.
Expected wall time about a minute; the eval re-measures it.

**The model call**: `openRouterJson("citation-blurbs", …)`, a new `NonTaskAiJob` on
`CITATION_BLURBS_MODEL` (`anthropic/claude-haiku-5.5`, the string `FRONT_MATTER_AUTHORS_MODEL`
uses), routed as `front-matter-authors` is; `AI_JOB_WIRE`, `NON_TASK_MODELS`, `AI_JOB_ROUTE`,
`CHAT_REASONING`, `JOB_DISPOSITION: "step-driven"`. Strict schema `{notes:[{i, blurb|null,
quote|null}]}`; `max_tokens` 16,000 a batch (Haiku thinks by default); `finish_reason: length`
makes the batch transient. The prompt is the spike's `BLURB_SYSTEM` with `plainWords("explain")`.
**Indices random per call** (6 base32 characters), each work's details and abstract fenced with
`untrusted()`. Code drops an unknown index, marks a repeated one `failed-check`, treats a missing
one as transient, requires the quote (≥4 normalised words) inside **that work's own evidence**,
caps at ~400 characters and 2 sentences, and stores a null as `declined`. No article text is sent.

## 4. What the reader sees

**On a row** (`WorkRow`), under the by-line: the blurb, class `cite-blurb`, in the model's face
(`--font-ai`, voices.css and `VOICES_BY_MODE`), then a quiet basis label, *From the abstract ·
arxiv.org* / *· Crossref* / *· DataCite*, or *From OpenAlex's copy of the abstract*, which opens a
card on hover, focus or tap (`useTapReveal`, as `WebInfluence`):

> A short note an AI wrote from this work's abstract, as [source] holds it, read on [day]. It is a
> quick look-up in a public catalogue of papers, not a web search and not a reading of the paper
> itself, so it can be wrong. Code checked that it rests on these words of the abstract: "…"

then *Ask in chat to look closer* for the owner; the source link is code-built. A `via: "title"`
match adds *Found by its title and first author, so it is very likely, but not certainly, this
work.* Declined, no evidence, failed check, transient: **nothing on the row**.

**The prose hover card** draws the same `CiteBlurb` — the path the report came by. Marginalia: no.

**The band's (i)** keeps `showListReadNote`'s condition and picks the sentence: none of the shown
rows has a blurb → `CITE_LIST_NOT_READ`; some → `CITE_LIST_READ_ABSTRACTS`, saying the notes are
an AI's from the abstract alone and a row with none had no abstract we could be sure was this
work's.

**A visitor sees blurbs**, through a guard in `publicCitedWork` (`src/public/dto.ts`): only `state:
"blurb"`, identity-matched, every field rebuilt (lengths capped, `workId` re-parsed, the URL rebuilt
by code), keys pinned in `tests/public-dto.test.ts`.

**Live**: `useStepFinished(slug, "citation-blurbs", refresh)` on the Bibliography read.

## 5. Privacy

`privacy.md` and `PrivacyPage.tsx` newly say: for a cited work without a DOI, **Crossref is sent its
title and first author's surname** (never the article's own title or text); **OpenAlex is sent
cited works' DOIs**; the model is sent cited works' titles, authors, years and public abstracts. No
arXiv. **Private uploads keep the default**: what is sent is about published works it cites,
cited DOIs have gone to Crossref and DataCite since 2026-10-01, and the one real leak (a
manuscript citing its authors' own unpublished work) is closed by the code-enforced *unpublished /
in preparation / under review / submitted / forthcoming* skip.

## 6. Chat

`article_citations` returns the blurb inside the fence (`abstract note (AI, from the abstract at
<host>): …`, ~300 characters) with our sentence outside it saying what a note is and is not.

## 7. Tests, red first

1. `parseCrossref` keeps a cleaned JATS abstract; `parseDatacite` keeps `Abstract`, not `Other`.
2. The Bibliography artefact never carries `abstract`.
3. PG: a found record with null `abstract_read_at` is not fresh; a re-ask stores it.
4. Title rule: a same-title review by another author refused; exact title + author kept; year-only
   refused; a correction tail refused; a label row not searched; an "in preparation" entry not
   searched; a book-looking entry against a journal record refused.
5. OpenAlex `book-chapter` refused (Searle fixture); a reconstruction labelled as one.
6. Batch reader: unknown index dropped; repeated → `failed-check`; missing → transient; a quote from
   another work's evidence → `failed-check`; an injected abstract cannot produce a stored blurb for
   another index; null → `declined`; `length` → the batch transient.
7. Step: the stamp moves on identity, not on `why` or relevance; unchanged entries reused with zero
   calls; transient not stored and retried; forced re-asks all; refuses with no Bibliography.
8. Attach: a re-made list that changes a row's url or title hides that blurb; a vanished entry
   shows nothing; owner and public both.
9. PG successor: a publication whose job ran `bibliography` queues exactly one `citation-blurbs`;
   a blurbs job's own publication queues none; one without Bibliography queues none.
10. Panel: the blurb, its label and card; the other states draw nothing; the (i) switch; visitor;
    the hover card.
11. Chat row carries the labelled blurb in the fence and the sentence outside.

**Eval after the build**: a `production` phase in `evals/citation-blurbs-spike.ts` calling the
shipped `collectEvidence` and `writeBlurbs`, under the new job: coverage per article (Semantic
Scholar's absence called out against the gate), drops by reason, ledger cost, wall time, an Opus
judge on every sentence, a hand identity check of every `via: "title"` match. Appended to 261017c.

## 8. Docs

`bibliography.md` (§ A row; § What we have read; § Nothing about the work beyond… — the newer,
labelled exception with Greg's 2026-10-17 quote; § Chat can read it; § Making it again; § Who sees
it; § Deferred; § The code); `sources.md` (§ What a press buys: notes follow the list);
`privacy.md` and `PrivacyPage.tsx`; `setup-dev.md` model table; `chat-tools.md`; `database.md`
(the two columns); `src/bibliographic.ts` header and plan 261001a (the title-search exception);
`src/web/help/pages/modes/sources.md`.

## Sub-stages, each leaving the tree green

- **3a. Evidence, no model, nothing on screen**: `src/bibliographic.ts`,
  `src/store/pg-bibliographic.ts`, `src/db/schema.ts` + a migration (two columns, a CHECK),
  `src/citation-evidence.ts`; tests 1–5; the rule note.
- **3b. The step and the trigger**: `src/models.ts`, `src/ai-call.ts`, `src/cost-categories.ts`,
  `src/citation-blurbs.ts`, `src/types.ts`, `src/step-order.ts`, `src/sharing-steps.ts`,
  `src/jobs.ts`, `src/pipeline.ts`, `src/reset-role.ts`, `src/store/artifacts.ts`,
  `src/store/pg-revisions.ts`, `src/store/export.ts`, `src/rerun-steps.ts`, the migration; privacy
  doc and page; tests 6, 7, 9.
- **3c. Reading it**: `src/store/pg.ts`, `src/bibliography.ts` (`attachBlurbs`),
  `src/public/dto.ts`, `BibliographyPanel.tsx`, `ProseHoverCard.tsx`, `useBibliography.ts`, CSS and
  voices, `src/chat-tools.ts`, the help page and docs, the eval re-run; tests 8, 10, 11.

## The design review (round 2 of the plan review), and what it changed

GPT Sol, read-only, [261017h-stage-3-design-review-sol.md](261017h-stage-3-design-review-sol.md):
*proceed with changes*, no P0, six P1s, four P2s. This was the plan's second round, so discovery is
closed; the build is reviewed separately. **Every item below overrides the sections above where
they disagree.**

- **G1 (P1), taken.** The artefact's root takes the established stamp shape, `sourceHash`,
  `version`, `generator` (with the model in `generator`), not `version` + `model`, which the shared
  stamp reader never reads. A run-twice test proves the second unforced run skips.
- **G2 (P1), taken.** A whole-artefact stamp would skip a run that left transient entries behind,
  for ever. So when any entry was transient the artefact is written with a **partial** stamp
  (`sourceHash` = the identity hash + `:partial`), which the next unforced run sees as not done;
  only a publication or a press starts a run, so nothing spins. A failed check is retried once in
  the same run, then stored as terminal *for this validation version* (G8). Tested with two real
  jobs, the first partial.
- **G3 (P1), taken.** `enqueueSuccessorIn` can answer `boundToOlderBase`; then a scoped replacement
  is queued for the new Bibliography, and the outcome is logged. Tested.
- **G4 (P1), taken.** The quote check alone is not a faithfulness boundary (it rejected 0 of 75 in
  the spike and passed the Searle inversion). So: **one sentence by default**, a second only when
  separately supported; **one quote per sentence**, 6–30 words, each found in that work's own
  evidence; and a **separate check call per work**, Haiku, no other work visible, given only that
  work's evidence and the sentence(s), answering *supported / not supported*; anything but
  *supported* stores no blurb (`failed-check`, `why: "not-supported"`). Doubling the calls stays
  near a cent; the eval re-measures it, with adversarial abstracts and the Searle case added.
- **G5 (P1), taken.** Visitors do not go through `loadBibliography`: `src/store/public-reader.ts`
  and `src/public-types.ts` join 3c, the public query selects `citation_blurbs`, and the attach
  happens inside the DTO boundary, tested through the real public query.
- **G6 (P1), taken — the safe default rather than a question.** A word list cannot prove a work
  is published, so **title search runs only for an article imported from a public web address**;
  an uploaded file (PDF or HTML, which may be a confidential manuscript) gets identifier lookups
  only (DOI and arXiv id, which have gone to Crossref and DataCite since 2026-10-01). privacy.md
  says exactly that. The *unpublished* word skip stays as a second guard, not the claim.
- **G7 (P2), taken as a stated limit.** Blurbs are *queued* whenever a Bibliography publishes and
  *run* when the owner next has the app open, as labels and the import's own Bibliography are.
  Queueing and running are tested separately.
- **G8 (P2), taken.** A `validationVersion` joins the attach fingerprint: a change to wording or
  model keeps old blurbs; a change to the safety checks detaches them.
- **G9 (P2), taken.** Registry negatives (`not-found`, `no-abstract`, `not-identified`, `conflict`)
  carry `checkedAt` and are re-asked after 7 days (the registry cache's own miss lifetime);
  structural negatives (`label-only`, `unpublished`, no usable identity) stay terminal. A 401 is a
  configuration failure, logged as one; a 403/429 cools the service for the run.
- **G10 (P2), taken.** Crossref's **first** author only; book types accepted are `book`,
  `monograph`, `edited-book`, `reference-book`; `book-chapter` is refused for a book-looking
  entry; tests for second-author-only agreement and each type.
- **Not taken**: Sol's closing note that identifiers alone still cover 54–56% of the reported
  paper. That figure already includes the Crossref title search (22 of the spike's blurbs came
  from it, none from a DOI), so identifiers-only would be well under it.
