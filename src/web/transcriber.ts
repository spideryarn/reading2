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

/**
 * **Somewhere to keep a dictation until its words are safely in the box.**
 *
 * The recording lives in the page's memory, so a tab that closes, reloads,
 * crashes or is discarded by the browser takes minutes of talking with it —
 * the one way left to lose a dictation once a failed upload started keeping its
 * audio. A keeper holds a copy as it is recorded, and the next time the same box
 * is on screen the recording is offered back. Greg, 2026-09-29
 * (SPIDERYARN-READING2-5M): *"I would be really sad if at the end of a few
 * minutes of really rich thought, the contents got lost."*
 * docs/plans/260929h-dictation-that-survives-a-closed-tab.md.
 *
 * A type here and an implementation elsewhere, for the same reason as
 * {@link Transcriber}: the product keeps recordings in IndexedDB
 * ([`dictation-keep.ts`](./dictation-keep.ts)), the fleet dashboard passes no
 * keeper at all, and the hook is shared by both.
 *
 * **Nothing here may throw or reject.** A keeper that fails must never touch the
 * dictation it is keeping; the worst it may do is keep nothing.
 */
export interface DictationKeeper<C> {
  /**
   * Which box this keeper is for — `"feedback"`, `"chat:<slug>:<thread>"`. A
   * recording is only ever offered back to the box it was made in, and the hook
   * re-runs its recovery when this changes.
   */
  readonly box: string;
  /**
   * Start keeping a new dictation. Null when this device cannot keep one — no
   * signed-in reader, no IndexedDB, no Web Locks — in which case the dictation
   * runs exactly as it did before keepers existed.
   */
  begin(where: C): KeptTape | null;
  /**
   * A dictation an earlier page left unfinished in this box, **claimed for this
   * page** so that no other tab can offer it too. Null when there is none.
   */
  recover(): Promise<RecoveredTape<C> | null>;
}

/** One kept dictation, while a page holds it. Every method is fire-and-forget. */
export interface KeptTape {
  /** One recorder chunk, in order. `part` counts from 0, as the tape's parts do. */
  chunk(part: number, blob: Blob, mimeType: string): void;
  /** The tape lost audio part-way, so what is kept is evidence, not a source to transcribe. */
  broken(): void;
  /**
   * Every part's recorder finished, so every kept part is a whole file. Until
   * this is said, a recovered tape is one whose page died mid-sentence: its last
   * part never got the recorder's closing chunk, and is offered with a warning
   * that the end may be missing rather than as "nothing was lost".
   */
  complete(): void;
  /**
   * Wait for every queued write, then say whether they all landed. What the row
   * may promise — "kept on this device" — depends on it; a keeper that has
   * silently failed must not be described as holding anything.
   */
  intact(): Promise<boolean>;
  /** Its words are in the box, or the reader threw it away. Delete it. */
  forget(): void;
  /** This page no longer holds it. Leave it for the next time the box is on screen. */
  release(): void;
}

/** What a recovery hands back: the parts as they were kept, and where they were going. */
export interface RecoveredTape<C> {
  tape: KeptTape;
  where: C;
  /** When the dictation started, for the sentence that offers it back. */
  startedAt: number;
  /** In order, never empty. `ms` is approximate: first chunk to last. */
  parts: Array<{ blob: Blob; mimeType: string; ms: number }>;
  broken: boolean;
  /** Every part closed and no chunk is missing. See {@link KeptTape.complete}. */
  complete: boolean;
}
