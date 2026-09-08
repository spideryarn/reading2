Verdict: **REFUSE**. F23–F26 are established P1s. The existing 22-case test file passes, but it does not exercise these transitions.

### F23 — P1 — established: a failed refresh leaves deletion enabled over stale metadata

[`readProvenance`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:460) deliberately retains the previous `provenance` after a refresh fails. `DeletePermanently` therefore receives `known=true, failed=true`, but its refusal branch checks only `!known` at [line 2796](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:2796).

(a) Sequence:

1. Initial metadata GET returns a fresh 200; Delete permanently appears.
2. A generated-mode completion starts `refresh()`.
3. That metadata refresh returns 500 while the article has meanwhile disappeared or changed ownership.
4. `provenanceError` becomes truthy, but the old `provenance` remains.
5. The delete button is still offered from a state the client explicitly failed to establish.

The current failed-load test starts with `provenance === null`, so it misses this.

(b) Smallest fix:

```tsx
if (!known || failed) {
```

Replace the current `if (!known)` condition. Add a test with a successful initial GET followed by a failed refresh.

### F24 — P1 — established: the three-valued re-read treats every 2xx as authoritative survival

The stated rule is “only 200 proves survival,” but [line 2617](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:2617) uses `res.ok`, admitting 201, 202, 204 and 206.

(a) Mutation:

1. Let the DELETE commit, then lose its response.
2. Make the re-read return a fresh `204 No Content`.
3. `stillOnTheServer` returns `"here"`.
4. The control says “The article is still here, untouched” about a deleted article.

(b) Exact replacement:

```ts
if (res.status === 404) return "gone";
if (res.status === 200) return "here";
return "unknown";
```

A 204 re-read test should fail before this change.

### F25 — P1 — established: a successful HTTP status is accepted without the route’s confirmation

At [lines 2735–2738](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:2735), the parsed `{ destroyed: slug }` is discarded. `readJson` also deliberately converts an empty successful response into `{}`.

(a) Mutation: make DELETE return either `204`, `{}`, or `{ "destroyed": "another-slug" }` without deleting the requested article. The control retires the cache and navigates as though deletion was confirmed. All current success assertions still pass.

(b) Smallest fix:

```ts
const answer = await readJson<{ destroyed?: unknown }>(
  await apiFetch(`/api/library/${encodeURIComponent(slug)}`, { method: "DELETE" }),
);
if (answer.destroyed !== slug) {
  throw new Error("The server did not confirm which article was deleted");
}
await leave();
```

The resulting throw correctly enters the existing authoritative re-read.

### F26 — P1 — established: an unknown result leaves the confirm button enabled

When the delete outcome and re-read are both inconclusive, [lines 2757–2762](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:2757) set an honest error but leave `asking=true` and restore `busy=false`. The destructive button at [line 2849](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/Metadata.tsx:2849) is therefore enabled over an explicitly unknown state.

(a) Sequence:

1. DELETE commits but its response is lost.
2. The re-read gets an offline copy, transport failure, 401 or 5xx.
3. The page says it cannot tell whether deletion worked.
4. Beside that admission, it still offers “Delete for ever” for the possibly nonexistent article.

This violates the component’s own “never offer a button over a state we have not established” contract.

(b) Add an explicit uncertain state and render no controls from it:

```ts
const [uncertain, setUncertain] = useState(false);

// survival === "unknown"
setUncertain(true);
setBusy(false);
return;
```

Then place an `if (uncertain)` refusal branch before the ordinary card, analogous to `ArchiveArticle`’s unknown state.

### F27 — P1 — reasoned: the re-read and cache retirement are not bound to the deleting reader

Each `apiFetch` obtains the current credential independently. Meanwhile [`forgetCachedReader`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/lib/cached-shelf.ts:82) reads `lastKnownUser()` only after deletion has settled.

(a) Sequence:

1. Reader A presses confirm.
2. The DELETE fails before writing.
3. The session changes directly to B before the re-read.
4. B receives the required non-owner 404.
5. That 404 is interpreted as proof that A’s article is gone, and B is navigated away.

On the success variant, A’s deletion commits, the session changes to B, and cache retirement clears B’s drawer rather than A’s. Direct A→B changes deliberately do not clear A’s cache, so A can later receive a stale deleted article from it.

(b) Bind the whole operation to one principal: capture the `{token, owner}` used for DELETE, use that same credential for the re-read and retire that explicit owner’s cache. If the component has unmounted or the displayed reader changed, perform necessary cache cleanup but do not navigate or report an outcome in the new reader’s UI.

### F28 — P3 — established: the privacy source contradicts the page shipped in the same commit

[`privacy.md`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/project/privacy.md:344) says the page “caught up,” while [lines 409–415](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/project/privacy.md:409) say it “has not been rewritten yet” and is “overdue.”

(a) The two claims coexist in commit `0ced1d69`; [`PrivacyPage.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/PrivacyPage.tsx:483) confirms the rewrite landed.

(b) Replace those two checklist bullets with:

```md
- **account deletion** grows a button. The per-article deletion button landed on
  2026-09-07 and the page was rewritten with it; account deletion remains manual.
- **what Archive and Delete permanently do** — both controls and their different
  effects are described under *Deleting things*.
```

### F29 — P3 — reasoned: the F7 “one scan” correction overcorrects

The FK action finds no matching rows, but it still executes its child lookup to establish that fact. The delete therefore performs the freeze trigger’s indexed lookup and a second, empty FK indexed lookup.

(a) The first operation is the explicit `UPDATE` at [migration line 63](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/drizzle/20260907200800_ingest_events_unlink_atomically.sql:63); the declared `ON DELETE SET NULL` still invokes its referential action afterwards.

(b) Replace the plan’s correction with:

> With F9 in place the FK still performs a second index-backed lookup, but it finds no rows and visits no matching ledger tuples. The first lookup is the only one that updates rows.

The important correction is “not two full ledger scans”; it is not literally one lookup.

### Database conclusions

I found no supported concurrency ordering that changes the charge:

- A usage query sees either the pre-delete live article or the committed frozen value, never half of the transaction.
- Visibility update and deletion serialize on the article row.
- Settlement’s FK check and deletion serialize.
- Rollback removes both the unlink and the stamp.

The validated CHECK is the right data-integrity choice. Stage B’s old trigger could expose both values only inside the still-uncommitted DELETE statement; no concurrent reader could observe or commit that state. `COPY` observes CHECK constraints, and a normal restore either restores consistent rows or fails when the validated constraint is added. A failed statement rolls back. `NOT VALID` would deliberately preserve an existing violation. It is useful only as an operational lock-duration technique if production table size warrants adding and validating separately—not because a legitimate dirty row is expected.

The F8 trigger has no false positive on the legitimate path. PostgreSQL forms `NEW` with both `SET` assignments before running the child `BEFORE UPDATE` trigger, and `articles.visibility NOT NULL` guarantees the frozen value is non-null.

For a confirmed same-reader deletion, cache retirement is otherwise sound: the epoch advance and deletion share one IndexedDB transaction, old in-flight tickets cannot repopulate it, and navigation awaits retirement. F27 is the exception because “same reader” is looked up again rather than preserved.

The 409 reliance is acceptable as part of the route’s status contract; the server must ensure 409 means no delete was attempted. The export-section scroll is preferable to a bare authenticated API link. I found no defect in the deliberate lack of bracketed codes or in the present double-click structure.

Test run: `tests/metadata-delete-permanently.test.tsx` passed, 22/22. No files were changed.