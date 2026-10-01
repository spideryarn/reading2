1. **P0 — `src/public/dto.ts:595`: private Debate source addresses could leak.** `publicCitationUrl` allowed a query-bearing row URL even when it was the article’s own refused `finalUrl`; percent-encoded copies also evaded the text scan. Fixed by checking `row.url`, decoding nested percent escapes, dropping affected rows, and computing the withheld count at the boundary. Regression tests: `tests/public-dto.test.ts:2108` and `:2124`.

2. **P1 — `src/public/dto.ts:521`, `src/public-types.ts:497`: Citations disclosed private Find-it activity.** The URL and `found` were removed, but `linkFrom: "web"` still revealed that the owner ran Find it. Public rows now normalize it to `"search"` and the public type excludes `"web"`; the owner panel retains its full type and behavior. Test: `tests/public-dto.test.ts:1611`.

3. **P1 — `tests/public-network-trace.test.tsx:1185`: important interaction paths were not directly exercised.** Added deep-link coverage for Trajectory stops/depth, FAQ questions and Debate names; exercised a Trajectory stop-card link; and expanded direct paid-mode URL coverage through all eight artefact modes. Each asserts one public GET and no POST/private request.

4. **P2 — `tests/access-sharing.test.tsx:514`: old-server compatibility lacked the exact regression case.** `asArticleSharing` was already correctly limiting failure to the inventory rather than rejecting the sharing card. Added a partial old payload missing the new `debate` flag and proved the owner can still stop sharing.

5. **P2 — stale public and internal copy.** Updated the sharing sentence, Privacy inventory and version date, mode documentation, counts/comments, and the plan’s as-built security contract. Principal locations: `src/messages.ts:3662`, `src/web/PrivacyPage.tsx:58`, `src/web/PrivacyPage.tsx:432`, `docs/project/reading-view-overview.md:31`, and `docs/project/mode.md:122`. The existing Debate empty-state copy was accurate.

6. **P1 — `tests/public-network-trace.test.tsx:2313`: the requested conclusion is literally too broad for signed-in non-owners.** Initial loading intentionally sends authenticated GETs to `/api/article/:slug`, `/api/jobs`, and `/api/reader`; the background jobs poll may recur. I did not change that established architecture. After initial loading, mode presses and interactions remain in the public namespace, except for that account-owned jobs poll, and make no POSTs.

Files edited:

- `docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md`
- `docs/project/mode.md`
- `docs/project/reading-view-overview.md`
- `src/messages.ts`
- `src/modes.ts`
- `src/public-types.ts`
- `src/public/dto.ts`
- `src/store/pg.ts`
- `src/types.ts`
- `src/web/AccessSharing.tsx`
- `src/web/CitationsPanel.tsx`
- `src/web/Dock.tsx`
- `src/web/PrivacyPage.tsx`
- `src/web/activation.ts`
- `src/web/public-artefacts.ts`
- `src/web/shared-inventory.ts`
- `tests/access-sharing.test.tsx`
- `tests/public-dto.test.ts`
- `tests/public-network-trace.test.tsx`

Checks: full typecheck passed for all 2,306 source files; targeted Biome check and `git diff --check` passed. Vitest refused to start because of the box’s memory guard, so no tests executed.

**Verdict:** The visitor boundary is sound after these fixes, subject to narrowing the “only `/api/public/`” claim for signed-in non-owner session traffic.