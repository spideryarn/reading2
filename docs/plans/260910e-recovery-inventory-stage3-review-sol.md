REFUSE — seven established P1 contract failures; no P0 found.

### F27 — P1 — established

[recovery-feed.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/recovery-feed.ts:129) checks the descriptor’s size, then calls `readFile()`. A regular file at or below 16 MiB can be appended indefinitely after `stat`; `readFile()` continues to EOF and defeats the ceiling.

(a) Input: open a small `recovery.json`, let `stat()` finish, then continuously append before/during `readFile()`.

(b) Smallest fix: replace `readFile()` with descriptor reads totaling at most `MAX_RECOVERY_INPUT_BYTES + 1`; the extra byte selects `oversized`. Decode only the bounded buffer.

### F28 — P1 — established

[overseer-recovery-drill.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/scripts/overseer-recovery-drill.ts:89) falls back to the lexical path when the complete target does not exist. If `/tmp/live` is a symlink to `~/.overseer`, `/tmp/live/new-drill` passes because `realpathSync()` fails on the absent leaf, then `mkdirSync(..., {recursive:true})` writes inside the real store. The guard also ignores an absolute `OVERSEER_STORE_DIR` naming a non-default live store.

(a) Inputs:

```text
/tmp/live -> /home/greg/.overseer
target=/tmp/live/new-drill
```

or:

```text
OVERSEER_STORE_DIR=/srv/live-overseer
target=/srv/live-overseer/new-drill
```

(b) Smallest fix: protect both the default store and an absolute `OVERSEER_STORE_DIR`; canonicalize the nearest existing ancestor and append the missing suffix before comparing. Recheck the canonical target immediately before creating any child.

### F29 — P1 — established

The fleet file parser does not validate relationships the daemon’s parser requires. [parseEntry](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/recovery-feed.ts:201) discards `entry.key`; [parseView](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/recovery-feed.ts:445) discards each item’s duplicated `key`, `name`, `at`, and `resolution`, and silently overwrites duplicate IDs. It can therefore attach one session’s directory, classification, or evidence to another record.

(a) Input: a record with `key: "$1 A"` and `entry.key: "$2 B"`, or a view item whose ID matches record A but whose duplicated identity describes B. The store’s parser rejects the former at `store.ts:2920`; fleet accepts both.

(b) Smallest fix:

```text
Require entry.key === record.key.
Require unique view.page IDs.
For every view item, require key/name/at/resolution to equal its record.
Require unresolved items to have both classification and evidence;
resolved items must have neither.
Any failure makes the view unreadable (or the record file unreadable for entry.key).
```

### F30 — P1 — established

The browser parser validates fields individually but not the server’s cross-field contract ([recovery-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/web/src/recovery-client.ts:178)). It accepts:

- `not-yet-checked` plus an `interrupted` row;
- an untrusted inventory plus non-`unknown` classifications;
- duplicate IDs or more than 100 records;
- `unresolved > total`;
- impossible oversize/entry/disappearance combinations.

The panel then renders contradictory claims rather than `no-answer`.

(a) Mutation: change a valid feed to `view.kind = "not-yet-checked"` while retaining a classified interrupted record. `parseRecoveryFeed()` returns it and the page displays both “classification is unknown” and “interrupted.”

(b) Smallest fix: add a final whole-payload validation enforcing those relationships, unique IDs, the 100-record bound, and:

```ts
unresolved <= total
shownUnresolved <= unresolved
shownResolved <= total - unresolved
```

Reject violations as `no-answer`.

### F31 — P1 — established

[RecoveryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/web/src/RecoveryPanel.tsx:345) computes view age from the browser clock and ignores the server’s validated `composedAt`.

(a) Input: `composedAt=15:00`, `checkedAt=14:30`, phone clock/`nowMs=14:30`. The page says “Checked 0s ago” although the server already knew the view was 30 minutes old.

(b) Smallest fix:

```tsx
Checked {ago(view.checkedAt, Date.parse(feed.composedAt))} when this answer was served
```

Alternatively retain receipt time and advance the server clock using elapsed client time.

### F32 — P1 — established

The page does not show all required per-record evidence. For `already-live` and `present-but-unmatched`, [the live row](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/web/src/RecoveryPanel.tsx:261) drops its directory, claim, verified conversation, and execution token—the facts needed to inspect the match. Unchecked and resolved rows also omit recorded worktree and any resume-support sentence ([lines 266–284](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/web/src/RecoveryPanel.tsx:266)).

(a) Input: a present-but-unmatched row with a different directory and conversation, or a `view:null` record with `entry.worktree`. Neither distinction appears.

(b) Smallest fix: render the four omitted live-row fields explicitly; render stored worktree for unchecked/resolved records; render `resume: not checked` or `resume: not applicable because this record is resolved`.

### F33 — P1 — established

With `records=[]` and `overflow>0`, the page simultaneously reports omitted candidates and [“No interrupted work is recorded”](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/web/src/RecoveryPanel.tsx:367). This state is reachable after indexed records are resolved and pruned while overflow IDs remain.

(a) Input: `total=0`, `records=[]`, `overflow=1`.

(b) Exact replacement:

```text
The recovery index currently holds no records.
```

### F34 — P2 — reasoned

Although disk I/O is asynchronous, parsing, validating, sorting, and serializing up to 16 MiB happens synchronously on the server event loop. The route test proves only that `handle()` returns before the read settles.

(a) Input: a maximally compact, valid, near-16-MiB file containing many records.

(b) Smallest fix: process parsing/projection in a worker, or establish through measurement a smaller ceiling that bounds event-loop latency without rejecting valid producer output.

### F35 — P2 — established

The wiring guards are source substring checks. Dead code inside the correct textual region still passes.

(a) Mutations:

```tsx
{false ? <RecoveryPanel refreshNonce={refreshNonce} nowMs={now} /> : null}
```

```ts
if (false) {
  if (recoveryApiRoute.handle(req, res)) return;
}
```

(b) Smallest fix: render the real `App` in Overseer mode and assert the panel exists; extract the server’s composed request handler into an import-safe factory and call `/api/recovery` through it.