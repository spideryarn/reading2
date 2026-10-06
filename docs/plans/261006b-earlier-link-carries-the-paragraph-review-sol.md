The privacy and same-site invariant holds for the proposed server design. Compatibility also works both ways: the new client can normalize missing `at`, and the old validator ignores extra fields. Excluding the public shelf and Metadata is consistent with limiting this feature to reading pages.

- **P1-F1 — P1, established: an unchanged `at` can land at the top.**  
  Start on `/read/a-piece?at=spya-k3m9qt&utm_source=mail`, then click the proposed `/read/a-piece?at=spya-k3m9qt` link. [`navigate`](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/src/web/router.ts:1408) changes the address and scrolls to zero. [`useReadingPosition`](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/src/web/reader/useReadingPosition.ts:58) sees an unchanged `at` and does not restore it. The scroll tracker subsequently clears `at`.

  A local DOM probe using the actual `Link`, history wrapper and reading-position hook reproduced `scrollY: 1200 → 0`, then an empty query. Its positive control, where the link changed `at`, landed at 1200.

  **Smallest change:** add this wording to the client section:  
  > “For an ordinary click within the currently open article, when the destination’s non-null `at` equals the current `at`, explicitly scroll to that block using the existing `scrollToBlock` helper after navigation. Preserve modified-click behavior and dialog closing.”

  Add a regression test asserting the scroll destination for this scenario; an `href` assertion alone misses it.

- **P1-F2 — P2, established: the plan names the wrong route-test file.**  
  [`tests/feedback-route.test.ts`](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/tests/feedback-route.test.ts:396) already pins the exact GET response and verifies that extra store fields—including the raw address—do not escape. The conditional reference to `tests/routes.test.ts` misses this existing guard.

  **Replace that test bullet with:**  
  > “`tests/feedback-route.test.ts`: extend the exact GET-response assertion to include `at`, covering an ID and null, while retaining extra private fields in the fake store row to prove the route still selects fields explicitly.”

- **P1-F3 — P3, established: the rejected `href` design’s justification is false.**  
  A client receiving one `href` need not accept “a path with some query.” It can require a same-site path, exactly one `at` parameter, no other query or fragment, and an ID passing `isSpideryarnId`.

  **Replace the rationale with:**  
  > “A server-built `href` could be validated equally strictly. Keeping `at` separate lets the client reuse `isSpideryarnId` directly without parsing another URL.”

  The separate-field design remains reasonable; switching designs is unnecessary.

No repository files were changed by me. Vitest failed before running tests because Vite could not create its temporary directory. Concurrent implementation edits appeared during review; these findings concern the original plan.

**Verdict: revise before building—P1-F1 is an established blocker.**