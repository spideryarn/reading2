# Why you're reading, higher in Metadata; the publication date in the masthead

Two suggestions from Greg (admin: `feedback-reporter.ts` exits 0 on both), 2026-10-15, on
`mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb`, build f84dc434.

> Move "Why you're reading" further up in Metadata
>
> — Greg, 2026-10-15 (`spya-ejzr4b`, SPIDERYARN-READING2-J3)

> Please include the publication date at the top of the article along with the other metadata
>
> And maybe hide some of the less-likely-to-be-useful metadata behind a default-collapsed section
>
> — Greg, 2026-10-15 (`spya-u7yfns`, SPIDERYARN-READING2-J4)

Prior work: the date and journal reached the Metadata page in
[261004a](261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md) and a
visitor's in [261004h](261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md);
the purpose box was first asked for in
[260930e](260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md). Design calls below
were weighed with Opus.

## 1. Metadata: *Why you're reading* as its own section, under *In one sentence*

Today the purpose box is the first card inside *Your reading*, sixth section down, under At a
glance, the PDF reading note and Access & sharing.

- **A section of its own, `Why you're reading`, directly after `In one sentence`.** It holds the
  purpose box and the read-only *About you* beside it (the comment there says a reader needs both
  answers side by side, so they move together).
- **Not above *In one sentence*.** That sits under the title by Greg's own request (2026-09-03,
  *"everything above it was furniture in front of the answer"*).
- **Not the whole of *Your reading*.** Comments and Where you left off were not asked about, and
  the test "sharing above the reader's own notes" stays true.
- Its keywords (`purpose reason goal why intent`) move with it so the page search finds it.
- Rejected, simpler: leave it in *Your reading* and move that section up. It drags Comments and
  Where you left off above Authors and At a glance for no reason.

## 2. Masthead: journal and date in the facts line; the counts behind *Show counts*

The facts line today: byline · site · N words · ~M min · P parts · S sections · [Fold all] ·
[Show authors and details].

After:

```
Ada Lovelace, Bob Smith · Nature Reviews Neuroscience · PubMed Central · Published 31 May 2024 · ~14 min
  [Show counts] [Fold all] [Show authors and details]
                ↓ pressed
… · ~14 min · 3,210 words · 4 parts · 12 sections  [Hide counts] [Fold all] …
```

- **Byline, journal, site, date**, the order the Metadata page and the visitor's Metadata page
  already print them (journal left out when the site already says it, `journalBesideSite`), with
  the word *Published* (a bare `2011` beside a word count reads as a number, not a date). UI face:
  facts about the piece are UI (fonts.md).
- **One helper for "when was it published" across the three pages.** An owner's meta has
  `publishedAt`; a visitor's is a `PublicMeta` with `published`, the day only. The masthead serves
  both, so `publishedLabel(meta)` in relative-time.ts reads either; the Metadata page and the
  visitor's page call it too, so the three cannot drift.
- **Shut by default: words, parts and sections.** A reader deciding whether to read gets nothing
  from the part and section counts; the word count is what the read-time card is built from, and the
  card stays. All three are still on Metadata's At a glance.
- **Kept visible:** the byline, journal, site, date, read time; Fold all and Show authors and
  details (controls, not facts); the PDF transcription note (a trust signal the reader is owed
  before trusting a sentence); the origin line; the gist.
- **The control is a text button like its two neighbours** (`.front-matter-toggle`'s style,
  `aria-expanded`, a `ControlTip`), per controls.md. Named *Show counts / Hide counts* so it cannot
  be mistaken for *Show authors and details* beside it. Placed first of the three buttons, next to
  the facts it reveals.
- **Not remembered.** It starts shut on every load, like the authors block. Remembering it would
  be new state for a cosmetic choice; add it if Greg asks.
- Rejected, simpler: delete parts and sections from the line and keep the word count, with no new
  control. GPT Sol argued for it, and it is a fair reading of Greg's *"maybe"*. Built the
  disclosure anyway, because the request names a default-collapsed section and the brief for this
  run asked which metadata goes behind one. Undoing it is one line if Greg prefers the cut.
- **No `aria-controls`** (Sol's finding 4). The counts are inline facts on the line rather than a
  region, so there is no element to point at without wrapping them, which would break the line's
  `.facts > span + span` separators. The button carries `aria-expanded`, as its neighbour
  `FrontMatterButton` does.

## Tests

- `tests/metadata-page-order.test.tsx`: *Why you're reading* is second, right after *In one
  sentence*, and the purpose box is inside it. `tests/metadata-contents-reveal.test.tsx`: *purpose*
  and *intent* find it on the real page, and *resume* still finds *Your reading*.
  `tests/page-search.test.ts`'s copied inventory follows.
- `tests/masthead-published-and-counts.test.tsx`: the facts line runs journal, site, date, read
  time, in that order, for an owner (`publishedAt`); a visitor's `published` and `publishedYear`
  print; a journal equal to the site prints once; words, parts and sections appear only after
  *Show counts*, and `aria-expanded` follows.
- `tests/masthead-facts-wrap-in-chrome.test.tsx`: the fixture gained a journal and a date, so the
  line shown on arrival is still long enough to prove the phone-wrap rule.
- The visitor's Metadata page passes `publishedLabel` its own two fields by name, so
  `metadata-origin.test.tsx`'s "never reads the owner's `publishedAt`" holds.

Plan review: [GPT Sol](261015c-why-you-are-reading-higher-in-metadata-and-the-publication-date-in-the-masthead-plan-review-sol.md),
approve with changes. Findings 1 and 3 taken; 2 and 4 answered above.

## Not doing

- No persisted open/shut state. No change to the visitor's Metadata page beyond the shared helper.
