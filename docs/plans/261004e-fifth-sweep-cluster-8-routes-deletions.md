# Fifth sweep, cluster 8: `routes.ts` deletions

Cluster 8 of [261003f](261003f-fifth-codebase-sweep-umbrella.md). Eight small items, most of them
deletions, in the order the umbrella's row gives. Evidence for each id is in
[the server request layer audit](../investigations/261003b-fifth-sweep-server-request-layer.md)
(R-items), [the cross-zone leads](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md)
(X-items) and [Sol's review of the first](../investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md).

**What it is for:** `src/routes.ts` carries several things that say one thing twice or describe
code that is gone. Each makes the next editor read more and trust less. Nothing here changes what a
reader sees, with two small exceptions named under R9 and R11.

## Re-run against today's tree (`0a98b28ab`, 2026-10-04)

The audit's line numbers are stale; the file has grown from about 10,400 lines to 11,099. Counts:

| Item | Audit said | Today |
|---|---|---|
| R5 | header inventory, lines 1–110 | lines 10–123, the whole list; 106 rows in the contract |
| R4 = X6 | 16 inner wraps in `first-capture` rows | **16**, at 9071, 9122, 9408, 9429, 9457, 9539, 9696, 9748, 9816, 9976, 10007, 10122, 10204, 10290, 10372, 10435. A seventeenth, at 8813, is in an `article: "handler"` row and stays |
| R7 | `/find` has no caller | none in `src/web`, `scripts`, `tools`, `evals` (the three `/find` hits are comments or unrelated). The row is at 9398; one of the 16 wraps is inside it |
| R9 | `ENOENT → 404`, ~7351 | 7751, unchanged |
| R11 | `slugPart` interpolates | `src/routes.ts:5422` and `src/public/routes.ts:351`; two rows (8782, 8806) already say a bare `"Not a slug"` |
| R10 | 10 `sse(res)` callers | 10. Three hand `gone` to the model (`streamLinkSummary`, `streamAskedTerm`, `markOneAnswer`), `search` does for quick runs only, six never do (`answer`, `streamTermLookup`, `streamCitationInvestigation`, `runRefereeCriterion`, `runRefereeClaims`, `runMirror`) |
| X8 | `isAllowed` is `true` | `src/auth.ts:314`; `[auth-beta]` appears once in the tree |
| X7 | high-power repeats `admitOrResync` | `src/billing/admission.ts:509–541`, unchanged |

## What gets done

One stage, two commits (deletions that change no behaviour; then the two that do).

1. **R5 — delete the header inventory.** Replace lines 10–123 with a pointer to
   `EXPECTED_AUTH_ROUTES` in `tests/authenticated-api-route-contract.test.ts` (which a test keeps
   true) and to `src/public/routes.ts`. Nothing reads the list.
2. **R4 = X6 — delete the 16 inner `withSpendAttribution` wraps**, and make the route contract
   refuse a `first-capture` row whose handler calls it. **Red first:** the new contract rule fails
   on today's table, naming the rows. The dispatcher's wrap is already tested by
   `tests/route-spend-attribution.test.ts`. Comments beside each wrap that explain *why* the row is
   attributed stay where they still say something true, reworded to name the row's `article` field.
3. **R7 — delete `POST /api/citations/:slug/:id/find`**: the row, its `EXPECTED_AUTH_ROUTES` entry
   and order-list line, `tests/citation-find-route.test.ts`, that file's entries in
   `tests/store-migration-registry.ts`, and the `findCitation` import. `makeFindCitation` and
   `runCitationLookup` in `src/citation-find.ts` stay: Investigate runs the lookup as step one, and
   `tests/citation-find.test.ts` and `tests/citation-investigate-route.test.ts` cover it.
   `docs/project/citations.md` says the route "still answers"; that sentence is corrected.
   **Wider than the file set:** the deletion leaves `findCitation` in `src/store/index.ts` with no
   caller. Deleting that export is the honest end of the job (a dedup that leaves a copy alive is
   worse than none), so it goes too unless Sol sees a reason not to.
4. **R9 — delete `ENOENT → 404`** in `serveApi`'s catch. **Red first:** a test in
   `tests/routes.test.ts` makes a store call reject with an `ENOENT` error and expects a 500 with
   the reader's sentence and a `captureFailure` call; today it is a 404 carrying the raw
   `ENOENT: … open '/path'` text. *This is one of the two behaviour changes:* a missing file inside
   a request becomes a reported 500 instead of a silent 404 that leaks a path.
5. **R11 — fixed words in the two slug messages.** `slugPart` and the public `slugFrom` say
   `"Not a slug"` and no longer append the value. **Red first:** a test that the 400's body is
   exactly the fixed sentence for a non-slug capture, on both dispatchers. Existing tests match
   `/Not a slug/` and stay green. *The other behaviour change:* the reader's 400 loses the echoed
   value, which was already in the URL they sent. **Not done here:** the same interpolation in
   `src/store/require-slug.ts`, `src/store/public-reader.ts`, `src/jobs.ts` and
   `src/term-lookup.ts`, which are outside this cluster's files. Listed in the debrief.
6. **R10 — say what each stream does when the reader leaves.** Sol showed the audit's
   stored-versus-ephemeral rule is false (Mirror stores nothing and runs on; glossary Ask stores
   and stops). So `sse()`'s comment gets the census above as a short table and the false
   *"it applies to every streaming route here"* is narrowed to what it is true of (the
   already-closed check). The product question is the umbrella's *For Greg 4*; nothing changes.
7. **X8 — delete `isAllowed` and the unreachable `[auth-beta]` 403.** Greg's 2026-08-26 quote is
   already in `docs/project/auth.md`. Pointers that name the function (`auth.md` twice,
   `security-map.md` twice, `security.md` once) are retargeted to `requireUser`. In
   `security-map.md`, an entry-point doc, only the pointer changes: the rule *"There is no
   allowlist"* keeps its words.
8. **X7 — `chargeAndSwitchOnHighPower` calls `admitOrResync`.** Deletes the hand-rolled resync and
   the `case "stale"`. `tests/billing-high-power.test.ts` already pins both stale paths (503 after
   a resync that did not help; success after one that did), so this is characterised before it
   changes; the mutation check at the end proves those two can fail.

## The simpler option passed over

Do R5, R4 and R7 only and leave the rest as comments. Passed over because R9 and R11 are each a
one-line change with a test, and X7 and X8 are deletions with existing coverage; leaving them
would cost a second agent the same reading.

## Done looks like

`npm test`, `npm run typecheck` green; the new contract rule red before the wraps go and green
after; the two behaviour tests red then green; mutation checks on X7 and R4's rule; Sol's plan and
code reviews answered; the umbrella's row updated.

## Sol's plan review (2026-10-04)

[The review](261004e-fifth-sweep-cluster-8-plan-review-sol.md): no P0 or P1, *ready with these
fixes*. It confirmed all 16 wraps pass exactly the dispatcher's slug, and that X7 and X8 are
equivalent. Four findings, all accepted:

- **F1 (P2):** deleting `tests/citation-find-route.test.ts` would drop Postgres checks of behaviour
  that survives (a stored find read back as `web`; the article's own link winning; a changed `why`
  hiding the reading and keeping the link). **Done:** the cases move to a test that seeds the store
  and reads through `GET /api/citations/:slug`.
- **F2 (P2):** with the route gone, `makeFindCitation` has no production caller either, so step 3's
  "it stays" was wrong. **Done:** the factory goes; its tests are re-pointed at `runCitationLookup`.
  This widens the cluster's file set to `src/citation-find.ts`, `src/store/index.ts` and three test
  files.
- **F3 (P2):** the contract's count controls go from 90 and 110 to 89 and 109. **Done.**
- **F4 (P3):** more present-tense mentions of the route (`citations.md`, `setup-dev.md`,
  `src/types.ts`, a test header, the registry's prose) and `slugFrom`'s comment defending the
  interpolation. **Done.**

## Log

(filled in as it lands)
