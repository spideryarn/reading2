Refuse: F1 is an established P0. The candidate broadens an existing draft-loss race to every way of dismissing the thank-you.

### F1 — P0 — established: successful submission can erase words that were never filed

(a) Sequence:

1. Type `A`.
2. Send, holding the request open.
3. While the form remains editable, change it to `A+B`.
4. Resolve the request successfully. Its serialized body contains only `A`.
5. Dismiss the thank-you. The new effect calls `discard()`, erasing `A+B`.

The textarea remains writable while sending at [FeedbackDialog.tsx:860](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/FeedbackDialog.tsx:860), while the request was already serialized from the earlier render at [FeedbackDialog.tsx:650](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/FeedbackDialog.tsx:650). The reset effect then clears the later text at [FeedbackDialog.tsx:499](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/FeedbackDialog.tsx:499).

I reproduced this in a `/tmp` jsdom harness: the POST contained `A`, and after close/reopen the textarea was empty rather than containing `B`.

The same underlying problem exists after ambiguous failures: the reader may edit before retrying, but the retry retains the same ID. PostgreSQL deliberately returns the originally stored report and ignores the changed payload at [pg-feedback.ts:217](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/store/pg-feedback.ts:217). The client treats that duplicate as success and then discards the changed draft.

Root-cause class: lost update caused by treating a mutable draft and an immutable idempotent submission as the same state.

(b) Smallest safe design:

- Capture the entire payload on the first Send and reuse that exact snapshot for every retry carrying that `reportId`.
- Make all draft mutation paths immutable for that report’s remaining lifetime—not merely while `stage.kind === "sending"`, because reopening changes the stage back to `editing`.
- Clear the snapshot only in `discard()`.
- If editing after an attempt is required, expose an explicit “Start a new report” action that mints a new ID.

The essential seam is:

```ts
const submitted = useRef<ReturnType<typeof reportBody> | null>(null);

// In send():
const payload =
  submitted.current ??
  reportBody({ id: reportId, body, kind, consented, where, diagnostics, screenshot });

submitted.current = payload;

// Every retry:
body: JSON.stringify(payload)

// In discard():
submitted.current = null;
```

The textarea, kind buttons, consent, screenshot controls, paste and drop handlers must then refuse mutation while `submitted.current !== null`.

### F2 — P1 — established: a late screenshot enters the next report

(a) Start sending a report, then select/paste a screenshot while its request is pending. Let screenshot conversion remain pending, resolve the report successfully, dismiss the thank-you, and only then finish conversion.

`discard()` clears the screenshot but does not advance `shotGeneration`. The late conversion therefore still passes its generation check and writes the previous report’s image into the newly minted report.

I reproduced this independently: reopening showed `.fb-shot-have` containing the late image. That image could subsequently accompany an unrelated report.

(b) Invalidate conversions when discarding, and reject new screenshot work once submission begins:

```ts
// Move this above discard().
const shotGeneration = useRef(0);

const discard = useCallback(() => {
  shotGeneration.current += 1;
  // existing resets...
}, []);
```

### F3 — P1 — established: the contact page makes false telemetry/UI claims

(a) Visit `/contact` signed out. The page says the best route is “the Feedback button in the top right,” but signed-out rendering returns `ContactPage` without mounting `FeedbackButton` at [App.tsx:413](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/App.tsx:413).

For a signed-in reader, pressing Feedback from `/contact` sends `/contact` as `location.href`; it does not carry the page visited before Contact. Consequently “so we can see what you saw” at [ContactPage.tsx:73](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/ContactPage.tsx:73) overstates what arrives.

The documentation also claims article and passage IDs arrive normally. Only URL and slug are unconditional; passage IDs live inside opt-in diagnostics.

(b) Replace the visible paragraph with:

```tsx
If you’re signed in, the best way to send them is the Feedback button in the top right.
Use it on the page you want to tell us about; it includes that page’s address with your report.
```

Replace the corresponding documentation claim with:

> A report filed through the button always arrives with the current page address and, on an article, its slug. If the reader opts into diagnostics, it can also include passage ids, recent requests, and their Vercel ids.

### F4 — P3 — established: several count comments are already false

The candidate has eight footer-mounting components, six of which omit `here`, and `FooterPage` has five members. [SiteFooter.tsx:59](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/SiteFooter.tsx:59) still says “five of seven,” and [SiteFooter.tsx:87](/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page/src/web/SiteFooter.tsx:87) says “three link kinds.” The plan similarly calls Contact the fourth member, while the page is described as four sentences despite currently containing three.

(b) Prefer count-free wording where possible; otherwise replace those phrases with “six of the eight callers,” “five link kinds,” and “Contact as the fifth member.”

The `useLayoutEffect` choice itself is sound; there is no meaningful browser-free behavioral test for pre-paint timing beyond the existing DOM-order test. Keeping both Contact and the raw `mailto:` in the footer is also defensible.

Verification: the repository feedback-dialog suite passed `29/29`; the two additional `/tmp` race checks both failed in the damaging ways described above. No repository files were changed.