# Citations: jump to the exact citation, and read a PDF's reference list

Two reports from Greg through the Feedback button, both sent from Citations mode on
`dongetal25-spya-vfmvmm` (a PDF of a *Trends in Cognitive Sciences* review) on 2026-09-30.

SPIDERYARN-READING2-6J:

> In citations mode, there's a block link for each citation, which is fine, but actually it would be
> more helpful to highlight specifically within the block where the citation is, because sometimes
> there are multiple citations in a block, and somehow citations mode doesn't make it obvious which
> citation corresponds to, you know, which footnote.

SPIDERYARN-READING2-6K:

> In citations mode, I wonder if there's a way to include the author names as well somehow, even if
> in somewhat truncated form, and also the date. And/or, you know, provide a tooltip with extra
> metadata like journal/conference/etc. It may be that we would need to make use of the references
> section or something like that in order to get this extra information as part of the citations
> mode generation.

Owner doc: [citations.md](../project/citations.md). Read [block-ids.md](../project/block-ids.md)
before anything that points inside a block.

## What is actually wrong on that article

Read from production (read-only) on 2026-09-30:

- 80 works (capped). **Not one has authors, a year or a reference.** Titles are the model's
  descriptions of a numbered cite, not titles: *"Study on recall of TV episodes"* for `TV episodes
  [8]`, whose real entry is *Chen, J. et al. (2017) Shared memories reveal shared structure in neural
  activity across individuals. Nat. Neurosci.*
- The article's `References` heading is there and **empty**. A PDF's reference list is transcribed
  by stage 2 and then deliberately not rendered (`RENDERED` in [`src/pdf.ts`](../../src/pdf.ts),
  Greg's v1 call: *"v1 does not show footnotes, references or a publisher's cover page"*). So the
  Citations stage, which reads only blocks, never saw a single entry.
- Each mention **is** already verified and marked in the prose (`citeMarks`, a
  `text-decoration` underline, `data-cite="<work id>"`). But the row's jump is *first cited
  `x6zc5d`*: a block id, and the arrival flash washes the whole paragraph. Block `x6zc5d` cites
  `[1,2]`, `[3–5]` and `[6]` — three works — so the wash cannot say which.

So 6K on this article is not a display problem. The stage has nothing to read. On an HTML article
with a bibliography the stage already fills authors and year; there the ask is the truncation and
the venue tooltip.

## What we build

### 6J — the row names the citing words, and the jump lands on them

1. **The row shows the words the article cites it with**, e.g. *first cited “TV episodes [8]”*,
   instead of a bare block id. It is the first verified mention in `firstCited`'s block (a
   `CitationPlace.quote`, the article's own characters, sliced by `verifyPlace`), shortened for the
   row. A work with no mention in that block (a footnote reached only through its marker, or a
   bibliography-only work) keeps today's block id. `BlockRef` is still the link, so ⌘-click, the
   block card and `href` are unchanged.
2. **The jump flashes that mark, not the paragraph.** `beginJump`, `scrollToBlock` and `flashBlock`
   already take a `passage`, found by `passageMarks` (rows.ts) — Trajectory uses it. Cite marks
   carry `data-cite`, not `data-hit`, so `passageMarks` learns one more key shape: a key made by
   `citePassageKey(workId)` finds `mark[data-cite]` elements whose list includes that id. One rule
   in one place, so the centring scroll and the flash agree. If the mark is not drawn (a visitor,
   who has no marks; a mention that is not unique in its block), the flash falls back to the cell,
   as it already does.

**Found at render time, not from a stored offset** — the brief's preference, and block-ids.md's
rule. `start` stays unused for drawing; the mark is re-found in the rendered text by
`citeMarks`, which is what already draws it.

### 6K — read the PDF's reference list, and show authors · year with the entry on hover

3. **For a PDF, the stage reads the numbered reference list from the PDF's own text layer** —
   `pass0`, pdf.js, no model and no outside service, through `readRawBytes` as
   `recoverPdfFigures` reads it. Running headers and footers come out first (`pageLines`), then
   code splits the lines under a `References` / `Bibliography` / … heading **at the list's own
   numbers** (`8.`, `[8]`, `8)` at a line start, each one more than the last), latest heading
   first, falling back to earlier ones. A scan, a list that is not numbered, or fewer than five
   entries gives no list, and the stage runs as today.
   [`src/citation-reference-list.ts`](../../src/citation-reference-list.ts).
4. **It goes to the model after the article**, one `[n] entry` a line, labelled as the article's
   own data and never an instruction. The model gives each work `"entry": <number>`.
5. **Code checks the number**: the list must have it, and the work's verified mentions must cite
   it (`[8]`, `[7,8]`, `[6–9]`). Then the entry's text — the list's characters, split by code — is
   attached. The model never copies the entry, so it cannot copy one and a half.
6. **Title, authors and year are located in the entry.** The title must be in it (and the entry's
   own characters are kept), or the entry is dropped as disagreeing; every author name must be a
   word of it, or the authors go; the year must be one of its years, and its own token is kept
   (`2017a`). Only where there is an entry: an HTML article's fields are as before.
7. **An HTML bibliography block's text is the entry** only when it is a `role: "reference"` block
   and exactly one work claims it — a footnote or compound block would show a neighbour's venue.
8. **The row**: authors shortened — two names or fewer as given, more as *First et al.* — then
   `· year`. The by-line carries a tooltip with the authors and the entry, labelled as the
   article's reference list, which is where journal, conference, volume and pages are. The prose
   hover card (`CiteCard`) shows the same by-line and the entry, since a card is what a finger
   gets.
9. `PROMPT_VERSION` → `citations/4`. Nothing re-runs by itself: the *Re-run AI processing* row on the
   Metadata page makes the list again (one model call).

## What this does not do, and why

- **No bibliographic lookup (OpenAlex, Crossref).** A new outside service, and Greg's decision —
  already recorded for 5P in [awaiting-approval.md](../user-feedback/awaiting-approval.md). The
  reference list gives authors, year and venue without one. Deferred, named.
- **The entry does not reach a visitor.** `src/public/dto.ts` rebuilds a cited work field by field
  and is a defence (security-map.md); an unattended run does not edit it. The visitor's row keeps
  authors · year and the mention jump (mentions already cross). Left for Greg, listed in the note.
- **A DOI or arXiv id in the PDF's entry is not yet used as the link.** It would be the biggest
  improvement for a PDF — this article's entries carry DOIs — and it fits the safety property
  (*the address was in the article, and code found it*). Deferred because the entry's end is the
  model's copy, and a copy running into the next entry would hand one work its neighbour's DOI; it
  needs its own boundary check and review. Named in citations.md § Deferred.
- **Showing the reference list in the reader.** That reverses Greg's v1 call on PDFs, and stage 2's
  transcription of a bibliography is unchecked by design. The text layer is the better source here
  anyway: deterministic, free, and complete.
- **An author–year PDF bibliography** (*Tulving, E. (1983) …*). No number to check a pairing
  by, so v1 sends no list for one; its rows are as before. The next step would be the same split
  at a different boundary, with the pairing checked by first author and year.
- **Titles a model invented when there is no entry** (*"Study on recall of TV episodes"*). With the
  list read, a PDF like this one gets real titles. An article with numbered cites and no list at all
  still gets descriptions; marking them as such is a separate change.
- **Flashing every mention** rather than the first cited. One jump, one place.

## The simpler option passed over

**Only the row change (1–2), and a note that PDF citations have no authors.** It answers 6J fully and
6K not at all, on exactly the kind of article (a PDF paper) Citations mode is most used on. The
reference-list read is one pdf.js pass over a document we already hold, no new service and no new
table, so the fuller version is worth its size.

## Stages

1. **6J, client only.** `citePassageKey` + `passageMarks`; the row's link text and jump; tests
   (`passageMarks` on a cite mark; the row renders the mention and calls `onJump` with the key).
2. **6K, the stage.** Reference-list extraction from `pass0` pages (pure function, unit-tested on
   this article's text-layer shape); `entry` in the prompt, `readDraft`, fold and types; the numeric
   cross-check; the authors/year check; the pipeline step reads the PDF; log the list's size and how
   many works got an entry.
3. **6K, the display.** Shortened authors, the by-line tooltip, the hover card; citations.md.
4. GPT Sol code review (fixes in place), gates, the note in `docs/user-feedback/`, push to `dev`.

Done looks like: on a local copy of a numbered-citation PDF, a re-run gives rows with real titles,
*Chen et al. · 2017*, an entry on hover naming *Nat. Neurosci.*; *first cited “TV episodes [8]”*
flashes the `[8]` phrase rather than its paragraph.

## Review log

### GPT Sol, plan review (2026-09-30) — "build with these changes", no P0

- **F1 (P1) the heading heuristic**: a running header saying "References" on every page, a list
  before the midpoint. *Taken*: furniture stripped with `pageLines` first; every heading is a
  candidate, latest first, and one wins only if a numbered list parses under it.
- **F2 (P1) a copied entry proves nothing about its end**, and the numeric check was optional.
  *Taken, and it reshaped the design*: code splits numbered lists, the model returns a number,
  the number must be cited by the work's mentions. Unnumbered lists are deferred.
- **F3 (P1) authors/year checks admit inventions and titles went unchecked.** *Taken*: all three are
  located in the entry, each author name must be there, the entry's year token is kept, and a
  title not in the entry drops the entry. Not applied to HTML articles, which keeps the risk Sol
  raised about good HTML metadata out of this change.
- **F4 (P1) a shared footnote as one entry.** *Taken*: block entries only for an unshared
  `role: "reference"` block, the claims count `linkFor` already uses.
- **F5 (P1) freshness does not cover the PDF.** *Declined, with the reason*: the raw document of an
  article only changes through a re-fetch, which re-runs extraction and changes the blocks the
  fingerprint already covers. The residual case — a new PDF whose body extracts identically and
  whose reference list alone changed — is an erratum, and the price of covering it is a third
  fingerprint input on three code paths and every existing PDF list reading as stale to its
  reader at once. Named here in case that trade looks different later.
- **F6 (P1) the output budget for echoed entries.** Gone with F2: an entry is a number.
  `PER_WORK_TOKENS` is unchanged.
- **F7 (P2) pdf.js cost.** *Taken*: `MAX_PAGES`, a scan skipped, the abort signal checked either
  side of the read, and `referenceListMs` on the step's log line. 13 ms to split the real paper's
  130 entries; `pass0` itself is seconds on a long PDF, beside a ~140 s model call.
- **F8 (P2) the `cite:` key names a work, not an occurrence**: two mentions of one work in one
  paragraph flash together. *Accepted*: Greg's complaint is telling works apart in a paragraph
  that cites several, which this does; telling two cites of the same work apart would need a
  per-place token written on the marks, for a case that is rare and harmless.
- **F9 (P2) prompt injection and the public DTO.** *Taken*: the list is labelled as data and never
  an instruction, the call has no tools, every bibliographic field is located by code; and
  `tests/public-dto.test.ts` now has an `entry` sentinel that must not cross.

Real text: the paper the reports came from splits into all 130 entries, running headers gone;
entry 8 is *Chen, J. et al. (2017) Shared memories reveal shared structure in neural activity
across individuals. Nat. Neurosci. 20, 115–125*.

### GPT Sol, code review (2026-09-30) — "ready after the fixes", no P0

Sol fixed in place, and each fix was read before it was kept:

- **P1** a numbering gap or a row-interleaved two-column layer glued another work onto an entry —
  an entry's own label out of sequence now ends the list;
- **P1** a contents page under a `References` line (`1. Introduction …… 1`) read as a list —
  refused;
- **P1** two different numbered entries with the same short title, author and year folded into one
  row — the entry number is now identity in both folds, and `mergeInto` refuses two numbers;
- **P2** zero-based lists and superscript numbers; `[8, p. 12]` read as 8 and `[2019]` not read at
  all; author names must come before the title in the entry (an invented "Neural Activity" could
  match title words); `no-raw` told apart from `not-pdf` on the log line, and a parser's error
  message no longer logged (it can quote the document); the screen-reader text carries the
  authors; the cite-flash CSS test checks the computed cascade.
- **Not fixed, P2**: an abort cannot interrupt `pass0`'s page walk, only be noticed after it. A
  change to the shared PDF parser, left as a follow-up.

**One of Sol's fixes was itself a regression, and was narrowed.** It let a line that is only a
number start an entry, and ended the list at any number out of sequence. `repeatedLines` never
counts a line of three characters or fewer as furniture, so a page number printed alone at a page
foot reaches the parser inside the list and would have ended it at the first bibliography page
break. Now only an entry's own label (`8.`, `[8]`, `8)`) out of sequence ends the list; a bare
number out of sequence is dropped as a page number, and a run-in one (`2 vols. Oxford`) stays text.
Two tests pin it, and the first was red against Sol's version. Checked on the corpus in
`evals/pdf/` too: the three with a bibliography are author–year and give no list either way, and
the reported paper still gives all 130 entries.
