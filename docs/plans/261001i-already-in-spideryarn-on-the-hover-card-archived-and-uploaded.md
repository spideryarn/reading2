# "Already in Spideryarn": on the hover card, for archived articles, and for uploads by their DOI

Three follow-ups that [260930b](260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md)
shipped and deferred (its § Deferred), for SPIDERYARN-READING2-5R (`spya-mxntdt`), Greg's:

> In Citations mode, we should also do a check to see if any of the cited-items are already present
> as articles in Spideryarn (on the user's shelf or in public articles), and if so, provide a special
> link to them.

The feedback note is
[260930_1000-citations-link-to-a-work-already-in-spideryarn.md](../user-feedback/260930_1000-citations-link-to-a-work-already-in-spideryarn.md);
it stays **shipped** and gets a line for this.

Checked before starting (2026-10-01): `git log origin/dev --since=2026-09-28`, `docs/plans/` from
260930 on, `docs/user-feedback/`, and `gjd-remote ls`. None of the three was done or in progress;
the one live session on it is this one.

## The one rule, unchanged

**A match may only ever name an article the reader may already open, and only by what they may
already see of it.** 260930b's `where` and its rule about what of a stranger's article is matched
against both stand. Each of the three below is checked against it.

## What we build

(As revised after GPT Sol's plan review, [261001i-plan-review-sol.md](261001i-plan-review-sol.md):
one P1 and five P2/P3, all taken — § Review log.)

### 1. The hover card in the prose (`CiteCard`)

`CiteCard` already reads the same `GET /api/citations` response the band does (`useCitationsRead`),
so the owner's rows already carry `inSpideryarn`. The card draws the band's line — the same
component, `InSpideryarn`, exported from `CitationsPanel.tsx`, so the two surfaces cannot word it
differently — under the by-line.

**Gated by name, not only by the data.** A visitor's band has had a public projection of the list
since 260929c; the card gets no works for a visitor only because `Reader` takes them from the owner's
read. So `ProseHoverCard` takes a `showInSpideryarn` prop, `owner !== null` in `Reader` beside
`canAddToShelf`, as the band has its own; the public DTO's omission stays the server boundary. The
stale *"`POLICY.citations` is owners-only"* comments in `ProseHoverCard`, `Reader` and
`reader-capability.ts` are corrected.

### 2. The reader's own archived articles

An archived article is off every shelf but still opens by direct link for its owner
(`Metadata.tsx`: *"An archived article stays readable by direct link — only the shelf filters"*).
So the `where` becomes

```
(   owner_id = me                                    -- archived or not
 OR (visibility = 'public' AND archived_at IS NULL)  -- listed on the public shelf
) AND readable                                       -- both arms, as before
```

The policy in words: **the reader's own openable articles, or currently listed public ones.** A
stranger's archived public article stays out — not because it would 404 (`publicSlug` checks
visibility only, so it still opens by direct link) but because archiving unlisted it, and a match
would make an intentionally unlisted article discoverable again.

The match carries `archived: true` when it is one, and the line says **In your library · archived**
so the reader is not surprised that the shelf does not show it. Ranking, at equal match strength (§ 3):
own live copy, then own archived copy, then a public one.

### 3. Uploaded PDFs, by the DOI we found for them

An upload has no address, so until now it could only match by title. `upload_source_guesses` holds,
per article, our guess at where the paper lives; a **`canonical`** row's `url` is one we built from a
DOI or arXiv id that was verified against the PDF (`kind = 'canonical'` ⇔ `matched_by in ('doi',
'arxiv')`, a table check). The candidate query left-joins that row and selects its `url` **only for
the reader's own article, only when `status = 'found' and kind = 'canonical'`**, and nulls it in
SQL otherwise.

- **Own only.** The guess is owner-only data: the public projection does not carry `sourceGuess`
  (types.ts § `sourceGuess`, plan 260929g decision 4). Matching a stranger's public upload by it
  would confirm a fact their public page does not publish, which is 260930b's signed-address case in
  another shape.
- **Canonical only.** A `matching` row is a search result whose content resembled the PDF, not an
  identifier — a weaker claim than the title match we already have, so it is not used.
- **Said as a guess.** It is matched by `identityOf` (DOI/arXiv by host and path, unchanged) but
  reported as its own `matchedBy: "guessed-id"`, tooltip *the DOI or arXiv id we found for your
  uploaded PDF*. Our guess is not the article's own address, and the row should not say it is.
- **Ranked as an identifier.** A canonical guess was built only after the PDF's identifier and title
  agreed (`src/source-guess.ts`), so it is not weaker evidence. DOI, arXiv and guessed-id are one
  tier; then own live → own archived → public; then, between two equal copies, the article's own
  identifier before our guess; then slug. Ranked lower, a stranger's public copy would beat the
  reader's own upload.
- **Parsing is the last validator, not `kind`.** The schema ties `canonical` to `matched_by in
  ('doi','arxiv')` but not to a host; a canonical URL that is not a resolver address fails closed in
  `identityOf` and matches nothing.

## Types

`CitedMatchedBy` gains `"guessed-id"`; `CitedInSpideryarn` gains `archived?: true`; `CitedCandidate`
gains `archived: boolean` and `guessedUrl: string | null`. `CITE_HERE_HOW` is a `Record` over
`CitedMatchedBy`, so the new case is a type error until worded.

## The simpler options passed over

- **Archived as an ordinary match, no word on the line.** Less to build, but the reader clicks
  *In your library*, goes to the shelf later, and cannot find it there. One word is cheap.
- **Matching a public upload by its guess too.** More matches, but it publishes an owner-only fact
  (above). The title match still catches most of these.
- **Folding the guess into `urls`.** One less field, but the tooltip would then say *the same DOI*
  about a guess of ours — the exact overclaim 5G's rule is against.

## Not built (still deferred)

A visitor's view of a public article's matches; using the matched article's text in *Look it up* /
*Investigate*; fuzzy titles; a stored match key (still the scale step 260930b names).

## Tests (red first)

- Pure (`tests/cited-in-spideryarn.test.ts`): a guessed DOI or arXiv id matches as `guessed-id`;
  the reader's own upload beats a stranger's public real-DOI copy, and a live upload beats an
  archived real-DOI copy; between two own live copies the real id wins; a non-resolver canonical URL
  matches nothing; it never matches by address; own live beats own archived beats public;
  `archived` set on the match and absent otherwise.
- Postgres (`tests/cited-in-spideryarn-pg.test.ts`): fixture 2 (own archived) becomes a candidate
  with `archived: true`; fixture 7 (stranger's public archived) still is not; a guess row on an own
  upload yields `guessedUrl`, on a stranger's public upload yields null, a `matching` row yields
  null; the SQL assertion updated to the new grouped `where`.
- Client, `tests/citation-hover-card.test.tsx`: an ordinary match (href, same tab, tooltip), the
  archived wording, the guessed-id tooltip, a public title match naming its article, and a
  non-owner with a malformed payload carrying the field draws nothing. `tests/citations-panel.test.tsx`:
  the band's archived and guessed-id wording.

## Stages

1. Server: query, matcher, types, tests. 2. Client: `CiteCard`, the archived wording, the new
`CITE_HERE_HOW` entry, `citations.md`, browser check. One commit each; GPT Sol review of the plan
(read-only) and of the code (workspace-write).

## Review log

GPT Sol, plan, read-only ([261001i-plan-review-sol.md](261001i-plan-review-sol.md)), *"Rework, then
ship"*:

1. **P1** the card's privacy boundary was described wrongly (citations do have a public projection) —
   taken: `showInSpideryarn` prop, stale comments fixed, a malformed-visitor test.
2. **P2** the archived-public reason confused listing with access — taken, policy restated.
3. **P2** the SQL sketch's precedence was wrong as printed — taken; the code was already grouped,
   and the generated-SQL test pins it.
4. **P2** `guessed-id` ranked too weakly — taken: one identifier tier.
5. **P2** the client test plan was vague — taken: five card tests.
6. **P3** `kind` does not guarantee a parseable URL — taken: the fail-closed test.

## Status

Building.
