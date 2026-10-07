# Persisted identity must outlive live lookup state

The review of voucher starter commit `ae0a8f00e` found two P1 defects before landing: an
identical concurrent create could be refused despite its voucher having committed, and a
readdress could send a replacement article under the deleted starter's slug. No affected
reader was observed; this sandbox did not run Postgres or inspect production. The review's
controlled-interleaving tests in [voucher-starter-races.test.ts](../../tests/voucher-starter-races.test.ts)
were seen red against the candidate: six assertion failures, four for create answers and two
for readdressed starters. The [stage plan](../plans/261007j-gift-voucher-starter-article-by-private-link.md)
holds the implementation and validation record.

## The classes, named

**A preflight absence does not decide a later replay.** `createVoucher` checked the voucher
before resolving its starter. If another create committed during that asynchronous resolution,
the `ready` branch reached the insert-conflict replay check, but `absent`, `unpublished` and
`link-off` returned immediately. A persisted request's identity was therefore subordinate to
a live article lookup on those branches: the tests expected `replayed` or `conflict` and got
`starter-refused`. The root cause was treating the first negative read as an enduring fact,
although the existing insert-conflict path already recognised that it could expire.

**An address reused after deletion is not the same referent.** The voucher deliberately keeps
both a nullable article foreign key and the originally supplied slug. The slug preserves the
create's identity and the fact that it once had a starter; it does not authenticate whichever
article later occupies that address. `updateVoucher` selected only the slug and resolved it
again, ignoring the article id and the `ON DELETE SET NULL` evidence. Both a deletion before
the unlocked read and one between that read and the locked read could result in a replacement
starter being reported `kept` and emailed.

Slug reuse is supported by existing code, not merely a fabricated database state.
[pgShelfStore.destroy](../../src/store/pg-shelf.ts) hard-deletes the article and its terminal
jobs; [lockOrCreateArticle](../../src/store/pg-revisions.ts) inserts a new article for a free
non-reserved slug, including one supplied through `POST /api/jobs`. No tombstone reserves the
deleted name. The sibling [article-cost predicate](../../src/store/ai-calls-spend-pg.ts),
`belongsTo`, already accounts for deleted-slug reuse by anchoring matches to article identity
and birth time. That class was known locally, but the voucher readdress path did not carry its
identity evidence through the lookup.

Both defects were introduced by `ae0a8f00e`, confirmed with `git log -S` and blame on the
early refusal and slug-only readdress reads. Its stated intent was to keep replay independent
of current starter state and retain the key-free article id and slug. The implementation
preserved those facts in storage but did not use them at every decision boundary.

## Why the existing evidence agreed

The original tests exercised replay after an already committed create and readdress after
deletion with no successor at the same address. Those cases validate useful ordinary paths
without challenging the two assumptions above. Removing the first replay check was seen red,
but that mutation did not exercise a commit after the check. Resolving a deleted slug as
absent was also green, but did not exercise a valid lookup of the wrong referent. Typechecking
cannot distinguish either result because all branches return valid union members.

## What would have caught it, ranked by ease against value

1. **Test state changes between the reads that decide identity.** The reviewer added
   deterministic controlled-interleaving tests that run without Postgres: a voucher appears
   during resolution, and a deleted article's slug resolves successfully to another id.
   These were seen red before the fixes. Preserve both success and refusal branches; a failed
   lookup and a successful lookup of the wrong identity are different counterexamples.
2. **Spend identity evidence only at the decision it supports.** Before returning a live
   starter refusal, recheck persisted replay identity. On readdress, inspect the nullable id
   and compare the resolved id with the locked voucher's id before keeping the starter.
   This is a narrow fix using existing columns, with no new schema or lock order.
3. **Reserve deleted slugs forever.** Rejected: it changes article lifecycle and routing
   throughout the product to compensate for one consumer confusing an address with identity.
4. **Hold article locks throughout resolution.** Rejected for this stage: it widens the
   transaction and lock-order contract when the existing id comparison can fail closed on a
   replacement. Regressions at the evidence boundaries are cheaper and protect replay too.

## The fix that is right for the long term

The narrow fixes are also the appropriate design here: immutable create fields decide replay,
and the foreign key decides which article may accompany a readdress. The saved slug remains
useful after deletion without granting a successor the predecessor's identity. Every path
that leaves the persisted-operation decision to perform live validation must reconsider that
decision before returning a contradictory answer. These fixes are part of the uncommitted
review work; the parent's review report records their final verification.

---

Up: [postmortems.md](../project/postmortems.md)
