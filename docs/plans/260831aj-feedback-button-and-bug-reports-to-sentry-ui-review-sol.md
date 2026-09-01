NO-SHIP. Two blockers remain: the dialog can lose or misattribute a reader’s report, and error names are not actually a closed egress vocabulary.

## Findings

### 1. Blocker — closing/reopening can lose a report, and an old request can overwrite a new one

Certainty: certain.

[FeedbackDialog.tsx:149](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:149) clears every field whenever `open` becomes true. Therefore:

1. A send fails.
2. The reader presses Escape, Cancel, the close button, or the backdrop.
3. They reopen Feedback.
4. Their only copy is erased.

That directly contradicts the header’s accidental-close claim.

There is a worse asynchronous form. Closing while a request is pending remains enabled. Reopening clears the form, resets `sending`, and mints a new ID. The old request can then resolve and execute the unguarded `setStage` calls at [FeedbackDialog.tsx:221](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:221), [FeedbackDialog.tsx:229](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:229), or [FeedbackDialog.tsx:235](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:235). A successful old request replaces the new report with “Thank you”; closing that screen then clears the new words.

Within one uninterrupted opening, retries—including a 429—do reuse the same ID. Across close/reopen they cannot meaningfully retry because the draft is destroyed and a fresh ID is minted. `useMemo` at [FeedbackDialog.tsx:132](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:132) is also the wrong semantic storage for an idempotency key; React does not promise memo caches as durable state.

I would insist that draft text, screenshot, consent and report ID survive dismissal until successful filing or explicit discard. Pending completions must be associated with their captured report ID and ignored if they belong to another draft.

### 2. Blocker — `Error.name` is shape-checked, but not closed

Certainty: certain boundary defect; there is no current production assignment from search text or provider bodies into `Error.name`.

[nameOfThrown()](/home/greg/code/spideryarn2/src/web/log-buffer.ts:363) returns any string obtained from a writable `name`. The later check at [log-buffer.ts:250](/home/greg/code/spideryarn2/src/web/log-buffer.ts:250) accepts arbitrary identifier-shaped content.

For example, all of these can leave through `errors[].name`:

```ts
throw { name: "PROVIDER_BODY_MARKER" };
const err = new Error();
err.name = "reader_search_term";
throw err;
```

Those are prose/data in a syntactically valid identifier. The server accepts the same shape. Names between 65 and 300 characters have a separate silent-drop problem: the client keeps them, but the server’s 64-character expression drops them.

The named edge cases otherwise behave safely:

- Cross-origin `event.error === null` → `"Error"`.
- Throwing getter → `"Error"`.
- Primitive/string throw → `"Error"`.
- Sentence-shaped writable name → `"Error"` downstream.

I would insist on an explicit vocabulary of built-in and authored error names, with everything unknown reduced to `"Error"`, at both ends.

Not building the previously proposed `safeDiagnosticError()` was reasonable insofar as v1 has no message or frames. But there is still a name decision to make; it can be a smaller `safeDiagnosticName()` rather than the earlier function.

### 3. High — a screenshot can be silently omitted while it is still processing

Certainty: certain.

[takeFile()](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:162) is asynchronous, but paste/drop/file handlers fire it with `void` and maintain no processing state. Submit immediately reads `shot?.base64` at [FeedbackDialog.tsx:212](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:212).

A reader can paste a large screenshot and immediately press ⌘/Ctrl+Enter. The report leaves with `screenshot: null`; the thumbnail may appear after the POST was already constructed. Two rapidly selected files can also complete out of order.

I would insist on a visible processing state and either disable Send until the latest image finishes or have Send await the current processing promise. Use a generation token so an older decode cannot replace a newer selection.

### 4. High — the narrow controls bar does not reserve the button’s space

Certainty: certain from CSS cascade.

The base controls rule reserves the button at [styles.css:523](/home/greg/code/spideryarn2/src/web/styles.css:523). At `max-width: 731px`, [styles.css:9660](/home/greg/code/spideryarn2/src/web/styles.css:9660) overrides it with a flat `0.75rem`.

At that width the fixed button is `2.4rem` wide and paints above the controls bar. The bar is deliberately horizontally scrollable there, so its final control can scroll underneath the Feedback button and never gain the promised end clearance.

The desktop right-hand expression is otherwise correct, and the masthead’s narrow override correctly restores its reservation. I would change the narrow controls padding to include `var(--feedback-w)` plus its intended gutter.

The always-reserved-space decision is defensible, but its cost is understated in [FeedbackButton.tsx:39](/home/greg/code/spideryarn2/src/web/FeedbackButton.tsx:39). Above 731px it reserves 7.5rem—about 120 CSS pixels—on anonymous shared articles, not merely “a few millimetres” or necessarily one earlier word wrap.

### 5. Medium — the failed-send fallback has no stated destination

Certainty: certain.

The failure panel at [FeedbackDialog.tsx:395](/home/greg/code/spideryarn2/src/web/FeedbackDialog.tsx:395) contains only Copy. There is no email address or `mailto:` link, although the plan says “somewhere to send it” and [messages.ts:1667](/home/greg/code/spideryarn2/src/messages.ts:1667) tells the reader to send it by email.

When the API is down, the reader can copy their words but is not told where to put them. I would add the actual destination and handle clipboard failure visibly, since this is the fallback for the primary channel failing.

### 6. Medium — `x-vercel-id` is protected on collection, but too late for the buffer’s own contract

Certainty: certain; not a current feedback-output leak.

The collector correctly validates it at [feedback-diagnostics.ts:208](/home/greg/code/spideryarn2/src/web/feedback-diagnostics.ts:208), and the server validates it again. An invalid header cannot reach `collectFeedbackDiagnostics()`.

However, the raw response-header value is retained in the ring first. That contradicts `log-buffer.ts`’s stated “redact at write time” rule, and `serialiseLogBuffer()` would expose it unvalidated. I would validate it while recording and retain the collector/server checks as redundancy.

## Screenshot boundary

The canvas round-trip does provide the claimed metadata property: the source is decoded to pixels, drawn into a fresh canvas and encoded as a new PNG. Original EXIF, filename, text chunks, colour-profile chunks and appended bytes are not copied. The server’s independent PNG rebuild makes the final stored/forwarded guarantee stronger.

The output size and dimensions are capped in the right security boundary. The client limits the long edge and encoded PNG bytes; the server repeats the byte check and enforces dimensions before inflation. JPEG input is sensibly invisible to the reader because any decodable JPEG becomes PNG before submission.

One lower-confidence robustness concern: [feedback-screenshot.ts:155](/home/greg/code/spideryarn2/src/web/feedback-screenshot.ts:155) decodes an input of any original size before applying the dimension cap. A huge selected file can consume substantial browser memory first. A generous `file.size` precheck would reduce that risk, though it is not a server-egress blocker.

## Tests that overclaim or miss important behavior

- [feedback-button-visibility.test.tsx:84](/home/greg/code/spideryarn2/tests/feedback-button-visibility.test.tsx:84) tests only `/`. Its signed-in control catches deletion, but not the claimed positional/universal rule. It would pass if the button existed only on the signed-in library, and it never exercises the anonymous public `/read/<slug>` branch—the risky anonymous route that mounts the reader. Test the same read route signed in and signed out, plus a second signed-in route.

- The dialog tests do not cover close/reopen preservation, a pending request resolving into a new opening, a 429 retry, fresh IDs after a completed report, clipboard failure, or screenshot processing/inclusion.

- No test exercises `watchUncaughtErrors()`. The null, primitive, throwing getter, writable name and over-64-character cases are all currently untested.

- The diagnostics “keeps every field” round-trip uses one well-shaped representative. The client permits values the server silently drops, including long error names and out-of-range article/API numbers.

- The screenshot tests prove compatibility with the server using a stubbed PNG encoder, but they do not prove browser-canvas metadata behavior themselves. The server tests are the real final-boundary evidence.

I attempted the focused suites. The workspace is read-only: normal Vitest could not create `node_modules/.vite-temp`; its runner/no-cache fallback then failed before importing tests while creating its temporary module cache. I therefore do not claim a fresh green run.