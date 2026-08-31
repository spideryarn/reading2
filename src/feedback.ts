/**
 * **The second destination for a bug report, and the only one that is not ours.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. The row in
 * Postgres is written first and is authoritative; this is the copy that lands
 * beside the errors, the release and the source maps, so that a report can be
 * read next to what the server was doing at the time.
 *
 * ## This is the one channel a reader's own words leave on purpose
 *
 * Everything in src/monitoring-scrub.ts exists because *"four times now, an
 * `Error.message` in this codebase has turned out to contain the article"*. A
 * feedback report inverts that: the reader typed the words themselves, into a
 * box that says where they go, having pressed a button labelled Feedback. That
 * is consent, and it is a different thing from a leak.
 *
 * **But consent licenses the message, not the machinery.** So the same rule
 * `safeEvent` follows applies here, in the same words: *build the payload, do
 * not clean it.*
 *
 * ## `safeEvent` does not run on this path, and that is verified rather than assumed
 *
 * `beforeSend` is routed only for an **error** event — `client.js` checks
 * `isErrorEvent(event)`, which is `event.type === undefined` — and
 * `captureFeedback` builds an event with `type: "feedback"`. So the allowlist
 * that rebuilds every error event before it leaves **never sees a feedback
 * report**. Nothing had to be loosened for this feature, and nothing is
 * guarding it either.
 *
 * ## Building the parameters is not enough — and this is the subtle part
 *
 * `captureFeedback` ends in `scope.captureEvent()`, and `prepareEvent` merges
 * **global + isolation + current** scope data (`getCombinedScopeData` in
 * `@sentry/core`'s `utils/scopeData.js`). So extras, contexts, tags, breadcrumbs
 * and an **unreduced `user`** ride along from wherever anything set them —
 * including `ip_address`, which `safeUser` drops deliberately and which
 * `safeUser` never gets the chance to drop here.
 *
 * That is not a worry, it is a measurement. Run against a hostile scope with a
 * fake transport, the naive version of this file put all five of these into the
 * envelope: `extra.articleProse`, `contexts.provider`, `tags.leakyTag`,
 * `breadcrumbs`, and a `user` carrying `username` and `ip_address`. **A fresh
 * current scope alone does not fix it**, because the isolation scope is merged
 * regardless of which current scope you pass.
 *
 * So both are replaced — `withIsolationScope(new Scope(), …)` in its two-argument
 * form, and a second `new Scope()` handed to `captureFeedback` — and the user is
 * re-added explicitly from the gate. tests/feedback-mirror.test.ts asserts on the
 * **final envelope**, not on the object handed to the SDK, because a test that
 * captures on a clean scope proves nothing; that is exactly how the first version
 * of this design got it wrong. `beforeSendFeedback` cannot serve as the allowlist
 * instead: it fires *before* scope capture.
 *
 * **What still rides, named rather than discovered later:** `server_name` (this
 * machine's hostname, or a Vercel instance's) and `contexts.runtime` (the Node
 * version), both added by `prepareEvent` after any hook can reach them. They are
 * facts about the server, not about the reader, and Sentry already has the
 * source maps for this project. Accepted, and written down.
 *
 * ## It cannot throw, and it cannot fail the request
 *
 * Rule 2 of src/monitoring.ts. The row is already written and the reader has
 * been told their report is filed; a Sentry outage must not turn that into an
 * error for them. Nothing is mirrored unless there is a client to mirror to, so
 * `mirrored_at` never records a report that went nowhere — that column is the
 * query that finds anything stranded, and it only means something if it is
 * never written hopefully.
 */
import { captureFeedback, getClient, Scope, withIsolationScope } from "@sentry/node-core/light";

import type { FeedbackScreenshot } from "./feedback-payload.js";
import { log } from "./log.js";
import type { FeedbackReport } from "./store/contracts.js";
import { feedbackStore } from "./store/index.js";

const logger = log("http");

export interface FeedbackMirrorInput {
  /** The report as it was **stored** — never the request body. */
  report: FeedbackReport;
  /**
   * The gate's own `VerifiedUser`, reduced. Not read off the report, so that
   * the field Sentry shows as the reporter and the field the row snapshotted
   * come from the same place they always did: src/auth.ts.
   */
  user: { id: string; email: string };
  /** Decoded, sniffed and named by us. `src/feedback-payload.ts`. */
  screenshot: FeedbackScreenshot | null;
}

/**
 * The three answers, as the one string Sentry's feedback UI shows.
 *
 * Assembled from named fields with our own headings — a reader who left a box
 * empty gets no heading for it rather than a heading over nothing. The three
 * stay separate *columns* in Postgres; this is the only place they are glued.
 */
function message(report: FeedbackReport): string {
  const parts: string[] = [];
  if (report.steps) parts.push(`Steps to reproduce:\n${report.steps}`);
  if (report.expected) parts.push(`What you expected to see:\n${report.expected}`);
  if (report.actual) parts.push(`What you saw instead:\n${report.actual}`);
  return parts.join("\n\n");
}

/**
 * What the issue list may be filtered by. **Ours, every one of them.**
 *
 * Not the reader's words and not a value off the request: a route kind from a
 * closed vocabulary, a validated slug, a build stamp, and three facts about the
 * report's own shape. `report_id` is deliberately not here — it goes on the
 * scope beside the user, because those two are the fields that join this event
 * to a row and to a person, and they are set at the one seam that knows both.
 */
function tagsFor(report: FeedbackReport, screenshot: FeedbackScreenshot | null) {
  return {
    route_kind: report.routeKind,
    consented: report.consented,
    has_screenshot: screenshot !== null,
    ...(report.slug !== null && { slug: report.slug }),
    ...(report.buildCommit !== null && { build_commit: report.buildCommit }),
    ...(report.requestVercelId !== null && { vercel_id: report.requestVercelId }),
    ...(report.diagnostics !== null && { diagnostics_version: report.diagnostics.version }),
  };
}

/**
 * File one report with Sentry, and record that it was filed.
 *
 * **Only ever called for a newly created row.** Feedback events are not deduped
 * by Sentry — verified: `dedupeIntegration.processEvent` returns early for any
 * event with a `type` — so mirroring a retry would file the same bug twice.
 * `FeedbackSubmission` makes that a union the caller has to narrow rather than a
 * boolean the caller can forget.
 */
export async function mirrorFeedback(input: FeedbackMirrorInput): Promise<void> {
  try {
    /* No client, nothing to mirror, and **nothing to record**. This is the
       ordinary case on a laptop and under `npm test` (src/monitoring.ts: a DSN
       and a deployment, or no Sentry), so it is the first thing asked. */
    const client = getClient();
    if (!client) return;

    const { report, user, screenshot } = input;
    /* The blob and the picture ride as envelope attachment items, which
       `client.sendEvent` appends from `hint.attachments` — verified against the
       installed SDK, from Node, not only from a browser. */
    const attachments = [
      ...(report.diagnostics === null
        ? []
        : [
            {
              data: JSON.stringify(report.diagnostics.payload),
              filename: "diagnostics.json",
              contentType: "application/json",
            },
          ]),
      ...(screenshot === null
        ? []
        : [
            {
              data: screenshot.bytes,
              /* Ours, from the bytes. A client-supplied filename or MIME type
                 never reaches here — see `sniffScreenshot`. */
              filename: screenshot.filename,
              contentType: screenshot.contentType,
            },
          ]),
    ];

    const eventId = withIsolationScope(new Scope(), () => {
      /* Both scopes, and read the header before changing either: a clean
         current scope on its own was tried and still leaked, because the
         isolation scope is merged whatever current scope you pass. */
      const scope = new Scope();
      scope.setClient(client);
      /* Re-added explicitly, from the gate, and reduced to the same two fields
         `safeUser` reduces an error's user to — which is the function that does
         not run on this path. */
      scope.setUser({ id: user.id, email: user.email });
      /* So a Sentry item and a Postgres row name each other. */
      scope.setTag("report_id", report.id);
      return captureFeedback(
        {
          message: message(report),
          /* **`email`, not `user.email`.** `contexts.feedback.contact_email` is
             the field Sentry's feedback UI reads, and it is a different field
             from the one on `user`. Both are set, from the same gate. */
          email: user.email,
          source: "spideryarn",
          tags: tagsFor(report, screenshot),
        },
        { attachments },
        scope,
      );
    });

    await feedbackStore.markMirrored(report.id, eventId ?? null);
    /* Lengths and ids, never text — docs/project/logging.md. The three answers
       are in the event, which the reader consented to; they are not in this
       log, which they did not. */
    logger.info(
      { id: report.id, sentryEventId: eventId ?? null, attachments: attachments.length },
      "feedback report mirrored to sentry",
    );
  } catch {
    /* Rule 2 of src/monitoring.ts, and the reason it is a bare `catch`: there is
       nothing this function can usefully do about a failure, and everything it
       could try — including logging the error — is a second way to throw from
       inside the path that must not. `mirrored_at is null` is how a stranded
       report is found. */
  }
}
