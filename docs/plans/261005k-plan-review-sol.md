**Build with changes.** The two main choices are sound: make the lens a chat, and keep profile-based suggestions separate from the existing picker. The plan needs tighter rules for suggestion validation, state, and privacy.

I reviewed base `f2c539eee` independently before reading the plan. No files were edited. I ran two small, read-only probes: command matching/catalogue filtering, and an in-memory Drizzle migration diff. I did not run browser checks or paid calls.

**Findings**

1. **F1 — P1 — `knownOptions` does not restrict answers to modes.**  
   **Established:** traced and ran the catalogue filter; the proposed consequence is reasoned. [Plan:116](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:116), [command-pick-call.ts:80](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/command-pick-call.ts:80).

   The filter accepts Archive, Export, Run again, High-powered AI and Experimental-switch keys. Checking that a returned `modes[].key` was offered is therefore insufficient unless the offered set itself contains only allowed mode commands.

   Specify that restriction on the server and require the browser’s resolved command to be `mode` or an explicitly supported `submode`. Test an otherwise valid Archive key returned under `modes`.

2. **F2 — P1 — Existing suggestion state cannot display or preserve this list.**  
   **Established:** traced the lifecycle and ran empty-draft matching. [Plan:130](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:130), [CommandBar.tsx:1580](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CommandBar.tsx:1580), [CommandBar.tsx:1624](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CommandBar.tsx:1624).

   An empty draft matches ordinary mode rows. Existing suggestions appear only when `matched.length === 0`, so these suggestions would be hidden. Opening and closing also call `dropAsk`, clearing existing suggestion state.

   Give B separate retained answer state and explicit display precedence. Resolve its commands against today’s capabilities, while keeping the answer across closes. Test suggest → press search → reopen → press the next suggestion, plus typing into the bar and clearing it again.

   `typedOnly` itself is safe: `quickSearchRow` can be drawn directly without passing through ranking.

3. **F3 — P1 — The cache omits one of the model’s inputs.**  
   **Reasoned:** from the declared input and cache key. [Plan:122](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:122), [Plan:134](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:134).

   The model reads both profile halves, but the cache uses article and purpose only. Editing *About you* would keep suggestions produced for the previous profile.

   Invalidate on the full rendered profile, and scope retained state to the signed-in owner. Also specify how the bar learns about saves: the existing [purpose.ts:79](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/purpose.ts:79) hook reads once per slug; it does not observe subsequent edits. Include profile edits and edits made while a suggestion request is outstanding in the acceptance tests.

4. **F4 — P1 — The explanation of the existing profile rule is inaccurate.**  
   **Established:** traced the actual wording. [Plan:142](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:142), [profile.ts:188](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/profile.ts:188), [reader-profile.md:173](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/project/reader-profile.md:173).

   The rule does not say “only when nobody sees the call.” It forbids putting profile material into queries, tool arguments or anything leaving the conversation. Visibility and a press are the proposed justification for an exception.

   State that exception honestly. Keep `PROFILE_RULES` unchanged for existing article/chat prompts, and give the suggestion prompt its own rules, as Quiz already does. The exception should distinguish purpose-derived topics from personal details in either profile box; personal details can occur in the reason too.

5. **F5 — P1 — The proposed privacy addition describes only the first transfer.**  
   **Reasoned:** traced the downstream search, storage and sharing paths. [Plan:149](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:149), [PrivacyPage.tsx:482](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/PrivacyPage.tsx:482), [PrivacyPage.tsx:532](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/PrivacyPage.tsx:532).

   Saying Luna receives the profile is true, but incomplete. Confirmed derived words also reach Jev; saved searches are shared with visitors when sharing is enabled; a sent chat question may become material for web searches.

   Add a short explanation of those consequences. Existing disclosure of searches and chats helps, but does not explain that their words can originate in the profile. Avoid promising that a prompt prevents personal-detail leakage. Add assertions for this new disclosure to the existing privacy-page test; checking model names alone cannot catch its removal.

6. **F6 — P1 — A failed purpose read must not become “nothing to suggest.”**  
   **Established:** traced the helper the plan proposes reusing. [Plan:117](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:117), [routes.ts:6774](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/routes.ts:6774).

   `resolveProfileParts` catches a shelf-read failure, returns `purpose: null`, and separately reports `purposeFailed`. That tolerance serves existing prompts, which can proceed using the global profile. This feature specifically promises suggestions from the purpose.

   Check ownership independently, and treat `purposeFailed` as a retryable failure. Only a successful read establishing an empty purpose should return the no-call answer.

7. **F7 — P2 — Replacing the Debate CHECK is not the whole schema change.**  
   **Established:** traced the current constraints; the new-column consequence is reasoned. [Plan:83](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:83), [schema.ts:3759](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/db/schema.ts:3759).

   Extend `chat_threads_origin_none` to require `origin_lens IS NULL` when there is no origin mode. Retain `origin_item_id IS NULL` for both Debate shapes. Otherwise the database permits origin data that the mapper discards.

   Test the database constraints as well as route validation: plain chat, old claim, lens, mixed claim/lens, and lens without a mode.

8. **F8 — P2 — The argument against every small version of “together” overlooks existing Search machinery.**  
   **Established:** traced independent search creation. [Plan:172](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:172), [useSearch.ts:800](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/useSearch.ts:800).

   `useSearch.ask(words, "quick")` creates a separate run with its own id. Search already displays several saved runs together. The shared typing draft prevents batching through `quickSearchPress`; it does not prevent independent searches.

   Deferring a mixed batch of searches, generating modes and chats is reasonable. A smaller option exists: **confirm selected quick searches, open Search once, and create separate visible runs through the existing controller**. It needs a handoff and failure/cancellation semantics, but no new server queue. Include that option in Greg’s question.

9. **F9 — P3 — The price-label premise contradicts current policy.**  
   **Established:** traced rendering and its governing explanation. [Plan:174](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:174), [activation.ts:332](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/activation.ts:332).

   Ordinary bar rows show **“generates”**, not call prices. Numerical AI costs are restricted to administrators. Reusing the existing command preserves the marker and activation behaviour; it does not preserve a price label.

10. **F10 — P3 — “It cannot return a list” is literally false.**  
    **Established:** traced `PickAnswer` and `readPick`. [Plan:40](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md:40), [command-pick.ts:49](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/command-pick.ts:49).

    A row answer includes `others`, an ordered list of alternative keys. The accurate distinction is that the picker cannot produce several independent actions with newly written arguments.

**Accuracy of “What is there today”**

| Claim | Assessment |
|---|---|
| Bar picks one command, extracts only words present in the sentence, sees neither article nor profile | Accurate, except for F10: row answers also carry alternatives. Jev picks; Luna performs argument extraction. |
| Purpose is `articles.purpose`, capped at 600; global profile is `reader_profiles.profile`; the helper loads both | Accurate. `renderProfile` produces up to two labelled lines, omitting empty halves. |
| Bar quick search writes one article draft and opens Search; simultaneous handoffs overwrite that draft | Accurate for the handoff/typing session. It should not imply that Search stores only one run. |
| `handToChat` seeds an unsent question; Debate claims are the sole stored-origin caller; the CHECK requires block and quote | Accurate. Other handoffs exist without origins. |
| Debate is unsteered, revision-scoped, replaced on regeneration, and article-stamped | Accurate. It has two web-search calls **plus a synthesis call**. “Shared with any visitor” needs the usual qualifications: sharing must be enabled, and the public projection can withhold inadmissible rows. The approximate cost is an estimate, not a fixed charge. |

**Answers to the seven design questions**

1. **A is the right interpretation of Greg’s later instruction.** His explicit “definitely” about custom research becoming Chat outweighs the earlier tentative steered-Debate idea. The plan correctly names the loss of checked Reception/Claims rows.

   The second origin shape fits the existing lifecycle. Because both shapes use `mode: "debate"`, switching on `mode` no longer narrows to a claim. Use an explicit shape discriminator or deliberate property guards. Check `Reader.checkClaimInChat`, server block-membership validation, `thread-source.ts`, and the test seeder’s block-identity collection—not only the mapper switches.

   Compare claim-to-claim and lens-to-lens explicitly; mixed shapes must differ. Existing retry/edit paths should continue omitting a supplied origin and preserving the stored one. Exercise both the route’s 409 check and `chat.ts`’s repeated origin check.

   A nullable `origin_lens` column is reasonable. **Installed Drizzle 0.31.10 does generate CHECK-expression changes**: my probe produced DROP constraint → ADD column → ADD constraint. The older schema comment saying it cannot is stale. Inspect generated SQL and avoid adding a duplicate hand-written replacement.

2. **The handoff works with Experimental off because Chat is not experimental.** A bar-generated lens can still start a chat while Debate is hidden. Its Debate “Your angles” entry point is then hidden; Chat’s list remains the way to find it.

   With Chat already open, handoff starts a fresh conversation and leaves the old draft under its old id. However, only the selected unsent conversation is restored after the band unmounts. A displaced, never-submitted draft can become unreachable after a later mode change. This is an inherited limitation worth explicitly testing and disclosing before broadening handoff use.

   On phones, `showBand` restores a stepped-aside band. Dictation remains available, but Live is deliberately unavailable until the first typed Send establishes the origin. Place the lens controls outside the stored-Debate-ready condition, so they work before a Debate run exists.

3. **Separate endpoint and call: yes.** The existing `openRouterJson` and quick-model constant are appropriate machinery; suitability for this generation task remains an eval question.

   Add the job to the model/wire inventory, gateway routing, reasoning policy and cost category. Choose explicit output-token and timeout limits; do not inherit the picker’s tiny extraction budget. Attribute the route’s spend to the slug using the authenticated route table, and test owner isolation and malformed captures.

   A production call through the gateway and request collector needs **no bypass spend declaration**. An eval needs a collector, or a declaration only if it genuinely bypasses the gateway.

   Keeping no rate limit is defensible under the accepted trust model, but needs its own bounded-cost decision. In-memory reuse and a disabled button do not stop repeated HTTP requests.

4. **Privacy holds only after F4 and F5 are addressed.** The existing picker’s sentence/list-only descriptions remain true if they stay scoped to `/api/command-pick`. The broader interface-model wording in `chat-llm-help-commands-vision.md` needs the planned update. I found no privacy-page test pinning the proposed new clause.

5. **Mode command reuse preserves activation.** `activate` calls the same mode/submode handlers as ordinary rows, including generation arming. Preserve command identity and kind while drawing `why` separately. The spending disclosure is “generates.” Quick-search reuse is sound after the display, persistence and invalidation changes in F2/F3.

6. **Defer mixed “run all”; reconsider search-only confirmation.** The latter is a small, honest interpretation of “together.” Whether to include it now is a product choice, not a technical impossibility.

7. **A → B is the right dependency order.** Stage 1 can land alone with the complete migration, mappings and old-origin compatibility checks. Stage 2 can land alone after that, with privacy changes in the same stage. Move each feature’s essential browser checks into its own stage before calling it complete; Stage 3 can remain the combined sweep.

   Keep the simpler bare-purpose search as an eval baseline. Add comparisons involving another paper: without article context, the model can propose a search that sounds useful while being a poor passage query. Do not describe the feedback item as fully resolved while “confirmed together” remains unanswered.

VERDICT: build with changes