# A downstream guard cannot protect an upstream first-open marker

Review of commit `815a2608e` reproduced a first-open default being consumed by a bare Metadata
visit. Deployment and reader exposure were not established. The fix is uncommitted in the review
worktree.

## The class: eligibility checked after its once-only marker was written

`useLastView` lives in the shared `ArticlePage`, which remains mounted when switching between
Metadata and the reading view. The commit made an empty saved view into a persistent first-open
marker. Both the layout-effect claim and the passive save could write that marker on Metadata,
while only the downstream `firstOpenHref` checked that the route was the reading view. Refusing
the default there was too late: the later article visit already had a key.

Two regression cases first failed with `expected '' to be null` after opening `/read/x/metadata`.
They cover both a fresh component on the later article visit and the same component changing view.

The first correction passed with direct history writes but failed when the test used `navigate`:
`expected '' to be '?mode=summary&margin=1'`. The old Metadata listener saw the new article address
before React rendered it, and wrote the marker ahead of the arrival effect. Eligibility belongs
at every writer, including the listener during navigation.

## Why the original checks agreed

The pure Metadata test checked only that the URL builder returned no default. It did not inspect
storage or the following article arrival. The composed hook tests omitted Metadata transitions.
A slug-only lifecycle guard also meant that merely suppressing Metadata's marker writes would
not cause a new decision on the surviving component's first article arrival.

## The fix

First-open eligibility now includes the article view, and the effect observes view transitions.
Restoration retains its previous rule: only a slug arrival restores a saved view. A Metadata save
with no rememberable state leaves a missing key missing; existing stored views still save. The
save listener requires both slug and view to match its component, so a departing view cannot
write an incoming view's marker. StrictMode replay still makes one decision per arrival.

## Countermeasures, ranked by cost and value

1. **Keep storage-and-navigation regression tests.** Implemented: inspect the intermediate key
   and final URL, with both remount and same-instance navigation through the real router. Keep
   controls for restoration and StrictMode alongside them.
2. **When a write gains once-only significance, inspect every writer and lifecycle.** Cheap review
   work: a guard on the visible result does not establish that earlier side effects were eligible.
3. **A separate marker or persistent state machine.** Rejected here: it adds storage machinery
   without automatically fixing view eligibility or the departing listener.

The lesson is to test the decision's surviving side effects and the next arrival, rather than
stopping at a correctly refused visible result.

See [postmortems.md](../project/postmortems.md) and the
[plan](../plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md).
