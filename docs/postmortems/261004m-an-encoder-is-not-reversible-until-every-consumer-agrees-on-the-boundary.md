# An encoder is not reversible until every consumer agrees on the boundary

The [DOI address review](../plans/261004j-encode-dois-in-link-addresses.md) caught
identity loss in an uncommitted encoder and its existing consumers. Nothing in
the new change had reached a reader. Existing registry and hover-card defects
were reproduced locally; production impact was not measured.

## The class: a transport boundary tested through only one consumer

The change treated an identifier as an opaque string at the writer, but its
readers still disagreed about where encoding ended and path structure began.
`identityOf` decoded the whole path; `describeLink` split and discarded empty
segments first. Registry paths had a third encoder. A round trip through the
first reader could therefore pass while a sibling lost the same identifier.

The malformed-Unicode branch made a related mistake: replacing an unpaired
surrogate made a URL constructible by changing the identifier. Its test checked
only that encoding did not throw and the host stayed `doi.org`, so it agreed
with the loss. A transport encoder cannot silently repair an identity.

## Evidence and introducing commits

Local reproductions before the review fixes:

- `doiUrl("10.1234/a\uD800b")` produced a path ending in `a%EF%BF%BDb`;
  `identityOf` returned a DOI containing U+FFFD rather than the original code
  unit. This replacement and its host-only test were uncommitted.
- `doiUrl("10.1234/../x")` produced `10.1234%2F../x`; `identityOf` recovered
  the DOI, while `describeLink` returned `citation: null`.
- `describeLink(doiUrl("10.1234/a//b/"), null)` displayed DOI `10.1234/a/b`.
  The split-and-filter consumer was introduced in `306ceb549`, whose purpose
  was to show where a hyperlink goes before opening it.
- `new URL("https://api.crossref.org/works/" + doiPath("10.1234/a/../x"))`
  resolved to `/works/10.1234/x`. The per-segment registry encoder came from
  `f66917631`, the shared bibliographic lookup implementation. Escaping each
  segment's characters does not prevent URL dot-segment normalization.

The legacy-percent ambiguity is a separate limit of the available evidence.
`https://doi.org/10.1234/a%2Fb` can be an old pasted literal DOI or an encoded
address for DOI `10.1234/a/b`. The string carries no provenance that separates
those histories. Decoding changes the old `keysOf` result from
`doi:10.1234/a%2fb` to `doi:10.1234/a/b`; malformed percent escapes fall back
to the original path instead.

That changed read key does **not** establish rerun ID churn. `idsByKey` preserves
the stored `c.key`; a rerun from the original literal DOI generates
`a%252Fb`, whose decoded new key is the original stored key. The reproduction
returned the previous id. The current stored-key selection was last revised
in `9f8a2fded` to preserve identity while removing unsupported metadata; changing
it into a decoder-based migration would introduce a different problem.

## What would have caught it, ranked by ease against value

1. **Boundary examples through every actual reader** — cheap and directly useful:
   leading dot suffixes, repeated and trailing separators, literal percent
   escapes, malformed Unicode, and browser-parsed registry URLs. Keep the
   identifier equality assertion alongside host checks, and observe each
   regression fail before applying its fix.
2. **Separate validation from serialization** — reject identifiers that cannot
   survive the transport before choosing a DOI link, and preserve the fallback
   search behavior. Let the low-level encoder fail rather than substitute a
   different identifier. This avoids teaching each consumer a repair policy.
3. **Stored-link encoding provenance or a data migration** — rejected for this
   scoped change. It could distinguish historical literal percent signs but
   requires persistence changes and evidence about existing rows. A heuristic
   based on the presence of percent escapes cannot recover that evidence.
4. **A new general URL framework** — rejected. The observed gaps are small
   enough for the shared leaf helpers and tests at their real consumers.

## The long-term fix

Keep one explicit identifier-to-address boundary: accept only Unicode scalar
strings, preserve opaque DOI separators when reading a resolver URL, and protect
dot segments in both resolver and registry paths. Continue using the registry
encoder's existing ordinary spelling. Use shared decoding for resolver
consumers instead of reconstructing an identifier from filtered path segments.

Keep the legacy-percent limitation explicit rather than claiming that all old
links read back as originally typed. Preserve stored citation keys during
inheritance; investigate actual historical rows before proposing a migration.

The useful lesson is to verify the identifier at every boundary that claims to
recover it. A safe host and a green round trip through one parser do not prove
that its other consumers preserve identity.

Up: [Postmortems](../project/postmortems.md).
