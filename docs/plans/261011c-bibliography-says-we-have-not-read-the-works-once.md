# 261011c — Bibliography says once that we have not read the works

Up: [plans.md](../project/plans.md) · report spya-rbp55k (#547, SPIDERYARN-READING2-GW) · queue item
`qi-9xmpffas` · the line it changes is [bibliography.md § What we have read of the work](../project/bibliography.md#what-we-have-read-of-the-work)

**Status: built, on `dev`. Part 2's last two places (Summary's paragraph; Quotes, Timeline, FAQ) stay queued.**

## What Greg asked for

> In bibliography mode, it warms "we have not read this work, just the piece that cites it" over
> and over and over again. It doesn't really add much. Since we've got rid of the vacuous summary
> phrase, so maybe we can get rid of that warming as well.
>
> I think in a previous feedback report, I'd requested that if I click Ask in Chat and get a nice
> response, that that should auto-generate a short summary that shows up in the citation entry, and
> that that should be true for anywhere where we offer Ask in Chat.
>
> — Greg, 2026-10-10 (spya-rbp55k), filed on build 29220e7d

## Part 2 is already built

The earlier report is spya-pdpnjf, plan
[261010s](261010s-ask-in-chat-resumes-its-thread-and-becomes-an-icon.md). Its D4 shows the chat's
**gist** in the cited work's row, in the button's place: one line a small model already writes
after each finished answer (`chat_threads.gist`), so no new call and no new cost. That landed in
`a350ae8eb` on 2026-10-10 at 18:25, ten hours **after** this report was filed on `29220e7d`, and is
in production (an ancestor of `origin/main`). It covers Glossary, Bibliography, Ideas and both
Claims lists.

**Two places it did not reach, built here** (GPT Sol's plan review, P1 and P2): Reception's
*Your angles* drew the reader's words and a count, never the gist; and a comment that started a
chat (its *Ask in chat* box) offered *Open the conversation this started* and nothing about what
was said there. Both now show the gist under what is already there, from the summary list they
already read: `rcp-angle-gist` in `ReceptionAndClaimsPanel.tsx` § `Angles`, and `threadGist` on
`CommentDialog`. No new model call: it is the same line.

Glossary's *Ask in chat* after a free-term lookup found nothing has no entry to put a summary on,
and is left out on purpose.

What is left of "anywhere where we offer Ask in Chat", each already a queue item:

- **Summary's paragraph button**: stores no origin, so nothing on the paragraph can show the
  chat. `qi-vj7p4sbh` was waiting on whether Greg wants a way back at all; this report says he does,
  and the item gets that line.
- **Quotes, Timeline, FAQ**: no Ask in chat yet. `qi-bd6h2fnd`. When it is built, the mark (and so
  the gist) comes with it, since the mark is part of the pattern
  ([chat-from-a-mode.md](../project/chat-from-a-mode.md)).

Both need a migration on the same `chat_threads_origin_*` CHECKs that `qi-mzfxw3q2` narrows, which
is why 261010s kept them apart. Not built here.

## Part 1 — the change

Today every row and every cited-work hover card says *We have not read this work, only the article
that cites it.* (`CITE_NOT_READ`, from `readNoteOf` in `BibliographyPanel.tsx`). It was added
(260929g) because a row then carried `why`, the model's sentence about what the article uses the
work for, and without the line `why` read as a description of the paper. Since 261003j `why` is
drawn only beside a lookup's verdict or a kept *Dig deeper* answer, and those rows carry their own,
different read line. So on a plain row the line now qualifies nothing: it sits under a title and an
author.

- **`readNoteOf` returns `string | null`**; `null` is "nothing has been read", the case that drew
  `CITE_NOT_READ`. The row and the hover card draw nothing for `null`. Every other line is kept: a
  page found by search (`CITE_PAGE_FOUND`), a lookup's extract, the paper read by *Dig deeper*. Those
  say something different from row to row, and they stand beside words that are about the work.
- **Said once, above the list**: *Unless a row says otherwise, we have read none of these works,
  only the article that cites them.* A quiet line (`gloss-quiet`) under the order row and the
  threshold, only when a visible row relies on that default. It is absent when the threshold hides
  every row, or every visible row carries its own more-specific line. Visitors see it too.
- **The hover card says nothing in that case.** It opens one work from the prose, and the provenance
  it does carry is the entry's own line (*copied from the article, not from the work*) when there is
  an entry. A card has no list to say it once above. The simpler option passed over is keeping the
  line on the card only; it is the same sentence Greg called noise, one card at a time.

Each caller tests for `null` explicitly (React would render a `null` child as an empty `<p>`
without complaint, Sol's P3), and the card drops its whole `prose-card-part-why` when neither `why`
nor a read line is drawn, so a plain card has no empty part with a margin.

The Help page's Sources copy says the same (`src/web/help/pages/modes/sources.md`), and its
Bibliography screenshot, which showed the line on every row, is retaken (Sol's P4).

## Tests

Red first, in `tests/bibliography-panel.test.tsx`: a row nobody looked up has no `.cite-read`, and
the band has the once-line exactly once; a row with a lookup or a found page still has its line.
`tests/citation-hover-card.test.tsx`: the card for an unread work draws no read line.
`tests/public-network-trace.test.tsx`: the visitor's band still says, once, that we have not read
the works. The panel suite also covers loading, stale and empty states, an all-hidden threshold,
and a list whose every row has its own line.

## Review

GPT Sol on this plan (read-only), and on the code.

## Log

- **Plan review** (GPT Sol, read-only): part 1 safe as planned, including the hover card. P1, P2:
  Reception's angles and a comment's chat did not show the gist, so the part-2 claim was overstated:
  built here. P3: `string | null` does not force a check in JSX, and the card's wrapper would be
  left empty: both handled, and a test for the wrapper. P4: the Help copy and screenshot: updated.
- **Code review** (Codex, fixes applied): C1: the list-wide line was still drawn when the threshold
  hid every row or every visible row had its own line; it now follows visible rows that need the
  default, with state tests. C2: an angle's `aria-label` hid its gist from assistive technology;
  the gist is now its description and the tooltip identifies the AI summary. C3: the shared
  two-line gist clamp lacked `overflow: hidden`; added and pinned. C4: current CSS comments and the
  260929 feedback record still stated the old per-row behaviour; corrected with history preserved.
- **Browser** (Sonnet subagent, Playwright on the box, `scaling-hypothesis`, 1440×900 and 390px):
  the line once above the list, none on plain rows, a looked-up row keeps its own; no read line
  and no empty part on an unread work's hover card (`261011c-shot-1`); no console errors. The
  gist on angles and comments was **not** seen in a browser: no local chat of either kind has a
  gist yet, so those rest on their unit tests. Help's `mode-bibliography.png` retaken.
