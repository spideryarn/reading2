# Front and back matter, marked at import and folded by default

Up: [plans.md](../project/plans.md)

Report `spya-ftsqsn` (suggestion, filed 2026-10-17T20:12Z, Sentry SPIDERYARN-READING2-JE), with
addenda `spya-k7gm2b`, `spya-k0w2q7` and `spya-vskdap`. Overseer queue item **qi-bz4tj9df**. An
administrator's report (`feedback-reporter.ts` exit 0), so trusted input. Filed from
`/read/arxiv-2308-08708-spya-xax6v4` (arXiv 2308.08708, *Consciousness in Artificial
Intelligence*). It answers two proposals that were waiting on Greg: **qi-fddb7wb8** (mark front
matter at import, a role on the block) and **qi-ad4wgkaq** (notice the abstract and
acknowledgements, fold them by default).

> In this article, there's a whole bunch of stuff at the top that's not very
> interesting/substantive (e.g a table about the authors & affiliations, acknowledgements,
> abstract, etc etc).
>
> Probably we do still want to include it, but somehow we want to:
> - Mark it up as being less interesting
> - And default-collapse it
> - Perhaps ignore/de-emphasise these sections (e.g. in Structure, Summary, etc)
>
> Perhaps the same applies to stuff at the end of the article (e.g. acknowledgements,
> bibliography).
>
> Or *perhaps* we just skip them altogether, and have a note to say they've been excluded, and
> click to see them in the original? That seems a bit toooo extreme, since sometimes there's
> useful stuff in there, and it's making things too annoying for the user to double-check.
>
> Ideally we do this in a clean, general, robust, reusable way. Ask me questions if there are
> alternatives/tradeoffs to consider.
>
> — Greg, 2026-10-17

> I'm not so worried about fixing old articles, more about improving this going forwards. […] it
> may be worth trying to create a little eval of articles that have stuff in various
> places/formats that we might want to default-collapse/de-emphasise/ignore.
>
> Make sure to take screenshots to see what this will look like for the user. This requires
> delicate UI (including an information-button/tooltip) so that they don't get in the way, but
> that the user can notice/discover them if needed.
>
> — Greg, 2026-10-17 (`spya-k7gm2b`)

> Also, I thought we had created first-class metadata for authors? If so, then ideally we'd be
> displaying that nicely in the UI (e.g. along with the publication year, perhaps
> default-collapsed).
>
> — Greg, 2026-10-17 (`spya-k0w2q7`)

> I'm leaning towards default-collapsed for the Abstract too, but visible in Structure so that the
> reader can see that there is an Abstract and easily get to it if they want to.
>
> — Greg, 2026-10-17 (`spya-vskdap`)

## Prior work, and what is left

Checked 2026-10-18: `docs/plans/`, `docs/user-feedback/`, `git log origin/dev`, `gjd-remote ls`,
the Overseer queue. Nothing else in flight. Greg is right that he has asked before; four rounds
have shipped, each a part:

- **Prompts skip the paperwork** ([261003c](261003c-summary-and-structure-skip-the-front-matter.md),
  [261003d](261003d-paperwork-in-every-whole-piece-mode.md)): `paperwork(kind)` in
  `src/paperwork.ts` tells every whole-piece prompt to leave out authors, affiliations,
  acknowledgements, funding and disclosures; Structure labels an abstract node *"The authors'
  summary of the paper."* rather than summarising it. This is the "de-emphasise in Structure,
  Summary" half, and it is done.
- **The byline under the title folds by default**
  ([261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md)): a display rule,
  `src/web/front-matter.ts`, reads the words of the leading blocks and folds one run of
  authors/affiliations/contact lines; the masthead's *Show authors and details* opens it. It
  deliberately stops at the first block it is unsure of, and does nothing for an abstract,
  keywords, a table of contents or anything at the end.
- **Authors and affiliations are first-class metadata** (`meta.authors`, `{name,
  affiliations[]}`; [260929d](260929d-authors-and-affiliations-at-import-shown-and-linked.md),
  [261010d](261010d-a-general-authors-pass-for-every-web-page.md)): the masthead draws each name
  with a tooltip of affiliations. So Greg's addendum `spya-k0w2q7` is right that it exists.

**What the reported article shows** (production, read-only, 2026-10-18; 667 blocks):

| blocks | what | today |
|---|---|---|
| 0 | the title as a paragraph | shown |
| 1 | the authors table, names only | shown (the rule stops: no `meta.authors`, no institution word) |
| 2–3 | a paragraph "Abstract", then the abstract | shown |
| 4–23 | a paragraph "Authors", then one "Name, affiliation" paragraph per author | shown |
| 24–38 | a paragraph "Details": authorship statement, acknowledgements, funding (with a 10-item list), conflicts | shown |
| 39–53 | "Executive Summary" and its prose | shown, correctly |
| 54–101 | a "Contents" `h6` and a 47-line table of contents | shown |
| 102–412 | the report | shown |
| 413–414 | Glossary | shown, correctly |
| 415–666 | "Bibliography" `h2` and 251 references | shown |

And its `meta` is poor: `title` "1Indicator Properties", `byline` and `authors` null,
`published_year` null. The title is fixed on `dev` since 261017a; the authors are this plan's
Stage 4 below.

So the gap is: **only one shape of front matter is recognised, by a rule that reads words, and
it is not stored anywhere**. Every label in this article — *Abstract*, *Authors*, *Details* — is
a paragraph, not a heading, so a rule over headings would miss almost all of it too.

## What to build

### The idea in one picture

```
 masthead: title · authors (hover: affiliations) · 2023
 ┌─────────────────────────────────────────────────────────────┐
 │ ▸ Title and authors · 2 lines                           ⓘ   │  ← a stub: one quiet line
 │ ▸ Abstract · 200 words                                  ⓘ   │
 │ ▸ Authors, acknowledgements, funding · 35 lines         ⓘ   │
 │ Executive Summary                                           │  ← the article starts here
 │ Recent progress in AI has …                                 │
 │ ▸ Contents · 48 lines                                   ⓘ   │
 │ 1 Introduction …                                            │
 │ …                                                           │
 │ Glossary …                                                  │
 │ ▸ Bibliography · 251 references                         ⓘ   │
 └─────────────────────────────────────────────────────────────┘
 ⓘ  "Folded by Spideryarn: the authors' own summary of the paper.
     Open it to read it here. Nothing is removed."
```

Pressing a stub opens that stretch in place, and the stub's line becomes a quiet *Fold away*
control above it. Structure keeps its rows for these stretches, drawn faint, and pressing one opens
the stretch and goes there (as a jump into today's folded byline does).

### Stage 1. The eval, and the classifier it measures

The question the eval answers: **can one cheap model call find these stretches, on articles of
every shape, without ever folding the article's own prose?** Greg asked for it
(`spya-k7gm2b`), and it decides the design: if a rule over the stored blocks did as well, we would
use the rule.

**Corpus.** About 25 articles, imported locally from public pages: the reported article; arXiv
HTML and PDF; PubMed Central, PLOS, eLife, Frontiers; bioRxiv; Wikipedia; essays and blogs with
and without footnotes or thanks; news; a long report; at least three with nothing to fold. The
blocks go to a scratch directory; the slugs and URLs go in the write-up.

**Gold labels.** Each article's stretches, labelled by an Opus subagent from the full block text
against a written guide (the kinds below and what is not one of them), then every label checked
by me. The critical label is the negative one: which leading and trailing blocks are the article's
own prose.

**The classifier** (`src/matter.ts`), one call per article on Haiku 5.5, the authors pass's model
and route shape (`src/front-matter-authors.ts`). What the model sees, as inert JSON lines:

- the **opening**: blocks from the start, each `{id, kind, words, text}` with text cut to 200
  characters, up to 120 blocks or 6,000 characters;
- **every heading** of the article, `{id, level, text}`;
- the **close**: the last 60 blocks, the same shape.

What it answers: a list of stretches, each `{ from, to, kinds }` where `from` and `to` are block
ids it was shown, **or** `{ section, kinds }` naming a heading, meaning that heading's whole
section (to the next heading at its level or coarser — the fold store's `sectionEnds`, the only
way a 251-reference bibliography is named without showing all of it). `kinds` is a closed list:

| kind | what |
|---|---|
| `title` | the title repeated as text |
| `authors` | names, affiliations, emails, correspondence, equal-contribution notes, ORCID |
| `abstract` | the authors' abstract, with its label |
| `keywords` | keywords, subject codes |
| `contents` | the piece's own table of contents |
| `dates` | received/accepted/published, DOI, licence, copyright, citation line |
| `acknowledgements` | thanks |
| `funding` | funding and grants |
| `declarations` | author contributions, competing interests, data and code availability, ethics |
| `references` | the reference list or bibliography |

Not a kind, on purpose: appendices, glossaries, notes and supplementary material are real content
and stay as they are; a standfirst, a "Significance" or "Key points" box and an executive summary
are the article's own summary and stay showing. The prompt says so, and the eval has them as
negatives.

**Held by code**, and anything short of all of it drops that stretch, not the whole answer:

- every id is one it was shown (or a heading); `from` comes at or before `to` **by block index**
  (block-ids.md § The cost we accepted);
- stretches do not overlap, and are returned in document order;
- a stretch made of shown blocks lies wholly inside the opening or wholly inside the close;
- a `section` stretch may only be `references`, `acknowledgements`, `funding`, `declarations` or
  `contents`;
- caps: an `abstract` stretch at most 800 words; a stretch with no `references` or `contents`
  kind at most 1,500 words; all stretches together leave at least half the article's
  non-reference words showing.

The caps are starting values for the eval to move, and the plan will say what moved.

**Measured, against the gold labels, three draws each:**

- **blocks of the article's own prose folded: must be 0.** Any one changes the prompt or the
  checks, not the count;
- matter blocks found, by kind;
- the 261007d rule on the same corpus, as the baseline;
- cost per article and seconds.

If Haiku cannot reach zero prose folded, Sonnet is measured next; if neither, the plan stops and
says so. Written up in
[261018b](../investigations/261018b-front-and-back-matter-eval.md), with the script that
produced each number.

### Stage 2. Stored as its own step, beside the blocks

A new step, **`matter`**, after `blocks` in `STEP_ORDER` and in `DEFAULT_INGEST_STEPS`, so every
new import gets it. It reads the stored blocks, makes the one call, and writes the checked
stretches to a new `jsonb` column, `article_revisions.matter`:

```
{ version, generator, sourceHash, stretches: [{ from: BlockId, to: BlockId, kinds: Kind[] }] }
```

`sourceHash` is `hashBlocks` over the blocks it read, so the step is skipped when they have not
changed and runs again when they have, like `labels`. A `section` answer is stored resolved, as
`from`/`to`. A failed or refused call stores nothing and the import goes on; the reading view then
uses today's rule. One cost job (`matter`, step-driven), on the authors pass's route shape.

**Why a column of its own, and not `Block.role`** (the shape qi-fddb7wb8 proposed). `role` is
already on every block and in a `CHECK` constraint, and it is tempting. But `hashBlocks` reads
`role`, so writing it after stage 3 would mark every later step stale on every import; and
writing it inside stage 3 would put a model call in the step that mints the ids, which must stay
deterministic and free to re-run. A stretch is also the natural unit: the reader folds a stretch,
not a block. The column costs one additive migration and the wiring every artefact column has.
*The simpler option passed over:* widening `front-matter.ts`'s word rule to the abstract, the
contents and the back. It is free and needs no backfill, but the reported article shows why it
cannot be general: its labels are bare paragraphs, and every new shape would be another rule.

**Models are not changed.** The prompts already leave the paperwork out (261003c, 261003d), and
Structure keeps the abstract as a labelled row, which is what Greg asks for. Taking the stretches
out of what automatic modes read is qi-2byhh6nc, still Greg's call; this column makes it a filter
rather than a project, and the queue entry will say so.

### Stage 3. The reading view folds each stretch to a stub

`src/web/fold.ts` keeps one kind of front-matter hiding and generalises it from one run to a list
of stretches. Each stretch:

- is **shut on arrival**, every load, for every article (not persisted; the same reset rules as
  today's run: a different article, or different stretches);
- when shut, its **first row stays on screen as a stub** and the rest are hidden. The stub is one
  quiet line in the prose column: a chevron, a label made from its kinds (*Abstract*;
  *Authors and affiliations*; *Acknowledgements, funding*; *Bibliography* when the heading says
  so), a count (*200 words*, *35 lines*, *251 references*) and an ⓘ with a `ControlTip`: what was
  folded, that Spideryarn folded it and nothing is removed, and how to open it. Faint ink, the
  interface face (it is the app's words, fonts.md), no box;
- opens on a press of the stub, and on `revealBlock` of any block in it (a search hit, a Structure
  row, a comment, `?at=`), all of it at once, as today;
- when open, the stub's place shows the block itself, and a small *Fold away* chevron sits in the
  gutter of its first row, like a heading's fold chevron.

Because the stub row is visible, a section that starts inside a shut stretch has a row to land on:
`visibleFrom` answers the stub's id rather than the first block after the run, which is simpler
than today's rule.

**Where the stretches come from**, in one function: the stored `matter` when there is one;
otherwise today's `frontMatter()` rule, as one `authors` stretch. So every article that folds today
still folds, and the masthead's *Show authors and details* goes away: its stretch has a stub now.

**Structure.** A row whose range lies wholly inside stretches is drawn in faint ink with the same
ⓘ, keeps its place and its label, and opens the stretch when pressed. Its number is kept; it is
still part of the piece.

**Visitors** (the public page) get today's rule only: adding `matter` to the public DTO touches
`src/public/dto.ts`, which is a listed defence (security-map.md). Written up for Greg, not done.

### Stage 4. The masthead's authors, on this article

Greg's addendum asks why the first-class authors are not shown. On this article `meta.authors` is
null, so the masthead has only the title. Re-import it locally on `dev` (which already has
261017a's title fix) and see what the authors reader and the Haiku affiliations pass make of its
author table. If they refuse it, find out why and fix it if the fix is small and general; if not,
say so in the note. **Default-collapsed:** where `meta.authors` is long (more than three), the
masthead shows the first three and *+ 15 more*, opening in place — only if it does not already;
checked in the browser first.

### Stage 5. Screenshots, docs, review, the record

- **Browser** (Sonnet subagent, Playwright on the box, browser-control.md): the reported article
  re-imported locally, before and after, 1440 and 390 wide; a stub hovered (the ⓘ); a stub
  opened; Structure with the faint rows; a jump from Structure into the abstract; a web essay with
  nothing to fold; an old article on the fallback rule.
- **Docs:** a new `docs/project/front-and-back-matter.md` (what is folded, why, the step, the
  fallback, the eval), owned by reading-view-overview.md, with one line in architecture.md's
  pipeline list and in content-extraction.md; the step in setup-dev.md's model table; `/help` if
  it describes folding. AGENTS.md is a rule doc and gets nothing unless Greg wants a line.
- GPT Sol's code review, write-capable; gates; push to `dev`.
- A question file for Greg (feedback-reports.md § Asking Greg a question): look at the article
  after a production re-import that is his to press; and whether to backfill existing articles
  (a production write, ~$0.005 each).
- The note, `feedback-endings.ts`, the queue: qi-bz4tj9df done; qi-fddb7wb8 and qi-ad4wgkaq done
  with a line saying this covers them; qi-2byhh6nc edited to say the stretches now exist.

## Decided here, for Greg to overturn

- **The abstract is folded by default**, a stub on the page and a row in Structure: his lean in
  `spya-vskdap`. One kind to take out of the fold list if he changes his mind after seeing it.
- **Nothing is skipped or removed**: Greg called that "toooo extreme".
- **Appendices, glossaries, notes and executive summaries are not folded.**
- **The fold is not remembered** between visits, as today.

## Stages

1. Corpus, gold labels, `src/matter.ts` (prompt and checks, red-first tests for every check), the
   eval and its write-up. GPT Sol on the plan before any of it is built into the pipeline.
2. The step, the column, the migration (applied locally), the stamp; tests.
3. The fold store and the stub, Structure's faint rows, removing the masthead control; tests.
4. The authors on the reported article.
5. Browser pass and screenshots, docs, GPT Sol code review, push, question, note, queue.

## The plan review

GPT Sol, read-only, 2026-10-18 ([the review](261018a-plan-review-sol.md)), verdict *revise before
build*. No P0. Every finding was checked against the code; all are accepted, and they bind the
stages above where they differ from the text there.

| | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P1 | `hashBlocks` hashes `id, text, role, treatment`; the classifier also reads `kind`, `level`, `words`, so a re-extraction that turns a paragraph into a heading would leave `matter` claiming to be current | Accepted: `matterInputHash` over ordered `[id, text, kind, level, words]`, versioned, for both `sourceHash` and the stamp. `hashBlocks` is not widened |
| F2 | P1 | A draft copies the published revision's columns; a failed reclassification would leave the old stretches to be trusted | Accepted: the column is `carry` in `REVISION_CARRY_POLICY`; the article read returns `matter` only when its shape is valid, every id resolves and `sourceHash` equals the current blocks' hash, else the fallback; a failure is stored as `{ status: "unavailable", sourceHash, version }` |
| F3 | P1 | The checks let the model fold prose: short articles where the windows overlap, text past 200 characters unseen, a `section` under any heading, and `references`/`contents` lifting the caps on the model's own say-so | Accepted. A discriminated answer (`type: "range" \| "section"`). A `section` only under a heading whose full text matches a closed label set for its kind, contents in the opening and back matter in the trailing part. Caps independent of `kinds`. The opening and close windows never overlap and each is at most 40% of the article. Kind-compatible evidence checked against the full stored text where a cheap test exists (labels, DOI and date prefixes, an email, a name from `meta`). Adversarial cases in the eval |
| F4 | P1 | Heading list and answer not bounded | Accepted: caps on heading count and characters, output tokens and stretches; the authors pass's untrusted-data instruction; malformed or extra output refused. Stub text comes only from the closed kinds and fixed copy; counts from blocks |
| F5 | P1 | With a stub, "row visible" and "block's words visible" are different facts; `isFolded` means both, for marginalia, on-screen sampling, the spine, scroll and block chat | Accepted: two predicates, `isRowHidden` and `isContentHidden`; every `isFolded` consumer audited and chosen deliberately; `isFoldedAway` stays a real fold's |
| F6 | P1 | `visibleFrom` answering the stub's id would reopen the stretch on a reload, because `scrollToBlock` reveals what it is sent to | Accepted: the reading position keeps mapping to the first block after the stretch, as today; explicit jumps still reveal |
| F7 | P1 | A stored `title` stretch collides with the masthead echo, which is never revealed | Accepted: echo ids are subtracted from stretches before choosing the stub; an echo-only stretch is dropped |
| F8 | P2 | `sectionEnds` is private to a React module | Accepted: a pure `sectionRanges` shared by `matter.ts` and `fold.ts` |
| F9 | P2 | Structure decoration: index containment in one stretch, and the measuring copies must match | Accepted |
| F10 | P2 | The argument against `Block.role` was overstated | Accepted; the § Stage 2 reasoning is replaced by: a stretch is a range-level, multi-kind judgement while `role` is one per block; model policy is `treatment`'s, not `role`'s; a separate artefact avoids a stamp over a hash that contains its own output; failure and staleness fall back without rewriting block data |

**Its simpler version** — today's byline rule plus exact authored labels (*Abstract*, *Keywords*,
*Contents*, *Acknowledgements*, *Funding*, *References*, *Bibliography*) with positional
evidence, and no model call — **joins the eval as a second baseline.** If it matches the
classifier with no prose folded, it is built instead, and the model call is not. Its point on the
critical path is taken too: whether `matter` is in `DEFAULT_INGEST_STEPS` or a successor job is
decided in Stage 2 from how long it takes against what the reader waits for already.

## What building changed

- **The design is the union, not one method.** The eval (261018b) measured the model call and the
  label rule each folding no prose but finding different things (model: authors, titles, dates,
  abstracts; label rule: reference lists and contents). The step runs the free label rule and the
  model call, merges them and holds the result through the same checks. A failed call stores the
  label rule's stretches alone (`generator: "labels"`, a closed `modelUnavailable` reason).
- **Haiku needs `effort: "low"`** and a higher token ceiling; at the provider default it spent the
  whole budget thinking and never answered.
- **Back matter starts at 25% of the article, not 40%**: real acknowledgements and references sat at
  32–34%. A `section` may carry any kind but `title`.
- **A contents list ends at its last entry**, an entry being a short line that names one of the
  article's own headings or carries a section or page number. Found by the first held-out set,
  where the label rule ran a Contents list into an image and its caption.
- **Footnotes are never folded**, though Wikipedia's citation lists are stored as footnotes and
  are the biggest remaining miss: real notes sit in the same list, and the reading view already
  draws footnotes as their own region.
- **`matter` is a successor job, not in `DEFAULT_INGEST_STEPS`**: a call of ~6 s (17 s worst)
  would lengthen the wait before a pasted URL first opens by a third. Until it lands the reading
  view uses the 261007d rule.
- **The stamp has no model** (`promptVersion: "matter/2"` names it), because the generator varies
  between `labels+<model>` and `labels`.
- **The union keeps the finer partition** so the abstract has its own stub; the first union merged
  touching stretches and gave the reported article one stub for blocks 0–38.
- **Stage 4 was an authors fix in the registry**, not the masthead: the masthead already shows
  three names and *+ N more*, each with a hover card of affiliations, and the year on the same
  line. The reported article declared no authors, so nothing reached it.
- **One stub per stretch, and the masthead's "Show authors and details" is gone**: its stretch has
  a stub of its own. The browser pass found stubs back to back spaced as paragraphs (now a compact
  list), two stubs both called *Authors and affiliations* (one now *Title and authors*), and a
  Structure row that opened only the first of the stretches it covered (now every one).
- **An older article may fold nothing**: 1706.03762 was never folded by the 261007d rule (its first
  block is a permission line) and has no stored `matter` until re-imported. Not a regression.

## The code review

GPT Sol, write-capable, 2026-10-18 ([prompt](261018a-code-review-prompt.md),
[the review](261018a-code-review-sol.md)). Its verdict line, *do not push*, was on the code before
its fixes, and its sandbox could not reach the local database. Every fix was read, the gates run,
and the eval re-run on all three sets from cached answers.

| | Sev | Finding | Outcome |
|---|---|---|---|
| C1 | P1 | A stored value of an older rule version, on the same blocks, was still shown and counted as settled | Kept: the version is checked at the read and at the successor; `matter/2` |
| C2 | P1 | Synthetic paths that fold prose: an abstract or keywords label explaining the unheaded paragraphs after it; a DOI in prose as dates; broad *support*/*contribution* wording as office matter; any first heading as the title; a lone paragraph inside a reference list | Kept, except the reference-list part, **reverted**: splitting at every single non-reference entry folded 184 words of figure notes on NBER (held-out 1) and cut the reported paper's bibliography into seven stubs. A lone paragraph among references still folds with them (accepted; test in `tests/matter.test.ts`); NBER is now a regression test, seen red. The rest cost recall: development 82% → 79%, held-out 2 71% → 67%, no prose anywhere |
| C3 | P1 | Behind trailing references, `visibleNear` could name a block hidden by a real fold | Kept, with its test |
| C4 | P2 | Two different works with identical titles could share registry authors | Accepted as Stage 4's trade-off: page-origin id and exact title both required |
| C5 | P2 | `stretchEvidence` is too complex to audit (cognitive complexity 73) | Not now: splitting per-kind validators is a refactor for its own change, re-run on the eval |
| C6 | P3 | Lint advisories in `admitMatter` | Kept |

## Ledger

- 2026-10-18: prior-work check; the reported article read from production (read-only); code
  mapped; plan written.
- 2026-10-18: corpus of 33 local articles; gold labels by two Opus subagents, spot-checked.
- 2026-10-18: Stage 1 (f85e5cdfd, f87620ee9, 1bd7e790f): classifier, label rule, union, eval; two
  held-out sets, the first finding one false fold, fixed by a general rule.
- 2026-10-18: Stage 4 (2dbca0050): registry names and year for a page that declares no authors.
- 2026-10-18: Stage 2 (80e7358e8): the step and column. Not migrated locally yet: the shared
  ledger holds two unlanded migrations of session fbm53cdk; asked it to land them.
- 2026-10-18: merged origin/dev (4d0b93f72), the migration regenerated after theirs and applied
  locally. Union fix (7471493c3); second held-out set (03251c96b); eval write-up and area doc
  (91002ae13).
- 2026-10-18: Stage 3 (49c065cae, 634920506): the stubs, Structure's faint rows, a browser pass
  and screenshots (`261018a-shot-*.png`). The reported article re-imported locally: six stubs, 19
  authors, 2023.
- 2026-10-18: the queue tests drive the `matter` successor explicitly (cf14ec4fa). Full suite: the
  only red files left came from origin/dev (citation-blurbs' `messages`, `command-pick-catalogue`,
  `cacheable-covers-artefact-routes`).
- 2026-10-18: merged origin/dev (07cb5235a); GPT Sol code review and its fixes, one reverted (§ The
  code review); eval tables refreshed.
