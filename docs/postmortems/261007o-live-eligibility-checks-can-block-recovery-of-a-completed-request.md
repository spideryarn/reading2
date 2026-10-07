# Live eligibility checks can block recovery of a completed request

Caught in the review of stage 2 of [261007j](../plans/261007j-gift-voucher-starter-article-by-private-link.md), introduced by `90d414d4c`. No production incident was observed. Root-cause investigation was delegated to a read-only subagent; the reviewer reproduced and fixed the defect.

## The class: a retry is checked as though it were a new request

`AdminVouchersPage.tsx` disabled Create and returned from submit whenever the starter's current shelf state was ineligible. After a lost create answer, `useAdminVouchers` still held the request's UUID, and the server deliberately answered matching replays before resolving today's starter. Turning off the link, deleting the article, or making it abstract-only therefore blocked recovery of a voucher that might already exist. This recreates the plan review's F2 at a different boundary.

The existing replay test changed the draft's starter, but never changed the original starter's live state. Three new regression cases failed at `expected true to be false`: the button stayed disabled after a lost answer and a shelf refresh.

## Lasting fix and countermeasures, ranked

1. **Exercise recovery after live state changes.** Done in `tests/admin-vouchers-page.test.tsx`: off, deleted and minimal starters can retry the exact same body and UUID; changing the email blocks a new create. These cases were red before the fix.
2. **Use the sending boundary's identity for the recovery exception.** Done: `useAdminVouchers.canReplay` and create both use `createKey`. The form has no second approximation of what counts as the same request. Its status explains recovery instead of saying Create must wait.
3. **Remove eligibility checks entirely.** Rejected: it would let new drafts submit known-ineligible starters. The server still owns all admission decisions and may refuse a retry if the first request never created anything.

The general lesson is to test both halves of an idempotent workflow: whether the server can replay and whether the client still permits that replay after its prerequisites change.
