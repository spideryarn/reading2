Land with fixes, after the database-backed route test runs successfully.

1. **P1 — Offers without a basis could overwrite existing reader data. Fixed.**  
   When the route could not read a field—or `useProfile: false`—the tool produced an offer without `basis`; the card then skipped its stale-value comparison and could overwrite whatever its fresh read found. `basis` is now required, unread fields produce no offer, and persisted/forged offers without a valid basis draw no card. Evidence: [src/chat-tools.ts:2160](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/chat-tools.ts:2160), [src/types.ts:3265](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/types.ts:3265), [src/web/GuideSaveOffer.tsx:70](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/web/GuideSaveOffer.tsx:70), [tests/guide-route.test.ts:223](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/tests/guide-route.test.ts:223).

2. **P2 — The security map still omits this write-button boundary. Recommendation unchanged.**  
   The map names `runTool` and `chipFor`, but not `GuideSaveOffer`. The proposed wording is already recorded for approval; I did not edit the protected document. Evidence: [security-map.md:114](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/project/security-map.md:114), [q-w2740x.md:44](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/user-feedback/questions/q-w2740x.md:44).

3. **P3 — A narrow read/write race remains. No change.**  
   Save and Undo compare through a GET and then use unconditional PATCH routes, so another tab can still write between those operations. Closing this requires atomic compare-and-set changes across both stores/routes, outside this stage; the plan already records that decision. Evidence: [GuideSaveOffer.tsx:170](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/web/GuideSaveOffer.tsx:170), [routes.ts:6634](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:6634), [routes.ts:7909](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:7909).

Verification:

- Four unit files: 74 tests passed.
- Typecheck passed via the same script using `node --import tsx`; the npm wrapper itself could not open its sandbox-blocked IPC socket.
- `guide-route.test.ts` could not collect because Docker/Postgres access is denied in this sandbox.
- Scoped lint reported only existing complexity/style advisories.