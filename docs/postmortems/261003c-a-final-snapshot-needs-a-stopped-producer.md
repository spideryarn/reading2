# A final snapshot needs a stopped producer

Stage 3 review of [GPT-Live](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md)
found two shutdown races, both introduced in `fd8ab7e62`. No reader impact was established.

On `pagehide`, a sequence copied from Realtime finalized the meter while GPT-Live deliberately
kept its channel alive to receive final usage. `LiveMeter.flush()` marks the queue finished
synchronously; its next `report()` silently returns. A final 32-second report delivered during the
close grace therefore disappeared. The new flow regression went red with no final usage post.

Conversely, persistence took two snapshots while the transcript producer was still alive. A fragment
arriving during the second slow append missed both snapshots. It remained visible without an unsaved
flag and would disappear on the next start. The red-first slow-append test showed an open channel
after the bounded close grace, while the final save was still pending.

The class is **finalizing state before quiescing its producer**. The meter stopped too early; the
transcript channel stopped too late. Adding another snapshot would only move the latter race.

The lasting fix preserves the existing bounded grace: a nonterminal meter checkpoint retries
queued reports immediately with `keepalive` and keeps accepting final usage; after the close grace,
the hook closes the transport and
clears its channel ref before freezing the final transcript. Queued channel callbacks can no longer
change that snapshot. The meter then finalizes with all usage received during grace still available.
The Realtime hook and the shared meter's default behavior are unchanged.

Countermeasures, ranked by effort against value:

1. Fake-wire flow tests deliver final usage after `pagehide` and hold an append open beyond the
   close deadline. Implemented, and both failed before the fixes.
2. Explicit producer shutdown before final consumer snapshots prevents the whole race, rather than
   hoping a fixed number of drain passes is sufficient. Implemented in the GPT-Live hook.
3. A durable outbox is rejected here: it cannot recover events the consumer deliberately rejects,
   or fragments never handed to persistence. Lost events after actual page destruction remain the
   experiment's accepted limitation.

A copied shutdown sequence carries protocol assumptions. Recheck which producers can still emit
after each shutdown step before calling any snapshot final.
