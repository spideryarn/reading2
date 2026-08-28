# Footnotes in Spideryarn — design consultation (pre-plan)

You are reviewing a **design question**, not built code. Nothing has been written yet. I want your
judgement on how footnotes should be represented, end to end, in this app.

Repo: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Read `CLAUDE.md` first, then
`docs/project/architecture.md`, `docs/project/block-ids.md`,
`docs/project/granularity-zoom.md`, `docs/project/links.md`, `docs/project/content-extraction.md`,
and `src/blocks.ts`, `src/types.ts`, `src/pdf.ts`, `src/pdf-read.ts`,
`src/web/internal-links.ts`.

## What the app is

An AI-assisted reading tool that **augments rather than replaces** reading. The core feature is
**granularity zoom**: the article rendered as a table of rows, one row per block, where you can
compress any span to a one-line gist and expand it back. Every feature — table of contents,
summaries, search hits, comments, chat citations, scroll position — addresses text by a **stable
block id** (`spya-k3m9qt`), never by offset or selector.

## The user's ask, verbatim

> Let's think about footnotes. How should we represent them? Include them in their own section at
> the end, with anchor links in the doc to them (with nice tool-tip previews), and some kind of
> special annotation to indicate that they're footnotes?

## What already exists that bears on this

1. **`Block`** (`src/types.ts`): `{ id, tag, kind, level?, text, words, html, gistable, note? }`.
   `kind` is one of `heading | text | quote | code | media | caption | other`. `gistable: false`
   already means "the ToC must not write a row about this, but it still has an id and can still be
   pointed at" — used today for images, rules, and pull-quotes that repeat body text.
2. **`gistable: false` is load-bearing downstream.** `src/labels.ts` and `src/toc.ts` only label and
   only build tree rows for gistable blocks; `src/article-vectors.ts` skips non-gistable blocks when
   embedding; `src/library-search.ts` skips them. So it is already an established "in the document,
   out of the machinery" switch. It does **not** currently affect `words` / reading time
   (`src/reading-time.ts` sums block words) — check me on that.
3. **In-article anchors already resolve to blocks.** Stage 3 (`src/blocks.ts`, `retargetAnchors`)
   rewrites the author's ids to ours and repoints `href="#..."` at them; `src/web/internal-links.ts`
   resolves a click to a block and hands it to the same scroll machinery everything else uses; an id
   on something *smaller* than a block (explicitly named in that file: "a footnote span") resolves
   to the containing block.
4. **The hover card already previews an in-article anchor**, showing the target paragraph's own
   words trimmed at a word boundary (`docs/project/links.md`, `ProseHoverCard.tsx`). So the
   "tooltip preview" half of the user's ask is close to free *if* a footnote is a normal anchor to a
   normal block.
5. **`BOILERPLATE_LABEL`** in `src/blocks.ts` already matches a standalone heading reading
   `notes` / `references` / `sources` and marks it non-gistable.
6. **Two extractors, one artefact.** A web page goes through Mozilla Readability; a PDF is
   transcribed by a model into typed records (`PdfRecord`, `RecordType`) and rendered to HTML in
   code. Both produce the same `article.html`, and stage 3 onward cannot tell which.
7. **The PDF path already classifies footnotes and then throws them away.** `RecordType` includes
   `footnote`, `reference`, `cover`, `tabledata`; the `RENDERED` set excludes those four. That
   design is deliberate and documented (`src/pdf.ts`): the transcription is scored against the PDF's
   own text layer, so the model must transcribe everything or the check cannot tell a correctly
   dropped footnote from a lost paragraph. **Showing footnotes for PDFs is therefore a change to one
   set, plus a renderer decision.**
8. **PDF records carry no linkage.** A `PdfRecord` is `{ page, type, text, continues, uncertain }`.
   Nothing connects a footnote to the marker in the body, and rule 8 of the transcription prompt
   forbids markup/links. Body-text superscript markers are not reliably preserved at all.

## What is actually in this corpus (measured today, 2026-08-28)

Web articles (3 of them; `data/*/raw.html`): **zero `<sup>` elements, zero real footnotes.** The
word "footnote"/"endnote" appears 3× and 8× in two files, all in markup/CSS noise rather than
content. The only in-article anchors in the corpus are the constitution's 5 section links.

PDF articles (6 transcriptions; counted from `data/*/pdf-chunks/*.json`):

| slug | records | words | `footnote` records | `reference` records / words |
|---|---|---|---|---|
| ball-lightning | 174 | 11,440 | **0** | 64 / 1,329 (12%) |
| coolabah-memory | 60 | 3,392 | **0** | 13 / 252 |
| fowler-phrenology | 87 | 8,782 | **0** | 0 |
| revistes-ub-30977 | 121 | 6,784 | **0** | 26 / 504 |
| source, source-2 | 60/61 | 3,392 | **0** | 13/14 / 252 |

So: **the corpus contains no footnotes at all.** It contains bibliographies (references), and
ball-lightning has 38 author-date inline citations like `(Smith, 2001)` in its prose. Two readings
of that zero are possible and I cannot yet distinguish them: these PDFs genuinely have no notes, or
the transcriber is folding notes into `reference` / `paragraph`. Say which you think, and what
cheap check would tell us.

This means the feature would be built for content we do not yet have — Wikipedia, Substack/Ghost
footnotes, LessWrong, arXiv HTML, academic HTML, anything with `<sup><a href="#fn1">`.

## The candidate design (attack it)

**Representation.** A footnote stays a **normal block with a normal id**, living in a section at the
end of the article, exactly where the source HTML puts it. Not a separate `notes` array, not a
sidecar artefact. Reasons: comments, search hits, chat citations, scroll position and deep links all
already work on blocks and would each need a second code path for a second kind of text.

**Marking it.** Add a `BlockKind` of `"note"` (or a `role` field), set on blocks inside a footnotes
container, and set `gistable: false` so a note gets no nav label, no ToC row, no tree node, no
embedding. The section heading is already caught by `BOILERPLATE_LABEL`.

**The marker in the prose.** Keep the author's own superscript marker, styled as a distinct
affordance; hover gives the existing card, showing the note's text; click jumps to the note block
via the existing `internalTarget` path. Add a back-link from the note to the marker's block.

**PDFs.** Add `footnote` to `RENDERED`, render notes into an end section, and accept that for a PDF
there is **no marker linkage** — a note is reachable by scrolling to the section, not by a jump from
the sentence it belongs to. Possibly out of scope for v1.

## Questions I want answered

1. **Block or sidecar?** Is "a footnote is just a block with `kind: "note"` and `gistable: false`"
   right, or does something in this architecture break under it? Specifically: granularity zoom —
   what does a footnotes section *do* when the reader zooms out? A tree node whose range covers 40
   notes and which has no gist is a hole in the middle of a structure everything else walks. Is the
   right answer "notes are outside the tree entirely", "notes are one collapsed node", or something
   else? See `src/tree-invariants.ts` and `src/validate-tree.ts` for what the tree must satisfy —
   tell me if excluding a contiguous tail of blocks violates an invariant.
2. **Word count and reading time.** A 12%-by-words bibliography or a long notes section inflates
   "~36 min" on the library card. Should `words` exclude notes, or should reading time exclude them
   while `words` stays honest? Where is the seam that both the card and the masthead read?
3. **Is a footnote searchable, citable, commentable?** My instinct is yes to search and comments (a
   substantive note is often the best sentence in a piece), no to being a *summary* source, and
   unclear for chat citations. What would you do?
4. **Citation notes vs substantive notes.** Much of academic footnoting is `Ibid., p. 42` — pure
   apparatus. Some notes are whole arguments. Is a classification step (cheap model call, or a
   heuristic on length / citation shape) worth it, and what would it change downstream? Beware
   recommending a model call where a regex on "does this note contain a verb / more than N words"
   would do.
5. **Where do notes actually live on screen?** Options: (a) at the end, jump-and-return, as on the
   original page; (b) inline-expanded in place, pushing the prose down; (c) in the band that the
   modes share (glossary/summaries/ideas/search take turns there); (d) hover card only, no jump.
   The app's principle is "never substitute generated text for the prose" and its layout is three
   regions — spine, band, prose. Which fits, and what breaks in each?
6. **The `reference` records.** Should a bibliography be treated the same as footnotes, or is it a
   different thing that deserves a different answer? It is 12% of ball-lightning by words.
7. **What is the cheapest thing that is genuinely useful?** If we build one afternoon's worth, what
   is it, and what does it foreclose?
8. **What would make this fail?** Name the failure mode that a careful implementer would not see
   coming — especially anything that would report success while doing nothing, which is this
   project's recurring bug class (`docs/reusable/silent-success.md`).

Be concrete and cite files and line numbers where you can. Disagree with the candidate design where
you think it is wrong; I would rather have the objection than the endorsement.
