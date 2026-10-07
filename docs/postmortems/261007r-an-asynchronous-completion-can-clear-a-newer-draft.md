# An asynchronous completion can clear a newer draft

Found by source review while reviewing stage 2 of [261007j](../plans/261007j-gift-voucher-starter-article-by-private-link.md). No production incident was observed or reproduced. Reported as wider finding F13, and fixed after the review (§ Lasting fix). A read-only subagent traced the behavior to **`5f15ef44c`**, the original voucher form. `90d414d4c` adds the starter to the same reset pattern.

## The class: completion applies to whatever draft exists now

`CreateForm` captures the request's fields before `await create(input)`. Only its submit button is disabled, so fields remain editable while the request is in flight. On success it clears every field unconditionally. A reader can submit voucher A, enter B's email or select B's starter, then lose B's unsent draft when A succeeds. The parent of stage 2 already does this with email, count, name and notes; this is not a new server defect.

The existing create tests return immediate POST responses and do not edit fields before success. They check that submitted fields clear, agreeing with the reset while never testing whether the draft changed. This finding is source-confirmed; there is no deferred-response regression in this review, and no claim of browser reproduction.

## Lasting fix and countermeasures, ranked

1. **A deferred-response regression that edits before the response resolves.** Cheap and the necessary first step for the separate fix: assert that voucher A is sent and B's unsent input survives. Not implemented here, so this report is not a completed fix.
2. **Clear only the draft that was submitted.** Compare the current draft's identity with the submitted identity before clearing it, or disable all editable draft controls during submission. The identity check preserves work already typed; disabling is simpler and gives up editing while waiting. Both need to cover the whole form, not just the new starter.
3. **Remove every success reset.** Rejected: it leaves successfully submitted drafts ready to create another voucher accidentally. A timeout or faster request also does not fix the class.

**Fixed after the review, the same day, with 1 and 2.** `CreateForm` keeps the current draft's
identity in a ref and clears the fields only when it still equals the draft that was sent; the
success sentence shows either way. `tests/admin-vouchers-page.test.tsx` § *keeps a draft typed
while the create was in flight* was seen red (`expected '' to be 'second@example.test'`) before the
fix, and a companion test pins that an untouched draft is still cleared.
