# Verdict

Do not build this plan as written. The product change is sound, but the migration needs an expand/contract deployment, and the dictation lifecycle is unsafe in this persistent native dialog.

## Findings

### 1. Blocker — dropping the columns in the same deploy can leave production’s feedback path broken indefinitely

The migration ordering itself is safe. Drizzle executes breakpoint-separated statements sequentially, and wraps all pending migration files in one transaction ([dialect.cjs](/home/greg/code/spideryarn2/node_modules/drizzle-orm/pg-core/dialect.cjs:62)). A three-file add/backfill/drop split in the same `npm run db:migrate` is therefore only more files; it creates no compatibility window.

The unsafe boundary is deployment: migrations commit before the push begins ([deploy.ts](/home/greg/code/spideryarn2/scripts/deploy.ts:1414)).

Failure:

1. Production is serving the old code, whose insert and `RETURNING` select name `steps`, `expected`, and `actual`.
2. The migration drops those columns and commits.
3. Before the new deployment takes over, an old function handles `POST /api/feedback`.
4. PostgreSQL answers `column ... does not exist`; the report gets a 500.
5. If `git push`, the Vercel build, or promotion fails, this is not brief: the old deployment remains broken until another successful deploy.

Only feedback submission and the emerging admin-feedback page touch this table, so the rest of the app should survive. But breaking the mechanism for reporting breakage is the worst localized outage. The deploy script would also print a false reassurance that the old code is happy because the migration was additive ([deploy.ts](/home/greg/code/spideryarn2/scripts/deploy.ts:1481)).

Smallest safe change: two production deploys, not three migration files in one deploy.

```md
Deploy A — expand
- Add nullable body and kind.
- Rewrite feedback_says_something temporarily as:
    body IS NOT NULL OR steps IS NOT NULL OR expected IS NOT NULL OR actual IS NOT NULL
- Backfill existing rows.
- Keep steps/expected/actual.
- Deploy code that reads/writes only body/kind and accepts both wire formats.
- Tolerate body = null temporarily: old code can insert one during the
  migration→push interval.

Deploy B — contract
- Backfill body WHERE body IS NULL again, catching rows old code inserted
  during Deploy A.
- SET body NOT NULL.
- Drop steps/expected/actual and their constraints.
- Deploy the final non-null body types.
```

When Deploy B’s migration runs, Deploy A’s server already references only `body` and `kind`, so a failed push no longer damages it.

### 2. Blocker — a valid old row can make the backfill abort

The plan first adds a `body ≤ 4000` CHECK, then concatenates three independently valid 4,000-character columns ([plan](/home/greg/code/spideryarn2/docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md:108)).

Failure row:

```text
steps    = 4,000 characters
expected = 4,000 characters
actual   = 4,000 characters
```

With the current Sentry headings and two blank-line separators, the resulting body is 12,072 characters. The `UPDATE` violates `feedback_body_shape`; because every pending migration is in one transaction, the whole migration run rolls back.

The ordinary final-schema store tests will not catch this: they run after migrations against an empty/final table and never place an old-shape row between the two schemas.

The smallest data-preserving change is to distinguish the new UI limit from the stored legacy maximum:

```diff
- CHECK (body IS NULL OR (... AND length(body) <= 4000))
+ CHECK (body IS NULL OR (... AND length(body) <= 12072))
```

Keep the new route and textarea capped at 4,000. Add a migration test with all three old fields at exactly 4,000 and assert that the complete, headed text survives.

If enforcing 4,000 against every database writer is essential, add an explicit legacy marker and condition the CHECK on it. Truncating the backfill is not acceptable: it silently discards reader data.

### 3. High — closing the dialog can leave the microphone recording invisibly

`FeedbackButton` always renders `FeedbackDialog`; closing it only changes its `open` prop ([FeedbackButton.tsx](/home/greg/code/spideryarn2/src/web/FeedbackButton.tsx:95)). Consequently, closing the native `<dialog>` does not unmount `useDictationField`, so `useDictation`’s unmount cleanup never runs ([useDictation.ts](/home/greg/code/spideryarn2/src/web/useDictation.ts:1042)).

Failure:

1. Open Feedback and start dictation.
2. Press Escape, Cancel, ×, or the backdrop.
3. The dialog disappears and focus returns to the page.
4. The MediaStream remains active and continues recording behind the closed dialog.

Smallest fix:

```tsx
useEffect(() => {
  if (!open && dictate.dictation.armed) {
    // Use the underlying toggle: dictate.toggle() would refocus a textarea
    // inside the now-closed dialog.
    dictate.dictation.toggle();
  }
}, [open, dictate.dictation.armed, dictate.dictation.toggle]);
```

This stops normally and preserves the spoken draft. A transcription already in flight may finish into the preserved hidden draft; the microphone is already off in that phase.

Add a test that starts an armed mock dictation, closes through each exit path, and observes one stop call.

### 4. High — `dictate.readOnly` does not prevent submission while the microphone is listening

`readOnly` is only `dictation.transcribing`, the period after the microphone has stopped ([useDictationField.ts](/home/greg/code/spideryarn2/src/web/useDictationField.ts:208)). `dictation.armed` separately means that the microphone is currently on ([useDictation.ts](/home/greg/code/spideryarn2/src/web/useDictation.ts:203)).

Failure:

1. Type a sentence, then start dictating.
2. While the microphone is still listening, press ⌘/Ctrl+Enter.
3. The proposed `readOnly` guard is false.
4. Chrome sends rough partial recognition; Safari/Firefox send only the pre-existing text.
5. The microphone can remain active while the dialog changes to “Thank you.”

Smallest fix:

```tsx
const dictationBusy = dictate.dictation.armed || dictate.readOnly;

const send = useCallback(async () => {
  if (dictationBusy) return;
  // existing guards...
}, [dictationBusy /* ... */]);

<button
  type="submit"
  disabled={
    !somethingSaid ||
    stage.kind === "sending" ||
    preparing ||
    dictationBusy
  }
/>
```

Replace the planned single “mid-transcription” test with two positive failures: `armed` and `transcribing`. The current planned test can pass while the listening-phase bug remains.

### 5. High — rejecting stale clients is the wrong choice for this endpoint

The plan deliberately pins the rejection in a test ([plan](/home/greg/code/spideryarn2/docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md:131)).

Failure:

1. Leave a production tab open on the old bundle.
2. Deploy the new route.
3. Enter a perfectly valid report in the old three-box dialog.
4. It posts `steps`/`expected`/`actual`.
5. `FEEDBACK_FIELDS` returns `[fb-field]`.

The exact allowlist remains valuable, but it can explicitly recognize two versions. This is the one endpoint where a client/server disagreement is likely to be the thing the reader is attempting to report.

Smallest fix:

```ts
const FEEDBACK_FIELDS = [
  "id",
  "body",
  "kind",
  // Explicit legacy vocabulary:
  "steps",
  "expected",
  "actual",
  "consented",
  "routeKind",
  "slug",
  "buildCommit",
  "diagnostics",
  "screenshot",
] as const;

const hasBody = Object.hasOwn(sent, "body");
const hasLegacy = ["steps", "expected", "actual"].some((key) =>
  Object.hasOwn(sent, key),
);

if (hasBody && hasLegacy) {
  throw httpError(400, "A report mixes two request formats [fb-shape]");
}

const body = hasBody
  ? feedbackAnswer(sent.body, "body")
  : legacyFeedbackBody(sent.steps, sent.expected, sent.actual);
```

`legacyFeedbackBody` should validate each old answer at 4,000, then concatenate the same headings used by the migration. Keep the outer HTTP allowance large enough for the legacy maximum; dropping `MAX_FEEDBACK_BODY_BYTES` from `3 *` to `1 *` would otherwise reject the compatibility format before parsing it.

### 6. Medium — native radios cannot satisfy the planned “picks and unpicks” check

The plan requires neither option to start selected, chooses native radios, and later says the browser pass will “pick and unpick” ([plan](/home/greg/code/spideryarn2/docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md:160)).

Failure:

1. Select Suggestion accidentally.
2. Click it again or navigate with the keyboard.
3. A native radio group cannot return to no selection.
4. The report is now permanently classified unless the whole successful-report discard path resets it.

Smallest fix: either admit that null means only “never touched” and delete “unpicks,” or add an explicit clear action:

```tsx
{kind !== null && (
  <button type="button" onClick={() => setKind(null)}>
    Clear choice
  </button>
)}
```

Also make `discard()` call `setKind(null)` and test that a new report after a successful suggestion starts unset.

### 7. Medium — the final required `body` should not remain nullable

The plan says the sole box is required, but proposes `body: string | null` and a separate `feedback_says_something` CHECK ([plan](/home/greg/code/spideryarn2/docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md:118)).

Concrete failure: implementing “`message()` is the body” literally does not typecheck:

```ts
function message(report: FeedbackReport): string {
  return report.body; // string | null is not assignable to string
}
```

The likely workaround, `report.body ?? ""`, encodes a database state the CHECK says cannot exist.

Smallest final-state change, after the expand/contract release:

```ts
// schema
body: text("body").notNull()

// contract
body: string
```

Keep it nullable only during Deploy A, then `SET NOT NULL` and tighten the type in Deploy B. `feedback_says_something` becomes redundant; `feedback_body_shape` only needs to enforce nonblank and length.

### 8. Medium — `/admin/feedback` is already a live consumer in this shared tree, despite the plan calling it unbuilt

The current working tree already contains the uncommitted admin store, route, wire type, card, and tests. `AdminFeedbackReport` still exposes the three fields ([types.ts](/home/greg/code/spideryarn2/src/types.ts:3015)), and the card renders them individually ([AdminFeedbackList.tsx](/home/greg/code/spideryarn2/src/web/AdminFeedbackList.tsx:206)).

Failure after changing `FeedbackReport`:

- `ADMIN_FEEDBACK_SHAPE_MATCHES` becomes `never`, so typecheck fails ([contracts.ts](/home/greg/code/spideryarn2/src/store/contracts.ts:1196)).
- A mechanical wire-type correction then leaves the card’s `report.steps`, `expected`, and `actual` accesses failing.
- If `kind` is added to the wire type but not the card, the page silently hides the classification.

Smallest plan addition:

```md
- Update AdminFeedbackReport to body + kind.
- Render one pre-wrapped body.
- Display kind as Problem / Suggestion / Unspecified.
- Update pg-admin-feedback and admin-feedback-store/card tests.
- Amend 260902l-admin-feedback-page.md before it lands.
```

Do not start the two `db:generate` calls in this shared tree as it stands: `src/db/schema.ts`, the journal, and a snapshot are already being changed by other work. Use the required dedicated worktree after those migrations land.

### 9. Low — suggestion feedback remains mislabeled or loses its kind on the failure fallback

Failure:

1. Select Suggestion.
2. Make the POST fail.
3. Click Email.
4. The subject remains `Spideryarn bug report …` ([FeedbackDialog.tsx](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:564)).
5. Unless `asPlainText` explicitly includes `kind`, the copied/email fallback loses the classification entirely.

Other stale reader-facing text says “boxes above” ([messages.ts](/home/greg/code/spideryarn2/src/messages.ts:1805)), and the corner button still advertises “Report a problem” ([FeedbackButton.tsx](/home/greg/code/spideryarn2/src/web/FeedbackButton.tsx:101)).

Smallest changes:

```diff
- title="Report a problem with this page"
+ title="Send feedback about this page"

- `Spideryarn bug report ${reportId}`
+ `Spideryarn feedback ${reportId}`

- Your words are still in the boxes above
+ Your words are still in the box above
```

And prepend the copied fallback with `Kind: Problem`, `Kind: Suggestion`, or `Kind: Not specified`.

## Suspicions killed

- The hourly cap is unaffected. `charsIn` is only logged; the actual cap counts rows using `FEEDBACK_HOURLY_CAP` ([pg-feedback.ts](/home/greg/code/spideryarn2/src/store/pg-feedback.ts:251)). A 4,000-character new body is smaller than the previously permitted Sentry message. The only byte-limit complication is stale-client compatibility.
- Nullable `kind` is otherwise correctly designed: the CHECK should admit only null/problem/suggestion, `""` should be rejected, and `tagsFor` should omit the tag entirely for null. An admin filter for the third state must use `IS NULL` and label it “Unspecified”; no stored `"unknown"` value is needed.
- The dialog-level paste handler does not eat ordinary text: it calls `preventDefault()` only when an image file was actually found. The drop/paste machinery does not conflict with dictation.
- Focus restoration remains native-dialog behavior. On close, use `dictate.dictation.toggle()` rather than the field wrapper, because the latter deliberately refocuses the textarea.

No files, database rows, or migrations were changed.