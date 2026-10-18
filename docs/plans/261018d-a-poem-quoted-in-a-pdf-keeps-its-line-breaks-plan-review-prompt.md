You are reviewing a plan (read-only). Repo: Spideryarn, an AI-assisted reading app.

Read docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md, then the code it touches:
src/pdf-read.ts (`renderHtml`, `withMarkers`, `ELEMENT`, the continuation join), src/blocks.ts
(`extractText`, `BOUNDARY_TAGS`, `codeText`), src/source-hash.ts (`hashBlocks`), and anything
downstream that reads a PDF article's block `html` (the reading view, maths rendering — find where
TeX in `\(…\)` is turned into maths, and whether a `<br>` or a `\n` inside a block can upset it —
search, quote matching, export, sanitising).

Questions:
1. Is the diagnosis right — the newlines are stored, and only rendering collapses them?
2. Is the verse test sound, and is "errs towards today's behaviour" really true? Name concrete
   quote shapes that would be called verse wrongly and so get a new, visible regression.
3. Will a `<br>` in a blockquote's html change any block's `text`, id, `hashBlocks`, or any cached
   artefact? Anything else that parses block html and would treat a `<br>` badly?
4. Is joining a quote's page-continuation with `\n` instead of a space safe (offsets of `pieces`,
   note markers, seam hyphen mending)?
5. Anything simpler that is as good?

Write findings numbered F1…, each with severity (high/medium/low), evidence (file:line), and a
recommendation. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REJECT.
