# Metadata search: many more aliases, and a page that cannot forget them

Greg (admin), report `spya-nkjpte`, 2026-10-02, on an article's `/metadata` page:

> Add lots more keyword-aliases for Metadata page search to make it more flexible/forgiving (e.g. I
> tried searching for "regenerate" to find ways to regenerate the AI processing, and nothing
> matched).
>
> And update docs so that any time we update the Metadata page, we keep that search and ToC
> up-to-date.

The search is the box above the contents list in the left margin — `PageContents.tsx` reading each
`<Section>`'s label, `keywords` and heading aside, ranked by `src/web/page-search.ts`. Built
yesterday in [261001s](261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md).

## Why "regenerate" found nothing

**Not reproduced in the margin box; found in the other search on the page.** A browser pass
(Playwright, 1440×900, an admin on a local article) typed Greg's word into the margin search box:
*regenerate*, *regen*, *rerun*, *re-run*, *redo*, *refresh*, *retry* all list *AI processing*. So
should the build deployed at 01:08Z, hours before the report: its `page-search.ts` has the same
re-run group (checked against that sha). What found **nothing** on that page:

- **The ⌘K command bar**, which is also a search box on the Metadata page: *regenerate* → *No
  command matches.* Its only row about this page is *Metadata*, whose aliases are *about, details,
  source, reading time, stats*.
- **The phrasings the table lacks**: *reprocess*, *start again*, *start over*, *reset*, *update*,
  *fix*, *high powered*, *opus* — all *Nothing on this page matches*.
- **Below 1024px** there is no box at all (and below 1280px until 261002a, which had not deployed).

We cannot tell which of these Greg met. This plan widens two of the three — the margin box's words,
and ⌘K's way *to* the page — and not ⌘K on the page itself (§ After GPT Sol's plan review).
**§ 2 and § 3 below are the first draft; the review section at the foot says what replaced them.**

## The design

### 1. More words, in the places that already hold them

- **The command bar's *Metadata* row** gains aliases for what you do on that page —
  *regenerate, rerun, redo, reprocess, AI processing, cost, export, share, archive, delete* — so
  ⌘K *regenerate* from the article lands on the page that does it.
- **The synonym table** (`page-search.ts § SYNONYMS`) grows. The re-run group gains the ways a
  reader says it — *reprocess, recompute, regen, remake, rewrite, reset, generate, update, renew,
  over, start* and so on — and new groups for the model switch (*high-powered, opus, sonnet,
  smarter, better, model*), people (*author, writer, person, people, who*) and the rest.
- **Each section's own `keywords`** get broader, in plain reader words.
- **AI processing's keywords include the name of every row it can re-run**, built from
  `RERUN_LABEL` rather than typed out, so *glossary*, *quiz*, *thread* or *sketch* land on the
  section that re-runs them, and a new row is searchable the day it is added.

### 2. Forgiving when every word does not match

Today every query word must hit one section (AND), so *regenerate my glossary please* fails on
*please*. **If no section answers every word, rank the sections by how many of the words they
answer** (then by score), rather than showing nothing. AND still wins whenever it finds anything,
so a second word still narrows.

*Simpler option passed over:* adding *please*-like words to the stopword list one at a time — a
treadmill that never ends.

### 3. The page cannot drop its search words without the compiler noticing

Greg asked for docs. A rule only in a doc is a sentence, not a check
([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)), so the doc line comes
with two mechanical checks:

- **The words move into one typed record**, `src/web/metadata-sections.ts` §
  `METADATA_SECTION_WORDS: Record<MetadataSectionLabel, string>`, and `Section`'s `label` becomes a
  `MetadataSectionLabel`. `Section` looks its own words up, so there is no `keywords` prop to
  forget: a new section's label is a type error until it has words. (*In one sentence* is the one
  section without any today.) It is a list of section names, which 261001s avoided for the
  contents list — but the contents list still reads the DOM; this record holds only words, and the
  compiler ties every `<Section label>` to it. `RERUN_LABEL` moves there too, so AI processing's
  words are built from it.
- **The findability test reads the real page.** `tests/page-search.test.ts` holds a hand-copied
  list of the sections and their keywords. It now takes the labels in page order from
  `Metadata.tsx`'s `<Section label="…">`, checks that set equals the record's keys, and runs a
  table of reader phrasings against the real vocabulary — *regenerate*, *rerun*, *re-run*, *redo*, *refresh*, *start again*, *reprocess* → AI
  processing, and a few per section.

**The contents list (ToC) needs no rule**: it is derived from the page's `[data-section]` elements,
so it cannot fall out of date. The doc says so, so nobody adds a second list.

**The docs half.** The Metadata page has no doc of its own in `docs/project/` — its row in
[web-client.md](../project/web-client.md) points at the 2026-08-25 plan. The line goes in that
row: *any change to the page's sections updates their `keywords` (and `page-search.ts § SYNONYMS`
for a new kind of word); the contents list derives itself.* A full Metadata doc is not this task.

## Deferred, named

- **Search inside a section's body, landing on the matching row** — still the deferred version from
  261001s. Mode names in AI processing's keywords cover the commonest case (*glossary* → the section
  that re-runs it) without it.
- **Typo tolerance** (edit distance: *regnerate*). Prefix match already covers typing-in-progress; a
  fuzzy matcher is a second ranking rule. Wait for a report.
- **A narrow-window search box** — follows the contents list, as 261001s said.
- **⌘K on the Metadata page jumping to a section.** There the *Metadata* row is the page you are
  on. Letting the command bar reveal a section would join two searches into one; the margin box is
  the one for sections.

## Stages

One stage.

1. Red first: the source-reading findability test with Greg's *regenerate* case among the new
   phrasings — red before the vocabulary changes.
2. SYNONYMS, keywords, `RERUN_LABEL`-derived keywords, required prop, OR fallback (with its own
   red-first unit test).
3. The doc line in web-client.md; the Section docstring points to it.
4. `npm test`, `npm run typecheck`; GPT Sol plan review before building, code review before push.

## After GPT Sol's plan review — what changed

The review is
[261002c-…-plan-review-sol.md](261002c-metadata-search-aliases-and-keeping-its-search-current-plan-review-sol.md).
It confirmed the diagnosis (the box cannot be shown before its index, and a later aside or section
re-scans), and changed the design in four places. Each was checked against the code.

1. **No OR fallback** (P1). *cost export* would have listed two sections where *cost* listed one:
   the second word widening the list, on Help's search too. Instead, **after an AND miss, drop only
   the query words that match no section at all, and try AND again** — *regenerate my glossary
   please* loses *please*; *delete cost*, whose words both mean something, still finds nothing.
2. **Broad words go in AI processing's keywords, not the synonym table** (P2). A synonym group
   applies to every section, so *over* or *update* in the re-run group would rank AI processing
   above *At a glance* for *over time*. The table gets only true one-word synonyms
   (*reprocess*, *regen*, *recompute*, *remake*); *start, over, reset, whole, update, fix, opus,
   sonnet, high, powered, model, better* are AI processing's own words. A test now fails if one stem
   sits in two groups, which `groupsOf` would otherwise silently resolve to the last.
3. **The `keywords` prop becomes required; no new module and no source parser** (P2). The record
   was a second list of names, and the source-order parse was not page order (the page renders
   Technical details, Cost, Export, AI processing, while their `<Section>` call sites sit in a
   different order). The phrase table runs in the rendered test,
   `tests/metadata-contents-reveal.test.tsx`, against the real page. `tests/metadata-page-order.test.tsx`
   already proves the contents list equals the page's sections.
4. **AI processing names the rows `RERUN_LABEL` does not** (P2): the *whole article* reset and the
   High-powered AI switch, by explicit words. The mode names are still built from `RERUN_LABEL`.

**Not taken, and why — P1, "the reproduced path stays a dead end".** Right: ⌘K *regenerate* on the
Metadata page will still not open *AI processing*; from the reading view it will now go to the
Metadata page. Making the command bar reveal a section is a second search over the same sections
with a different matcher (command-match.ts), and the box is drawn at every width from 1024px. Named
in § Deferred, and in the feedback note as the question to ask Greg: if it was ⌘K he used, that is
the next piece. "All three get wider" is corrected to "two of the three".

## After GPT Sol's code review — what changed

1. **Sol removed the retry after an AND miss; it was put back** (the one finding not taken). Its
   case: with the experimental switch off, *redo whole article* sets aside *whole* and answers
   *redo* — AI processing, which then has no *Whole article* row. True, but AI processing is where
   every other redo is, so the answer is near rather than wrong; and strict AND turns any stray
   word into "nothing matched", which is the complaint this report is about. What *was* taken from
   that finding: *get* is question furniture only in *get rid* (it means something in Help's *get
   it back*), *with* joined the stopwords, and the reset's own words follow its switch (2). The
   tests pin both sides: *delete cost* still finds nothing; *regenerate my glossary zebra* finds AI
   processing.
2. **Whole-article words follow the whole-article control.** *Reset*, *whole* and *over* are indexed
   only while the experimental switch exposes that row. The rendered test checks both switch
   positions.
3. **The command bar does not borrow `public`.** That word already names *Shared articles*, and the
   new Metadata alias won their tie only because the article row comes first. *Share* still offers
   Metadata below *Shared articles*; the tests now assert the first result for both cases.
