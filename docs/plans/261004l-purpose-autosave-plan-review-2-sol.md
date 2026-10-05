The keyed child fixes retirement **within one session**, but the revised plan still has a live-page ordering failure. I changed no files. An in-memory React harness using the actual hook reproduced F9.

The unmount answer is **yes, with qualifications**: [the cleanup](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:257) waits for an outstanding request; its `finally` then compares the latest draft and calls that child’s `leave`. A keyed replacement has separate refs and I/O closures, so the old draft targets the old slug. It sends nothing if unseeded or already saved. Delivery remains best effort.

1. **F9 — P0, established: different sources can create overlapping sessions for the same article.**

   **Scenario:** Change from `/add/https://example.com/paper` to `/add/https://example.com/paper/`. These are different `source` values, but [`urlKey`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/ingest.ts:265) treats them as the same article, and [`freeSlug`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/jobs.ts:4064) can adopt the same slug.

   The `source + slug` key retires one session and creates another. Old PATCH A is outstanding, with draft B waiting behind it. The new session saves C. Then A completes and the retired session flushes B. The harness observed **C → A → B**, leaving B stored despite C being the newest reader text. [The server update](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/pg-shelf.ts:389) accepts each write.

   Thus the restated ordering guarantee is accurate **per session**, but not across the proposed session replacements. This is a live-page failure separate from the arbitrated `pagehide` limit.

   **Replacement wording:**

   > “Session retirement preserves ordering within that session. Before a replacement session reads or writes a slug, any retiring session for that same slug must finish its outstanding and final writes. Different-slug sessions may proceed independently.”

   The current `leave(): void` does not expose completion of the final write, so the plan must specify the concrete handoff mechanism.

2. **F10 — P1, established: the stated save callback violates the hook’s return contract.**

   **Scenario:** Section 1 specifies `savePurpose(slug, text || null)`. [`savePurpose`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/purpose.ts:33) returns `Promise<string | null>`; [the hook requires `Promise<string>`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:110).

   Direct wiring fails typechecking. If that mismatch is bypassed, clearing returns `null`, which the hook interprets as unseeded: subsequent commits and unmount flushing stop saving.

   **Replacement wording:**

   > “Its save callback is `async text => (await savePurpose(slug, text === "" ? null : text)) ?? ""`, matching the existing purpose callers.”

3. **F11 — P0, reasoned: parent/child draft ownership is unspecified at the points where words can be lost.**

   **Scenario:** A natural implementation mirrors the parent textarea into the child through an effect. The reader types B while the child still holds saved A; completion and an opening decision arrive before that mirror runs. The child reports clean, its commit reads A, and navigation drops B.

   Seeding has the opposite risk: the child adopts stored S while the parent still displays blank. That recreates the hidden-purpose problem. Likewise, server normalisation updates only the hook’s draft; blindly copying that answer into the parent can overwrite newer typing. Keying the child does not fence callbacks that update shared parent state.

   These are **reasoned**, because the bridge has not been specified or built.

   **Replacement wording:**

   > “Every textarea edit synchronously updates the parent’s current-text ref and the active session’s draft before any commit or opening decision. Seeding reads that latest ref. Stored-value adoption and normalised answers update the textarea only for the active session and only if no newer edit superseded them. Retired sessions cannot update parent text, status or navigation.”

   Also resolve the carry rule: section 1 appears to carry typed words across a new address, while the new-address test requires an empty box. Specify source changes separately from same-source Retry slug changes.

4. **F12 — P1, reasoned: adding `inFlight` to the idle trigger can create automatic refusal retries.**

   **Scenario:** Lift the current timer and add `inFlight` to its dependencies. PATCH A is refused; `inFlight` changes to false; [the existing pending predicate includes `error`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx:63); another timer starts. Every refusal schedules another request indefinitely.

   [The current timer](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx:143) explicitly avoids this. The revised trigger needs a refusal rule.

   **Replacement wording:**

   > “A successful write settling may rearm the timer for a remaining dirty draft. A refusal does not schedule another attempt without a new edit or explicit commit. Pending-warning state is separate from automatic-retry eligibility.”

5. **F13 — P1, established: section 6 still equates an unseeded stopped session with an absent article.**

   **Scenario:** The article row exists, the import fails later, and the purpose read is delayed or fails. The session is unseeded and the add stopped, so the specified message says **“There is no article to save this to yet.”** That is false. [`purposeFailed`](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/routes.ts:6636) catches any shelf-read failure; it does not establish absence.

   **Replacement wording:**

   > “Not saved. We haven’t confirmed this article’s saved reason.”

   For exhaustion:

   > “Not saved. Could not read this article’s saved reason.”

   The automatic-modes qualification now handles modes being off. For precision, replace “anything generated later” with “newly requested generation”: already queued jobs retain their captured profile even when they execute later.

**DO NOT BUILD**