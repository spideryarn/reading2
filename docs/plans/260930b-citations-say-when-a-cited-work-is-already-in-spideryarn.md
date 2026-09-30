# Citations say when a cited work is already in Spideryarn

SPIDERYARN-READING2-5R (`spya-mxntdt`), from Greg (admin, verified by
`scripts/feedback-reporter.ts`, exit 0), sent from Citations mode on `9689-full-spya-m43th2`:

> In Citations mode, we should also do a check to see if any of the cited-items are already present
> as articles in Spideryarn (on the user's shelf or in public articles), and if so, provide a special
> link to them.

The feedback note is
[260930_1000-citations-link-to-a-work-already-in-spideryarn.md](../user-feedback/260930_1000-citations-link-to-a-work-already-in-spideryarn.md).
It builds on 5G ([260929g](260929g-check-a-cited-paper-supports-the-claim.md)) and 5Q
([260930a](260930a-citations-investigate-one-work-on-demand.md)), both already on `dev`; neither
touches this ground.

## The one rule

**A match may only ever name an article the reader may already open**: one they own, or one that is
public (and readable, and not archived — the public shelf's own bar). Another reader's private
article must not show up, and nor must its existence — so no count, no "someone has this", no
timing difference worth the name. That is enforced in the `where` of one query, not by filtering
afterwards.

## What we build (v1)

**Server — one query, one pure matcher, attached in the owner's route.** (As revised after GPT
Sol's plan review, [260930b-plan-review-sol.md](260930b-plan-review-sol.md): four P1s, all taken.)

- `src/store/pg-cited-in-spideryarn.ts` (new): `citedCandidates(exceptSlug)` takes the owner from
  `currentOwnerId()` itself — **no caller can pass an owner** — and selects every article that is
  **(owner_id = me OR visibility = 'public') AND not archived AND readable** (a tree and at least one
  block, for both arms: the owner's reader 404s a half-made article too). Per row: `slug`, `mine`,
  a **match title** (the extracted title), a **display title** (for mine `title_override ?? title`;
  for a stranger's, the extracted title only — `title_override` is an owner's relationship with the
  document, and the `case` is in SQL so it is never read), the byline, and URLs. **A stranger's
  URLs are only what their public page publishes**: `final_url` through `publicSourceUrl`, never
  `requested_url` — a signed address may be the owner's paywall key, and matching on it would
  confirm which public article it belongs to. The article being read is dropped.
- `src/cited-in-spideryarn.ts` (new, pure): `matchCited(works, candidates)` → per work id at most
  one `{ slug, whose: "yours" | "public", matchedBy: "doi" | "arxiv" | "address" | "title", title }`.
  - **doi / arxiv**: the work's `doi:`/`arxiv:` identity (from `keysOf`) equals the id a candidate
    URL **is** — parsed by host (`doi.org`, `arxiv.org`), not found anywhere in the string, so a
    query string or a lookalike host cannot carry one. An arXiv id ignores its version.
  - **address**: `sameTarget`, unchanged — `http` and `https` stay two pages, as elsewhere. Never a
    Scholar search.
  - **title**: `keyWords` (the identity normaliser `keysOf` uses, which keeps "Part 1" and "Part 2"
    apart — not `wordsOf`) of the work's title equals that of the **extracted** title; at least 4
    words and not contradicted by the first author, or 3 words and the author positively agreeing.
    This is the one that catches an uploaded PDF, which has no URL.
  - Precedence: identifier > address > title, then the reader's own copy before a public one, then
    slug order — deterministic.
- Attached as `CitedWork.inSpideryarn` in the owner's `GET /api/citations` route, after
  `loadCitations` (so after `attachFinds`), read-time only, never stored. **Not in `loadCitations`**:
  chat, *Look it up* and *Investigate* call that too and need none of it. A failure logs and costs
  the links, not the list. The public reader never calls it, and the public DTO is constructed
  field by field (`publicCitedWork`), so a visitor's list cannot carry it.

**Client — one line on the row.** In `CitationsPanel`'s `WorkRow`, under the title: a link
*In your library* or *On the public shelf*, to `/read/<slug>` in the same tab (it is ours, not a
link out), with the matched article's title and how it matched in the tooltip. A title match says
*matched by title* on the row too, because it is the weakest.

**Not changed**: `readNoteOf` still says we have not read the work. The matched article *has* been
read, but a title match is a guess about identity, and 5G's rule is that the row does not claim a
reading it cannot vouch for. Saying *there is a copy here* and letting the reader open it is the
honest version.

**Prior art, not reused**: the prose hover card for a hyperlink already says *on your shelf* and
offers *read it here* (`useLinkFacts` in `ProseHoverCard.tsx`). That asks `GET /api/library` from
the browser and compares the one href — own shelf only, by address only — so it cannot answer for a
public article, a DOI, or a title. Joining the two is on the deferred list.

## The simpler option passed over

Matching in SQL (normalised URL and title expressions as `where` clauses). It scales better but
would put a second copy of the URL and title normalisation in SQL beside the JS one, and they would
drift. **The cost of the chosen way:** one read of the candidate columns for every own and public
article per Citations load. At beta scale that is hundreds of short rows. When the shelf is
thousands, the next step is a stored match-key column per revision, written at extract — named here
so it is a decision, not an inheritance.

## Deferred

- The hover card in the prose (`CiteCard`) — one surface first.
- A visitor's view of a public article's citations: a stranger would see links to other public
  articles, which is safe, but it is a second call site on the public boundary; not in v1.
- Archived own articles; uploaded PDFs matched through `upload_source_guesses`'s guessed DOI.
- Using the matched article's text in *Look it up* / *Investigate* (reading the real work instead of
  a search extract) — the obvious next step, and a bigger one.
- Fuzzy title matching (subtitles, punctuation variants beyond `wordsOf`).

## Stages

1. Server: the query, the matcher, the attach, tests — the pure matcher (including adversarial
   URLs), and a Postgres test with two owners and eight articles proving another reader's private,
   archived or unreadable article never appears, a stranger's rename and signed address never
   leave, plus a generated-SQL assertion on the `where`. **Red first by mutation**: loosening the
   visibility clause failed three of its cases; dropping the `publicSourceUrl` filter failed the
   signed-address case. Existing guards (`owner-isolation`, `public-imports`) need no edit — this
   module is on the authenticated side only, which Sol confirmed.
2. Client: the row line, CSS, docs (`citations.md`), a browser check.

Both reviewed by GPT Sol (plan read-only, code before push).

## Status

**Shipped to `dev`, not deployed** (2026-09-30).

- Stage 1 and 2 landed together as 05fbc5e8. GPT Sol's code review
  ([260930b-code-review-sol.md](260930b-code-review-sol.md)) found no P0/P1 and fixed four P2s
  (whole-path DOI/arXiv parsing, owner-only rendering, a non-vacuous DTO test, the store guarded at
  its export) — 3ef362b6. Its sandbox could not reach Postgres, so the scoped set was re-run outside
  it: 15 files, 438 tests, exit 0.
- **Browser check** (Playwright, a dev server of this worktree at 3ef362b6, three seeded local
  articles, removed afterwards): the reader's own copy of a cited Nature paper drew *In your library*
  with *matched by the same DOI*; a stranger's public copy of another drew *On the public shelf*; a
  stranger's **private** copy of a third drew nothing, and neither its title nor its slug was in the
  page or in the `GET /api/citations` response. The link opened the article in the same tab. No
  overflow at 390px. [Desktop](260930b-shots/desktop.png), [phone](260930b-shots/mobile.png).
- Noticed in passing, not ours: `?citeby=first` in a URL did not change the order on load.
