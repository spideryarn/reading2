# Citations: no by-line that repeats the title, and a flash you can see

Two admin suggestions about Citations mode, batched as Overseer queue item `qi-ye7ytftw`
(SPIDERYARN-READING2-7W, report `spya-ac5msa`; SPIDERYARN-READING2-7X, report `spya-e2yzkf`).
Owning doc: [citations.md](../project/citations.md); the flash is
[`src/web/flash.ts`](../../src/web/flash.ts) and `prose.css` § the flash on arrival.

> In the new version of Citations mode, it sometimes shows the same thing twice, e.g.
> `Bartlett (1932)` / `Bartlett · 1932`. This isn't always the case. Perhaps it depends on how it's
> cited in the text. So sometimes the bottom differs from the top line. If they're the same, don't
> show the bottom line?
>
> — Greg, 2026-10-01 (7W)

> In Citations mode, if I click the "first cited" it scrolls to that block and flashes the exact
> text that cites - great. But it's a little bit too subtle and quick, so I often don't quite spot
> the flash.
>
> — Greg, 2026-10-01 (7X)

## Why it happens

**7W.** When the article gives only an author–year label for a work (gwern's `Santoro et al 2016`,
a psychology paper's `Bartlett (1932)`), that label *is* the row's title — `authorYearLabel` in
`src/paper-evidence.ts` already names the case. The row then draws the title and, under it, the
by-line `authors · year` (`byLineOf`), which is the same words with different punctuation. When the
article has a real title, the two lines differ and both are wanted.

**7X.** The *first cited* jump washes the citing words' `mark.cite` fragments
(`passage-flash`): `--highlight-wash` (orange at 20% over the page) for 1.2 s, holding full for the
first 35%. On a few words, rather than a whole paragraph, that is a small, pale patch for about
0.4 s — and the reader's eye is still arriving from the scroll.

## What we build

### Stage 1 — the by-line hides when it says what the title says (7W)

- `byLineRepeatsTitle(title, by)` in `CitationsPanel.tsx`: both folded to lower case, diacritics
  stripped, `&` read as `and`, `et al.` / `et al` the same, and everything but letters and digits
  dropped — then compared word for word. `Bartlett (1932)` ≡ `Bartlett · 1932`;
  `Santoro et al 2016` ≡ `Santoro et al. · 2016`; `Smith & Jones (2001)` ≡ `Smith and Jones · 2001`.
  Anything else counts as different and both lines show — the safe direction, since a hidden line
  that said something new is a loss and a shown duplicate is only clutter.
- **Never hidden when the registry filled a field** (`workByLine(...).filled`): then the line carries
  the visible *from Crossref* mark, which must stay (plan 261001a stage 5). In practice the title
  would not match anyway, but the rule should not depend on that.
- **What the by-line's hover card said is not lost.** That card carries the authors unshortened and
  the article's reference-list entry (SPIDERYARN-READING2-6K) — for an author–year work the entry is
  often the only place the real title is. When the line is hidden, the same card opens from the
  title instead. When the title is a link, the link's native `title` attribute is dropped (two
  popups on one hover is worse than one) and the card gains its line: *opens host in a new tab —
  how we got the link*. One content component, `ByLineCard`, used by both triggers, so the two
  cannot drift.
- Tests, red first: the comparison (the three equalities above, and `Bartlett (1932)` vs
  `Bartlett · 1933`, `Memory (1932)` vs `Bartlett · 1932`, an empty by-line); a row render with a
  label title draws no `.cite-by`; a row with a real title still draws it; a filled row still
  draws it.

### Stage 2 — the flash: longer, stronger on words, and one length (7X)

- **Longer, for every flash**: `FLASH_MS` 1200 → 2400, the wash held at full for the first half
  rather than 35%. The brief says the machinery is shared (block links, search hits, Trajectory, and
  every other `beginJump`) and to change it in one place; a flash that is
  too quick to notice on words is also on the short side on a paragraph, and one length keeps the
  rule simple. This supersedes Greg's 2026-09-28 *"a second or so"* with his 2026-10-01 words.
- **Stronger, on words only**: the passage flash (`mark.cite` and Trajectory's `mark.hit`) uses a
  new `--flash-wash-strong` token — the orange at about 45% over the page, mixed in oklab like
  `--highlight-wash` — and pulses once (full, dip, full, hold, fade) so motion catches the eye.
  The paragraph wash keeps `--highlight-wash`: a whole cell at 45% would be loud, and its area is
  what makes it visible already.
- **One length, checked.** The CSS durations are written as literals today and kept equal to
  `FLASH_MS` by a comment. They become `var(--flash-ms)`, set once in `tokens.css`, and a test reads
  that token and asserts it equals `FLASH_MS` — so the two can no longer drift silently. Existing
  tests that match `1.2s` move to the token.
- Reduced motion: unchanged in kind — the still wash, held for `FLASH_MS`, now the strong token on
  words.
- Tests, red first: the token equals `FLASH_MS`; each flash rule uses `var(--flash-ms)`; the
  passage keyframes use `--flash-wash-strong`; a passage flash is still on at 2399 ms and gone
  at 2400.

### Stage 3 — browser check, docs, note

Playwright against system Chrome, desktop and 390 px: a citations card with an author–year title
shows one line and its card opens on the title; a titled card shows both; *first cited* scrolls and
the words visibly pulse (screenshots at ~200 ms and ~1.5 s). `citations.md` gets a line on the
hidden by-line; the flash's own comment block carries the new numbers.

## The simpler option passed over

**Just hide the line** and lose its hover card on author–year rows. Rejected because for exactly
those rows the reference-list entry in that card is where the work's real title lives; dropping it
would trade one line of clutter for the only pointer to what was cited.

**Change only the citation flash** (a separate, longer class for `mark.cite`). Rejected: the brief
asks for one place, and a second length is a second rule to keep in step. If Greg wants paragraph
jumps kept at about a second, it is one token to split later.

## Deferred

- Whether *any* by-line that is a subset of the title (title `Bartlett (1932) Remembering`) should
  also hide — not asked for; a different-looking line shows.
- Metadata's TOC flash (7Y) is queued separately. If its jump goes through `beginJump` it gets the
  longer length for free; whether it also wants the stronger colour is that report's to decide.

## Review log

**Plan review, GPT Sol** ([261001m-plan-review-sol.md](261001m-plan-review-sol.md)), three findings,
all taken; they change the plan above as follows, and the code is built to this section where the
two differ.

1. *P1 — the folding hid different authors.* Dropping every non-letter made `Smith-Jones (2001)`
   equal `Smith, Jones · 2001`. Now only the known presentation differences fold — case, accents,
   brackets, the middle dot, a comma before the year, `&`/`and`, the stop in `et al.` — and hyphens,
   apostrophes and name commas stay. Both counterexamples are negative tests.
2. *P1 — a card on a linked title was out of reach on touch and described the wrong element.* The
   link itself is now the trigger, `aria-describedby` names the entry text, and a finger gets
   reveal-then-commit (`useTapReveal`): the first tap opens the card (*Tap again to open the
   link.*), the second follows it. Tested with a touch press, and the test was seen red without the
   `preventDefault`.
3. *P2 — doubling every flash makes Trajectory, which flashes on every step, a near-continuous
   pulse.* **Stage 2 is scoped to a cited work's words**: `CITE_FLASH_MS` 2400 beside an unchanged
   `FLASH_MS` 1200, and `cite-flash` (strong wash, a dip and return, hold, fade) on `mark.cite`
   only. Paragraphs and Trajectory keep their wash. Both lengths are tokens
   (`--flash-ms`, `--cite-flash-ms`) a test holds equal to the timers, so there is still one place
   to change each. This replaces the "longer, for every flash" bullet above, and means 7Y gets
   nothing for free from this plan.
