/**
 * **What a dictation's words come back as, and who is allowed to fetch them.**
 *
 * A contract file: two types, no imports, no runtime values. It exists so that
 * [`useDictation`](./useDictation.ts) can be told where to send a recording
 * instead of knowing.
 *
 * ## Why the hook stopped knowing
 *
 * Until 2026-09-08 the hook imported `sendForTranscription` from
 * [`dictation-upload.ts`](./dictation-upload.ts) directly, and that one edge was
 * the whole of the product coupling in ~3,000 lines of browser audio machinery:
 * the uploader calls `apiFetch`, which reaches `lib/api.ts`, which reaches
 * Supabase, Sentry, the offline store and the billing plan. Measured, walking
 * the import closure: **`useDictation.ts` reached 25 files and 17,829 lines**,
 * of which the microphone needed six.
 *
 * That mattered when the fleet dashboard (`tools/fleet/`) wanted the same
 * microphone. It is a box utility that must run with the product's server
 * absent — docs/project/overseer-direction.md § Principles — so it could not
 * import the product's authenticated fetch to record a sentence, and copying a
 * state machine that took a day of debugging to make believable would have been
 * worse. Cutting this one edge made every other file importable.
 * docs/plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md
 * § Stage E.
 *
 * **The rule the fleet holds itself to, and the reason this file has no
 * imports:** only leaf, browser-only, product-agnostic modules may be imported
 * from `src/`. A module that is nearly leaf but for one product coupling gets
 * the coupling extracted behind a parameter — this one — rather than importing
 * it.
 */

/**
 * The transcript, or a reason there isn't one.
 *
 * `text` may be an empty string on success — somebody who pressed the button
 * and said nothing gets a successful transcription of nothing, and the box must
 * be left exactly as it was rather than told something went wrong.
 */
export type TranscriptionResult =
  | { ok: true; text: string }
  | {
      ok: false;
      message: string;
      /**
       * **Whether sending the same bytes again could possibly work.**
       *
       * The reason a Retry button needs a field rather than a guess:
       * [copy.md](../../docs/project/copy.md) is explicit that telling somebody
       * to try again when retrying cannot work is the expensive mistake — they
       * do it four or five times and conclude the app is broken. A recording
       * this browser cannot encode, or one over the size cap, will be refused
       * identically for ever; a 502 or a dropped connection very likely will
       * not. GPT Sol's plan review, F5.
       */
      retryable: boolean;
    }
  /** The reader navigated away or pressed again. Say nothing to anybody. */
  | { ok: false; abandoned: true; message: string; retryable: false };

/**
 * Turning a recording into words, wherever that happens to happen.
 *
 * `C` is the caller's **context** — where the dictation was going, which is how
 * a server decides what vocabulary to prime the model with. The hook holds it,
 * snapshots it per session and hands it back here; it never looks inside. For
 * the product that is `DictationContext` in
 * [`dictation-upload.ts`](./dictation-upload.ts) and the server turns it into an
 * article's glossary; for the fleet dashboard it is a session id and the server
 * turns it into the names on the page.
 *
 * **It must not throw.** Every failure is a `TranscriptionResult` with a
 * sentence in it, because the caller's error path is a text box being handed
 * back to a person, not a stack trace.
 */
export type Transcriber<C> = (
  blob: Blob,
  mimeType: string,
  context: C,
  signal?: AbortSignal,
) => Promise<TranscriptionResult>;
