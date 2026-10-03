# Sweep clusters 2 and 3: the scan's decoding, and four one-file fixes

Two clusters off the fifth sweep's umbrella
([261003f](261003f-fifth-codebase-sweep-umbrella.md) § The clusters, rows 2 and 3). Five live
defects, each in one file, each fixed red test first. The evidence is in the investigation docs the
umbrella links; this plan says what each fix is, what was re-checked against today's tree
(`aea9f8635`), and what was passed over.

## Stages

One stage per defect, one commit each. Stage 1 is pushed alone and first, because cluster 6a waits
for it.

### 1. `part()` answers 400 for a bad `%` escape (SR-R1)

- **Re-checked:** `src/routes.ts` § `part` is still `return decodeURIComponent(m[group] ?? "")`.
  The only other `decodeURIComponent` in the file is `attributableSlug`, which already catches.
  `tests/authenticated-api-route-contract.test.ts` still pins the 500 in two cases.
- **Fix:** `part` catches the throw and raises `httpError(400, "That is not a path we can read.")`
  — fixed words, nothing interpolated, as `slugFrom` in `src/public/routes.ts` does.
- **Tests (red first):** the pinned case becomes *"…so it is a 400"* with that sentence. The pair
  case can no longer tell the two routes apart by status, so it asserts the two **messages** differ
  (body-first says *"Request body is not valid JSON"*, decode-first says the new sentence). That
  still goes red if the order is swapped, which is what the pair is for.
- **Passed over:** one shared `decodeCapture` for both dispatchers (SR-R8). The umbrella holds it;
  two three-line catches are not yet worth a module.

### 2. The injection scan decodes stored HTML as UTF-8 (XZ-X3) — a defence

- **Re-checked:** `src/source-scan.ts` still calls `decodeHtml(source.bytes, null)`. With no
  transport label and no `<meta charset>` the sniffer answers windows-1252, though
  `storedDocumentBytes` (`src/fetch.ts`) stored the page as UTF-8.
- **One thing the audit asked to be settled, and the answer is not the one it hoped for.** From
  2026-08-25 (`841ed6bd8`) to 2026-08-27 (`37806f1db`) stage 1 wrote the **network bytes** for HTML,
  not the decoded string. So "stored HTML is always UTF-8" is true of everything stored since, and
  not provably of everything.
- **Fix:** decode as UTF-8 **strictly** (`new TextDecoder("utf-8", { fatal: true })`); if the bytes
  are not valid UTF-8, they cannot have come from `storedDocumentBytes`, so fall back to the sniff
  that is there today. That needs no census of old rows, and a legacy windows-1252 page with any
  high byte is almost never valid UTF-8, so it takes the fallback and scans as it does now.
- **Simpler option passed over:** unconditional UTF-8. One line fewer, but a legacy raw page would
  then scan as U+FFFD noise with nothing said — the same silent blindness, moved.
- **Tests (red first), in `tests/source-scan.test.ts`,** current-page cases stored through the real
  `storedDocumentBytes`: (a) the control — zero-width characters and a Unicode-tag payload, with
  `<meta charset="utf-8">`; (b) the same page with **no** meta finds the same; (c) the same page
  with a stale `<meta charset="windows-1252">` finds the same, so "believe the meta when there is
  one" cannot pass; (d) a page that arrived with a broken byte is valid UTF-8 once stored and
  still finds both; (e) raw windows-1252 bytes take the sniff, asserted on the punctuation
  (`0x93` → `“`), which a replacement-character decode cannot produce. (c)–(e) are Sol's PR-1.
- **Docs:** the file's header paragraph that says the sniff "is the same answer for everything in
  the corpus" is false and is rewritten; `security.md` if it repeats the claim.

### 3. The spine card does not repeat a row as a bullet (WC-W1)

- **Re-checked:** `BandCard` in `src/web/Spine.tsx` builds `kids` from `childLabel` and filters only
  blanks. The fixture in `tests/spine-card.test.tsx` has no heading leaf.
- **Fix:** drop a bullet that is a **heading leaf** (`startsAtHeading`) **and** whose text is the
  title of a row on **this band's own path** in `where` (the part and the band), in the same
  filter, before `+ n more` is counted. Both halves are Sol's PR-2 (P1): `where` lists neighbouring
  sections too, so "any row" dropped a real sub-heading called *Methods* beside a part called
  *Methods*; and text alone dropped a paragraph's label that matched the title. Not
  `startsAtHeading` alone, which would drop every real sub-heading.
- **Tests (red first):** a section whose first leaves carry its part's title and its own; neither
  is a bullet, and `+ n more` does not count them. Kept: a real sub-heading, a heading matching a
  neighbouring section and a neighbouring part (both checked to be rows of that card), and a
  paragraph label matching the band's own title.
- **Pending Greg (umbrella, For Greg 1):** whether the bullet list goes altogether. Until he
  answers, the list stays.

### 4. Metadata's contents list follows the scroll margin (XZ-X12)

- **Re-checked:** `REACHED_PX = 100` in `src/web/PageContents.tsx`; `Metadata.tsx` § Section uses
  `scroll-mt-24`, which is 6rem — 120px at a 20px root. Metadata is the only page that mounts
  `PageContents`.
- **Fix:** the threshold is the section's own computed `scroll-margin-top` plus the 4px slack;
  where that cannot be read (jsdom, or no margin set) it is the old 100.
- **Tests (red first):** stubbed rects and computed style, on a **later** section and away from
  the bottom of the document, because the first-entry fallback and the at-the-bottom rule both
  mark an entry without consulting the threshold. Margin 120px: 122px is reached and 125px is
  not, so the slack is pinned from both sides (Sol's PR-3); a second margin; and with no margin
  readable, the old 100.

### 5. AccessSharing's copy button says when it failed (found by Sol)

- **Re-checked:** `CopyLink` returns silently with no clipboard and maps a rejection to
  `copied = false`, which is the idle look.
- **Fix:** three states — idle, copied, failed — as `CopyAnswer` in `ChatPanel.tsx` has. A failure
  shows beside the button in a pre-mounted polite live region, and says the link can be selected
  and copied by hand. The sentence goes in `src/messages.ts` beside `SHARING_COPY_TIP`, which is
  one file outside the cluster's list and is where reader-facing words live.
- **Tests (red first), Sol's PR-4:** no clipboard object, and a clipboard that rejects, are two
  paths and each gets a case — the live region beside the button says it failed, and the
  by-hand guidance is on screen; and a copy that works puts the exact link on the clipboard.
- **Passed over:** a shared copy-button hook. That is cluster 20, which names this cluster as a
  predecessor.

## Done

Each red test seen red, then green; `npm test` and `npm run typecheck`; GPT Sol on this plan and on
the code; the umbrella's two rows updated with the commits.

## Review status

**Plan — GPT Sol, 2026-10-03, REVISE**
([the review](261003g-sweep-clusters-2-and-3-plan-review-sol.md)). One P1 and three P2s, all
accepted and all written into the stages above:

| | | |
|---|---|---|
| PR-1 | P2 | stage 2's tests could pass an implementation that believes a stored `<meta charset>` — three cases added |
| PR-2 | P1 | stage 3's "any row" predicate drops real bullets — narrowed to heading leaves on the band's own path |
| PR-3 | P2 | stage 4's test did not pin the 4px slack — both sides asserted |
| PR-4 | P2 | stage 5 named no tests — both failure paths and the success named |

Stages 1 and 2 came back correct as planned. Sol also reproduced that a hostile page cannot force
stage 2's fallback through today's fetch or upload paths: both normalise to valid UTF-8 before
storing. Whether any pre-2026-08-27 raw row survives was not established, which is why the fallback
stays.

**Code — GPT Sol, 2026-10-03, SHIP**
([the review](261003g-sweep-clusters-2-and-3-code-review-sol.md)), write-capable over
`3c6ab877f..de9fbbdb0`. No runtime change. Three P2s, all in the tests and all fixed by it: a
`part()` that caught only a bare `%` passed (CR-1); reading every margin off the first section
passed (CR-2); a live region mounted only with a result passed (CR-3). Three P3 prose fixes. Twelve
mutations, three of which survived until those tests were strengthened. One finding outside the
stage, reported and not fixed: `security-map.md` lists five untrusted parties, calls them four, and
then calls the signed-in reader the fifth (CR-7).

**Browser — a Sonnet subagent, Playwright on the box, 2026-10-03.** Spine: 19 cards on one article,
no bullet repeating a row, bullets and `+ n more` still there. Contents list: at a 20px root font
the computed margin reads `120px` and the clicked section is the one marked. Copy: with the
clipboard removed, the red line appears under the link. Two things it saw at the ends of the
contents list (nothing marked at scroll 0 on one walk; *Export* marked near the foot) are the
first-entry and at-the-bottom rules, which this change does not touch, and were not chased.

## What landed

All five, on `dev`, 2026-10-03:

| Stage | Commit |
|---|---|
| 1. `part()` answers 400 | `3c6ab877f` (pushed first, alone, for cluster 6a) |
| 2. The scan reads stored HTML as UTF-8 | `be1d4fd5a` |
| 3. The spine card does not repeat a row | `a93af4623` |
| 4. The contents list follows the scroll margin | `848a32084` |
| 5. The copy button says when it failed | `de9fbbdb0` |
| Sol's code-review fixes (tests and prose) | `f09897985` |

Two files outside the cluster's list were touched, each for one small hunk: `src/messages.ts` (the
failure sentence) and `src/web/Metadata.tsx` (a comment the stage 4 change had made false).

**Not done, on purpose:** whether the spine card's bullet list goes altogether is still Greg's
(umbrella, For Greg 1). Whether any pre-2026-08-27 raw HTML row survives in production was not
counted; stage 2's fallback makes the answer not matter.
