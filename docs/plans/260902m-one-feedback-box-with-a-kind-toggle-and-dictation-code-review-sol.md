## Ranked findings

### 1. High — the snapshots are structurally chained but semantically stale

[`20260902141103_snapshot.json`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/drizzle/meta/20260902141103_snapshot.json:2024) contains `jobs.reserves_name`, `jobs.url_key`, and the `0052` indexes. Those changes disappear again from [`20260902150952_snapshot.json`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/drizzle/meta/20260902150952_snapshot.json:2048), and remain absent from both feedback snapshots.

(a) Concrete failure:

I copied `drizzle/` to `/tmp` and generated against the current schema. It emitted:

```sql
DROP INDEX "spideryarn"."jobs_active_slug";
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "reserves_name" ...;
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "url_key" text;
-- plus all five 0052 indexes and jobs_cancelling_is_running
```

Those changes are already in `0052`. Deploying that generated migration fails immediately because `jobs_active_slug` was already dropped.

Reproduction:

```bash
repo=$PWD
probe=$(mktemp -d)
cp -a drizzle "$probe/"
(
  cd "$probe"
  "$repo/node_modules/.bin/drizzle-kit" generate \
    --schema "$repo/src/db/schema.ts" \
    --out drizzle \
    --dialect postgresql \
    --name review_probe \
    --prefix timestamp
)
```

`npm run db:chain` still says “Everything’s fine”; it checks linkage, not snapshot contents.

(b) Smallest fix:

The realtime migration did not touch `jobs`, so copy the complete `"spideryarn.jobs"` object from `20260902141103_snapshot.json` into:

```text
20260902150952_snapshot.json
20260902161529_snapshot.json
20260902161553_snapshot.json
```

Keep their IDs and `prevId`s unchanged. I tested that repair in `/tmp`; generation then emitted only the genuinely new `feedback_route_kind` widening for `privacy`.

### 2. Medium — two same-ID sends can complete out of order and overwrite success with failure

Closing and reopening releases `sending.current` at [`FeedbackDialog.tsx:280`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/src/web/FeedbackDialog.tsx:280), allowing a retry while the first request remains in flight. Both retain the same report ID, while `stillMine` checks only that ID at [line 434](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/src/web/FeedbackDialog.tsx:434).

(a) Concrete failure:

1. First Send remains pending.
2. Close and reopen.
3. Second Send returns `201`; the dialog shows “Thank you”.
4. First Send then rejects.
5. Its catch still passes `stillMine()` and changes the dialog back to the failure form.

The inverse ordering can also turn a failed latest attempt into apparent success.

(b) Smallest fix: distinguish attempts as well as reports.

```diff
 const sending = useRef(false);
+const sendAttempt = useRef(0);

 const send = useCallback(async () => {
   ...
+  const attempt = ++sendAttempt.current;
   const mine = reportId;
-  const stillMine = () => mine === reportIdRef.current;
+  const stillMine = () =>
+    mine === reportIdRef.current && attempt === sendAttempt.current;
```

Add a test with two deferred requests for the same ID, settling the newer success before the older failure.

### 3. Medium — the dialog does not actually enforce its 4,000-character limit

`over` is computed at [`FeedbackDialog.tsx:354`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/src/web/FeedbackDialog.tsx:354), but neither the send guard nor the button’s `disabled` expression uses it.

(a) Concrete failure:

Paste 4,001 characters. The counter says the limit is 4,000, but Send remains enabled; clicking it or pressing ⌘/Ctrl+Enter posts the report and produces a server-side `[fb-long]` failure.

(b) Smallest fix:

```diff
 const send = useCallback(async () => {
   if (sending.current) return;
   if (!somethingSaid) return;
+  if (over) return;
   if (dictationBusy) return;
   ...
-}, [reportId, somethingSaid, preparing, consented, body, kind, where, shot, dictationBusy]);
+}, [reportId, somethingSaid, over, preparing, consented, body, kind, where, shot, dictationBusy]);

-disabled={!somethingSaid || stage.kind === "sending" || preparing || dictationBusy}
+disabled={!somethingSaid || over || stage.kind === "sending" || preparing || dictationBusy}
```

### 4. Low — `[fb-shape]` tests values, not the presence of both request shapes

[`feedbackBody`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box/src/routes.ts:5134) considers a shape present only when it contains nonblank text.

(a) Concrete failure:

```json
{
  "body": null,
  "steps": "Pressed the button",
  "expected": null,
  "actual": null
}
```

This carries both vocabularies but is accepted as legacy rather than rejected with `[fb-shape]`. The same happens with `"body": ""` or with a nonblank body plus legacy keys containing nulls.

(b) Smallest fix:

```ts
const hasBody = Object.hasOwn(sent, "body");
const hasLegacy = ["steps", "expected", "actual"].some((key) =>
  Object.hasOwn(sent, key),
);
if (hasBody && hasLegacy) {
  throw httpError(400, "A report mixes two request shapes [fb-shape]");
}
```

Run this before normalising their values.

## Things that are fine

- **12,072 is exact:** `20 + 26 + 22` heading/newline characters, `4` separator characters, and `12,000` answer characters.
- **No legal old row fails the migration CHECK.** The old constraints guarantee at least one non-null, nonblank, at-most-4,000 answer. The migration preserves every character.
- **Migration ordering is safe.** Drizzle executes every breakpoint sequentially inside one transaction. The restrictive body CHECK is dropped before backfill; `NOT NULL` comes after it; old columns are dropped last.
- **The legacy route cannot exceed the database cap:** each field is validated at 4,000 before concatenation. The outer byte allowance’s `3 × 4,000 × 6` plus 4 KiB easily includes the extra 72 heading bytes.
- **The microphone close path is sound.** `dictation.toggle` is stable; closing while armed stops normally, and the later transcript lands in the preserved hidden draft. The transcribing phase is already covered by `readOnly`. `discard()` resets `kind`.
- **Logging contains no reader prose.** `kind` is the store result; `reportKind` is a closed vocabulary. The body is absent.
- **`asPlainText` and Sentry are correct.** The fallback includes body, kind, page and build. Sentry’s `message` is exactly the body—reader prose deliberately sent through this feature’s stated exception.

Accessibility opinion, not a defect: the fieldset and toggle-button states are operable and named, but they do not convey mutual exclusivity or provide radio-group arrow navigation. Native radios plus a conditional “Clear choice” button would provide stronger semantics; keeping the current buttons is a defensible simpler trade-off.

Verification: 56 targeted route/dialog/mirror tests passed, `db:chain` passed, and typechecking passed. No tracked files were changed.