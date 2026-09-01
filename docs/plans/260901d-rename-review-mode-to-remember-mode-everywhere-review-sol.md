Verdict: do not build this plan as written. The rename itself is defensible, but the staging is broken and the persistence sweep is incomplete.

## Blocking findings

1. Stage B immediately disagrees with the database

The claim that leaving `"review"` in `schema.ts` means “the code still matches the database” is backwards ([plan](/home/greg/code/spideryarn2/docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md:211)).

After Stage B:

- New code inserts `kind = 'remember'`.
- The live CHECK still accepts only `chat|review`.
- Creating a Remember thread fails with `23514 check_violation`.
- Existing `review` rows are worse: after the normaliser changes, [`pg-chat.ts`](/home/greg/code/spideryarn2/src/store/pg-chat.ts:229) treats them as unknown and silently returns `kind: "chat"`.
- The filesystem normaliser has the same problem in [`chat.ts`](/home/greg/code/spideryarn2/src/chat.ts:88).

Therefore Stage B cannot keep the Postgres tests green and is not a coherent commit or deployment. At minimum `tests/store-chat-pg.test.ts` will exercise the rejected insert; it is not one of the plan’s supposed five owned tests.

Use A/B/C as a work order if useful, but commit and test the runtime discriminant, schema, and migration together after 0047 lands. Alternatively, Stage B must leave every persisted `ThreadKind` literal as `review`, not just `schema.ts`; that creates a deliberate temporary `mode=remember` → `kind=review` mapping and should be stated honestly.

2. Production has an unavoidable incompatible window

The repository’s deployment runs migrations before pushing the new application. Once 0048 commits:

- Old code trying to create `review` fails the new CHECK.
- Old code loading the migrated `remember` row normalises it to `chat`.
- An old client continuing that thread can receive a 409 or use the chat prompt, depending on what it sends.

The three SQL statements are transactional and `ALTER TABLE` blocks concurrent table writers while they execute. The dangerous concurrency is after the transaction commits, while old serverless instances still run.

“No compatibility aliases” does not solve this. Choose explicitly:

- A maintenance window: block requests, migrate, deploy, reopen.
- Expand/migrate/contract across deployments.

Given no users, the brief maintenance window is reasonable. The current plan chooses neither and incorrectly calls the rollout safe.

3. “Exactly one database home” is false

There is only one relational discriminator: `chat_threads.kind`. I verified that against the active schema, `src/store/`, and the migrations.

But feedback reports persist the current mode inside `feedback.diagnostics` JSONB:

- [`FeedbackArticleState.mode`](/home/greg/code/spideryarn2/src/feedback-payload.ts:118)
- validation against `MODES` in [`feedback-payload.ts`](/home/greg/code/spideryarn2/src/feedback-payload.ts:371)
- the JSONB column in `feedback.diagnostics`

A probe finding no current `"review"` value does not make this cease to be a persistence path. The plan’s statement that no JSONB holds a mode name is structurally wrong.

I would leave existing feedback unchanged because it is historical telemetry describing what the reader actually saw. But that must be an explicit exception, and new diagnostics must accept `remember`.

4. The filesystem backup was missed

[`data/noema-mythology-of-conscious-ai/chat.json`](/home/greg/code/spideryarn2/data/noema-mythology-of-conscious-ai/chat.json:296) contains a real `kind: "review"` thread. It is ignored rather than committed, which is presumably why the sweep missed it.

After the code rename, loading this file silently turns that thread into chat. [`store/export.ts`](/home/greg/code/spideryarn2/src/store/export.ts:534) is another value-producing path that must change.

The fixture corpus is correctly covered, but the real local snapshot is not. Either:

- migrate `threads[].kind` in local `data/*/chat.json` with a narrowly parsed filesystem migration, after obtaining the required permission to overwrite local reader data; or
- explicitly accept that the backup’s Remember thread becomes a chat.

Leaving it unnoticed is not acceptable.

## Other substantial corrections

5. The rename remains defensible, but “more justified” is rhetoric, not evidence

The original reason weakened: the feared exact pair was Review/Reviewer, and the new mode is Referee. Those words are more distinguishable.

The “seven lines apart in `MODES`” argument is especially poor because `MODES` is not dock order; the source explicitly says the bar has separate ordering ([`modes.ts`](/home/greg/code/spideryarn2/src/modes.ts:108)). In the actual dock, Referee and Review are separated by Diagram and Chat ([`Dock.tsx`](/home/greg/code/spideryarn2/src/web/Dock.tsx:442), [`Dock.tsx`](/home/greg/code/spideryarn2/src/web/Dock.tsx:469)).

I would still rename it:

- Review remains ambiguous beside a tool for peer-review work.
- Remember aligns with the product’s “internalise” intent.
- It works as an umbrella over Recall and Quiz.

The downside is that Remember can imply saved memories or long-term spaced repetition, which the mode does not provide. The dock blurb largely corrects that. So: justified, yes; “more justified than before,” no. Rewrite the rationale as “the original collision did not materialise, but a related live ambiguity remains.”

6. The prompt-body fact is true; the regression conclusion is not

I checked the complete `REVIEW_SYSTEM` template. It contains no use of “review” as the activity. The only matching target-like text inside the template is “half-remember”. Renaming the constant does not require changing model-visible prompt prose.

But “the stance eval cannot regress by construction” is false. The model-visible request also depends on the renamed discriminator selecting:

- `REVIEW_SYSTEM`
- `readItFor`
- `stanceLine`

Those branches are in [`converse.ts`](/home/greg/code/spideryarn2/src/converse.ts:674). A mistaken rename can select the chat prompt or omit the stance while the template itself remains byte-identical.

Capture and compare the complete built model messages before and after, for all four stances. That is stronger and cheaper evidence than a nondeterministic paid eval whose own input literal is being renamed simultaneously.

7. Renaming `?review=` is correct, but it needs broader coverage

Keeping `recall|quiz` is right: those values describe the two views, not the enclosing mode.

Nothing server-side consumes the sub-mode key. Its live dependencies are concentrated in `params.ts` and `App.tsx`, but there are two separate URL registrations:

- the paired reader/writer in [`App.tsx`](/home/greg/code/spideryarn2/src/web/App.tsx:3090)
- the write-only setter in [`App.tsx`](/home/greg/code/spideryarn2/src/web/App.tsx:3221)

Missing the latter causes opening a conversation to update the obsolete key while the band reads the new one.

The plan should add tests for:

- `modeParam.parse("remember")` succeeds and `"review"` fails.
- `rememberParam` accepts `recall|quiz`.
- `?mode=remember&remember=quiz&thread=…` drops `thread`.
- Opening a Remember thread returns to Recall and clears the stale Quiz state.
- The old `review=` key is ignored.

Also, [`url-state.md`](/home/greg/code/spideryarn2/docs/project/url-state.md:27) currently documents neither this sub-mode key nor Referee’s. Renaming a parameter that the URL source of truth does not list would leave the documentation incomplete.

8. The migration SQL is correct but the migration plan is incomplete

The order is right:

1. Drop CHECK.
2. Update `review` → `remember`.
3. Re-add and validate the narrowed CHECK.

Because the migration is transactional and takes an exclusive table lock, concurrent inserts cannot slip in while the CHECK is absent. The rollout problem is old code after commit, not writers between those statements.

`chat_messages.stance` needs no data update. Its values do not encode the thread kind, and the FK is by article/thread identity. Existing stance rows remain attached to the migrated thread. Comments and type names around them should change.

Stage C must explicitly include:

- wait for 0047 to be committed;
- re-read the journal tail rather than assuming 0048;
- change `schema.ts`;
- generate the migration;
- insert the UPDATE between generated DROP and ADD;
- commit the new SQL, journal entry, and 0048 snapshot together;
- verify `review=0`, `remember=old review count`, and total thread counts unchanged;
- then perform the maintenance-window production rollout.

Historical `0019`, the comment in shipped `0046`, and every pre-0048 Drizzle snapshot must remain untouched.

9. The sweep and test baseline are understated

The plan says five test files belong to this rename. That is plainly false. Existing affected tests include at least:

- `store-chat-pg`
- `store-roundtrip`
- `chat-turn-paths`
- `chat-web-links-prompt`
- `visitor-gaps`
- `public-network-trace`
- `page-title`
- `referee-mode`
- `quiz`
- the four named `review-*` files
- `fixture-corpus`

I also found live mode-facing occurrences omitted from the plan’s inventory:

- dictation’s model-visible site vocabulary: [`src/vocabulary.ts`](/home/greg/code/spideryarn2/src/vocabulary.ts:49)
- the server/client page-title map: [`src/title-text.ts`](/home/greg/code/spideryarn2/src/title-text.ts:231)
- visitor entitlement copy
- the live-noise eval’s vocabulary
- `docs/project/dictation.md`
- `docs/project/setup-dev.md`

The committed dictation result JSON is historical eval output and should not be rewritten merely to make grep clean; the live vocabulary source should be changed.

10. The “done” grep condition is impossible

“No occurrence of the mode sense of review survives outside plans and postmortems” cannot be achieved without corrupting history or breaking links.

Legitimate survivors include:

- exact Greg quotations in the renamed project doc;
- current-code links to historical files such as `260827ah-review-mode.md`;
- shipped migrations and old Drizzle snapshots;
- historical feedback diagnostics;
- unrelated committed eval outputs that record “review mode” as their input at the time.

Replace that condition with: no old live identifier, accepted wire value, URL key, user-facing label, current normative prose, or generated current-schema artefact remains. Maintain an explicit allowlist for historical paths, quotations, migrations, snapshots, telemetry, and eval results.

In short: keep the rename, soften its rationale, merge the runtime/schema stages, define a maintenance rollout, account for feedback JSONB and the filesystem thread, broaden the tests, and replace the impossible grep criterion.