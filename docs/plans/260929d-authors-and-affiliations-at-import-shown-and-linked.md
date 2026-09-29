# Authors and affiliations at import, shown and linked

Greg, 2026-09-29, from the Feedback button on `/read/arxiv-2212-spya-u5293w?mode=glossary`
(SPIDERYARN-READING2-4J, overseer queue `qi-pvvfjq67`):

> When we import, try and extract out author names and other metadata (e.g. affiliations). At the
> very least, display them in the Metadata section. If you can also see a good way to display them at
> the top of the article, that would be nice. Note: they often seem to get mis-transcribed (e.g. the
> footnotes get shown as numbers after the name (e.g. "Smith1") - it would be great if we could clean
> this up at the same time. And for extra points, we'd add rich tooltips (as per tooltips.md) to the
> author name, and clicking it would somehow take us to a list (e.g. a filtered list on the
> homepage-shelf) of other stuff by that article.

Builds on [260928b](260928b-multi-author-bylines-from-citation-meta.md), which landed the day before:
a web page's byline is now every `citation_author` (or a repeated `dc.creator`), in natural order,
joined with `"; "`. That fixed *which* names a web page gets. It left three things:

1. **The byline is one string.** Nothing downstream knows where one author ends and the next begins,
   so nothing can show, link or describe an author.
2. **No affiliations anywhere**, although scholarly pages declare one per author
   (`citation_author_institution`, measured on Nature and PLOS today) and every PDF front page prints
   them.
3. **PDF bylines carry their footnote markers.** A PDF's byline is the text of the records the
   front-matter model named (`src/pdf-frontmatter.ts`), joined. The local database has
   `Ehren L. Newman 1,* , Thomas F. Varley 1,* , … Samantha P. Sherrill 2 and John M. Beggs 3`; the
   report's page is an arXiv PDF with `Smith1`. The ten front pages in `evals/pdf/titles/` show the
   markers in every shape: plain digits glued or spaced (`Ou1`), superscript `¹`, `*`/`**`/`***`,
   `∗`, `☆`, and a **letter glued to the surname** (`Rukhsara` for Rukhsar, `Tiwaria` for Tiwari).

## What this does

### 1. `meta.authors`: a list, not a string

```ts
interface Author { name: string; affiliations: string[] }   // src/types.ts
Meta.authors?: Author[]                                     // absent = we do not know the list
```

Stored as a new nullable `article_revisions.authors jsonb` (additive migration, `CHECK
(jsonb_typeof(authors) = 'array')`). **Why JSONB and not a column or a child table** (sql.md asks for
the sentence): it is an ordered display list that only means anything on the revision it came from,
nothing filters, sorts or joins on it, and the shelf's "other articles by" search reads the `byline`
text, which stays a column. A `revision_authors` table would also have to be copied forward by the
carry machinery that every other stage-2 field gets for free as a column. If we ever want an author
index across articles, that is the moment for a table (deferred, below).

Carry policy `carry` (stage 2 owns it, like `byline`). Projected on the `article` read only — the
Metadata page reads `article.meta` too — and **not** on the shelf's read (every paper's authors on
every homepage load) or on any AI artefact's fingerprint: no prompt prints it, so it must not make
anything stale. Written to the rollback's `meta.json` and, as part of the whole row, to the bundle's
`revision.json`. Read back through `decodeAuthors` (src/authors.ts), so a value that is not a list of
`{name, affiliations[]}` reads as no list rather than crashing the masthead. *Changed after Sol's
plan review (P2, P6): the draft named the `metadata` read too, which would only have duplicated it.*

**Not the visitor's read, in this plan.** A visitor's article is built by `src/public/dto.ts`, field
by field, and that file is on [security-map.md](../project/security-map.md)'s list of defences, which
this work was briefed not to edit. So a visitor sees the byline string as today. What adding it
takes is written down under *Not in this plan*, for Greg.

**`meta.byline` stays, and stays the source of truth for every prompt and for Referee mode**. When
we have an author list, the byline is **derived from it** (names joined `"; "`, as 260928b does).
260928b keeps Readability's byline when it already names every declared author, and that byline can
name *more* people than were declared (one `citation_author` beside a two-person JSON-LD list), so
**`authors` is stored only when it accounts for the whole byline** — the byline is the one built
from the list, or taking every declared name out of it leaves only separators (`authorsForByline`).
Otherwise the byline stands alone, as before. *Sol's P3, which the build had already hit.*

**Size.** Both sources are a stranger's text and the byline goes into every paid prompt, so both are
held to `AUTHOR_LIMITS` (src/authors.ts): 100 authors, 10 affiliations each, 120 characters a name,
300 an affiliation. A web page with more keeps its first hundred; a PDF answer over any cap is
refused whole. *Sol's P4: the web path had no cap at all, and a physics collaboration's page can
declare thousands of authors.*

### 2. Web pages: affiliations from the tags the page already declares

`metaAuthors` (src/meta-authors.ts) returns `Author[]` instead of `string[]`:
each `citation_author_institution` (and its older spelling `citation_author_affiliation`) belongs to
the nearest `citation_author` before it — the Highwire convention, and what Nature and PLOS emit.
An institution tag before any author is ignored. Duplicate authors (case-folded) merge their
affiliations. The `dc.creator` path has no affiliations. Names are flipped into natural order exactly
as now, for the whole list or not at all.

A page with none of these tags gets no `authors` — its byline is whatever Readability said, as now.

### 3. PDFs: the front-matter model names the authors, and code checks every word

The front-matter pass already reads pages 1–3 and names the byline records. **A second, small call**
(src/pdf-authors.ts), run only when it named a byline, is shown the same records and told which are
the byline, and asked for **each author's name and the institutions printed for them, copied as
printed.**

*Why a second call, measured.* The first build added `authors` to the front-matter prompt itself.
On the eval that cost the front-matter pass its main job: publisher furniture hidden fell from 4/5 to
1/5. So that prompt is back byte-identical (its fingerprint and cached answers with it) and the
authors are a call of their own — two calls that each do one thing. It also showed the model does
**not** leave markers off when asked: it copied `Mei-jun Ou1` and `Keul¹,☆` on every sample, and
spent its whole 2,000-token ceiling reasoning on one NASA sample and answered nothing. So the
markers are cut by rule (below), and the authors call has an 8,000-token ceiling.

That is text written by the model, which this prompt has refused until now ("answer with ids only").
The reason for ids-only is that a record is a stranger's text, and a model allowed to write the title
could be talked into writing something else. So **the model points and the page supplies the
text** (src/pdf-authors.ts):

- **A name** is looked for in the byline records the model named: its words (letters and digits,
  case and diacritics folded, `¹` read as `1`) must appear there consecutively, every word exact
  except the **last**, which may have a footnote marker glued after it — up to three digits or one
  letter (`Ou1`, `Rukhsara`). The marker is what gets cut off.
- **An affiliation** is looked for on one page of the window, consecutively, every word exact except
  the **first**, which may have a marker glued in front (`1Environmental`, `aComputer`).
- **What is stored is the page's characters for the span found**, whitespace collapsed to one line —
  never the model's string — **with digit and symbol markers trimmed by rule**: trailing digits,
  superscripts, `* ∗ † ‡ § ¶ ☆ #` and commas off a name, and the same off the front of an
  affiliation. Names do not end in digits, so the rule is safe. **A letter marker is never cut by
  rule** — `Costa` ends in the same `a` an Elsevier paper uses — only where the model left it off and
  the dropped part is marker-shaped. The span must then still be shaped like a name (letters, marks,
  spaces, `. ' -`) or an address (those, digits and `, ; : & ( ) / –`) and fit `AUTHOR_LIMITS`.
- **Any author that fails means no `authors` at all** and the byline is the joined records, exactly as
  today, plus a note. All or nothing, like 260928b's name flipping: half a list in natural order beside
  half not is worse than either.
- When the list passes, **`meta.byline` becomes the names joined `"; "`** — which is the "Smith1"
  fix for every PDF from now on.

**After Sol's code review** ([260929d-authors-code-review-sol.md](260929d-authors-code-review-sol.md)),
which fixed an astral-character offset bug, made names match in printed order (no reversal, no
repeats) and stopped `3M Company` losing its `3`:

- **A leading number or glued letter comes off an affiliation only when it is this author's
  marker**, and the markers are read off the *page* — what is glued to or follows the name in the
  byline record (`Ou1`, `Newman 1,*`, `Keul¹,☆`, `Rukhsara`) — not off the model's copy, which may
  have left them out. Leading symbols (`*`, `☆`) always come off.
- **Nobody skipped.** The byline words between one found name and the next, or before the first,
  must be markers or glue (`and`, `by`); otherwise the list is refused, because a byline built from a
  list that leaves out a printed author drops their credit. **The named limit**: an author printed
  *after* the last name found cannot be told from an affiliation fused onto the byline record, so
  that omission is not caught.
- **The one truncation left** is a single letter off a surname — `Ana Cost` for `Ana Costa` passes,
  because the same rule is what lets `Rukhsara` become `Rukhsar`. Accepted: it needs the model to
  drop the letter, and the eval never saw it.
- Web pages: `authorsForByline` rejects `Jane Doe, PhD and John Smith` (the `PhD` is left over), so
  that page keeps its byline string. Conservative, and left as it is.

Re-scored after all of it from the cached answers, no new calls: the same numbers as the table below.

So the model can drop a marker, split a packed record and choose; it cannot invent, respell, reorder,
skip a name in the middle, or decorate. *Changed after Sol's plan review (P0): the draft compared letters only and kept
the model's string, so the model could add any punctuation, digits or newlines, and a three-letter
run-on on every word let it truncate names.* **What it can still do** is choose the wrong printed
words — call a sentence of the page an affiliation. That is bounded by the caps and measured by the
eval's injection fixture, and the damage is a wrong line on the Metadata page: `authors` goes into
no prompt.

Deterministic marker-stripping was the simpler option and is passed over because the corpus defeats
it: `Tiwaria` vs `Maria`, affiliations packed into one record as `1 Dept…, 2 Health…`
(Frontiers), a fused byline-and-affiliation record (ARNN, ACL), and NASA's affiliations mapped by
position with no markers at all. The model can read those; a regex cannot, and the check above keeps
the model to copying.

**The prompt change is measured before it lands**
([prompting-guide.md](../project/prompting-guide.md)): `evals/pdf/titles.mts` over all ten fixtures,
three samples, before and after. `expected.json` gains **structured golds** — every author's name and
affiliations — and the eval scores each author, name and affiliations as a set, so an arm that hands
every affiliation to the wrong person scores wrong. *Sol's P1: the draft scored a count.* The
byline column now compares lists of names rather than strings, so `"; "` against a gold's `", "` is
not a miss and a marker left on a name still is. A new arm, `tidy-authors`, is `tidy` plus the authors call, so its title and
furniture columns are `tidy`'s by construction. Gate: the byline and author columns go up; the
injection fixture gets no affiliation.

**Result**, 2026-09-29, ten fixtures × three samples, transcription bank `ee94ff70ea4a`:

| arm | titles | furniture hidden | must-keep kept | byline | names | + affiliations |
| --- | --- | --- | --- | --- | --- | --- |
| `tidy` (as before) | 23/30 | 4/5 | 98/99 | 14/28 (50%) | 0/30 | 0/30 |
| `tidy-authors` | 23/30 | 4/5 | 98/99 | **27/28 (96%)** | **27/30 (90%)** | **20/30 (67%)** |

The misses, all read: Wellcome's `L. N. FOWLER, OF NEW YORK` gives "OF NEW YORK" as an affiliation
(a place, arguably right); NASA's three stacked address lines come back as three affiliations rather
than one; UNAL's affiliations are typed `footnote`, which the front-matter window never shows, so
none is found; and one ARNN sample's *transcription* has only the first author in its byline record.
The injection fixture's authors are right with no affiliations. 28 calls, $0.33 in all — about 1.2¢
for the authors call on a PDF with a byline, and nothing on one without.

The front-matter fingerprint does not move, so no cached decision is invalidated. Only newly imported
or reset PDFs pay the authors call.

### 4. Shown in three places

- **The masthead** (`Masthead.tsx`): the byline slot in the facts line becomes the author names, each
  one a link wrapped in a rich `Tooltip` (the name, its affiliations, and "Click for the other
  articles on your shelf by …"). More than three authors show the first three and a "+ 22 more"
  button that expands the rest in place. No `authors` → the byline string exactly as today.
- **The Metadata page** (`Metadata.tsx`): a new **Authors** section under the identity block — each
  name with its affiliations under it, the same links. Absent when there is no list.
- **The shelf**: the link is `/?q=<the name's words>`. The shelf's search already lives in `?q=`,
  already matches the byline, and is AND-of-substrings. The query is the name's words without
  punctuation or initials — `Samuel Nastase`, `Yun Fei Liu` — because the search keeps punctuation in
  a term, so the name as written would miss `Samuel A Nastase` and `Nastase, Samuel A.`. No new shelf
  code. *Sol's P1 on the query; the draft also wrote `/read?q=`, which is not the shelf.*

The link is drawn **for the owner only** (the same `onRenamed !== undefined` stand-in the masthead
uses); a visitor would get the name and the tooltip, not a link to a shelf that is not theirs — and
today gets neither, since the visitor's payload has no `authors`.

**On a phone, a tap on a name goes to the shelf**, like any link; the card is for a pointer or the
keyboard. The affiliations are on the Metadata page, one under each name, which is where a phone
reader finds them. A tap-to-reveal card (first tap opens, second follows) is deferred: it is a
controlled `Tooltip` and a decision about what a tap means, and it matters most for visitors, who do
not get the list yet. *Sol's P8 asked for this to be decided rather than left open.*

## Not in this plan (deferred)

- **Existing articles are not backfilled.** They pick up authors on the Metadata page's reset (which
  re-runs `extract`: free for a web page, one front-matter call for a PDF). A sweep over production
  would be a write to readers' data and is Greg's call.
- **Bylines with no structured source** — a blog's `By Jane Doe and John Roe` from Readability, or an
  arXiv HTML (LaTeXML) page with no `citation_author` — stay one unlinked string.
- **One person, many spellings.** `Nastase, S. A.` on one article and `Samuel A. Nastase` on another
  are two searches. An author index across articles (a table, identity by ORCID or a folded key) is
  the fix, and it is a feature of its own.
- **ORCID, e-mail, corresponding-author flags**, and affiliations for web pages that declare them only
  in JSON-LD.
- **Visitors.** For Greg, since it touches a listed defence: `authors` would need adding to
  `PUBLIC_PROJECTIONS.article` (src/store/public-reader.ts), the `publicArticle` input, the field-by-field
  allowlist in `src/public/dto.ts` (only `name` and `affiliations`, each a string), and `PublicMeta`
  (src/public-types.ts), with `tests/public-reads.test.ts`, `tests/public-dto.test.ts` and
  `tests/public-visibility-pg.test.ts` extended — Sol's P5 lists the three seams. The data is the
  publisher's own public metadata, so the risk is low, but the file is on the list for a reason and
  the call is his.
- **A tap-to-reveal card on touch**, above.

## Stages

1. Types, migration, store plumbing (write, read, carry, projections, export), `metaAuthors`
   returning affiliations, tests. Web pages done end to end.
2. The front-matter prompt, the provenance check, the eval run before and after, tests.
3. The masthead and the Metadata page, component tests, and a browser check at desktop and phone
   widths.

Each stage gets its gates (`npm run typecheck`, the affected tests), and the whole gets a GPT Sol code
review before it lands on `dev`.
