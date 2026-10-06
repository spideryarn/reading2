Reviewed **`b7a0d9253`**, including all sixteen evidence documents and the earlier rejection lists. No files changed; no network or database access. Source references below use the common investigation prefix `docs/investigations/261006d-seventh-sweep-depth-`.

**U1 — P1: C3 omits the safety condition on deadline recovery.**

Both pipeline reviews say to **discard the aborted step’s returned product**, then use the existing deadline hand-back path. Assets can return an incomplete manifest with unfetched images labelled `network` and stamped current. “Stop discarding the finished work” is therefore an unsafe interpretation of the umbrella’s description.

Evidence: `pipeline-review-sol-on-opus`, § PQO1; `pipeline-review-opus-on-sol`, § PQO1.  
Smallest change: explicitly require no product commit on `DeadlineReached`, preservation of earlier committed work, and reuse of `pauseForDeadline`, including its cancellation, stale-claim and exhausted-budget outcomes.

**U2 — P1: C5 chooses a retention policy Greg reserved for discussion.**

Protecting notes is established policy. Allowing permanently retained, annotated criteria above the cap is a further retention choice. The server Sol review explicitly calls it an owner decision. The umbrella acknowledges that qualification and then overrides it because the alternative is a wedge; it does not establish that these are the only possible remedies.

The reviewer count is also incomplete: across the four relevant cross-reviews, **three recommend building the trim and one requires an owner decision**, rather than two and one. Those opinions do not supply Greg’s authorization.

Evidence: `server-review-sol-on-opus`, § SVO1; both schema reviews’ DB1 discussions; Greg’s quoted scope restriction.  
Smallest change: build the useful DELETE/placement refusals, but put “retain annotated criteria beyond twenty” to Greg. Mark only that portion of C5 as waiting.

**U3 — P1: C7 deletes an index and then requires it to exist.**

Item 5 drops `chat_messages_thread_ordinal_idx`. Item 6 declares and tests **all six** migration-only indexes, including that index. Following both instructions either fails the required-object test or restores the duplicate.

Item 6 also omits the snapshot reconciliation required by both reviews. Adding declarations normally generates CREATE statements for existing objects; saying “No DDL runs” does not specify how that is prevented.

Evidence: `database-schema-opus`, § DBO4; `database-schema-review-sol-on-opus`, § DBO4; latest Drizzle snapshot.  
Smallest change: declare the **five surviving migration-only indexes** and five CHECKs; reconcile the generated snapshot and journal while removing duplicate CREATE statements. Require successful migration from both an existing database and an empty database. Keep all C7 stages sequential.

**U4 — P1: NEW1 disappears, including its relevance to question 10.**

The ownership-transfer command updates tables alphabetically. Updating `ingest_events.owner_id` before `jobs.owner_id` violates the immediate composite reservation/job FK. Both dry-run and apply abort when the relevant reservation has a job.

Evidence: `database-schema-review-sol-on-opus`, § Missed by both; `scripts/db-reown.ts`, `ownedTables` and update loop; `drizzle/20260902172838_billing_owner_and_event_fks.sql`.  
Smallest change: give **NEW1** an explicit repair or hold disposition. Its proposed deferral repair needs its own review and must share C7’s migration sequence. Connect question 10’s proposed ownership FKs to this actual transfer-order problem.

**U5 — P1: C9’s linked plan exceeds the approval established for this review.**

The umbrella says the spike ends in a written decision, but the linked plan authorizes staged rollout if Claude decides the spike passed. Its “What the plan review changed” section explicitly overrules the reviewer’s restriction to the one-hook spike.

The user’s stated authorization here is **a one-hook spike**. Claude’s later interpretation cannot enlarge it.

Evidence: `261006n-one-type-for-a-read-spiked-on-useideas.md`, § What Greg approved and § What the plan review changed; its Sol review, R1.  
Smallest change: end authorized work at the spike and its evidence. Present broader migration as a recommendation requiring discussion.

**U6 — P2: Three other finding IDs have no disposition.**

The sixteen documents contain **64 numbered IDs**. Four have no substantive home: **NEW1, WCO8, WCO9 and PQO6**.

- **WCO8:** stale client counts and filesystem descriptions, preserving genuinely historical counts.
- **WCO9:** signposting Reader’s unchecked branches, with the correction to **19 executable comparisons on 17 lines covering seven modes**.
- **PQO6:** stale execution records, demonstrated transport mutation evidence, the unverified newer resume case, and the missing Messages continuation-boundary test.

Five additional IDs are absent literally but represented substantively: **WC3/WCO10** by C9, **DBO7** by question 5, and **DB6/DBO10** by question 6.

Evidence: client and pipeline Sol cross-reviews, those sections.  
Smallest change: assign the missing work, and add the five aliases so the finding ledger is auditable.

**U7 — P2: Other accepted sub-findings are silently narrowed away.**

The cluster summaries omit these parts of their cited findings:

| Cluster | Omitted evidence or qualification |
|---|---|
| C2, WCO1 | The membership defence must identify relevant always-mounted reads with explicit exclusions. Adding Quiz to another handwritten list does not close the class. |
| C2, WCO2 | Preserve failed refreshes, while successful absence or stale results still clear links. Keep the enhancement silent. |
| C2, WCO5 | Correct `StageRecord`’s truthiness gate as well as Metadata’s four `Boolean(...)` consumers. |
| C4 | Correct the false chat guarantee comments and the two comment-resurrection comments. |
| C6, SVO8 | Include `pg-reader.ts` and the false `public-reader.ts` predicate description, not only `pg.ts`. |
| C8, PQO3 | Explicitly hold the public terminal fixture methods; their disposition is absent. |

Evidence: respective cross-review sections.  
Smallest change: add these bounded requirements or explicit dispositions to their clusters.

**U8 — P2: C3’s evidence and file claims are false as blanket statements.**

“All in `src/jobs.ts`, all R (pg) by the Opus review” does not hold:

- PQ1’s freshness failure is R (pg); its **three additional `note()` exits are C**.
- PQO2 is **C in the Opus review**, with coordinator reproduction in the Sol review.
- PQ4/PQO4 are **C**, spanning `jobs.ts`, `store/jobs.ts`, `pg-jobs.ts` and `pipeline.ts`.
- Persisting titles also touches the job-store contract and implementation.

Evidence: both pipeline reviews, §§ PQ1, PQO2 and PQO4.  
Smallest change: put evidence and files beside each item. Specify how the three progress-write exits will settle, or identify them as a separate C follow-up; the freshness patch alone does not fix them.

**U9 — P2: The umbrella hides tier and reachability disagreements it promises to report.**

- **SV3/SVO4:** Sol retains Tier 0; Opus explicitly downgrades to Tier 1 because no current client produces the conflicting-anchor schedule. C4 suppresses this disagreement.
- **PQO2:** Sol promotes it to Tier 0; Opus retains Tier 1.
- **PQ3:** both reviews retain Tier 0, with P2 and little visible impact; C8 labels the cluster Tier 1.
- **WC4:** Tier 1, conditional on a band throw, rather than an established live production failure.
- **WCO7:** a mechanical key correction, with no demonstrated missed ordinary completion.
- **WCO5:** raw wording is R; empty-message reachability remains H.

Evidence: the corresponding cross-review verdicts.  
Smallest change: retain mixed evidence/tiering explicitly instead of making each cluster inherit its strongest member’s classification.

**U10 — P2: C5 and C8 omit qualifications that distinguish working fixes from plausible broken ones.**

C5 needs candidate row locks followed by a **fresh reference check in another statement under READ COMMITTED**. A single snapshot-based `NOT EXISTS` delete can still fail after concurrent placement.

C8’s surviving-Labels helper must **exclude the settling job**, retain owner scope, and preserve the live path’s `unfinished === "labels"` trigger. Copying the expiry check unchanged can count the still-running job as its own successor.

Evidence: schema reviews, § DB1; pipeline reviews, § PQ3.  
Smallest change: state those requirements in the cluster briefs and require the concurrent-placement and no-successor controls.

**U11 — P2: C7’s timestamp and comment scopes need correction.**

DB4 requires adding nullable `created_at` **without a default**, then installing the default separately. Ordinary generated `ADD COLUMN … DEFAULT now()` invents dates for existing rows.

“False schema comments (DB2, DBO11): five locations” describes only Sol’s corrected DBO11 scope. **DB2 alone has eight entries**; it is not the combined census. The historical `comments.thread_id` explanation should remain historical, rather than being treated as a current false claim.

Evidence: schema Sol investigation, §§ DB2/DB4; both schema reviews.  
Smallest change: include the two-statement timestamp recipe and enumerate the union of comment corrections.

**U12 — P2: The short-version counts and assurances are not traceable.**

“About fifteen live defects, eleven reproduced” has no enumerated population. Counting unique defect rows consistently, the documents already give running-code or Postgres reproduction for **thirteen**: SV1, SV2/WC1, SVO1/DB1, SVO2, SVO3, WCO1, WCO2, WCO5, PQ1, PQ2, PQ3, PQO1 and PQO2. That excludes malformed-response probes and policy-only reproductions.

“None loses a reader’s data” is stronger than the evidence. The client review identifies an **H** path where the stale displayed note invites saving over the newer note.

C7 schedules **three** new/tightened data CHECKs, not four. Its index drop is not additive. Twelve numbered owner entries contain **thirteen separate questions**, because item 12 bundles two.

Evidence: the review verdicts; umbrella §§ Short version, C7 and For Greg.  
Smallest change: replace the headline counts with an ID ledger, distinguish reproduction scope, say “no data loss reproduced,” name the three CHECKs, and count questions consistently.

The substantive production numbers do match: **13/62 articles**, **9,303/24,344 identities = 38.21%**, **411/460 published revisions**, **90,870/105,774 blocks = 85.91%**, and **0/157 ownership mismatches**.

**U13 — P2: The overlap table omits actual collisions.**

| Clusters | Missing collision |
|---|---|
| C2–C10 | `src/web/useIllustrated.ts`: failure-key correction versus hold integration |
| C5–C6 | `src/store/pg-comments.ts`: placement-FK handling versus deletion of the create catch |
| C5–C7 | `tests/store-parity-referee.test.ts`: trim regression versus published-revision fixture correction |
| C6–C7 | `src/store/pg.ts`: filesystem comments versus updating the “needs a migration” scalar comment |

C3–C8 also share more than `pg-jobs.ts`: their accepted comment work includes `jobs.ts`, `store/jobs.ts` and `pipeline.ts`. C4–C6 share `types.ts` as well as routes. C9–C10 share read-error and rewrite-hold tests as well as `useSkim.ts`.

Evidence: cross-review file manifests and `tests/store-parity-referee.test.ts:242`.  
Smallest change: supply complete manifests and explicit ordering edges. Serialize migration journal/snapshot ownership, including NEW1 and any subsequently approved schema cleanup.

**U14 — P2: C9-before-C10 is collision avoidance, not a dependency.**

The reachable double-spend gap in WCO3 is Tier 0. The type spike is Tier 2. Either order resolves their shared files; neither review establishes that holds require the new read type.

Evidence: client Sol review, §§ WCO3 and Build order; sweep method’s highest-confirmed-tier rule.  
Smallest change: after C2’s conflicting Illustrated edit lands, do C10 before C9, or split out its reachable hold repairs and land those first.

**U15 — P2: C10 must distinguish accepted absence from malformed success.**

Its validation work lacks the reviewer’s explicit condition: **intended `200 null` is absence, not a malformed reply**. Validate non-null envelopes before publishing setters, and preserve accepted data on malformed refresh.

Evidence: `reader-client-review-sol-on-opus`, § WCO4.  
Smallest change: include the null branch and valid-envelope controls in C10.

**U16 — P2: The refusal audit is incomplete, although C7’s three immediate CHECK counts are present.**

| Proposed refusal | Ordinary reachability / recorded data |
|---|---|
| C4 earlier stale-edit 409 | Ordinary stale tab; moves an existing refusal before the abort. |
| C4 transactional anchor/help refusal | Colliding or replayed first sends; reviewers disagree about current-client reach. Identical anchors and ordinary unanchored follow-ups must pass. Help remains 400, anchor 409. |
| C5 criterion DELETE 409 | Ordinary annotated criterion. Recorded production has zero criterion-linked notes. |
| C5 stale-placement refusal | Ordinary two-tab placement/delete race, including starting from today’s unannotated criteria. |
| C6 malformed-session 404 | Hand-made malformed ID; server-minted ordinary IDs pass. |
| C6 reused upload refusals | Existing 404/410/409 outcomes; equivalence reproduced. |
| C7 criterion-shape CHECK | Ordinary writers comply; **0/10** violate. |
| C7 empty-unless-done CHECK | Ordinary routes comply; **0/4** violate. Wider store type permits a forbidden patch. |
| C7 published-scalars CHECK | Ordinary publication complies; **0/460 published** violate. Direct fixtures can fail. |
| C8 required-product throw | Production already has no exemption; malformed step products remain refused. |
| C10 malformed-reply throw | No current malformed producer established; intended null must pass. |

The missing production census is **terminal jobs retaining draft pointers**, for Tier 3’s PQO5 CHECK. Ordinary remote Stop can also violate that proposed CHECK **mid-transaction**, regardless of the final stored census.

Evidence: respective review sections; especially pipeline Sol review, § PQO5.  
Smallest change: add this refusal ledger. For PQO5, require the missing count and change both `releaseStepIn` **and** `discardAfterCancel`: clearing the pointer only in the former makes the latter’s row-count assertion throw and roll back.

**U17 — P2: Several owner recommendations omit the decisive trade-off.**

- **Question 1:** “Keep it—the work is done” omits that cancellation may yield incomplete image results stamped current. Both pipeline reviews explicitly warn about this.
- **Question 3:** detachment clears **both criterion association and valence**, losing the reader’s score as well as its association. Deleting notes also reverses the schema’s explicit reader-data protection.
- **Question 4:** retaining Generate enables another paid action after the read failed. The evidence correctly makes this a spending-policy choice.
- **Question 8:** never-published articles still carry checkpoints, identities, uploads and financial associations. Their deletion is broader than the approved abandoned-draft sweep.
- **Question 9:** “keep the last few” must protect bases needed by live drafts, concurrent rebase and lineage.
- **Question 10:** no evidence establishes a dependency on revision-retention policy. The demonstrated dependency is ownership-transfer ordering, NEW1.

Evidence: pipeline PQO1 reviews; server SVO1 review; client WCO6 review; schema Sol review §§ DBO2, DBO5, DBO6 and NEW1.  
Smallest change: put these consequences immediately before the options and amend the recommendations accordingly.

**U18 — P2: The owner batch is not answerable as written, and contains engineering work presented as decisions.**

| Entry | Assessment |
|---|---|
| 1 | Understandable once incomplete-results consequences are included. |
| 2 | Already a deliberate written exception in `pipeline.ts`, `STEPS.simple.stamp`. Distinguish “shown as outdated” from “eligible for automatic rewriting.” Documenting the existing choice is safe work. |
| 3 | Define “criterion,” then explain loss of association and score. |
| 4 | Understandable, but “one line once C9 lands” applies only to Ideas; the other eleven hooks have not migrated. |
| 5 | Explain that the row is an old allowance record, without reader prose, and that cleanup offers little runtime benefit. |
| 6 | Explain the unused column and its FK; “yes” is insufficient context for a column drop. Owner approval remains appropriate. |
| 7 | Translate the CHECK/type vocabulary into whether the product retains support for this old block kind. |
| 8 | Explain retry/checkpoint consequences and deletion safeguards. |
| 9 | Define revisions as saved copies and explain protected live bases. |
| 10 | Explain duplicated ownership and the future ownership-model choice. |
| 11 | “Its own look” is an investigation assignment, not a product decision. No frequency or cost evidence supports choosing limits yet. |
| 12a | Explain old tabs/home-screen clients can survive deploys. Twenty-four days is not evidence the removal condition passed. |
| 12b | Header-opt-in null conversion can preserve old clients and ordinary semantics. That bounded compatibility work is safe engineering work, not necessarily Greg’s decision. |

Evidence: respective investigations’ owner sections; `pipeline.ts:4582`; server SVO7/SVO12 reviews.  
Smallest change: send only actual choices, with concrete consequences. Move existing-policy documentation and bounded compatibility implementation into the engineering queue.

**U19 — P2: The scope line reports one investigator’s omissions as the whole sweep’s omissions.**

Sol read Reader, activation, params, mode catalogue and SSE machinery in full. It also read significant parts of AI-call and Simple. The “two thirds of Reader” and several omitted-file claims describe **Opus’s coverage**, not combined coverage.

Evidence: both client investigations’ § What I read; pipeline Sol investigation’s coverage table.  
Smallest change: distinguish **read by both**, **read by one**, and **read by neither**. Keep the weaker independent coverage visible.

**U20 — P2: “One level up” imposes a majority explanation the findings do not support.**

Using the stated meaning—an enforced contract fails to carry across a boundary—I count **17 of 64 IDs fitting and 47 not fitting**:

- Server: **8/20** — SV1, SV2, SV3, SVO1, SVO2, SVO3, SVO4, SVR1.
- Client: **2/14** — WC1, WCO4.
- Pipeline: **1/10** — PQ2.
- Schema: **6/20** — DB1, DB3, DBO5, DBO8, DBO9, NEW1.

This is a generous count, including untranslated refusals and the unchecked producer/consumer envelope. IDs overlap; it is not a count of distinct bugs.

The remainder includes same-layer sibling omissions, wrong cancellation transitions, lost title persistence, stale prose, dead machinery, duplicated indexes, missing performance indexes, retention decisions and unproved redesigns. Several cheapest fixes delete code or add a listener. SV1 moves a check **earlier/upward**, rather than downward.

Evidence: all finding lists and their reviews.  
Smallest change: describe boundary enforcement as **one recurring class**, alongside sibling drift and failure-exit handling. Delete “most” and “all of one kind.” The narrower conclusion that the four architectures remain sound is supported independently by both investigations.

**U21 — P2: C1’s promised plan is unavailable at the reviewed commit.**

The named readiness cluster plan is absent from `b7a0d9253`. Sixth-sweep question 9 supports recording failing filenames, but not the new scanner, record-validation and UI details asserted here.

Evidence: commit’s file tree; sixth umbrella, § For Greg 9.  
Smallest change: link a reviewable plan/evidence revision, or mark those implementation details prospective. Do not treat this umbrella review as validation of the missing plan.

**U22 — P3: C7’s duplicate-index drop and C10’s holds are legitimate build decisions.**

Dropping this verified exact duplicate preserves UNIQUE enforcement, removes no reader data, and is readily reversible. Opus’s “ask because it is a drop” is broader than Greg’s actual restriction. Recheck the definitions before applying it.

C10’s written rule **does exist**: [mode.md](/var/tmp/spideryarn-worktrees/seventh-sweep-depth-umbrella/docs/project/mode.md:449) requires forced verbs to use the hold and every forced control to honour `rewriting`. The existing Glossary append precedent supports Quotes.

Smallest change: cite that rule explicitly and retain the release/failure/offline behaviour. Neither item needs another owner question merely because one reviewer preferred asking.

**U23 — P3: No direct resurrection of the earlier rejected abstractions was found.**

C9 remains a result-type spike, not a generic loader; C2’s compiler checks address newly demonstrated Debate omissions; C8’s filesystem-session deletion was unfinished work, rather than a rejected deletion. The rejected registries, stream shells and size-driven splits remain rejected.

The compatibility-filter retirement still lacks evidence that its own removal condition passed; age alone should not revive compatibility-removal reasoning.

Evidence: fifth and sixth umbrellas, § Considered and rejected; seventh client/server reviews.  
Smallest change: preserve these scope boundaries and qualify the compatibility recommendation.

**Verdict: not ready.** The deadline-product condition, retention authorization, contradictory index instructions, missing NEW1 disposition and spike-only authorization need correction before the remaining clusters are dispatched.