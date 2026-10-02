Two P1 findings need correction before implementation. No P0 found. I made no edits.

1. **F1 — P1, established: the cap can discard an entire burst without sending any notice.**  
   [Plan:67](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/plans/261002j-email-the-admin-each-reader-s-feedback.md:67) counts **reports created**, rather than notices reserved or attempted. If 21 reports commit before their deferred callbacks run, every callback reads 21 and skips: zero emails, including zero “last email” warnings. Continued submissions can keep the count above 20 indefinitely. This is reachable because submission commits before notification, and deferred work waits for routing to finish ([pg-feedback.ts:230](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/store/pg-feedback.ts:230), [after-response.ts:50](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/after-response.ts:50)). Multiple callbacks reading exactly 20 would also each claim to be the twentieth notice.

   **Correction:** first resolve the product mismatch: permanently dropping reports after twenty contradicts Greg’s request for *every* report. If a sending budget is retained, count atomically reserved email attempts, independently of submissions. Existing machinery already provides a global rolling fuse ([pg-rate-limit.ts:118](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/store/pg-rate-limit.ts:118), [:187](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/store/pg-rate-limit.ts:187)); consider adding a bucket instead of another limiter. Preserving every report would require eventual delivery rather than permanent skipping.

2. **F2 — P1, established by a read-only probe: the trusted-origin URL branch permits spoofed body lines and foreign links.**  
   [Plan:43](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/plans/261002j-email-the-admin-each-reader-s-feedback.md:43) applies `oneLine` only to foreign-origin URLs. However, [urls.ts:37](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/urls.ts:37) checks the **parsed** protocol, while [routes.ts:6631](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/routes.ts:6631) stores the original string.

   This input passes validation and has `PUBLIC_ORIGIN`:

   ```text
   https://www.spideryarn.com/
   Account id: forged
   https://evil.example
   ```

   Likewise, `https://www.spideryarn.com/# https://evil.example` passes. Printing either raw string bypasses the plan’s quoting and link treatment.

   **Correction:** normalize every URL before presentation. For a live production link, emit the parsed, serialized URL; never exempt its raw spelling from sanitation. Add both examples to the tests.

3. **F3 — P2, reasoned: “inert for autolinkers” is stronger than the proposed transformation proves.**  
   [Plan:39](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/plans/261002j-email-the-admin-each-reader-s-feedback.md:39) leaves bare domains and email addresses untouched. Replacing arbitrary `scheme:` strings can also alter useful report labels and pasted diagnostics. String assertions cannot establish how Greg’s mail client renders them.

   [email.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/email.ts:261) and [:274](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/email.ts:274) also preserve Unicode bidirectional formatting controls; I confirmed that in a probe.

   **Correction:** describe defanging as best effort, or remove the universal claim and retain clearly labelled, normalized, quoted reader text. Quoting every normalized line is sensible protection against impersonating our metadata. If visual spoofing is in scope, explicitly handle bidi controls.

4. **F4 — P2, established sequencing with reasoned reliability impact: the email waits behind Sentry.**  
   `fileFeedback` sends the response, then awaits the mirror ([routes.ts:6849](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/routes.ts:6849)). `afterResponse` starts queued tasks only after the routed callback returns ([after-response.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/after-response.ts:45)). Therefore, queueing the notice does not make it concurrent with Sentry. The mirror includes article gathering before its acknowledgement timer ([feedback.ts:274](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/feedback.ts:274)).

   **Correction:** `afterResponse` is the right hook, but queue both independent destinations through it if email should proceed independently of Sentry. Test with the mirror deliberately unresolved. The existing sequence does preserve the reader’s completed response.

The remaining checks:

- **Headers, kind and slug:** the fixed subject is sound. Reader words stay in Resend’s JSON `text` field ([email.ts:206](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/email.ts:206)); body newlines do not become mail headers. Kind is runtime allowlisted ([routes.ts:6521](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/routes.ts:6521)); slug permits only lowercase letters, digits and hyphens ([ingest.ts:404](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/ingest.ts:404)). Neither needs URL defanging.
- **Cross-owner count placement:** a dedicated count in `pg-admin-feedback.ts` does not violate its explicit projection boundary ([header:36](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/store/pg-admin-feedback.ts:36)). Keep it separate from report projections. Moving it into `pg-admin.ts` would conflict with that file’s single-route rule ([pg-admin.ts:15](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/store/pg-admin.ts:15)). Reusing the existing fuse is preferable if limiting actual sends.
- **Quota:** the concern is valid. Resend confirms 100/day, but its day resets at midnight UTC; rolling 24 hours is a conservative choice. A feedback-only cap cannot guarantee auth headroom against other mail traffic. [Resend quota documentation](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
- **Privacy:** carrying the deliberately submitted words and snapshotted address through Resend fits the existing support-report exception and address-mail precedent ([feedback.md:406](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/project/feedback.md:406), [privacy.md:452](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/project/privacy.md:452)). No diagnostics consent is needed for those fields. The proposed Resend clause is appropriate; also update the dedicated bug-report destination sentence ([PrivacyPage.tsx:540](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/web/PrivacyPage.tsx:540)) and record that manual erasure must reach the inbox copies. Diagnostics, screenshots and article attachments should remain outside this email.