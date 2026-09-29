# Outside titles stored with their markup, because safe was taken for correct

Greg, via the Overseer, 2026-09-29. Session fb56 saw a Debate source drawn as
`Physics - <i>Landmarks</i>—Millikan Measures the Electron's Charge`, with the tags showing. The
problem was cosmetic. Nothing unsafe reached a reader: every surface that draws a title escapes it
or treats it as text, which is exactly why the tags were visible. The fix is
[260929e](../plans/260929e-outside-titles-become-plain-text-at-ingest.md).

## What happened

OpenRouter's web search returns each page it cites as a `url_citation`, whose `title` is the page's
own title. That title is HTML-ish text: APS writes `<i>Landmarks</i>` into it. `collectAnnotated`
([src/openrouter-stream.ts](../../src/openrouter-stream.ts)) copied it verbatim, and Debate stored
it in `article_revisions.debate`. Locally, 5 of 75 stored Debate source titles were that one page,
on five revisions of `cargocult-spya-rz663q`. The browser showed it literally in the Debate row and
in the source card ([before](../plans/260929e-shot-before-debate-row.png)).

The same gap was open on every other road a title comes in by:

- the article's own title, where Readability decodes `&lt;i&gt;` into literal tags;
- a PDF's `Info.Title`;
- a link preview's `og:title`;
- a cited work's title, which the model copies off the page;
- Referee Criteria's sources.

None of those showed markup in the local data, so the problem was only visible on the Debate row.

**Introduced:** 3060972a (2026-08-25, *Ask the model to explain a passage you select*), the first
code to store a search result's title: `...(c.title ? { title: c.title } : {})`. Chat (3a99eb04),
the shared collector (984464e8) and Debate (39701ce7, 2026-09-05) inherited it. Each of those
commits was careful about the URL next to the title (`isWebUrl`, *"refused here rather than guarded
at the point of render"*). None of them said anything about the title.

## The class: a string from outside whose format nobody decided

**When a string crosses in from outside, somebody has to decide what format it is in: plain text,
HTML, or TeX. Otherwise every consumer silently assumes plain text.** In a React app that assumption
is safe, because React escapes whatever it is given. But safe is not the same as correct. The markup
is harmless *and shown*, and no check in the pipeline treats "harmless" as a failure.

The same shape recurs one field over. The `url` beside this `title` had its format decided at the
boundary on day one. And `plainMaths` ([src/pdf-tex.ts](../../src/pdf-tex.ts)) decides that a PDF
title is not TeX, but only for PDFs and only for TeX. Each boundary decided the format question it
had already been bitten by, and no more.

## Why nothing went red

- **Every test fixture was already plain.** `collect-citations.test.ts` used `"A page"`,
  `link-preview-extract.test.ts` used `"A Paper"`, and the extract tests used `"A Title"`. A test
  written with clean data cannot notice that the data is never cleaned. This is the check sharing
  the code's assumption, from [silent-success.md](../reusable/silent-success.md).
- **The attention at this boundary went to what can hurt.** The collector's comments cover the
  discriminator, the dedupe and the URL scheme, and every one of those is about safety. A title in
  a React text node cannot hurt anyone, so it never came up. Nobody asked "will this look right?"
- **Real data rarely has it.** Five rows out of hundreds locally, all from one site. It needed a
  human looking at a Debate panel that happened to cite APS.

## What would have caught it, ranked by ease against value

1. **Put markup in the fixtures for any outside string.** `tests/plain-title.test.ts` feeds the APS
   title through every seam an outside title enters by. A new seam added without `plainTitle` goes
   red once somebody adds it to that list. Done.
2. **One function that states the rule, called where the title is constructed.** `plainTitle`
   ([src/html.ts](../../src/html.ts)), with `metaColumns` as a backstop for article titles. Its
   comment says it is not a sanitiser, so nobody reaches for it as one. Done.
3. **When you guard one field of an outside record, ask the same question of its neighbours.** The
   `url` got a boundary and the `title` beside it got none. That habit costs nothing, and it would
   have caught this bug on 2026-08-25.
4. **A branded `PlainText` type on every stored title.** Rejected for now. It would touch about
   twenty types and every producer to stop a cosmetic bug, and the seam test covers the same ground
   more cheaply. Revisit if a second format bug arrives on a field the test does not list.
5. **Strip at render, with a `<TitleText>` component at every sink.** Rejected. There are about
   twenty sinks, several of them not React (the tab, `og:title`, export, and prompts that quote a
   title to a model). Twenty call sites is the class itself, not a fix for it. The plan says more.

## The fix that is right for the long term

What shipped is the long-term shape: decide the format once, where the string is constructed, and
store the result. The one remaining choice is **italics**. A species name or a formula reads better
italicised. That would mean storing a sanitised inline form beside the plain one and rendering it
through DOMPurify with an `i/em/sub/sup` allowlist. That opens a new `innerHTML` sink for strangers'
strings, so it waits until Greg asks for it. When he does, the plain form stays as the fallback for
the tab and tooltips.

## The thing I would tell myself

The code already had a sentence for this: *"refused here rather than guarded at the point of
render, because this is where model output stops being a string and starts being stored."* It was
written about the URL, one line away from the title. The rule was right, and it was applied to the
one field that had caused trouble so far. When a boundary decides something about a field, the
fields next to it deserve the same question before they are stored.
