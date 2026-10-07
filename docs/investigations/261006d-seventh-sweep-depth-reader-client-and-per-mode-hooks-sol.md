# Seventh sweep, depth: reader client (GPT Sol, read-only, 2026-10-06)

## What I read

Checkout: `bf78e90c7f718fb042d51f9aa394c72c335514a5`. No tracked files changed.

**Read in full:**

- `src/web/reader/Reader.tsx` and the other files under `src/web/reader/`.
- The twenty hooks named in the brief: Glossary, Ideas, Quotes, Timeline, FAQ, Citations, Debate, Quiz, Simple, Sketch, Illustrated, Tweets, Skim, Search, Crossrefs, Claims, Criteria, Mirror, Comments and Chat.
- `useOrderedRead.ts`, `useStepJob.ts`, `useAutoRun.ts`, `lib/api.ts`, `lib/sse.ts`, `activation.ts`, `params.ts`, `mode-catalog.ts` and `sub-modes.ts`.
- Supporting read machinery: `public-api.ts`, `rewrite-hold.ts`, `lib/opening-read.ts`, `lib/describe-failure.ts`, `lib/reader-facing.ts` and `lib/made-for.ts`.
- `article/ArticlePage.tsx`, `reader/ModeBoundary.tsx`, `FeatureBoundary.tsx` and `modes/ideas/IdeasMode.tsx`.
- Both brief files, `docs/project/mode.md`, the sweep method, both fifth-sweep client investigations and the seven specified postmortems. The fifth and sixth umbrella plans were read for their requested held/rejected sections and the sixth’s “After the clusters”.

**Read in part, following particular call paths:**

- `Metadata.tsx`: provenance reads, refresh/retry ordering, purpose seeding and sharing-card inputs.
- `Dock.tsx`: reading-view inputs and the Questions drawer’s combined loading/failure state.
- IdeasPanel, SkimMode, MarginaliaColumn, DebateMode, CommentDialog and ProseHoverCard: consumers and controls relevant to findings below.
- Article access, chat controller/reducer/model, `routes.ts`’s comment answer route and `store/pg-comments.ts`’s fenced answer update.
- Relevant portions of the read-error, comment, bookmark, boundary and passage tests.

I did not read the remaining Metadata/Dock presentation code, every panel, or the complete chat/store/server modules. I did not use another seventh-sweep investigation as evidence.

Selection was informed by:

```sh
git log --since=2026-09-20 --format= --name-only -i --grep=fix -- \
  src/web/reader src/web/use*.ts src/web/Metadata.tsx src/web/Dock.tsx |
  sort | uniq -c | sort -rn
```

The leading file appearances were Reader **52**, Dock **29**, Metadata **28**, Comments **12**, Citations **11**, StepJob **10**, Quiz and Glossary **8** each. These are appearances in commits whose messages match “fix”, not counts of distinct defects.

## What the method could not see

No browser, network or database was available. The new defects below are **C: proved from code**, not browser reproductions. I have not established production incidence, including how many legacy explanation comments remain.

Two existing, service-free suites ran successfully:

```sh
npx vitest run tests/read-error-matrix.test.tsx
# 55 passed

npx vitest run tests/use-comments-create-waits-for-the-opening-read.test.ts
# 18 passed
```

Those passes establish their existing assertions, not the new interleavings below. No red test is reported.

The API’s offline-copy fallback also matters: a fulfilled GET can be a saved response, rather than a fresh observation of the server. Reading the client cannot establish current server data or cross-tab timing.

For Postgres verification, the orchestrator can run, with its configured test database:

```sh
npx vitest run tests/store-comments.test.ts
npx vitest run tests/comment-answer-stream-lifetime.test.ts
```

These exercise existing storage and stream-lifetime contracts. Neither currently proves the reader-edit/answer-frame race in WC1; that needs a deferred-response regression.

## Findings

Tier 0 findings come first. Within that group, and then among the remaining findings, ordering is by ease × value.

### WC1 — Comment answer frames overwrite newer reader edits on screen

**C · Tier 0 · ease 3 · value 4 · risk medium**

**Anchors:** `src/web/useComments.ts` — `send`, immutable `pending`, `put(done)` and the `delta` branch’s `const { replacing: _held, ...rest } = pending`; `src/web/CommentDialog.tsx` — editable `CommentBody` while `comment.status === "pending"`; `src/routes.ts` — `answer` → `settle`.

**Failing input:**

1. Open a legacy explanation comment whose note body is `"old"`.
2. Press Dig deeper and hold its answer stream open.
3. Edit the note to `"new"`; let its PATCH succeed.
4. Deliver another answer delta, then the terminal frame.

The PATCH installs the server’s edited comment. The next delta replaces it with a row spread from `pending`, captured before the edit. The body becomes `"old"` again.

The terminal frame does not reliably repair this. On a successful answer write, `settle` receives the store’s returned comment list but frames `{ ...comment, ...patch }`, using the comment captured when the answer began. The database update writes only answer-owned columns; the displayed row can therefore disagree with the saved note after the stream ends.

`begin` and the client failure branch also replace whole rows from older snapshots. Clearing a body, changing placement or recolouring exposes the same ownership problem.

This path is supported for legacy explanation rows. Their production population was not queried.

**Class:** independent writers replace a shared record without respecting which fields each writer owns. The queued body/placement/colour PATCHes serialize those writes with one another; the answer stream is outside that queue.

**Proposed fix — a separate claim:** update answer-owned fields against the current client row for `begin`, `delta`, `done` and failure, retaining current reader-owned fields. Removal must remain explicit: a generic object spread cannot express clearing optional fields. At the server terminal seam, use the returned stored row when present rather than reconstructing it from the opening snapshot.

The smallest closure for the demonstrated sequence is the client’s answer-field update, including the terminal branch. Correcting the server frame removes its false “what the store actually holds” claim too. Check the reverse interleaving—an older PATCH response arriving after a newer delta—before declaring the field-ownership class closed.

This should be a narrow comment-row operation. It would duplicate neither the PATCH queue nor `readEvents`; a generic stream shell would not solve it.

**Regression required:** hold a stream, complete a body PATCH, then deliver a delta and terminal frame. Repeat with body removal and with terminal-only completion. Compare the visible note with an independently maintained stored note.

### WC2 — A late bookmark can open over a newly selected Debate sub-mode

**C · Tier 0 · ease 5 · value 2 · risk low**

**Anchor:** `src/web/reader/Reader.tsx` — `surface.current`, `bookmarkBlock`, and `selectProse`’s later `unchanged` check.

The foreground snapshot includes Learn, Diagram, Referee, Summary and Structure sub-modes. It omits `subNav.debate`, although the subscription immediately above already reads that parameter.

**Failing input:** with experimental modes enabled, open Debate Reception, press a gutter bookmark and hold its create response. Switch to Debate Claims, then release the response. The mode remains `debate`; none of the recorded surface values changes. `unchanged` is true, so the old bookmark press writes `?note=` and opens its comment box over the newer foreground choice.

The held selection-create path uses the same snapshot and has the same omission.

The existing comment states the intended rule explicitly: mode-specific parameters count because changing a sub-mode is a new foreground choice. No Debate exemption is written.

**Proposed fix — a separate claim:** add `subNav.debate` to both the snapshot and the layout-effect dependency list. Extend `a-gutter-bookmark-opens-the-comment-box.test.tsx` with Reception → Claims while the create is held.

No new foreground registry is needed. The existing snapshot is the mechanism to repair.

**History:** `4b502174a` introduced Debate’s sub-modes and added its Reader subscription, but did not extend this guard. That is new drift beyond the earlier five-mode contract.

### WC3 — The approved read-result type is worth a one-hook Ideas spike

**C for existing states · Tier 2 for the proposed migration · ease 3 · value 4 · risk medium**

**Anchors:** `src/web/useIdeas.ts` — `IdeasRead`, `load`, status-preserving catch and `retryRead`; `src/web/IdeasPanel.tsx` — independent `owner.error` and `owner.status` gates.

A read is currently distributed among independently writable status, value, error and currency fields. Preserving status after a refresh failure is deliberate, but it means `"none"` and `"ready"` can each coexist with a failed latest read. A consumer must remember this rather than receive it in its input shape. The specified postmortems demonstrate omissions at that seam.

**Best spike: Ideas.** It represents the ordinary stored-artefact family, has profile and currency flags, retained-data refreshes, read-only and job-owning halves, rewrite holds and useful existing test coverage. It avoids Glossary’s lookup mutations, Quiz’s saved-attempt bookkeeping and picture validation.

**Proposed fix — a separate claim:** make one discriminated value the hook’s actual read state and carry it through its direct consumer props. Do not merely construct a union at return time while retaining the old independently writable states.

The minimum shape must distinguish previous knowledge from the current request:

```ts
type Known<T> = {
  value: T | null;
  // Domain currency and answer provenance travel with this answer.
};

type Read<T> =
  | { kind: "asking"; previous: Known<T> | null }
  | { kind: "failed"; failure: ReadFailure; previous: Known<T> | null }
  | { kind: "known"; answer: Known<T> };
```

This is a capability sketch, not a proposed complete API. In particular:

- `previous: null` means no accepted answer; `{ value: null }` means an accepted absence.
- A failed refresh can retain a known value **or a known absence**.
- Asking during refresh must retain the accepted answer. Most present hooks do not expose this asking state.
- A built artefact containing an empty list differs from no artefact.
- Article staleness, prompt age and changed profile are separate facts; they can coexist.
- Offline provenance, read-start order and replacement identity must retain their existing semantics.
- A running job, a failed job and a rewrite awaiting its replacement are not read states. Keep `useStepJob` and `useRewriteHold`.
- “Never had” versus “no longer has” a particular optimistic row requires confirmation history. Whole-read absence cannot supply it.

**Deletion test:** the spike should delete Ideas’ independent read-status/error/value transition machinery and consumers’ reconstruction of those combinations. It should not add a second state model beside it. Whether it reduces implementation complexity is something the spike must demonstrate.

It need not collapse into the rejected generic artefact-read hook. Ideas can continue to own parsing, absent-result policy, copy and verbs. `useOrderedRead` should continue to own ordering. Moving those responsibilities into a generic loader is outside this proposal.

#### Consumers that would change

| Consumer | Current dependency | Ideas spike |
|---|---|---|
| `IdeasBand` / `useIdeasMode` | `ideas.ideas`, generation identity, resolved passages | Obtain the accepted value from the read; preserve held content during refresh/failure. |
| `IdeasPanel` | `status`, `error`, `stale`, `profiled`, `profileChanged`, plus job/hold fields | Consume the whole read; handle failure independently of retained content. Keep job state separate. |
| `useSkim` / Skim’s Ideas read | Ideas `status` and `stale` choose prerequisites and waiting | Translate explicit read knowledge into prerequisite decisions; unresolved/failed reads must retain the existing spending policy. |
| `OwnerMarginFeed` | `status === "ready" && !stale` | Select an accepted, usable Ideas value under the existing policy. |
| `Reader` | Receives Ideas passages/feed, not `IdeasRead` directly | No direct Ideas read-prop migration. Later Glossary/Citations/Quiz adoption reaches its direct owner capabilities. |
| `Metadata` | Own provenance value, error, offline and checking facts | No Ideas-spike change. Its own later migration must carry read state to sections such as Sharing. |
| `Dock` | Combined comments/questions `loaded` and separate errors | No Ideas-spike change. A later collection migration must preserve partial local rows after a failed opening read. |
| `useAutoRun` | `ArtefactStatus` | Use an explicit adapter for the spike; do not redesign activation or spending policy. |

`PublicRead<T>` is a **different job**. It describes an HTTP outcome—body or not-shared—while other failures throw. It does not represent asking, retained knowledge or revalidation. Its public 404 policy must not become a universal interpretation of private-route 404s.

#### Would this type have prevented the seven postmortems?

| Postmortem | Honest preventive claim |
|---|---|
| **261004c** — empty artefact still carries failed read | **Conditionally yes:** whole-read props and exhaustive failure rendering expose `failed(previous: known-empty)`. A type projected into the old status-only gate would not. |
| **261004f** — previous 404 cannot settle failed retry | **Conditionally yes:** every completed request must transition out of `asking`, independently of its previous answer. A union alone cannot force the catch to run that transition. |
| **261005q** — never-had versus no-longer-has | **No:** it needs per-row server-confirmation history. Keep the existing unseen/confirmed reconciliation. |
| **261005r** — publication 404 mistaken for sharing state | **Not by itself:** explicit unknown helps, but the read must concern visibility. A typed publication answer still cannot establish sharing. |
| **261006b** — completion order mistaken for observation order | **No:** read/write generations and start-time provenance are required. `known` is not proof of observing the latest write. |
| **261006g** — asking passed through failure-shaped prop | **Yes for the prop omission**, if the whole type crosses that seam. It does not create the bounded retry policy that fixed the second half. |
| **261005i** — failure presence inferred from message | **Yes for presence**, if consumers branch on `kind`, not message truthiness. Catching `unknown` and producing useful copy remain necessary. |

Characterise retained-value and retained-absence refreshes, adversarial rejections, offline answers and rewrite holds before adoption. The existing matrix’s malformed-refresh rows cover **four** hooks—Ideas, Quotes, Glossary and Quiz—not the whole family.

### WC4 — Debate sub-mode changes do not reset a failed band

**C · Tier 1 · ease 5 · value 2 · risk low**

**Anchors:** `src/web/reader/ModeBoundary.tsx` — `useQueryStates`, `subMode`, `resetKey`; `src/web/modes/debate/DebateMode.tsx` — owner and `VisitorDebateBand` subscriptions to `debateParam`.

The boundary distinguishes Diagram, Referee, Learn, Summary and Structure sub-modes. Debate falls through to `""`, so Reception and Claims have identical reset keys for owners and visitors.

After a fault in one Debate view, Back/Forward to the other view retains the failure fallback. A new owner press can reset it through activation, which masks some paths; history navigation does not provide that press. Visitors also have genuinely different Debate views.

This is a proved omission in the recovery contract, not evidence of a particular production Debate throw.

**Proposed fix — a separate claim:** subscribe to `debateParam` and include its selected view in the reset key for both access arms. Extend `a-broken-mode-leaves-the-article-readable.test.tsx`: throw in Claims, navigate back to Reception without arming a press, and require a fresh band.

Use the existing `FeatureBoundary`; no replacement boundary or mode registry is justified.

`4b502174a` introduced this sibling difference. The boundary’s written visitor exceptions cover pinned Diagram and unavailable Referee/Learn bands; they do not justify excluding Debate.

## Siblings compared

### Read-hook matrix

The baseline below is the **ordinary stored-artefact family**, the thirteen rows Glossary through Skim. It is not an instruction to make collections or write-only streams behave like artefacts.

**Notation:**

- **A:** nullable artefact; `status: loading | none | ready | error`; independent `error` and currency fields. Initial asking, failed, known-empty, known-value and stale are distinguishable **in combination**. Refresh asking over retained data is not exposed.
- **P:** `profiled` and `profileChanged`.
- **F:** fresh-read bookkeeping for rewrite holds.
- **O:** `useOrderedRead`; current-generation GET checks, no GET abort. Unless a row says otherwise, stored payload is not internally cleared on slug change.
- **K:** actual article ownership boundary: `OwnedArticle key={slug}` remounts on slug changes; `useArticleAccess` returns loading synchronously when reader identity changes, unmounting private readers.
- **Δ:** departure from that baseline. “Written” identifies a stated reason; “unwritten” means I found no reason for that difference in the hook/shared machinery.

For baseline A hooks, network/JSON failures set a read error and preserve an accepted value/status; an opening failure settles to `error`. Baseline retry repeats the GET and never generates. Invalid JSON is a failure; a successful `readJson<T>` cast alone does not validate its shape.

| Hook | Returned read shape / states | Ordered read | 404 / malformed success / failure | Retry | Slug, reader, late answer and abort |
|---|---|---|---|---|---|
| **Glossary** | A: `glossary`, stale/outdated, P, F; Δ `panelRun`, lookup/hide state | O; also `armRefresh` | 404 or explicit null → none; checks outer glossary object, not full entry schema; baseline failure | `retryRead` | Δ clears state during render on slug change. Written: child-effect ordering/dedupe. K; GET fenced, lookup/ask ownership and abort machinery separate. |
| **Ideas** | A: `ideas`, stale/outdated, P, F | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K; no internal payload reset; no GET abort. |
| **Quotes** | A: `quotes`, stale/outdated, P; Δ append/find-more state | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K. Append differs from replacement; written policy. |
| **Timeline** | A: `timeline`, stale/outdated; Δ no P/F | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K. No profile participation is written in its interface. |
| **FAQ** | A: `faq`, stale/outdated; Δ no P/F | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K. Read-only/full-hook split is written; no profiled result contract. |
| **Citations** | A: `citations`, stale/outdated; Δ lookup/dig state, no P/F | O | 404/null → none; citations-array check; baseline failure | `retryRead` | O + K; lookup/dig abort separately. Written: stored citation data plus per-work lookup. |
| **Debate** | A: `debate`, stale/outdated; Δ no P/F | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K. Profile exclusion and read-only margin half are written. |
| **Quiz** | A: `quiz`, stale/outdated, P, F; Δ kept/from-server/unread maps | O | 404/null → none; stronger batch/question checks; baseline failure | `retryRead` | O + K; kept bookkeeping is article-scoped; mark work aborts separately. Written: saved attempts have another lifecycle. |
| **Simple** | A: `simpleSummary`, stale/outdated, P, F; Δ preview state | O | 404/null → none; outer object check; baseline failure | `retryRead` | O + K; preview lifecycle separate. Written. |
| **Sketch** | A: `sketch`, stale/outdated, P, F; Δ validation `faults` | O | 404 → none; `readSketch` validates/repairs scenes; no surviving scene → none; baseline failure | `retryRead` | O + K; Δ block-id order changes re-key load. Written: validate against current blocks. |
| **Illustrated** | A: `illustrated`, stale/outdated, P; Δ `faults`, discriminated Sketch prerequisite readiness | O | 404 → none; stored-picture validation; no surviving plate → none; baseline failure | `retryRead` | O + K; Δ block-id order triggers validation/read. Written: picture and prerequisite contracts. |
| **Tweets** | A: `thread`, stale, profileChanged, F; Δ no outdated/profiled; historical `answered` ref | O | 404 → none; Δ outer reply is unchecked: `{}` can become ready with null thread. After an accepted answer, failure uses `THREAD_RECHECK_FAILED`; failed empty retry settles to none | `retryRead` | O + K; only history ref resets internally. Written recheck policy and arrival-generation exception; malformed acceptance has no written reason. |
| **Skim** | A: `skim`, stale/outdated/profileChanged; Δ `notOnRoute`, prerequisite wait | O | 404 → none; Δ reply is cast, so `{}` can become ready with undefined payload; baseline failure | `retryRead` | O + K. Written prerequisite/job policy; malformed acceptance has no written reason. |
| **Search** | Δ `runs[]`, `loaded`, `loadFailed`, `loadError`, `loadFromCopy`, write `error`, per-row stale | Δ opening read | 404/network → failed load; missing `runs` defaults to []; array shape unchecked | Δ page reload for GET; `retry(id)` retries a run | Δ internally resets; opening GET deadline/live guard/abort; POST scope token rejects old-slug frames and supersession aborts. Written opening-read/write ordering. K. |
| **Crossrefs** | Δ only `readonly Crossref[] \| null`; asking/failure/absence conflated, no exposed stale | O | 404/null/non-drawable/failure → null, including discarding old links | Δ no public retry; job completion refreshes | Δ slug-tagged projection hides old links synchronously; GET fenced, not aborted. Written: quiet optional prose enhancement. K. |
| **Claims** | Δ `run`, `stale`, `loaded`, `loadFailed`, shared `error`; fingerprint knowledge separate | O; uses `discard` | Δ 404/network → failed read; missing run → known empty; shape unchecked | Δ internal reload used by activation; no returned read-retry verb | Δ effect resets and discards generation; stream checks current slug, does not abort. Written: one replacing Claims run per article. K. |
| **Criteria** | Δ `criteria[]`, `loaded`, `loadFailed`, `loadError`, write `error`, per-row stale | Δ opening read | 404/network → failed load; missing list → []; shape unchecked | Δ page reload for GET; row retry starts stream | Δ internally resets; opening GET deadline/live guard/abort. Stream has no Search-style old-slug token/abort; K prevents it entering the new article instance. Difference unwritten. |
| **Mirror** | Δ no stored read: `idle/running/done/failed`, `result`, `writing`, `error`; no currency state | Δ none | POST failure, including 404, → failed run; validates terminal result; EOF → failure | Δ `ask` repeats model run | Δ resets on slug; controller identity fences results, aborts on leaving. Written: ephemeral run over referee comments. K. |
| **Comments** | Δ `comments[]`, `loaded`, `loadFailed`, `loadError`, write `error`; no artefact stale | Δ opening read | 404/network → failed load; missing list → []; shape unchecked | Δ page reload for GET; explanation retry is a separate POST | Δ resets list/registries; opening GET deadline/live guard/abort. Free writes deliberately outlive mount with captured ownership. Answer stream is not aborted or equivalently slug-fenced; K isolates instances. WC1 remains within one instance. |
| **Chat** | Δ `threads[]`, `loaded`, `loadFailed`, shared `error`; controller internally has `loadPhase` | Δ operation reducer | 404/network → failed load; missing list → []; deeper shape unchecked | `reload` | Δ controller per slug rejects superseded load operations; no opening GET deadline/abort. Durable writes outlive subscribers deliberately. Written operation model. K. |

The ordered-read count is reproducible with:

```sh
rg -n 'useOrderedRead\(' \
  src/web/use{Glossary,Ideas,Quotes,Timeline,Faq,Citations,Debate,Quiz,Simple,Sketch,Illustrated,Tweets,Skim,Search,Crossrefs,Claims,Criteria,Mirror,Comments,Chat}.ts
```

There are **15 executable call sites**: the thirteen artefact hooks, Crossrefs and Claims.

The different parsers should remain domain-owned. The unchecked successful replies are a characterisation gap, not proof that the current server produces those shapes. Missing collection fields defaulting to empty are another gap worth preserving in the migration evidence; they should not quietly become a new universal absence policy.

### Sub-mode siblings

`src/web/sub-modes.ts`’s `SubMode` union names **six** parents. The count comes from its six alternatives: Learn, Diagram, Referee, Summary, Structure and Debate.

| Parent | Late foreground snapshot | Failed-band reset |
|---|---|---|
| Learn | Included | Owner only; visitor has no selectable band |
| Diagram | Included | Owner only; visitor pinned to Sketch |
| Referee | Included | Owner only; visitor unavailable |
| Summary | Included | Owner and visitor |
| Structure | Included | Owner and visitor |
| Debate | **Omitted: WC2** | **Omitted: WC4** |

The exceptions in the reset column are documented. Debate’s omissions are not.

### Reader’s reasons to change

Reader changes for composition/access, layout and scroll geometry, URL navigation, passage publishing, overlays, gestures and mode-specific handoffs. These responsibilities are real; its length is not evidence for extraction.

The ordering-sensitive seams deserve particular care:

- `useReadingPosition`’s `synced` ref records agreement between URL and scrolling; it is not a second authoritative position.
- `surface` and `commentsNow` are published in layout effects so async completions see committed foreground state.
- Stable `selectProse` callbacks read committed refs to avoid invalidating the memoised prose table.
- Fresh-selection restoration waits until DOM painting and dialog focus have happened.
- `modeWas` refreshes chat summaries when leaving Chat.
- `bandAway`, heralds, arrivals and handoffs describe transient interactions that a URL alone does not encode.

The remaining passage slots belong to Search, Ideas, Timeline, Referee and Skim; Quotes has a derived path. I found no new lifecycle drift that earns the previously rejected reducer.

A new mode still has to consider `modeBand`, passage selection/keyboard dispatch, stop-card opening, overlay policy and foreground cancellation. The new evidence is the missed Debate sub-mode in two existing lists, not a reason to build a mode registry.

## For the owner

WC1 removes a visible disagreement with the saved note. WC2 removes a late comment box opening over a newer Debate choice. WC4 allows navigation to a different Debate view to recover from a failed band. These are corrections to written behavior; no new product policy is proposed.

The read-result spike should preserve current presentation initially. Exposing refresh-in-flight does not decide whether readers should see a new spinner, whether retained data remains interactive, or whether more reads retry automatically. Those would be product choices, beyond the approved type migration.

Two existing differences should remain deliberate:

- Crossrefs hides read failure because it is an optional enhancement. Adopting a richer internal type does not require adding visible errors or retry controls.
- Comments, Search and Criteria can show locally made rows after the opening list failed. A collection result must not label those rows a complete server list or remove them merely to fit the artefact shape.

## Considered and not proposed

- **Deleted comments returning to storage after answer completion.** The client comments suggest this, but the current fenced database `UPDATE` cannot recreate a deleted row. I dropped the resurrection claim. The explanatory comments in `send` should be corrected to match the current store contract.
- **Quote opening bypassing `showBand`.** The suspicious callback uses the plain mode setter, but its Open Quotes control is hidden when already in Quotes. Changing from another mode triggers the existing band reset. No reachable defect established.
- **Criteria/Comments old-slug streams landing.** Their hook-local protection differs from Search. Actual article navigation remounts the keyed owner subtree, and reader changes unmount it through access loading. I did not establish a visible cross-article leak; the matrix records the dependency rather than promoting a hypothetical unkeyed caller.
- **Malformed 200s across all hooks.** Several unchecked bodies can produce misleading states, but I found no current producer proving a live failing input. Do not call parser uniformity a completed repair merely because the result type compiles.
- **Mirror’s null error-frame handling.** The defensive gap remains, but I found no new producer or drift beyond the fifth sweep’s held concern. No generic stream shell proposed.
- **Reader, Metadata or Dock splits by size; a mode registry; a generic artefact-read hook.** No new deletion-test evidence earns them.
- **Shared automatic retry in `useOrderedRead`.** It would introduce failure-policy decisions into machinery that currently owns ordering. Metadata’s bounded retry does not establish that policy for other reads.
- **Removing `useOrderedRead`, fresh-read provenance or rewrite holds after introducing a union.** The union answers what is known. Those mechanisms answer which request may commit and whether it observed a write.
- **Reviving the passage reducer.** No new sibling drift found.
- **Making public and private 404s equivalent.** They answer different questions; `PublicRead` is not the lifecycle type.

## One level up

The overall approach remains sound: modes own their data contracts and policies, while ordering, job observation, activation and passage lifecycle have narrow shared owners. The weak point is information crossing component boundaries as a value plus separately chosen booleans, and new sub-modes extending some handwritten lists without extending others. An Ideas result-type spike can strengthen the first seam without centralising mode policy. The two Debate omissions need local repairs and regressions. The comment race needs field ownership to survive asynchronous whole-row replies; neither a larger Reader decomposition nor a generic stream abstraction addresses it.