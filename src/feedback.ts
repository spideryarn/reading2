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
 * re-added explicitly from the gate. `beforeSendFeedback` cannot serve as the
 * allowlist instead: it fires *before* scope capture.
 *
 * ## And replacing two scopes is **still** not enough
 *
 * `prepareEvent` starts from the **global** scope; the two above are merged into
 * it. And an event processor runs after all three. GPT Sol's code review,
 * 2026-08-31, reproduced global extras, a global attachment and a processor's
 * additions all reaching the final envelope against exactly the code above.
 *
 * So the thing that actually closes this seam is a guard at the **envelope**,
 * after every scope and every processor: src/feedback-envelope.ts, which
 * rebuilds the outgoing item from what this file registers before it captures.
 * Read that file's header; it is where the argument lives. Everything above
 * stays anyway, because two independent mechanisms failing the same way is
 * unlikely and the second one is free — the same argument `dataCollection` gets
 * in src/monitoring.ts.
 *
 * tests/feedback-mirror.test.ts asserts on the **final envelope**, not on the
 * object handed to the SDK, because a test that captures on a clean scope proves
 * nothing; that is exactly how the first two versions of this design got it
 * wrong, one after the other.
 *
 * ## It cannot throw, and it cannot fail the request
 *
 * Rule 2 of src/monitoring.ts. The row is already written and the reader has
 * been told their report is filed; a Sentry outage must not turn that into an
 * error for them.
 *
 * ## `mirror_attempted_at` and `mirrored_at` are two different facts
 *
 * They were one, and that was wrong. `captureFeedback` returns an event id
 * synchronously; the SDK sends later, `sendEvent` does not return the send
 * promise, and `sendEnvelope` swallows every transport failure and resolves an
 * empty `{}`. So a network failure, a rate limit, a dropped event or a disabled
 * transport all used to leave `mirrored_at` populated with nothing delivered —
 * docs/reusable/silent-success.md, in the one column that finds a stranded
 * report.
 *
 * Now:
 *
 * - **`mirror_attempted_at`** is written as soon as the event is handed over.
 *   That is a thing we know.
 * - **`mirrored_at`** is written only for a 2xx from the transport, carried by
 *   the `afterSendEvent` hook. Best-effort, with a two-second ceiling: if the
 *   acknowledgement does not arrive the row honestly says *attempted, not
 *   confirmed*.
 *
 * Which makes `mirror_attempted_at is not null and mirrored_at is null` a
 * trustworthy query for a report Sentry did not take, which is the whole point
 * of having either column.
 *
 * The wait happens **after the reader has been answered** — src/routes.ts starts
 * this and awaits it on the far side of `send` — so it costs a warm function and
 * never a spinner.
 */
import type { TransportMakeRequestResponse } from "@sentry/core";
import { captureFeedback, getClient, Scope, withIsolationScope } from "@sentry/node-core/light";

import {
  expectFeedbackEnvelope,
  installFeedbackEnvelopeGuard,
  type AllowedAttachment,
  type FeedbackTagKey,
  type FeedbackTagValue,
} from "./feedback-envelope.js";
import type { FeedbackScreenshot } from "./feedback-image.js";
import { log } from "./log.js";
import type { FeedbackReport } from "./store/contracts.js";
import { feedbackStore } from "./store/index.js";

const logger = log("http");

/**
 * How long to wait for Sentry to say it took the report, **after the reader has
 * already been answered**.
 *
 * The same two seconds `flushMonitoring` allows, and for the same reason: the
 * report is filed and the response is sent before this starts, so all that is
 * being bought is the difference between a row that says *delivered* and a row
 * that says *handed over*. Worth two seconds of a warm function; not worth
 * holding a reader.
 */
const MIRROR_ACK_MS = 2000;

export interface FeedbackMirrorInput {
  /** The report as it was **stored** — never the request body. */
  report: FeedbackReport;
  /**
   * The gate's own `VerifiedUser`, reduced. Not read off the report, so that
   * the field Sentry shows as the reporter and the field the row snapshotted
   * come from the same place they always did: src/auth.ts.
   */
  user: { id: string; email: string };
  /** Decoded, re-encoded and named by us. `src/feedback-image.ts`. */
  screenshot: FeedbackScreenshot | null;
}

/**
 * What the reader wrote, as the string Sentry's feedback UI shows.
 *
 * It used to glue three answers under three headings we wrote. There is one box
 * now (docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md),
 * so this is the reader's own words in their own order and **nothing is added
 * to them** — the kind is a tag, where it can be filtered on, rather than a
 * heading pushed into a person's sentence.
 */
function message(report: FeedbackReport): string {
  return report.body;
}

/**
 * What the issue list may be filtered by. **Ours, every one of them.**
 *
 * Not the reader's words and not a value off the request: a route kind from a
 * closed vocabulary, a validated slug, a build stamp, and three facts about the
 * report's own shape. `report_id` is deliberately not here — it goes on the
 * scope beside the user, because those two are the fields that join this event
 * to a row and to a person, and they are set at the one seam that knows both.
 *
 * **The return type is the pin.** `FeedbackTagKey` is the guard's allowlist in
 * src/feedback-envelope.ts, so a tag added here and not there is a compile
 * error rather than a tag that silently stops arriving — which is the shape of
 * failure an allowlist at a distance usually has.
 */
function tagsFor(
  report: FeedbackReport,
  screenshot: FeedbackScreenshot | null,
): Partial<Record<Exclude<FeedbackTagKey, "report_id">, FeedbackTagValue>> {
  return {
    /* `?? ""` rather than dropping the tag: a tag that is sometimes absent is
       a Sentry search that silently misses rows, and an empty string is a
       visible "we did not get one" — a report from a bundle older than
       2026-09-02. src/db/schema.ts § `url`. */
    url: report.url ?? "",
    consented: report.consented,
    /* Absent rather than empty when the reader did not say. A tag whose value is
       `""` is a tag Sentry will happily group by, and "reports that say nothing
       about their kind" is a filter on the tag *missing*. */
    ...(report.kind !== null && { kind: report.kind }),
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
  const { report, user, screenshot } = input;
  try {
    /* No client, nothing to mirror, and **nothing to record** — not even an
       attempt. This is the ordinary case on a laptop and under `npm test`
       (src/monitoring.ts: a DSN and a deployment, or no Sentry), so it is the
       first thing asked. */
    const client = getClient();
    if (!client) return;
    /* Before anything is captured. src/feedback-envelope.ts explains why this
       is installed here rather than in `initMonitoring`. */
    installFeedbackEnvelopeGuard(client);

    /* The blob and the picture ride as envelope attachment items, which
       `client.sendEvent` appends from `hint.attachments` — verified against the
       installed SDK, from Node, not only from a browser. The same array is
       registered with the guard, which is what writes the final items. */
    const attachments: AllowedAttachment[] = [
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
              /* Ours, from the bytes — and from a re-encode, not a sniff. See
                 src/feedback-image.ts. */
              filename: screenshot.filename,
              contentType: screenshot.contentType,
            },
          ]),
    ];

    const tags: Partial<Record<FeedbackTagKey, FeedbackTagValue>> = {
      report_id: report.id,
      ...tagsFor(report, screenshot),
    };
    /* Everything the envelope may contain, said **before** it is built, so the
       guard writes it rather than inspects it. Forgotten again in `finally`
       however this ends. */
    const forget = expectFeedbackEnvelope(report.id, {
      message: message(report),
      contactEmail: user.email,
      source: "spideryarn",
      user: { id: user.id, email: user.email },
      tags,
      attachments,
    });

    /**
     * **The acknowledgement, and the whole reason this function is shaped like
     * this.**
     *
     * `captureFeedback` hands back an event id synchronously and the SDK sends
     * later: `client.sendEvent` does not return the send promise, and
     * `sendEnvelope` catches every transport failure and resolves `{}`. So the
     * id proves the event was *built*, and nothing else. `afterSendEvent` is the
     * one hook that carries what the transport actually answered.
     */
    let settle: ((response: TransportMakeRequestResponse | null) => void) | undefined;
    const acknowledged = new Promise<TransportMakeRequestResponse | null>((resolve) => {
      settle = resolve;
    });
    let eventId: string | undefined;
    const off = client.on("afterSendEvent", (event, response) => {
      if (event.event_id !== eventId) return;
      settle?.(response);
    });
    /* `unref`, so a pending wait can never be the thing keeping a process
       alive — the same care src/log.ts takes about its own timers. */
    const timer = setTimeout(() => settle?.(null), MIRROR_ACK_MS);
    timer.unref?.();

    try {
      eventId = withIsolationScope(new Scope(), () => {
        /* Both scopes, and read the header before changing either: a clean
           current scope on its own was tried and still leaked, because the
           isolation scope is merged whatever current scope you pass. And even
           both together are not enough — src/feedback-envelope.ts. */
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

      /* **What we know at this moment, and only that.** The event has been
         built and handed over; nothing has been delivered. */
      await feedbackStore.markMirrorAttempted(report.id);

      const response = await acknowledged;
      const status = response?.statusCode;
      const took = status !== undefined && status >= 200 && status < 300;
      if (!took) {
        /* Left as attempted-not-confirmed, which is the true thing to say. The
           query that finds a stranded report is
           `mirror_attempted_at is not null and mirrored_at is null`, and it only
           means anything because of this branch. */
        logger.warn(
          { id: report.id, status: status ?? null },
          "feedback report was not acknowledged by sentry",
        );
        return;
      }
      const marked = await feedbackStore.markMirrored(report.id, eventId ?? null);
      /* Lengths and ids, never text — docs/project/logging.md. The three answers
         are in the event, which the reader consented to; they are not in this
         log, which they did not. */
      logger.info(
        {
          id: report.id,
          sentryEventId: eventId ?? null,
          attachments: attachments.length,
          marked,
        },
        "feedback report mirrored to sentry",
      );
    } finally {
      clearTimeout(timer);
      off();
      forget();
    }
  } catch {
    /* Rule 2 of src/monitoring.ts, and the reason it is a bare `catch`: there is
       nothing this function can usefully do about a failure, and everything it
       could try — including logging the error — is a second way to throw from
       inside the path that must not. */
  }
}
