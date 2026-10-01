# Public-article visitors see Debate's threads and relevance, a citation's entry, and cross-references

**Status as of 2026-10-01: built, awaiting GPT Sol's code review** — evidence: `tests/public-dto-owner-only-fields.test.ts`, the cross-references case in `tests/public-visibility-pg.test.ts`, and two cases in `tests/public-network-trace.test.tsx`, each seen red under a mutation of the code it covers.

## The decision

Four things the reading view shows an article's owner were left off the public DTO
([`src/public/dto.ts`](../../src/public/dto.ts)). The DTO is an allowlist and a listed defence
([security-map.md](../project/security-map.md)), so each unattended run that built one of them left
it for Greg:

| Report | What the visitor is missing | Deferred in |
|---|---|---|
| 6M | Debate's theme threads and key sources (`Debate.synthesis`) | [260930j § Visitors](260930j-debate-themes-and-key-sources.md) |
| 6J/6K | a cited work's full reference entry, on hover (`CitedWork.entry`) | [260930i](260930i-citations-mark-the-exact-citation-and-read-the-pdf-reference-list.md) |
| 5Z | cross-reference links in the prose (the `crossrefs` column) | [260930f § Left for Greg](260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md#left-for-greg-two-defence-edits) |
| 5P | Debate's relevance judgement on each row (`DebateRow.bears`) | [260929h § Deferred](260929h-debate-mode-clearer-sources-and-orders.md) |

The Overseer asked Greg whether to allow all four. Each one is generated from the article itself
and holds nothing personal. Greg answered:

> ok
>
> — Greg, 2026-10-01 (relayed by the Overseer, ~00:15)

So this plan does all four in one reviewed change. Each gets a test that a visitor receives it,
and a test that nothing private rides along with it.

## Is each one really about the article? Checked field by field

- **`bears`** is one of three closed words (`directly | partly | loosely`). It is the model's
  judgement of a stranger's page against a claim in the article. It is read through
  `readStoredBears`, so a stored value outside the vocabulary becomes absent. Its input was the
  article and the search extract, nothing about the reader, and no profile goes into the search.
  **Safe.**
- **`synthesis`** is `made {themes[{id,label,gist,rowIds}], key[{rowId,role,why}]} | too-few {rows}
  | failed`. The label, gist and why are the model's words over the rows both passes kept. Those
  rows are the same rows the visitor already receives (`publicDebate`), and no profile goes into
  the call (src/debate-themes.ts). **Two hazards, both at the boundary rather than in the content:**
  1. A theme or key source can name a row that `publicDebate` withheld because its address was
     refused. The fix is to **re-settle the synthesis against the published rows only**, using the
     existing `settleSynthesis` (src/debate-synthesis.ts). That drops a key source whose row is
     gone, and a theme left with fewer than two works, by the same rule the owner's panel applies.
  2. The model's words could quote a refused address. So every label, gist and why goes through the
     same `carriesRefused` scan the rows get, and an item that fails is dropped.

  If the owner's synthesis is `made` and the public re-settle empties it, the visitor gets
  `made` with empty lists, not `failed`. `failed` would tell the visitor the call broke, which is
  false. `too-few` and `failed` cross as they are: `rows` is a count.
- **`entry`** is ≤ 400 characters, always the article's own characters sliced by code: either the
  text of the `reference` block, which visitors already receive as a block, or for a PDF the entry
  in the reference list read from the PDF's own text layer (src/citation-reference-list.ts). The
  PDF case is the one to think about. A publisher's per-download stamp ("Downloaded by … on …")
  names the downloader. It repeats on every page, so `pageLines` removes it as running furniture
  before the list is split. A stamp printed once, on page one, is not inside a reference list.
  Nothing in it is the reader's: no profile, no goal, no note. It crosses as text, like a block's
  `text`. A URL inside it is printed by the paper and is already public wherever the block is.
  **Safe.**
- **`crossrefs`** is `{from, phrase, to}` per link. `phrase` is the article's own characters, and
  `from` and `to` are block ids of this article. `dropped` (counts), `sourceHash`, `generatedAt`,
  `elapsedMs`, `version` and `generator` stay behind. No profile goes into the call. **Safe.** One
  thing is not about privacy but about honesty: **a stale artefact must not be drawn** (Sol F8 on
  260930f). A link can still name two surviving ids and a phrase that still matches while no longer
  being true, and the prose has nowhere to say "out of date". The owner's hook draws nothing when
  `stale`, so the visitor's payload **omits the key when stale**, by the same fingerprint.

None of the four carries an owner id, a note, a profile hash, a reading goal or a lookup. The tests
below fill every owner-only input with sentinels and check that none appears anywhere in the JSON.

## How

### Server

1. **`publicDebateRowBase`** gains `...(bears ? { bears } : {})`, read through `readStoredBears`.
   `PublicDebateRowBase` in src/public-types.ts gains `bears?: DebateBears`.
2. **`publicDebate`** gains `synthesis`, built by a new `publicSynthesis(debate, publishedRows,
   carriesRefused)`:
   - `owner = readStoredSynthesis(debate)` (all rows), then `null` → absent, and
     `failed`/`too-few` → as is;
   - `made` → drop each theme or key whose `label`/`gist`/`why` `carriesRefused`, then
     `settleSynthesis(themes, key, publishedRows)` → `{ kind: "made", ...settled }`.

   `PublicDebate.synthesis?: DebateSynthesis`.
3. **`publicCitedWork`** gains `...opt(work, "entry")`, and `PublicCitedWork.entry?: string`.
4. **`crossrefs`**:
   - Select `articleRevisions.crossrefs` in `PUBLIC_PROJECTIONS.article`.
   - Hand `publicArticle` the row's `crossrefs`, plus a `crossrefsFresh` boolean the **reader**
     computes. The DTO projects; it does not hash, for `stale`'s reason in `publicSearches`.
   - `publicCrossrefs` rebuilds `{ links: [{from, phrase, to}] }`, keeping only links whose `from`
     and `to` are block ids in this payload. The key is omitted when the reader said not fresh,
     when `crossrefs.slug !== row.slug`, or when `links` is not an array.
   - `PublicArticle.crossrefs?: { links: Crossref[] }`.
   - **Freshness on the public path.** `isStale`/`inputFingerprint` live in src/crossrefs.ts. That
     file imports the model call, and `tests/public-imports.test.ts` forbids the public graph from
     reaching it. Rather than write a second fingerprint, which is two answers to one question, move
     the pure half into a leaf, **`src/crossrefs-fingerprint.ts`**: `inputFingerprint`, `isStale`,
     `renderPrompt`, `linkCap`, `MAX_LINKS`. src/crossrefs.ts re-exports them, so its callers do
     not change. `renderPrompt` needs `partsOf`, which lives in src/arc.ts, a forbidden writer. So
     `partsOf` moves to a pure leaf as well, **`src/tree-parts.ts`**, and arc.ts re-exports it.
     `stageFailure` and `isSupplementNode` come with it: check that their imports are pure.
     `metaFingerprintOf`/`citedMetaFingerprintOf` live in pg.ts, which is forbidden. They move to
     src/source-hash.ts, and pg.ts re-exports them. The public reader then computes
     `crossrefsFresh` from the blocks it already fetched (`id`, `text`, `role`, `treatment`), the
     tree, and `title`/`byline`/`siteName`/`finalUrl` off the same row. Those are exactly the
     owner's inputs: `blockHashQuery` selects those four block columns, and
     `citedMetaFingerprintOf` reads those four revision columns.

     *The simpler option passed over:* send crossrefs to visitors without a freshness check, on the
     argument that the client only places a phrase that still occurs exactly once in its block.
     Rejected because that is the case Sol F8 named. A placeable link can still be wrong, and an
     owner would see nothing where a visitor would see the stale links.

     *A risk to test:* the public path sanitises block HTML (`sanitizeStoredBlocks`). If it ever
     changed `text`, every public crossrefs would read stale. That fails safe (no links), but it
     would be silent. So the integration test has a **positive control**: a fresh artefact on a
     public article must reach the visitor.

### Client

- **Debate:** DebatePanel reads `readStoredSynthesis(debate)` for a visitor too. The public rows
  satisfy `SynthesisRow`, and re-checking on the client is harmless and keeps one reader. The
  "visitors carry no synthesis / no bears" comments in DebatePanel.tsx and DebateMode.tsx become
  true statements about the public payload. `debate-order.ts` already reads `bears` off either
  shape. Check that *prioritised* and the relevance bar now appear for a visitor.
- **Citations:** `ByLine` reads `work.entry`. Check that `ShownWork` exposes it on the public arm.
- **Cross-references:** the visitor arm of `ReaderCapability` gains
  `crossrefs: readonly Crossref[] | null`, from the payload. In Reader.tsx,
  `xrefs = capability.kind === "owner" ? owner.crossrefs : visitor.crossrefs`. TableView, the
  nonce check in src/web/xref.ts and the card are unchanged. The marks are drawn after
  `sanitizeArticle`, as for the owner. The sanitiser half (5Z item 1) has landed: commits
  `4b4790e5` and `13f8266b`, coordinated with session fb5z2. This change does not edit the
  sanitiser.

### Tests

- **tests/public-dto.test.ts:**
  - Flip the `entry` sentinel test: the entry now crosses.
  - Positive tests for `bears`, `synthesis` and `crossrefs`.
  - Synthesis cases: a theme naming a withheld row is re-settled away; a key source on a withheld row
    is dropped; a gist quoting a refused address is dropped; `made` emptied by withholding becomes
    `made []`, not `failed`.
  - Crossrefs cases: omitted when not fresh, omitted on a slug mismatch, a link to an unknown block
    dropped, only `{from, phrase, to}` crossing.
  - Update the recursive key-set assertions.
  - One **no-private-data** case: an input with all four fields populated plus owner-only sentinels
    (a block `note`, a `profileHash`, a `guidance`/reading-goal string, a glossary `lookup`, an
    owner id, a `found` find), and an assertion that no sentinel appears anywhere in the JSON.
- **The public-reads/Postgres suite:** the `crossrefs` column reaches an anonymous read; a fresh
  artefact crosses (the positive control); a stale one is omitted.
- **tests/public-imports.test.ts** must stay green: it is the check that the moved leaves really
  are pure.
- **Client:** a visitor's DebatePanel shows threads, and `bears` ordering when present. A visitor's
  Reader draws an xref mark from the payload.

## Docs

- security-map.md and the DTO's own comments say what crosses.
- reading-view docs: citations.md, cross-references (check which doc), and the debate doc's visitor
  lines.
- The four notes in docs/user-feedback/ get a follow-up line each. The 5Z line comes off
  awaiting-approval.md, and so does the DTO half of the 5P row; its authors-and-year decision
  stays.

## Exactly what this change adds to the public DTO

Greg approved this defence edit on 2026-10-01 (relayed by the Overseer). These are all the keys a
stranger can now receive that they could not before. Every one is built field by field in
`src/public/dto.ts`, none is spread, and each is checked at runtime, because JSONB arrives
unchecked.

| Key, in `PublicArticle` | Built by | Crosses when | Why it is safe |
|---|---|---|---|
| `debate.direct.rows[].bears`, `debate.claims.rows[].bears` | `bearsOf` via `readStoredBears` | the stored value is one of `directly`, `partly`, `loosely` | One closed word. It is the model's judgement of a page the visitor already gets, against a claim in the article. No reader input goes into it. |
| `debate.synthesis` = `{kind:"failed"}` or `{kind:"too-few", rows}` | `publicSynthesis` | `readStoredSynthesis` says so | No prose. `rows` is a count. |
| `debate.synthesis` = `{kind:"made", themes:[{id,label,gist,rowIds}], key:[{rowId,role,why}]}` | `publicSynthesis` → `settleSynthesis` against the published rows | **no row was withheld in either group**, and only items whose words carry no refused address | The model's words over rows the visitor receives. With nothing withheld, they cannot describe a row the visitor does not see. Re-settling means every `rowId` names a published row, and a theme still spans two works. No profile goes into the call. |
| `citations.citations[].entry` | `publicEntry` | it is a string ≤ 400 **and equal to `entryOfText` of the work's own `reference` block**, and that block is in the payload | Every character is already in `blocks`. **A PDF list's entry does not cross**: a one-page download stamp could name the downloader (Sol P1). |
| `crossrefs` = `{links:[{from,phrase,to}]}` | `publicCrossrefs` | the reader's `isStale` says fresh (raw rows, tree, `citedMetaFingerprintOf` of the raw columns), the slug matches, and each link is three strings whose ends are two different blocks in the payload | `phrase` is the article's own characters, and both ends are its blocks. `dropped`, `sourceHash`, the stamp and any extra key stay behind. No profile goes into the call. |

**Left out on purpose, and why:** `entry` from a PDF's text layer (above). The `made` synthesis on
a debate with a withheld row. `workTitle`/`authors`/`publishedYear` on Debate rows: Greg did not
ask for them, nothing writes them today, and the bibliographic lookup that would is his separate
decision under 5P.

**Moved so the public graph can ask the owner's question:** `partsOf` → `src/tree-parts.ts`; the
cross-references fingerprint (`inputFingerprint`, `isStale`, `renderPrompt`, `linkCap`,
`MAX_LINKS`) → `src/crossrefs-fingerprint.ts`; `metaFingerprintOf`/`citedMetaFingerprintOf` →
`src/source-hash.ts`; `ENTRY_CAP`/`capEntry`/`entryOfText` → `src/citation-entry.ts`. Each old home
re-exports, and `tests/public-imports.test.ts` stays green.

**Not changed:** the sanitiser (5Z item 1, session fb5z2, commits `4b4790e5` and `13f8266b`), and
`src/web/visitor.ts`, because cross-references are an annotation, not a mode.

## GPT Sol, plan review (2026-10-01) — "do not build" as written; all five taken

Each finding was checked against the code before it was taken, and each held.

- **P1 — a theme's words can carry a withheld row's content.** The synthesis call saw every row
  (src/debate-themes.ts). A theme kept over the public rows A and B can still summarise a withheld
  row C in its `gist` without containing C's address, so neither re-settling nor an address scan
  catches it. **Taken:** if `publicDebate` withheld any row in either group, the `made` synthesis
  does not cross at all. `failed` and `too-few` carry no prose and cross as they are. The re-settle
  against the published rows stays, as a second line. Withholding is rare: it needs a credential in
  an address or a host a stranger could not reach.
- **P1 — a PDF's `entry` is not proven free of the downloader's identity.** Furniture is removed
  only when a line repeats on three or more pages (src/pdf.ts), and the list parser appends any
  continuation line to the current entry. So a "Downloaded by …" stamp printed on one or two
  pages, an email address or a signed URL can end up inside an entry, and nothing else in the
  public payload shows that text. **Taken, and this is the one field that crosses only in part:**
  an entry crosses only when it is exactly the collapsed, capped text of the work's own
  `reference` block, and that block is in the public payload. That is the bibliography-block case,
  where the visitor can already read every character. **An entry read from a PDF's text layer does
  not cross.** Publishing it safely would need its own provenance and privacy design. `capEntry`
  moves into a pure leaf, so the stage and the check share one definition.
- **P2 — validate at runtime, do not copy typed values.** JSONB arrives unchecked. **Taken:**
  `entry` must be a string within the cap. Each crossref must be a record whose `from`, `phrase`
  and `to` are strings, and whose ids are blocks in the payload; anything else is dropped.
  `bears` already goes through `readStoredBears`, and the synthesis through
  `readStoredSynthesis`/`settleSynthesis`. Malformed-object tests carry nested private sentinels.
- **P2 — the client seam.** **Taken:** `crossrefs` goes from the raw `PublicArticle` →
  `ArticleAccess` (src/web/article/access.ts) → `VisitorArticle` → `ReaderCapability` → Reader.
  DebatePanel's `!isShared` exclusion goes. The test runs the whole path from a public response to
  the rendered page.
- **P3 — fingerprint parity at the edges.** **Taken:** the public reader calls the moved
  `citedMetaFingerprintOf` on the raw revision columns, and hashes the raw rows, not the sanitised
  blocks — `hashBlocks`' precedent in the same function. Parity tests cover a normal article, a
  null-title article with its other metadata set, and a query-bearing `finalUrl`.

Sol also confirmed three things. The leaf moves pull nothing forbidden into the public graph.
`visitor.ts` needs no policy row, because cross-references are annotations, not a mode. The public
namespace is `no-store`, so there are no cached payloads to migrate.
