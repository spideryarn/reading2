# Encode DOIs before they go into a link address

Queue item `qi-thwhkxxh` (GPT Sol's C10, P1). Greg, 2026-10-04: *"yes if this is a bug and/or
there's a clear improvement that won't add too much complexity go for it"*.

## The bug

Three places build `https://doi.org/<doi>` by pasting the DOI in as written:

- `src/source-guess.ts` § `isSamePaper` — the canonical address stored for a reader's uploaded paper.
- `src/paper-evidence.ts` § `paperAddress` — the address we **fetch** to read a cited paper.
- `src/citations.ts` § `doiUrl` — the link on a Citations row (`fromAnchor`, `linkFor`).

A DOI here is whatever matched `10.\d{4,9}/[^\s"'<>?#]+`, so it may hold `%`, `\`, `;`, `:`, `[`
and so on. Unencoded, some of those change what the address means:

- **`%`** — `10.1234/a%2Fb` in a path is read back as `10.1234/a/b`, a different DOI. `identityOf`
  (src/cited-in-spideryarn.ts) decodes the path once, so our own round trip gives the wrong
  identifier, and so does doi.org. `identifiersIn` decodes its input once already, so a DOI that
  still holds a `%` afterwards is a literal one.
- **`\`** — a browser's URL parser turns `\` into `/` in an `https:` address.

`?`, `#`, whitespace and quotes cannot be in a matched DOI, so the host cannot be changed and no
query can be added; this is a wrong-address bug, not an open redirect.

The two later call sites (`crossrefUrl`, `dataciteUrl`, `openAlexWorkUrl`, `citerUrl`) already
encode each path segment — `doiPath` in src/bibliographic.ts and an inline copy in
src/citer-link.ts.

## The fix

One leaf module, `src/doi-url.ts`, importing nothing (so the browser and every server module can
use it without an import cycle — `bibliographic → cited-in-spideryarn → citations` already exists,
so `citations` cannot import `bibliographic`):

```ts
export function doiUrl(doi: string): string            // the doi.org address
export function doiOfUrl(url: string): string | null   // and back
export function doiPath(doi: string): string           // moved from src/bibliographic.ts, for the registries' APIs
```

The three call sites, `citerUrl` and `doiHref` (src/web/article/UnreadPaperPage.tsx) call `doiUrl`.

**`doiUrl` escapes only what is not a legal path character** — `encodeURI`, plus `?` and `#` —
rather than `encodeURIComponent` on each segment as the first draft of this plan had it. The
difference is the colon: Springer's older DOIs are `10.1023/A:1010933404324`, and
`encodeURIComponent` would rewrite every such stored link to `A%3A…`. With `encodeURI` an ordinary
DOI with a colon, parentheses, semicolon or plus is written exactly as before. Square brackets
are encoded as `%5B` / `%5D`, as are other characters outside `encodeURI`'s preserved set; the
earlier claim that no stored link changes was too broad. `doiPath` keeps `encodeURIComponent`
for the registries' API paths, retaining their ordinary spelling.

**A slash before a `.` or `..` segment is escaped as `%2F`** (`10.1234/a/../x` →
`10.1234/a%2F../x`), which a URL parser does not fold and `identityOf` decodes back. The DOI
Foundation recommends this; GPT Sol's plan review, finding 5, corrected the first draft, which said
no encoding could fix it.

**Two consumers read the DOI back out of the link by slicing the string**, and both now ask
`doiOfUrl`, which decodes (plan review, findings 2 and 3 — without this an encoded link changes a
row's key and a re-run mints it a new id):

- `keysOf` in src/citations.ts — the row's `idKey`, which inheritance and `sameIdentifier` compare.
- `anchorOf` in src/citation-lookup.ts — the anchor searched for in a found page's text.

A legacy link without valid percent escapes reads as it was written. Valid escapes decode once:
`https://doi.org/10.1234/a%2Fb` reads as DOI `10.1234/a/b`, whereas the old row's key was
`doi:10.1234/a%2fb`. Without encoding provenance, an old literal escape cannot be distinguished
from a new encoded path. `idsByKey` retains the stored row key, so rerunning the original literal
DOI still inherits its id from that key; the new link is `…/a%252Fb`.

**Red test first**: one per call site (a DOI holding `%2F` and one holding `\`), one each for
`keysOf` and `anchorOf`, and `tests/doi-url.test.ts` for the encoder itself, round-tripped through
`identityOf`.

## Passed over

- **Refuse a DOI with odd characters instead of encoding it.** Simpler to reason about, but it drops
  real DOIs and the encoding is two lines.
- **`encodeURIComponent` per segment everywhere** (the existing `doiPath`). One encoder instead of
  two, but it rewrites the stored link of every DOI holding a colon.

## Docs

`docs/project/security.md` gains a short section: Crossref, DataCite and OpenAlex are outside
sources of strings we render — text only, and every link is built by us from a shape-checked
identifier through `doiUrl` / `citerUrl`. `security-map.md` is an entry-point doc; any change there
goes to Greg as a before/after in the debrief.

## Stages

One stage: red tests, the leaf module, the call sites, the doc section, GPT Sol code review.

## Code review fixes

- Refuse malformed UTF-16 before selecting a citation DOI: silently replacing a lone surrogate
  changes its identity. Direct `doiUrl` calls now throw rather than substitute U+FFFD.
- Protect dot segments in `doiPath` too. Its prior encoder allowed URL parsing to fold
  `10.1234/a/../x` to `10.1234/x` on the registry fetch path.
- Read the DOI resolver's whole path in the client preview before finding the prefix separator.
  Splitting first lost a leading dot suffix whose separator is encoded, and filtering empty
  segments removed repeated and trailing DOI slashes.
- Narrow the security section's claims to constructed addresses and upstream identifier checks:
  `doiUrl` encodes; `parseWorkId` checks shape. React escapes ordinary text attributes.

Each code defect had a failing regression test before its fix. The boundary mismatch is recorded
in [the postmortem](../postmortems/261004m-an-encoder-is-not-reversible-until-every-consumer-agrees-on-the-boundary.md).
