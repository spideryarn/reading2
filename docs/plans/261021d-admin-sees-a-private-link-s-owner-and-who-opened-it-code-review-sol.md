1. **P1 — [src/web/PrivacyPage.tsx:678](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/src/web/PrivacyPage.tsx:678):** The privacy page said signed-out visitors produced “only a rough count,” but the database also stores first and last timestamps. I disclosed those timestamps and tightened the privacy test.

2. **P1 — [src/store/pg-private-link-openers.ts:104](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/src/store/pg-private-link-openers.ts:104):** The admin response silently omitted every opener after the 100 most recent, despite the UI and documentation claiming to show who opened the link. I removed the undisclosed limit.

3. **P2 — [src/web/Ownership.tsx:144](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/src/web/Ownership.tsx:144):** On the administrator’s own article, the opener line retained the route’s initial link state. Creating a link did not show “nobody has opened it,” and turning one off could leave that line stale. I connected it to the private-link control’s live state and added a create/turn-off regression test.

4. **P2 — [src/web/help/pages/sharing.md:24](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/src/web/help/pages/sharing.md:24):** Help called the anonymous metric a count of people, although it counts page opens. I changed it to “a rough count of signed-out opens” and regenerated the Help corpus.

5. **P2 — [tests/owner-isolation.test.ts:637](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/tests/owner-isolation.test.ts:637):** The security guard’s commentary still described “two queries” and enumeration only after adding the public writer. I corrected the commentary; the guard’s allowances and enforcement were not weakened.

6. **P2 — [docs/project/security-risks.md:463](/var/tmp/spideryarn-worktrees/fbcf30ac-private-link-owner-opens/docs/project/security-risks.md:463):** R31 remains: a valid key-holder can issue unlimited requests, although increments are throttled to one per two seconds and saturated. I did not add infrastructure rate-limiting; the documented Vercel firewall rule remains a wider decision for Greg.

Files edited:

- `src/help-corpus.generated.json`
- `src/store/pg-private-link-openers.ts`
- `src/web/Metadata.tsx`
- `src/web/Ownership.tsx`
- `src/web/PrivacyPage.tsx`
- `src/web/help/pages/sharing.md`
- `tests/article-ownership.test.tsx`
- `tests/owner-isolation.test.ts`
- `tests/privacy-page.test.ts`

Verdict: Ready with fixes—no non-admin disclosure or slug/key oracle found; 120 unit tests passed, all 3,901 TypeScript files passed typechecking, and the deliberately unrun Postgres suite is non-vacuous and structurally sound.