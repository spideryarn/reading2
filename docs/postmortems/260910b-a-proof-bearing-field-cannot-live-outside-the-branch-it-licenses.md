# A proof-bearing field cannot live outside the branch it licenses

The per-account wire type and all of its parsers admitted a numeric usage reading with
`providerAccountId: null`, directly contradicting the adjacent rule that an unproved identity may
carry no number. The older standalone Codex card had the same shape in view code: it printed
percentages and reset credits beneath “Account not attributed.” Nothing from the new per-account
work reached a user; the branch was still local when review found it. The older Codex card was live
on the internal fleet dashboard.

## What happened

Commit `a17ec425` put `providerAccountId: string | null` in the common outer part of
`AccountUsageSection`, while `windows | unknown` and `buckets | unknown` lived in a separate family
union. TypeScript therefore accepted the Cartesian-product states the comment prohibited:

```text
providerAccountId: null + Claude windows
providerAccountId: null + Codex buckets
```

The producer parser, fleet projection and browser parser each parsed identity into a `common`
object, parsed the reading independently, and spread the two together. The store delegated to the
producer parser. Four validators agreed because all four followed the same too-wide declaration.
Commit `74634fd3` retained the state and added the renderer that would put it under an account
heading.

The sibling predates this stage. Commit `f829277e` deliberately preserved Codex observations whose
provider returned no account id, which is right for history, but `CodexUsageCard` independently
treated `kind: "value"` as permission to draw its buckets and reset-credit count. It disclosed
“Account not attributed” without withholding the claims that required attribution.

## The class: a proof-bearing field modeled independently from the claim it licenses

Identity is not metadata beside a number. It is evidence that licenses displaying the number under
an account. If the evidence and claim live on independent fields, their type is a Cartesian product
and the forbidden combination is only prose.

This is why multiple parsers did not add confidence. They were copies of one assumption, not
independent checks. The same tell applies to freshness, permissions and provenance: when field A is
what makes field B safe to use, A belongs on B's discriminated branch or in the function that
returns B.

## Why nothing went red

- Typecheck correctly accepted the forbidden state because the type explicitly represented it.
- Valid fixtures always supplied provider ids.
- The existing Codex-null test proved the normal producer converted one anonymous observation to
  `unknown`; it did not try persisted or wire input that bypassed that constructor.
- The “unknown has no percentage” test proved one direction. It never proved the converse:
  “percentage requires identified.”
- The standalone Codex tests recorded null identity as valid history, but none composed it with the
  card and asked whether a number survived.

The red review tests were concrete: each per-account boundary accepted a numeric null-id fixture,
and the standalone card rendered `24% used` plus `2 reset credits` under “Account not attributed.”

## What would have caught it, ranked by ease against value

1. **Put the proof on the licensed branch.** Done. Numeric Claude and Codex arms now require
   `providerAccountId: string`; only `unknown` arms permit null. Producer mistakes become compile
   errors.
2. **Exercise the forbidden cross-product at every trust boundary.** Done. Runtime JSON bypasses
   TypeScript, so producer/store, fleet and browser parsers refuse numeric null-id sections, and the
   DOM test proves no percentage survives.
3. **Test both implications when documenting a two-way invariant.** Cheap and applicable beyond
   this feature: `unknown ⇒ no number` is not evidence for `number ⇒ proved identity`.
4. Named constructors for numeric sections — deferred. The discriminated union already makes
   ordinary construction safe; constructors would mainly duplicate it.
5. Runtime schema generation — rejected for now. It is disproportionate to these small wire shapes
   and would not remove the need for degraded-state integration tests at the browser boundary.

## The fix that is right for the long term

The type carries the invariant, each untyped boundary repeats it, duplicate provider identities are
refused after parsing, and the standalone Codex card withholds buckets and reset credits when the
observation has no account id. History may retain the anonymous observation as evidence of what the
provider returned; a decision surface may not promote it to attributed headroom.

## The thing I would tell myself

I wrote the exact safety rule beside the type and then placed its evidence outside the branch it was
supposed to guard. A comment cannot narrow a Cartesian product. Put proof and claim in the same arm,
then attack the forbidden combination at every untyped boundary.
