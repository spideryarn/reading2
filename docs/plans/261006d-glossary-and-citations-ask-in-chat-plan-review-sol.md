The design is sound, but D1 introduces one concrete failure for valid glossary entries. I reviewed HEAD `5ca4373e`; no files changed.

- **F1 — P1, established: the 300-character snapshot cap can make the button’s first Send fail.** Glossary names are trimmed but never length-limited: [glossary.ts:278](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/glossary.ts:278), [glossary.ts:337](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/glossary.ts:337). A read-only harness through `buildGlossary` accepted a 301-character name and returned one valid entry. Passing that name unchanged as `origin.quote` would violate D1’s proposed route cap, contradicting D3’s promise that ordinary reader actions encounter no new refusal.

  **Smallest fix:** explicitly bound the stored name snapshot before handoff, while retaining the entry ID and using the existing fenced-text helper for the seed. Test a name longer than 300 characters through button → Send. Citations’ normal generation does enforce its 120-character title cap; Glossary has no equivalent.

- **F2 — P2, established: `streamChat` also needs changing, beyond `parseOrigin`.** The existing block-existence guard treats every non-lens origin as a claim and reads `wantedOrigin.blockId`: [routes.ts:3146](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/routes.ts:3146). Adding the proposed union arms makes this access fail typechecking; preserving its current logic would refuse item origins because they have no block.

  **Smallest fix:** name this guard in the build list and restrict it to `wantedOrigin.mode === "debate" && !isLensOrigin(wantedOrigin)`. Thus “everything … is generic already” needs qualification.

- **F3 — P2, established: the build list omits the controller wiring for both marks.** Neither panel currently receives chat summaries or an origin-chat callback. The intervening components are [GlossaryMode.tsx:59](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/modes/glossary/GlossaryMode.tsx:59) and [CitationsMode.tsx:48](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/modes/citations/CitationsMode.tsx:48). Glossary’s existing `onAskChat` carries only a string for the absent-term action.

  **Smallest fix:** specify owner-only props through Reader → each owner Band → Panel → `Term`/`Looked` or `WorkRow`: raw `chatSummaries`, the new sender, and the existing reopening handler. Use `chatSummaries`, not Reader’s `chats`, which is filtered to quoted passage anchors at [Reader.tsx:1077](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/reader/Reader.tsx:1077). Test the complete Reader composition so a panel-only test cannot conceal missing props.

- **F4 — P2, reasoned: extracting the mark’s JSX alone will not preserve its layout.** Its full-width line, indentation and coarse-pointer height depend on `.dbt-group-claim > .dbt-claim-chat`: [debate.css:223](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/styles/debate.css:223). Those selectors do not apply in Glossary or Citations.

  **Smallest fix:** include shared mark styles in the extraction, leaving Debate-specific placement in Debate’s stylesheet. Verify all three callers at narrow widths and with coarse-pointer emulation.

- **F5 — P2, reasoned: D2’s “cannot fail on existing data” is stronger than the evidence.** The route refuses these modes, but the existing database constraints permit glossary/citations rows without an item ID or quote: [schema.ts:3882](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/db/schema.ts:3882). Route refusal establishes what this application writes, not the absence of historical or directly inserted rows. I did not inspect either database.

  **Smallest fix:** replace the guarantee with an expectation and require a read-only preflight for rows that would violate the new CHECK before applying it.

- **F6 — P3, established: `LookupControl` does not exist.** The glossary component is `Looked`, and its owner control is constructed inside it: [GlossaryPanel.tsx:1964](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/GlossaryPanel.tsx:1964). Correct both references in the survey and D5.

The remaining factual claims largely hold. The union has two Debate shapes; `ORIGIN_MODES` contains only Debate; the columns already exist; ClaimsList draws its button and mark inline; both Dig deeper controls are owner-only; and the absent-term handoff carries no origin. The four named exhaustive checks exist, although `originFromColumns` is a separate, non-exhaustive decoder that also needs its planned update. “No CHECK says what … is made of” should mean **no complete item-shape CHECK**: the existing lens constraint already forbids lenses outside Debate.

ID inheritance is real, with boundaries: Glossary matches names/aliases and inherits only when the source hash still matches; Citations inherits through its identity keys subject to ambiguity checks. An arbitrary rename need not retain its ID.

D1’s identity choice is appropriate. Ignoring the name snapshot in `sameOrigin` is safe for the 409: [withTurn:312](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/chat.ts:312) retains the existing thread, and [pg-chat.ts:338](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/store/pg-chat.ts:338) updates only title and timestamp on conflict. A changed snapshot on a resend cannot overwrite the original. Add a transaction test proving that behavior.

D2’s CHECK is compatible with every existing constraint and requires only an `ADD CONSTRAINT`. A null-safe spelling is:

```sql
CHECK (
  origin_mode IS NULL
  OR origin_mode NOT IN ('glossary', 'citations')
  OR (
    origin_item_id IS NOT NULL AND origin_quote IS NOT NULL
    AND origin_block_id IS NULL AND origin_lens IS NULL
  )
)
```

It preserves no-origin, Debate and reserved Summary rows. It tightens previously permitted glossary/citations rows, which is why F5’s preflight matters. Test both modes, including missing quote and forbidden block/lens fields.

D3 is reasonable: the server does not dereference the item ID, and stale or removed entries should not prevent their chats surviving. D4’s fencing is inexpensive because [fencedQuote](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/src/web/chat-handoff.ts:235) already handles embedded delimiters and length. Reuse it. D5’s visitor guard is necessary: both visitor bands draw the same panels from public artifacts. D6 fits the current source/filter machinery.

For the remaining build inventory:

- Export, Postgres storage and the test seeder already use the shared origin mappers; they need round-trip coverage, not another field mapping.
- Extend `CHAT_FROM_WORDS` in `params.ts` and `CHAT_FROM_LABEL` alongside `threadSource`; the list/filter consumers then work generically.
- I found no test directly pinning `ORIGIN_MODES`. The existing “mode nobody has built” case uses Glossary **without a quote**, so it would still reject after this feature for a different reason: [chat-origin-route.test.ts:201](/var/tmp/spideryarn-worktrees/qi-mh276fx8-ask-in-chat/tests/chat-origin-route.test.ts:201). Replace that case with an unbuilt mode and add positive route coverage for both new origins.

Validation: 39 existing tests passed across origin matching/mapping, thread sources and origin transactions. The 301-character glossary harness also succeeded.

**Verdict: not ready to build as written—resolve F1’s valid-entry Send failure and make the missing route/controller wiring explicit.**