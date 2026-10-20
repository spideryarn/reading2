/**
 * **A dictation that failed, told to Sentry** — the product's
 * {@link DictationReporter}, which every box passes to `useDictationField`.
 *
 * > I was on the microphone input button. … there was some kind of error so the
 * > microphone input didn't work. … See if you can find that error in Sentry, in
 * > the logs or anywhere like that. If you can't, let's improve the logging and
 * > Sentry error monitoring around microphone input.
 * >
 * > — Greg, 2026-10-11 (spya-m2pyfq, SPIDERYARN-READING2-H0)
 *
 * It could not be found: no recording reached `/api/transcribe` in that window,
 * so the dictation failed in the browser, and nothing in the browser reported a
 * caught failure anywhere. docs/plans/261011i-dictation-failures-reach-sentry.md.
 *
 * ## What reaches Sentry is the code, never the sentence
 *
 * The `mic-` codes are deliberately not in `src/messages.ts`, so `sanitise`
 * would withhold the sentence anyway; rather than lean on that, the reporter
 * never hands it over. It builds an `Error` named `DictationFailure` and sends
 * `neverAuthored`, and everything else travels as tags built from closed sets:
 * the code (matched against a pattern with no room for prose), which box
 * ({@link DictationSurface}), the context's `kind` (never an article slug), the
 * browser's name for a refused microphone (`MIC_ERROR_NAMES`), whether a chosen
 * microphone was the one that opened, whether live words were running, and the
 * browser's engine and whether it is a phone or tablet — because the scrubber
 * drops the user agent, and "Safari on an iPhone" is half of most microphone
 * diagnoses. One issue per code, by fingerprint, because every failure is
 * raised from this one line and the stack would otherwise fold them together.
 */
import { captureClientFailure } from "./monitoring.js";
import type { DictationContext } from "./dictation-upload.js";
import type { DictationFailure, DictationReporter } from "./transcriber.js";

/**
 * Not failures: a recording offered back, or words held rather than put in the
 * wrong box. Each is the app doing its job, and an issue for it would be noise
 * on the one dashboard the feedback sweep reads.
 */
const NOT_FAILURES = new Set([
  "mic-recovered",
  "mic-cut-off",
  "mic-moved",
  "mic-moved-held",
  /* The fifteen-minute ceiling: everything said up to it is kept and sent. */
  "mic-full",
]);

/** Every box with a microphone, by name: a closed set, so it can be a tag. */
export type DictationSurface =
  | "add"
  | "annotate"
  | "chat"
  | "command-bar"
  | "comment"
  | "feedback"
  | "feedback-reply"
  | "help"
  | "illustrated"
  | "profile"
  | "quiz";

/** The browser's engine and form, coarsely, from a closed set. */
export function browserTags(ua: string): { browser_engine: string; browser_mobile: string } {
  const engine = /Firefox\//.test(ua)
    ? "gecko"
    : /Chrome\/|Chromium\/|CriOS\//.test(ua)
      ? "chromium"
      : /AppleWebKit\//.test(ua)
        ? "webkit"
        : "other";
  return { browser_engine: engine, browser_mobile: /Mobi|iPhone|iPad|Android/.test(ua) ? "yes" : "no" };
}

/**
 * The code at the end of a sentence, if it is one of ours: `mic-` or `ai-`,
 * lower-case letters, digits and hyphens, and short. `none` otherwise, so an
 * uncoded sentence is still an issue — one that says a sentence lost its code.
 */
export function dictationCode(message: string): string {
  return message.match(/\[((?:mic|ai)-[a-z0-9-]{1,24})\]\s*$/)?.[1] ?? "none";
}

/** What the reporter sends, separated out so a test can read it without Sentry. */
export function dictationFailureEvent(
  failure: DictationFailure,
  context: DictationContext,
  surface: DictationSurface,
  ua: string,
): { error: Error; tags: Record<string, string>; fingerprint: string[] } | null {
  const code = dictationCode(failure.message);
  if (NOT_FAILURES.has(code)) return null;
  const error = new Error("dictation failed");
  error.name = "DictationFailure";
  return {
    error,
    tags: {
      dictation_code: code,
      dictation_surface: surface,
      dictation_place: context.kind,
      mic_error: failure.micError ?? "none",
      mic_chosen: failure.chosenMic,
      mic_live: failure.live ? "yes" : "no",
      ...browserTags(ua),
    },
    fingerprint: ["dictation-failure", code],
  };
}

/**
 * The reporter for one box. Built once per surface at module level by the
 * callers, so its identity is stable — though the hook holds it in a ref and
 * would not mind.
 */
export function dictationReporter(surface: DictationSurface): DictationReporter<DictationContext> {
  return (failure, context) => {
    const event = dictationFailureEvent(failure, context, surface, navigator.userAgent ?? "");
    if (!event) return;
    captureClientFailure(event.error, event.tags, {
      neverAuthored: true,
      fingerprint: event.fingerprint,
    });
  };
}
