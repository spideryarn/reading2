# PDF transcription glitches: paragraphs cut by a figure or a footer, and bylines that fail whole

**Status: stages 1 and 2 shipped to `dev` (plan and code reviewed by GPT Sol). Stage 3 and the rest of § Deferred are Greg's.** From feedback
SPIDERYARN-READING2-69 ([the note](../user-feedback/260930_0850-pdf-transcription-glitches.md)).

> I think you now have access to the production database. So have a look at some of the articles
> and the transcribed versions of them, and look for little glitches. Look for ways in which author
> names got slightly mangled, or footnotes are not represented properly, or paragraphs that span
> pages are not kind of joined together, or any other sort of minor boo-boos in the transcription.
> And if you need to sort of then check against the original PDF or whatever, then you can do that.
> … And then either add those papers to our evals or something to try and make minimal tweaks to
> whatever post-processing we do during the import process to fix those going forwards. Because my
> understanding is that we run a LUNA model, and maybe we need to upgrade it to Sonnet, but we run
> some kind of model that takes the output from the import process, the early stages, and does some
> kind of corrective stuff like this. And I'm just saying let's keep on improving it.
>
> — Greg, 2026-09-30

## What actually runs, since the report assumes something slightly different

There is **no model pass that corrects the transcription**. What runs on a PDF
([content-extraction.md § Two extractors](../project/content-extraction.md#two-extractors-one-artefact)):

```
  PDF ──► Luna (openai/gpt-5.6-luna) reads the pages ──► records {page, type, text, continues}
            │   (the "LUNA model" — it transcribes; it does not correct anything afterwards)
            ▼
          scored against the PDF's own text layer (free, deterministic)
            ▼
          Sonnet 5: front-matter pass — which records are the title, byline, journal furniture
          Sonnet 5: authors pass — names and affiliations, each checked against the page's own characters
            ▼
          deterministic code: mendSeamHyphens (a word cut by a chunk seam), renderHtml (records → HTML,
          joining a record marked `continues` onto the one before it)
```

So the corrective steps are small, and mostly code. Every glitch this plan fixes is in that code, not
in what either model wrote.

## The survey

**Read-only, against production**, 2026-09-30: every article whose latest published revision came
from a PDF — **21 articles** (112 revisions on the current prompt, `pdf-v4`, which collapse to 9
articles; the rest are on v2/v3). Each query ran inside `begin read only … rollback`, never a `SET`
([database.md § Never `SET` anything on the transaction pooler](../project/database.md#connecting-to-the-remote)).
The stored source PDF of every one was downloaded from the `sources` bucket and its sha256 checked
against the revision's; all 21 matched. The per-chunk model output is in the `checkpoints` table
(`namespace = 'pdf-chunk'`), which is what made it possible to tell whether a glitch was the model's
or ours.

Then **7 of them re-read with the current pipeline** (dev's OpenRouter key, `nullCheckpointStore`, no
production write), because most revisions predate a fix that has since landed — the authors pass
(260929d) went out on 2026-09-29, after 7 of the 9 v4 revisions were made. Cost: about $0.40.

### What was found

| Glitch | Where | Whose | In the current pipeline? |
|---|---|---|---|
| **A paragraph cut in two by a figure placed mid-paragraph.** The reader sees half a sentence, the figure, then a paragraph starting in lower case. | 6 of the 7 re-read papers, 25 boundaries; 1–7 per paper | **Ours.** The model set `continues: true` on the second half every time; `renderHtml` only joins onto the record *immediately* before, which is the figure. | **Yes** — the largest class |
| **A paragraph cut in two at a page turn by a running footer or a footnote.** | Chrysikou (7), Melnikoff (4), Kuhn's 142pp (35), Baldassano, Layfield; 2 in the 7 re-reads | **Ours.** `continues: true` again; `renderHtml` resets its cursor on *any* record it does not render (`publisher`, `footnote`). | **Yes** |
| A continuation across a page that is wholly a figure (Edelman p1 → p3, p2 is a full-page figure). | 1 | Ours, same cursor, and the page-gap rule | Yes |
| **A byline list refused whole because one affiliation did not verify.** Byline stays `Taylor Webb1,*, Keith J. Holyoak1 , and Hongjing Lu1,2`. | Webb et al. | Ours: `verifyAuthors` is all-or-nothing, and an affiliation failure also throws away three verified names | Yes |
| A stacked NeurIPS byline (name / institution / email, per author) refused, so the byline is `Qihong Lu Princeton University qlu@princeton.edu Po-Hsuan Chen …` | Lu et al. | Ours: "nobody skipped" reads the institution between two names as a skipped person | Yes — **deferred**, below |
| Footnote markers left in bylines (`Griffiths1∗`, `Layfield1,2*`), a J Neurosci ORCID glyph glued on (`XChristopher Baldassano`), affiliations in the byline (`ROBERT T. ROSS and PETER C. HOLLAND University of Pittsburgh`) | 7 articles | Predates the authors pass | **No** — 5 of those 7 re-read clean; the two that do not are the two rows above |
| Paragraphs split on the same page with no `continues` (Edelman, 16 boundaries) | 1 (pdf-v3) | The model, on the old prompt | **No** — the v4 re-read has none |
| **Footnotes are not in the reading view at all.** Transcribed, typed `footnote`, then dropped by `RENDERED`; the prose keeps its bare markers (`…a more familiar situation.1 This`) pointing at nothing. | every PDF with footnotes | By design (v1), not a glitch in the code | Yes — **stage 3, for Greg** |
| Dhammapada: verse numbers as their own paragraphs, apostrophes starting a new line (`They\n’re`) | 1 (pdf-v3, a verse translation) | Model, old prompt | Not re-measured; a verse book is a shape of its own |

**A figure's half-paragraph is the one to see.** Baldassano et al., p2, as a reader has it today:

```
  <p>… and then these clips were concatenated to</p>        ← stops mid-sentence
  (two running-footer records, not rendered, sat here)
  <p>create 16 new scrambled stimuli. Like the original …</p>

  <p>… (the paragraph that precedes Figure 1) …</p>
  <figure>Figure 1. … All stories were approximately 3 min long.</figure>
  <p>2012; Robin and Moscovitch, 2017) and co…</p>          ← the rest of the sentence before the figure
```

## Why the model is not the thing to change

In every one of the ~70 cut boundaries above the model had already said, in `continues`, that the
second half carried on. The cut is our renderer declining to believe it. A stronger model reading the
same pages would say the same thing and be cut the same way. The one model-side glitch that remains
on the current prompt (a `continues` missed within a page — 1 boundary in the 7 re-reads, "Four ‖
rats received") is not worth a model switch.

**What switching the PDF reader to Sonnet would cost, named rather than done.** Luna is about a tenth
of Sonnet's price ([`src/models.ts`](../../src/models.ts) § the `quick` row). Measured PDF costs on
Luna: a 3-page cut about $0.017, the 142-page Kuhn paper $0.49–$0.63
([content-extraction.md](../project/content-extraction.md#two-extractors-one-artefact)). On Sonnet that
is roughly $5–6 for the long paper, every import and every re-import. Nothing in this survey says it
would buy anything. Not done.

## Stage 1 — one join rule, used by both of the functions that need it

`renderHtml` and `mendSeamHyphens` each keep their own copy of the same cursor ("mirrors renderHtml's
own cursor", says the comment on the second), so the fix is to make it **one function both call**:
`continuationTargets(records): (number | null)[]` — for each record, the index of the record it
joins onto, or `null`. Two copies of a rule that must agree is how they drift; the comment already
admits the mirroring is untested in one direction.

The rule, in order, for a record with `continues: true` and non-empty text:

1. **The record immediately before it**, as today: same type, on the same page or the next.
2. **Across page furniture at a page turn.** If the only things between it and the previous rendered
   record are `publisher` and `footnote` records (running footers, a DOI line, a footnote at the foot
   of the page), and it is on the **next page** from the last piece of that paragraph, join. **Not
   on the same page** — that is the Kuhn case in
   [`tests/pdf-frontmatter-wiring.test.ts`](../../tests/pdf-frontmatter-wiring.test.ts), where
   `Available online 26 January 2024` was hidden precisely so that the sentence after it would stop
   joining onto it, and a same-page bridge would glue that sentence onto the author's name instead.
3. **Back past a figure or table** — paragraphs only. If the records between it and the last
   paragraph are only figures, tables, their `tabledata`, and page furniture, join onto that
   paragraph. The figure stays where it is — after the now-whole paragraph, which is where a reader
   expects it.

For 2 and 3, **the earlier half must visibly stop mid-sentence** (added after the measurement below,
and tightened after the plan review), and the continuation must be on the same page as the last piece
of the paragraph or the next — never further (the review's F4, below).

Everything else resets the cursor as now: `reference`, `cover`, a heading, a different type, a page
gap — and a record the front-matter pass set aside, whatever its type now says (F1).

**What this can get wrong, and why it is the right way round.** It only ever acts where the model
said `continues: true`, and past anything only where the earlier half visibly stops mid-sentence. The
false join left is one where both hold and the paragraph is still the wrong one. `mendSeamHyphens` gets the same
target, so a word cut across a page turn with a footer between the halves now mends too — its
existing test "does not reach across a record renderHtml would not join" is about exactly that
footnote and changes meaning; it becomes the positive case, and a `reference` record takes over as
the thing that still stops it.

**The corpus.** Excerpts of real record sequences from the surveyed papers — a few records either side
of each boundary, the words cut to a sentence — in a test file, each with the join it must or must
not make, including the negatives: the Kuhn same-page case, a heading that is `continues` onto its
run-in paragraph (Ross & Holland's `Pretest.`), a `reference` between two halves, a gap page, the
Baldassano box, and the review's constructed sequences. That is where Greg's "add those papers to our evals" lands for this class: the
behaviour is deterministic, so it is a test, not an eval. Short quotations only; no whole paper and
no PDF is committed, since several are not openly licensed (J Neurosci, Elsevier, Psychonomic
Society).

**The measurement.** Re-render every surveyed article's stored records, and the 7 re-reads, with the
old rule and the new, and list every boundary that changed — each one read by hand, and the list and
its count go in this plan. Offline and free: rendering is deterministic, and the records are already
bought.

### What the measurement found (built, 2026-09-30)

Over 28 record sets (the 21 articles' stored checkpoints, which are incomplete for some — old chunks
are pruned — and the 7 re-reads), the first version of the rule joined **87** boundaries that were not
joined before, and un-joined none. An Opus subagent read all 87, one by one: **79 right, 5 wrong,
3 unsure.** Four of the five wrong were two shapes:

- **Baldassano et al., the boxed Significance Statement** (×2, once in the stored records and once in
  the re-read): the sentence `… (van Kesteren et al., 2010,` is cut by the page's footnotes, a
  boxed statement, and Figure 1, and its end `2012; Robin and Moscovitch, 2017) …` would have been
  glued onto the box's last paragraph — which ends in a full stop.
- A numbered list item (`4. My personal first-person awareness …`) glued onto item 3 across a
  footnote.

So the rule gained a condition, **the page's own evidence that a sentence was cut**: reaching past
anything needs the earlier half to not end a sentence (a closing quote, bracket or footnote marker
after the stop allowed — `limits³.`, `problems.4, 5`). The first version also accepted a later half
starting in lower case instead; the plan review (F2) showed that says the continuation continues
*something*, not *this*, and it bought none of the measured joins, so it went.
The model's `continues` alone still suffices for the record immediately before, as it always did.
Declining leaves a boundary as it was before this change; joining the wrong paragraph rewrites one
that was whole, so the conservative way round is the right one.

With it: **80 newly joined, 0 un-joined**, and after the review's changes **78** — the two lost are
the one full-page-figure join (Krichmar pp. 1–3, in both record sets), cut per F4. That removes all
four of those wrong joins and all three unsure ones (each ended a sentence, then a capital). What remains wrong is two, and both are
transcription faults the join does not cause: a paragraph the model emitted twice around a figure
(Miller et al. p14 — the duplicate is now in one paragraph rather than two), and a continuation
whose real end is missing (Kuhn p35, `… to generate and` then `One expression is …`). One right join
reads `ap- appropriate`: the model kept the stem and restarted the word on the next record; before,
the two halves were separate paragraphs.

Each rule is guarded by a test that goes red when that rule is removed. Six mutations of
`continuationTargets` were run against the first version, and each turned at least one test red: no
furniture bridge, no figure bridge, no evidence check, furniture allowed on the same page, gap pages
unchecked, and every unrendered type bridged. The review's cases (F1, F2, F3, F5) each have their own
test.

**What it does not do: touch any article already on the shelf.** A revision's HTML is written at
import; a re-import picks this up. The transcription chunks are free to reuse where they are still
checkpointed (the key is the prompt, not the renderer); the two small front-matter calls run again
(F8). Re-running production articles is Greg's call,
not this plan's.

## Stage 2 — keep the names when only an affiliation fails

`verifyAuthors` refuses the **whole** list if any affiliation fails to verify, and the byline then
falls back to the records' raw text — `Taylor Webb1,*, Keith J. Holyoak1 , and Hongjing Lu1,2` —
even though all three names verified. The affiliation failure (the model joined `1Department of
Psychology` to `University of California, Los Angeles, CA, USA`, two lines apart on the page) is a
failure of the affiliation, not of the names.

Change: when every **name** verifies but an affiliation does not, the byline is built from the
verified names (`Taylor Webb; Keith J. Holyoak; Hongjing Lu`) and **no author list is stored** — so
nothing claims those authors had no affiliation. A name that fails still refuses everything, as now: "half a list beside half not
is worse than either" was about people, and it still holds.

**What a reader gets, stated rather than implied** (the review's F7 — an earlier draft of this
paragraph said the Metadata page would explain it, and it does not). The note naming the refused
affiliation goes to the stage's `notes`, which are logged and never stored: the pipeline keeps
`extractedHtml` and `meta`. So this is the old fallback's state with a clean string in it — a plain,
unlinked byline, no Authors section, and no author evidence for the uploaded-source guess — and the
places that read `meta.byline` as text get the clean names: the masthead, the shelf and its search,
prompts, and Referee mode's own-author exclusion.

Simpler option passed over: store the list with the failed affiliations dropped. Rejected because an
author with `affiliations: []` reads as "none printed", which is false.

Test first, in [`tests/pdf-authors.test.ts`](../../tests/pdf-authors.test.ts), from the Webb byline
record as the page prints it, and red before the change.

## Deferred, and named

- **Stage 3 — footnotes in a PDF article (Greg's call).** Today they are transcribed, checked, and
  then not shown; the prose keeps `situation.1` with nothing to point at. Showing them means (a)
  rendering `footnote` records into the notes section web articles already get
  ([`src/notes.ts`](../../src/notes.ts)), and (b) knowing which digits in the prose are markers,
  which the transcription cannot say today — rule 1 of the prompt copies `1` and `¹` alike. (a)
  alone is cheap and would put the notes at the end of the article, unlinked; (b) is a prompt change
  (`PROMPT_VERSION` bump, so every re-import pays again) or a text-layer heuristic (superscript
  glyphs by font size in pass 0). Which Greg wants — notes at the end, unlinked, or linked markers —
  is a product decision, so it is written up here rather than built.
- **Stacked NeurIPS-style bylines** (Lu et al.): letting the words between two names be the previous
  author's verified affiliation and email. Real and common in ML papers, but it loosens the "nobody
  skipped" check, which is the one that stops an author being dropped — it wants its own tests and
  review, not a line in this plan. **Done 2026-10-01 in [261001l](261001l-pdf-stacked-bylines.md).**
- **A glued ORCID glyph** (`XChristopher`): the one re-read of that paper came out clean
  (`X Christopher` in the text layer, the model dropped it); one sample of a stochastic process, so
  not fixed on that evidence and not fixed blind either.
- **Re-rendering production articles** so existing readers get the joins. Free for chunks still
  checkpointed, but it rewrites real readers' articles and re-mints ids for joined blocks — Greg's
  call.

## The plan review, and what was done with it

GPT Sol, read-only, 2026-09-30 —
[260930e-pdf-transcription-glitches-plan-review-sol.md](260930e-pdf-transcription-glitches-plan-review-sol.md).
Verdict *"revise before build"*. The code had been drafted alongside it; every finding was checked
against that code and all eight held.

| | Finding | Done |
|---|---|---|
| F1 | A record the front-matter pass retyped to `publisher` would be bridged like a footer, joining a paragraph onto the author's name across a page turn | Set-aside records are barriers: `continuationTargets(records, barriers)`, fed `front.setAside` |
| F2 | Across a figure, `continues` cannot say *which* paragraph; a lower-case start is not evidence | The earlier half must visibly stop mid-sentence, always; negatives for a continued caption and a table |
| F3 | A continued caption was appended after `</figcaption>` and its ref minted from half the caption — **true before this change too** | `renderHtml` assembles whole blocks before writing HTML; the uncertain class is kept if any piece is uncertain |
| F4 | The page-gap extension is broader than its one example and cannot tell a figure page from dropped prose | Cut: never further than the next page |
| F5 | A list item reaching past a figure leaves one list as two | Paragraphs only |
| F6 | Targets recomputed after mending could differ | Computed once in `runPdfExtract`, handed to both |
| F7 | The authors note is not persisted or shown | Claim removed; the consequences written down in Stage 2 |
| F8 | Re-import is not free | Claim corrected |

## The code review, and what was done with it

GPT Sol, write-enabled, 2026-09-30 —
[260930e-pdf-transcription-glitches-code-review-sol.md](260930e-pdf-transcription-glitches-code-review-sol.md).
Verdict *"ready after three fixes"*, which it made, each with a test red first; read and kept.

| | Finding | Done |
|---|---|---|
| C1 | **Ours, from F6.** With the targets computed before mending, a one-word continuation the mend empties (`or` + `ange` + `sphere of 15 cm.`) broke the chain, and the third piece became a paragraph of its own | `renderHtml` gives an emptied record its target's block, so the chain carries through it |
| C2 | The names-only arm could drop authors printed after the last name the model gave (`Mei-jun Ou` of five) | Names-only only when nothing but markers and glue follows the last verified name; otherwise the byline as printed |
| C3 | `ENDS_A_SENTENCE` missed non-Latin sentence ends (`。`) | `\p{Sentence_Terminal}` and any closing punctuation |
| C4 | **Pre-existing, not changed:** the ordinary author list has the same trailing-author gap C2 closed for the new arm — `[Mei-jun Ou]` against a two-name byline stores one author. Trailing words cannot be told from an affiliation fused onto the byline record, which is the stacked-byline question deferred above | Closed 2026-10-01 in [261001l](261001l-pdf-stacked-bylines.md) |
