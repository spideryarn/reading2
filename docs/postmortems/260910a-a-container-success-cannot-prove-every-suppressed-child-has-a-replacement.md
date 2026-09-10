# A container success cannot prove every suppressed child has a replacement

On 2026-09-10 the new Usage limits tab hid the old Claude cache and Codex card whenever the
per-account feed said `published`. A published feed containing only failed sections, only one
provider family, an expired reading, or a different account therefore removed useful headroom with
nothing numeric in its place. Nothing reached a user: the branch had not been pushed to `dev`.

The first full-suite fix narrowed an unconditional `true` to `accountUsage.kind === "published"`.
That repaired old-server and pre-first-pass states, but kept the same wrong unit of evidence.

## What happened

`AccountUsageSections` owns one independently collected section per subscription. The deep card
below it owns a cached Claude reading and the latest Codex history reading. Drawing the same account
twice is confusing, so commit `74634fd3` added one boolean meaning “headroom is shown above” and used
it to suppress both fallback sources.

The boolean described the envelope, not its contents. `published` permits a valid partial result:
one family can be absent, one section can be `unknown`, windows can have reset, and another provider
account can be the only one with numbers. Commit `2a471a5f` made the boolean conditional on that
envelope and its tests proved only the two envelope arms. They never varied the section that was
supposed to replace the hidden reading.

The failing review test was direct evidence: with a published Codex section changed from 23% to
`unknown`, the still-current 61% fallback disappeared. The same shape existed for Claude and for
differently attributed, stale, expired and partial readings.

## The class: a container success spent as child-level evidence

A collection's success discriminant proves that the collection was read. It does not prove that
every child exists, is current, has the same identity, or carries the field another component is
about to hide.

This is more specific than “the test was weak”. The implementation compressed several independent
proofs into one boolean, and the test used the same compression. Both were green because both asked
whether the envelope published; neither asked whether the suppressed fact had a replacement.

The tell elsewhere is a prop named like `hasData`, `loaded` or `published` controlling several
children at once. If the children can fail independently, the prop has already discarded the
evidence the decision needs.

## Which commits introduced and preserved it

- `74634fd396408a36940a36021f46b83094e83554` introduced the page-level boolean and unconditional
  suppression on the Usage tab.
- `2a471a5f00abcc6bb02bb8701271fcd4d548d4f3` fixed the absent-envelope case but preserved the class
  by treating `published` as proof of replacement.

The author was pursuing the right product rule — one number per subscription — and chose a boolean
that could not carry the attribution, freshness and window coverage needed to apply it safely.

## Why nothing went red

The component fallback tests proved that `AccountUsageSections` says why a whole feed is absent or
unreadable. The App test proved that a healthy published Codex section suppressed the duplicate and
that the card returned on another tab. Neither composed those facts into the dangerous cases:
published plus unknown, a different account, an expired window, or partial window coverage.

Typechecking could not help because `headroomShownAbove: boolean` made every state look equally
intentional after the evidence had been collapsed. The comments repeated the same assumption:
“published sections” and “replacement on screen” were treated as synonyms.

## What would have caught it, ranked by ease against value

1. **Vary the alleged replacement inside a published envelope.** Done. The App test now keeps the
   fallback for unknown, differently attributed and expired sections, and the Claude card test adds
   partial-window coverage. Each mutation was observed red against the original implementation.
2. **Pass evidence to suppression code, not a verdict boolean.** Done. `UsageCard` receives the
   parsed per-account feed and earns suppression separately by provider, non-null matching identity,
   freshness and coverage of every displayed fallback window.
3. **Keep fallback and replacement beside one another always.** Rejected. It is the cheapest safe
   implementation, but two independently timed percentages for one subscription make both readings
   harder to trust and defeat the product decision this change exists to make.
4. **Create a generic collection-completeness framework.** Rejected. The relevant proofs are
   domain facts — account identity, reset expiry and window keys — and a generic abstraction would
   either erase them again or be larger than the code it replaced.

## The fix that is right for the long term

The implemented fix is also the long-term design: suppression is a derived, per-provider decision made
where both candidates and the browser clock are present. It requires the same non-null provider id,
a replacement no older than the fallback, a non-stale section, and coverage of every displayed
fallback window; numeric fallback windows require current numeric replacements. Duplicate bucket or
window identities refuse suppression rather than being collapsed.

The per-account Codex section now also uses the same reset-credit card as the fallback. Hiding the
whole Codex card no longer loses a zero or an unknown reset-credit reading while percentages appear
to have been replaced.

## The thing I would tell myself

I knew each account call could fail independently and still let the pass publish. I should not have
turned that collection result into one boolean and then asked the boolean a question about every
child. If hiding a fact requires proof, carry the proof to the line that hides it.
