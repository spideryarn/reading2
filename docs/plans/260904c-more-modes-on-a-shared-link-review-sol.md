## Verdict

Do not build stages 3–5 as written.

Timeline and the force-only diagram are sound. The reader-work stages need two changes first:

1. Existing public articles must not gain comments, chat, or searches without a new per-article opt-in.
2. Public collection reads need dedicated projection-and-authorisation queries. Reusing owner-store methods such as `comments.listFor(articleId)` breaks the public-reader boundary.

The single-payload design is defensible only after measuring worst-case data. My preferred simple shape is one lazy endpoint—`GET /api/public/article/:slug/reader-work`—returning three required arrays. That avoids both the four-state artefact machinery and the cost on every public article request.

## Blocking

### 1. Retroactive exposure requires consent, not revised copy

The previous plan explicitly promised that annotations were excluded and would need a later opt-in. The live privacy page is stronger still: “Your notes, your comments and your conversations are not shared.” See [the original plan](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/docs/plans/260827ai-public-read-only-access.md>) and [PrivacyPage.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/PrivacyPage.tsx:273>).

Publishing those rows automatically on already-public articles would invalidate the choice owners previously made. A notice is not enough.

The cheap technical option is an additive article field such as:

```ts
publicReaderWork: boolean // NOT NULL DEFAULT false
```

Existing articles retain their present inventory. The sharing dialog offers an explicit “also share my comments, conversations and saved searches” choice. Every public reader-work query requires both `visibility = 'public'` and this new flag.

This needs to land with the exposure code, not in the final documentation sweep:

- [schema.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:264>)
- [pg-visibility.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/store/pg-visibility.ts>)
- [AccessSharing.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/AccessSharing.tsx>)
- [PrivacyPage.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/PrivacyPage.tsx>)
- [privacy-page.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/privacy-page.test.ts>)

The consent wording must also disclose that chat answers may repeat information from other private library articles. Chat tools can search and read the owner’s whole library; hiding the tool metadata does not remove derived material already present in the assistant’s text.

### 2. Reusing `listFor(articleId)` defeats the public-read architecture

Stage 3 proposes reusing the owner comment reader. That method uses an unrestricted `.select()` and maps private operational columns such as model, error, searches, and leases. See [pg-comments.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/store/pg-comments.ts:118>).

More importantly, the existing security tests specifically identify “obtain an article ID, then read a child table by ID” as the escape hatch. Comments, chat, and searches are deliberately absent from the public table allowlist in [public-imports.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-imports.test.ts:275>).

Implement dedicated public projections in [public-reader.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/store/public-reader.ts>). Each query should:

- select named public columns;
- join `articles`;
- repeat the public slug and reader-work consent predicates;
- avoid accepting a naked `articleId` as its authority;
- filter private subtypes and unfinished rows in SQL.

Export query builders and inspect their generated SQL in [public-reads.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-reads.test.ts>). Also consciously amend the public table tripwire rather than merely allowing imports from the owner stores.

### 3. The current allowlists would expose unintended modes and misleading records

Two row-level filters are missing:

- Comments with `criterionId` are Referee-mode work. Removing `criterionId` and `valence` from the DTO does not make their quote/body non-referee. Filter `criterion_id IS NULL` unless Referee notes are separately approved.
- Chat loading currently includes `chat`, `remember`, and `candidates`; the app filters candidates later. A public query must filter `kind = 'chat'` in SQL. Otherwise the payload exposes Remember transcripts and Referee candidate machinery even if the visitor UI hides them. See [schema.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:2806>) and [App.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/App.tsx:3809>).

Pending and failed comments, searches, or messages also need a decision. Sending `status` while withholding `error`, retry controls, and polling can leave a permanently blank or unexplained public item. The simple policy is to publish only completed rows.

## The payload architecture

The plan’s stated reason for one payload is not compelling. Collections are not generated artefacts, so they do not need `PublicArtefactRead<T>` or an `availability-unknown` state. Required arrays are sufficient:

```ts
{
  comments: [],
  chats: [],
  searches: []
}
```

An empty array means “there are none”; it is not a visitor capability gap.

Also, a per-collection route does not itself bound payload size. Only pagination or a hard limit does that.

I recommend one lazy combined endpoint:

```text
GET /api/public/article/:slug/reader-work
→ { comments: [], chats: [], searches: [] }
```

Fetch it the first time the visitor opens any reader-work mode. It has:

- one loading/error state, unrelated to artefact availability;
- no cost on ordinary article loads;
- no proliferation of three public APIs;
- no change to whether modes are advertised;
- required arrays that eliminate optional-state ambiguity.

Before deciding, measure the maximum and distribution of serialized bytes and row counts across accessible articles. Measuring “a real article” in Stage 6 is too late and proves little. Remember that `HEAD /api/public/article/:slug` currently performs the full read/serialization too, so bots and link unfurlers can trigger the extra queries.

If existing data can approach the response cap, the simplest answer is probably to defer chat rather than immediately build thread pagination. Chat is the largest and riskiest part of the requested scope.

## Complete column audit

### Comments

Unclassified by the plan:

| Column | Recommendation |
|---|---|
| `articleId` | Do not cross. |
| `id` | Cross; needed for stable identity and dialog/list keys. |
| `updatedAt` | Explicitly omit unless the public UI shows “edited”. |
| `threadId` | Omit unless public comments deliberately link into public chat. |
| `status` | Prefer filtering to completed rows; otherwise cross a narrowed public status. |

Corrections to classified fields:

- `answer`: yes, it can cross after explicit consent; it is part of what the owner saved.
- `citations`: yes, but rebuild `{ url, title? }` field-by-field and apply a real public URL policy.
- `criterionId` and `valence`: correct not to cross, but rows containing them must be filtered entirely.
- `searches`: correctly omitted as internal explanation provenance.

Source: [comments schema](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:1419>).

### Chat threads

Unclassified:

| Column | Recommendation |
|---|---|
| `articleId` | Do not cross. |
| `id` | Cross; necessary to select and key a thread. |
| `updatedAt` | Cross if reusing the current thread list, which displays/sorts by recency; otherwise deliberately remove that behaviour. |

`kind` should not normally cross: filter public rows to `kind = 'chat'`, then the public DTO can omit it or make it a fixed literal.

Source: [chat thread schema](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:2806>).

### Chat messages

The plan lists `ownerId` as never shared, but `chat_messages` has no `ownerId`.

Unclassified:

| Column | Recommendation |
|---|---|
| `articleId` | Do not cross. |
| `threadId` | Do not cross when messages are nested under a thread. |
| `id` | Cross for stable identity. |
| `status` | Filter to completed messages or cross a narrowed public status. |
| `searches` | Omit unless the public UI deliberately shows web-search provenance. |
| `createdAt` | Classify explicitly; current shared UI types may require it even if it is not displayed. |

Wrong or incomplete classifications:

- `ordinal`: do not cross; the array order already represents it.
- `passages`: should cross if the answer crosses. They connect claims back to article blocks; omitting them turns a grounded response into an apparently uncited assertion. Project only `blockIds` and `why`, validating every block ID.
- `stopped`: should cross, or stopped messages should be excluded. It explains why an answer ends early.
- `interrupted`: similarly needs either a public representation or filtering.
- `stance`: omit if public chat is restricted to `kind = 'chat'`; it is relevant to Remember.
- `editedAt`: may be omitted, but classify it explicitly.
- `tools`: must not cross wholesale.

`ToolRun` contains `name`, `label`, `detail`, `status`, and timing. Labels/details can contain:

- the reader’s search words;
- a private article title or slug;
- descriptions of searching the owner’s library;
- internal function names and timing.

It does not contain raw model names, costs, or full tool result payloads, but it can disclose private library metadata. For v1, omit tools entirely. Source: [ToolRun type](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/types.ts:1966>).

Citations carry URL/title. They can expose query strings or credential-bearing/private-network URLs unless sanitised; the current `isWebUrl` check is only a scheme check. [CommentDialog.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/CommentDialog.tsx>) currently lacks even the chat panel’s filtering.

Source: [chat message schema](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:2932>).

### Search runs

Unclassified:

| Column | Recommendation |
|---|---|
| `articleId` | Do not cross. |
| `id` | Cross for stable saved-run identity. |

Additional points:

- `criterion` is the reader’s own writing. Sharing it is necessary for the feature, but the plan should identify it explicitly as reader-authored disclosure.
- `hits` contains `blockId`, `quote`, `confidence`, `reasoning`, and optional `start`. It contains no URL, model, cost, or reader query. The quote is article prose and reasoning is model prose. Rebuild this nested object field-by-field.
- `sourceHash` should not cross. If freshness matters, expose a derived `stale: boolean`.
- Prefer publishing only completed runs. A failed status without its private error or retry path is not useful.

Sources: [search-run schema](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/db/schema.ts:3091>) and [SearchHit type](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/types.ts:2644>).

## Worth doing

### Remove the proposed union members

`owners-work` and `none-yet` are the wrong abstraction. “No saved items yet” is content inside an accessible panel, not something preventing access.

With the consent gate recommended above, retain `readers-own`: it is exactly the correct sentence for a public article whose owner has not opted into sharing reader work. Comments, Chat, and Search can all use it.

The three totality mechanisms are useful but not sufficient:

- `POLICY` catches a newly added mode.
- `FIXED_BY_AN_ACCOUNT` catches a newly added gap kind.
- `visitorSentence` catches an unhandled consumer branch if its return is exhaustively typed.

They do not detect:

- orphan union members with no producer;
- a wrong payload key;
- a DTO field silently omitted because it is optional;
- a collection wired to the wrong mode;
- a private child-table query authorised only by naked `articleId`.

Add required DTO fixtures and exact nested key-path tests for comments, threads, messages, citations, tool runs, and search hits. If `owners-work.key` survives, it must at least be `keyof PublicReaderWork`, not an untyped string.

### Harden diagram gating at the component boundary

The three hooks listed in the plan are not the only paid paths:

- `SketchView` mounts `useSketch`, which auto-runs.
- `IllustratedView` mounts `useIllustrated`, which can enqueue generation jobs.

See [DiagramPanel.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/DiagramPanel.tsx:1468>).

Pinning the visitor kind to `force` prevents both children from mounting, so I found no fourth paid request once that invariant holds. Force also draws correctly without embeddings: it retains hierarchy, sequence, anchor, and vocabulary edges; semantic edges simply become empty.

Make the invariant structural with a discriminated `access` prop rather than `isOwner: boolean`. Test hostile direct URLs and history navigation for `diagram=sketch`, `illustrated`, `drift`, and `trail`, asserting that none of the generation, projection, similarity, or sketch-caption endpoints are called.

### Decide whether visitor prose markers are included

The plan describes panels, but [reader-capability.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/reader-capability.ts>) currently gives visitors `NO_COMMENTS` and `NO_THREADS`. That means comments/chat can exist in the dock while their anchored marks remain absent from the article.

Either populate read-only marks from the public DTO or state explicitly that v1 exposes list views only.

## Missing files and tests

The plan should name these explicitly:

- [public-imports.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-imports.test.ts>) — child-table tripwire and allowed-table rationale.
- [public-reads.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-reads.test.ts>) — generated SQL predicates and selected columns.
- [public-visibility-pg.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-visibility-pg.test.ts>) — real DB tests for private/public, wrong owner, consent off/on, subtype filtering, and no oracle.
- [public-types.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/public-types.ts>) — dedicated public comment/chat/search/nested DTO types.
- [public-dto.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-dto.test.ts>) — required nested fixtures and exact key paths.
- [PrivacyPage.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/PrivacyPage.tsx>) and [privacy-page.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/privacy-page.test.ts>).
- [shared-inventory.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/shared-inventory.test.ts>) — both consent scopes and one-hot payload wiring.
- [public-network-trace.test.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/public-network-trace.test.tsx>) — diagram deep links and assurance that visitor panels never mount owner/live hooks.
- A migration, [db-schema.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/db-schema.test.ts>), and [access-sharing.test.tsx](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/tests/access-sharing.test.tsx>) for the consent field.

There is also a factual error in the plan: chat and search are not fixed prose rows in `ALWAYS_SHARED`/`NEVER_SHARED`; they are mode-derived inventory entries. Only comments require moving fixed prose. See [shared-inventory.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/web/shared-inventory.ts>) and [messages.ts](</home/greg/code/spideryarn2/.claude/worktrees/public-modes/src/messages.ts>).

## Recommended order

1. Measure maximum/distribution of stored reader-work bytes and row counts.
2. Add the per-article reader-work opt-in, privacy copy, and both-scope tests.
3. Timeline.
4. Force-only diagram.
5. Comments with dedicated public query and Referee filtering.
6. Search with completed-run filtering.
7. Chat last—or defer it—because it has two tables, subtype filtering, tool metadata, and possible derived disclosure from other private articles.
8. Final browser and size evidence.

Cut the `owners-work`/`none-yet` union surgery. Move documentation and reader-facing privacy copy into the same stages that make data cross the boundary; Stage 8 should verify them, not introduce them.