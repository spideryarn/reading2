# Outside titles become plain text at ingest

**Status:** plan, 2026-09-29. Asked for by Greg via the Overseer after session fb56 saw a Debate
source drawn as `Physics - <i>Landmarks</i>—Millikan Measures the Electron's Charge`. Greg wants it
fixed "in a clean, general, robust, root-cause, reusable way, and anywhere else that might be
affected".

## What the evidence says

**The markup is stored, and no model added it.** In the local database, 5 of 75 Debate source titles
contain markup. All five are the same APS page, `<i>Landmarks</i>`, on five revisions of
`cargocult-spya-rz663q`. They are the web search's `url_citation.title`, which `collectAnnotated`
(src/openrouter-stream.ts) copies verbatim, and src/debate.ts keeps "the search result's title,
never the model's". Locally, 0 of 589 citation titles, 0 of 332 article titles and 0 of 20
link-preview titles have markup. Those paths can still carry it: Readability's `article.title`
decodes `&lt;i&gt;` into a literal `<i>`, and `og:title`, PDF `Info.Title` and Crossref-style
`<jats:italic>` all appear in the wild.

**No surface is unsafe, and every surface shows the markup literally.** A read-only sweep found
about 20 sinks: Debate rows and cards, Citations, the citation hover card, library/wiki/link-preview
hover cards, chat/comment/criteria/candidates/glossary citations, the shelf card, the public shelf,
the masthead, Metadata, library search, add-article, profile, `document.title`, the server
`<title>`/`og:title`, and export. Every one is a React text node, an attribute, or `escapeHtml`.
None goes through `innerHTML`. So this is not an XSS hole. The problem is that a string that is
really HTML-ish arrives, and nothing decides it is plain text.

**The class:** *an outside string's format is never decided at the boundary*. Each ingest point
normalises whitespace at most (`tidy`, `text()`, `.trim()`), and nothing says "this is HTML-ish,
make it text". There is no shared helper to forget, which is why it was forgotten everywhere.

## The rule, and its one home

> A title that came from outside us is stored as plain text: inline markup removed, entities
> decoded, whitespace and control characters normalised.

**One function, `plainTitle(value)`, in `src/html.ts`.** That file is already the pure leaf both
sides import, and it already holds `normaliseText`. The steps, in this order:

1. **Decode entities once.** Numeric (`&#233;`, `&#xE9;`) and a modest named table (`amp lt gt quot
   apos nbsp ndash mdash lsquo rsquo ldquo rdquo hellip times minus`, plus a few more). An unknown
   named entity is left as written, not guessed. An invalid code point (0, surrogates, >0x10FFFF)
   is also left as written.
2. **Remove known inline-markup tags.** This is an **allowlist of tag names**, not "anything
   tag-shaped", so `x<y and y>z` survives. The list: HTML inline (`i b em strong u s sub sup small
   big span font sc scp tt code cite q dfn var mark abbr a br wbr`), MathML (`math mi mo mn ms
   mtext mrow msub msup msubsup mfrac msqrt mroot mover munder munderover mstyle mspace semantics
   mfenced mpadded mphantom menclose`), and JATS (`italic bold underline monospace
   inline-formula alternatives`). A namespace prefix (`mml:`, `jats:`, `m:`) is ignored when
   matching. Tags are removed, not replaced with a space, so `H<sub>2</sub>O` becomes `H2O`. The
   exceptions: `<br>` becomes a space, and `annotation`, `annotation-xml` and `tex-math` go **with
   their content**, because that content is a second copy of the maths in TeX.
3. **`normaliseText`.** This runs after decoding on purpose, so `&#x202E;` cannot smuggle in a bidi
   override that step 1 produced.

Decoding before stripping means a title encoded once (`&lt;i&gt;`) or already decoded (`<i>`) ends
up the same. A title about the `<b>` tag loses the word. That is rare, and it is the price.

**Applied where each outside title is constructed, not at twenty render sites** (revised after
the plan review; see below):

| Seam | Covers |
|---|---|
| `collectAnnotated` in src/openrouter-stream.ts, once for both collectors | every web-search title: Debate, chat, explain, the Referee Criteria "consulted" pool, referee candidates, citation finds |
| `readCitations` in src/referee-criteria.ts | Referee Criteria's cited sources, which come from the model's JSON rather than from the annotations |
| `runExtract` in src/extract.ts, **before** the title branches | the HTML article title in `meta.title`, the extracted page's `<h1>` (which stage 3 makes a block) and the job's title |
| `runPdfExtract` in src/pdf-read.ts, after `plainMaths` | the same three for a PDF |
| `metaColumns` in src/store/artifacts-pg.ts | a **backstop**: the column stays plain even if a future producer forgets |
| `extractPreview` in src/link-previews.ts | link-preview hover-card titles |
| `readDraft` in src/citations.ts (reached through the exported `toDrafts`) | the model's reading of a cited work's title, which copies whatever the article's text had |

`articles.titleOverride` is **not** touched. It is the owner's own typing, so it is not an outside
string.

## Existing rows: a backfill Greg runs

`scripts/backfill-plain-titles.ts` **reports by default and writes only with `--write`**. It prints
its `Target:` line first. It rewrites:

- `jobs.title`, `citation_finds.title` and `link_previews.title`
- every `title` key inside `article_revisions.debate` and `article_revisions.citations`,
  `chat_messages.citations`, `comments.citations`, `glossary_lookups.citations` and
  `referee_criteria.results`

Each write is a compare-and-swap against the value it read, so a row written in between is left
alone and counted. It prints every change as before and after.

**Article titles are listed, never written.** An HTML article's title is also in its extracted
`<h1>`, in a heading block and in the stamped HTML. Patching only the column would leave those
disagreeing with it, so the script lists the slugs to re-extract. Re-extracting moves the title, the
blocks and the source hash together. It also re-runs the steps whose prompt quoted the old title,
which is correct because that prompt changed.

**Locally:** the dry run finds the five Debate rows and nothing else, and I ran `--write` against
local only. **Production is Greg's to run.**

## What the plan review changed

GPT Sol reviewed the plan (read-only) and found no XSS issue. Every sink escapes or draws text, and
the helper's comment now says it is **not** a sanitiser. It did find six things, all taken:

- **Clean the article title in the producers.** Cleaning only at `metaColumns` was too late: the raw
  title had already gone into the `<h1>` and the job title.
- **Compare-and-swap in the backfill, and keep an empty title empty rather than null.**
- **Add Referee Criteria's `readCitations`,** a missed seam.
- **List article titles for re-extraction rather than rewriting them.**
- **Bound the strip loop and add adversarial tests.**
- **Narrow the idempotence and entity claims.** The named-entity table is short on purpose, and a
  doubly-encoded title changes on a second call.

## Options passed over

- **Render-time: a `<TitleText>` component, or `plainTitle` at each sink.** This is the "simpler"
  option in lines changed per surface, and it needs no backfill. I passed it over because the class
  *is* "a boundary some sites skip": twenty sinks means twenty chances, and the non-React ones (the
  tab, `og:title`, export, and every prompt that quotes a title to a model) would each need their
  own call. A handful of constructors is a smaller set to keep right, and the stored data becomes true.
- **Keep the italics: store a sanitised inline-HTML form beside the plain text, and render it
  through DOMPurify with an `i/em/sub/sup` allowlist.** That would be prettier for species names and
  formulas. But it opens a new `innerHTML` sink for strangers' strings, needs a second field on
  every title-carrying type, and has to fall back to plain text in the tab and in tooltips anyway.
  It is not worth it for a cosmetic gain. Plain text first. If Greg wants italics later, this is the
  route, and the plain form stays the fallback.

## Tests (written first, watched red)

`tests/plain-title.test.ts`:

- **The unit:** the APS title, `jats:italic`, MathML with an `annotation`, `H<sub>2</sub>O`, `&amp;`,
  numeric entities, `x<y and y>z` unchanged, an unknown entity left alone, a bidi override via
  `&#x202E;` dropped, and idempotence on plain input.
- **Every seam, fed the APS title:** `collectSearchEvidence`, `collectCitations`, `extractPreview`,
  `toDrafts`, and `metaColumns` (exported for the test), each checked through the function the seam
  exports. Each one returns plain text.

## Browser check

Before the fix: the Debate row and the Debate card on `cargocult-spya-rz663q` show a literal `<i>`.
After the fix and a local backfill, both show `Physics - Landmarks—Millikan…`. Screenshots go
beside this plan.
