/**
 * **Keep the audio, so a failed dictation leaves something behind.**
 *
 * Greg asked for this: *"if there's an error, store the audio as a file and
 * show a button to reveal it in the OS file explorer so the user can decide
 * what to do with it"*.
 *
 * ## The half that cannot be built, said plainly
 *
 * **A web page cannot reveal a file in the OS file explorer.** There is no API
 * for it and there is not going to be one — it is a sandbox boundary, not a
 * gap. So what this produces is a `Blob` and the caller offers it as a
 * *download*. Chrome's own downloads UI then carries a **Show in Folder** item,
 * so the reveal still happens; it is taken by the browser at the reader's
 * request rather than by us, one click further along. That is the nearest true
 * thing, and the button says *Save the recording* rather than promising the
 * other one.
 *
 * ## The container is the whole feature
 *
 * A file the reader's machine will not open fails the point of this while
 * passing every check we could write. Measured in Chrome 151, 2026-08-27:
 *
 * | requested | what you get |
 * |---|---|
 * | `audio/mp4;codecs=mp4a.40.2` | **AAC-LC in MP4** — `ftypisom`, opens on a double-click |
 * | `audio/mp4` | **Opus in MP4**, which macOS cannot play |
 * | `audio/webm;codecs=opus` | fine, but nothing on a Mac opens it by default |
 *
 * So AAC-in-MP4 is asked for first, and **bare `audio/mp4` is deliberately not
 * in the list at all** — it reports supported, records happily, and hands over
 * something that looks openable and is not. That is the
 * [silent-success](../../docs/reusable/silent-success.md) pattern with a file
 * extension on it.
 *
 * ## Nothing is offered unless it is really evidence
 *
 * A reader handed a file is being told *this is what we heard*. So `stop()`
 * returns null — and no button appears — unless the recorder started, never
 * errored, finished handing over its data, produced bytes, and ran long enough
 * to contain anything. GPT Sol's plan review, 2026-08-27, item 6: an
 * accidental double-press must not produce a quarter-second of nothing wearing
 * the word "recording".
 *
 * ## The order that matters
 *
 * **The recorder is stopped before the track is**, and the caller waits for
 * this promise before releasing it. Killing the track under a live recorder
 * loses the final `dataavailable`, which is the tail of the file — the part a
 * reader is most likely to be looking for. GPT Sol's plan review, item 1. The
 * wait is bounded, because a recorder that never fires `stop` must not be able
 * to strand the microphone open.
 *
 * ## What it costs
 *
 * ~5.6 KB/s at 32 kbps (measured: 7 chunks, 13,971 bytes in 2.5s). Both a
 * five-minute cap and a byte cap, because `audioBitsPerSecond` is a hint an
 * encoder may exceed and a bound derived from it is arithmetic rather than a
 * guarantee (GPT Sol, item 10). It lives in memory as `Blob` chunks and in
 * **no other place** — never uploaded, never written to disk by us, dropped the
 * moment a dictation produces text, and discardable by hand.
 *
 * Three consumers read the one track at once — the recogniser, the meter's
 * `AnalyserNode`, and this. Verified rather than assumed: one 2.5-second run
 * produced `start audiostart soundstart speechstart` from the recogniser,
 * `rms 0.027` from the analyser, and 13,971 bytes here.
 */

/** What a finished recording is. Never handed over empty, short, or broken. */
export interface MicRecording {
  blob: Blob;
  /** What the recorder actually produced, which may not be what we asked for. */
  mimeType: string;
  /** The file extension that matches it — `m4a`, `webm`. No leading dot. */
  ext: string;
  /** How long it ran, in ms. For the label on the button. */
  ms: number;
  /** It hit a cap and stopped early, so this is the beginning and not the whole. */
  capped: boolean;
}

/** A recording in progress. Exactly one of `stop` / `cancel` is called, once. */
export interface MicTape {
  /**
   * Stop, and hand back what was recorded once the recorder has finished with
   * it. Null when there is nothing worth offering.
   *
   * **The caller must await this before stopping the track** — see the header.
   */
  stop(): Promise<MicRecording | null>;
  /** Stop and throw it away. For the ordinary case where dictation worked. */
  cancel(): void;
}

/** One thing to try: a container, and the options to try it with. */
export interface Attempt {
  type: string;
  /** Omitted where the encoder is known to refuse a hint. See below. */
  audioBitsPerSecond?: number;
}

/**
 * What to try, in order, **with the options each one is actually known to
 * survive** — and that qualifier is the whole of a bug found on 2026-08-27.
 *
 * `isTypeSupported("audio/mp4;codecs=mp4a.40.2")` returns true, and a recorder
 * built on it produces a real AAC file. Add `audioBitsPerSecond: 32000` and it
 * fires **`EncodingError` 307ms in, hands over one zero-byte chunk and stops** —
 * measured three times out of three, on the built-in microphone alone, on the
 * built-in microphone shared with the recogniser, and on the virtual device.
 * The same 32 kbps hint on Opus-in-WebM is fine. So on this machine the app
 * always picked AAC, always sent the hint, always got nothing, and **never
 * offered a recording at all** — with no error anywhere, because a failed
 * recorder is deliberately silent.
 *
 * The lesson, which is why the list has this shape rather than a bitrate
 * constant beside it: **`isTypeSupported` is a claim about the codec, not about
 * your options.** Nothing you can ask before starting will tell you the encoder
 * accepts the *combination*, so the recorder has to prove itself — see the
 * fallback in `recordTrack`, which is what makes this list a list of attempts
 * rather than a preference.
 *
 * Speech does not need 32 kbps of AAC; the caps bound the size either way, and
 * AAC's own default measured ~14 KB/s, which fits five minutes inside
 * {@link MAX_BYTES} with room to spare.
 *
 * Bare `audio/mp4` is absent for a different reason — see the header. It is not
 * an oversight and putting it back breaks the feature silently.
 */
const ATTEMPTS: Attempt[] = [
  { type: "audio/mp4;codecs=mp4a.40.2" },
  { type: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 },
  { type: "audio/webm", audioBitsPerSecond: 32_000 },
];
/** A chunk a second, so a stop mid-second still has the second before it. */
const TIMESLICE_MS = 1000;
/**
 * The caps. Recording stops; **dictation carries on** — running out of tape is
 * not a reason to take the microphone away from somebody mid-sentence, and the
 * saved file then says it is only the beginning.
 */
const MAX_MS = 5 * 60_000;
/** Belt to the cap's braces: a bound on what is actually held, not on a bitrate hint. */
const MAX_BYTES = 8 * 1024 * 1024;
/**
 * Shorter than this and there is nothing in it worth calling evidence.
 *
 * A press immediately followed by a second press produces no confirmed text and
 * would otherwise offer the reader a fraction of a second of room tone as
 * though it explained something. GPT Sol's plan review, item 5.
 */
const MIN_MS = 2000;
/** How long to wait for a recorder to finish before releasing the track anyway. */
const FLUSH_TIMEOUT_MS = 3000;

/**
 * The attempts this browser says it can make, best first.
 *
 * Empty means it claims none of them, in which case `recordTrack` asks for
 * nothing at all and reads back whatever the recorder chose for itself.
 */
export function supportedAttempts(
  supported: (type: string) => boolean = isSupported,
): Attempt[] {
  return ATTEMPTS.filter((a) => supported(a.type));
}

/** The best container this browser will give us, or undefined to let it choose. */
export function pickMimeType(
  /* `isTypeSupported` is checked for existence, not merely `MediaRecorder`.
     They arrived separately — Safari shipped the recorder before the probe —
     and calling a missing one throws where returning `undefined` would have
     been perfectly fine: the recorder picks its own container and we read back
     whatever it produced. Found by a fake that did not have it. */
  supported: (type: string) => boolean = isSupported,
): string | undefined {
  return supportedAttempts(supported)[0]?.type;
}

function isSupported(type: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type)
  );
}

/**
 * The file extension for a mime type, so the saved file opens in the right
 * thing rather than arriving as an anonymous blob. Taken from what the recorder
 * says it *produced*, never from what we asked it for.
 */
export function extFor(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav" || base === "audio/wave") return "wav";
  const sub = base.split("/")[1];
  return sub && /^[a-z0-9]+$/.test(sub) ? sub : "bin";
}

/**
 * A filename with the time in it, so two saved recordings do not collide and so
 * the reader can tell which press it was.
 *
 * Local time rather than UTC, and punctuation a filesystem will accept: this
 * name is read by a person looking at a downloads folder, and `2026-08-27
 * 14-32-05` is the form they can match against their own memory of when they
 * pressed the button.
 */
export function recordingFilename(at: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(
    at.getHours(),
  )}-${p(at.getMinutes())}-${p(at.getSeconds())}`;
  return `spideryarn dictation ${stamp}.${ext}`;
}

/**
 * `m:ss`, for the running timer and for the length on the save button.
 *
 * The same function for both on purpose: they are two views of one duration,
 * and the moment they are formatted separately is the moment they disagree by a
 * second and somebody has to work out which is lying. Minutes are not padded —
 * `0:07`, not `00:07` — because a stopwatch reads more like a stopwatch that
 * way, and hours are simply carried into the minutes (`61:00`) rather than
 * growing a third field for a case dictation will never reach.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Start recording a track. Null where there is no `MediaRecorder`, or where it
 * refuses to start.
 *
 * **Never throws, and never stops the track.** The track belongs to
 * [`useDictation`](./useDictation.ts); this is one more reader of it. A
 * recording that cannot start must not be a reason dictation does not.
 */
export function recordTrack(track: MediaStreamTrack): MicTape | null {
  if (typeof MediaRecorder === "undefined") return null;
  /* An empty list is a browser that claims none of our containers. Ask for
     nothing and read back what it chose — which is the same fallback the
     header describes, one level up. */
  const attempts: Array<Attempt | undefined> = supportedAttempts();
  if (attempts.length === 0) attempts.push(undefined);

  const chunks: Blob[] = [];
  let bytes = 0;
  let cancelled = false;
  let errored = false;
  let capped = false;
  let timedOut = false;
  let startedAt = Date.now();
  let endedAt: number | null = null;
  let at = 0;
  let rec: MediaRecorder | null = null;
  let settle: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const halted = () => {
    try {
      if (rec && rec.state !== "inactive") rec.stop();
    } catch {
      /* Already inactive. */
    }
  };

  const finished = () => {
    endedAt = Date.now();
    settle?.();
  };

  /**
   * Build and start one attempt. False if it would not even construct or start,
   * in which case the caller moves on to the next.
   */
  const begin = (): boolean => {
    const opts = attempts[at];
    let next: MediaRecorder;
    try {
      next = new MediaRecorder(new MediaStream([track]), opts ? { ...opts, mimeType: opts.type } : {});
    } catch {
      return false;
    }
    next.ondataavailable = (e) => {
      if (cancelled || e.data.size === 0) return;
      /* **Checked before the chunk is kept, not after.** The first version
         stored it and then noticed, which bounds nothing: a delayed
         `dataavailable` can be any size, so the "cap" was a promise about a
         number nobody had looked at yet. GPT Sol's code review, item 4. */
      if (bytes + e.data.size > MAX_BYTES) {
        capped = true;
        halted();
        return;
      }
      chunks.push(e.data);
      bytes += e.data.size;
    };
    next.onstop = () => {
      if (rec === next) finished();
    };
    next.onerror = () => {
      if (rec !== next) return;
      /* **A recorder that failed before producing anything gets replaced, not
         mourned.** `isTypeSupported` is a claim about the codec and not about
         the options we pass with it, so the only way to find out whether this
         browser will really encode this combination is to watch it try — and on
         2026-08-27 the first choice failed on every machine we had, silently,
         which meant the feature never once produced a file. Anything already
         collected, though, means the container was fine and something else went
         wrong later; that is a real failure and the evidence contract says we
         offer nothing. */
      if (bytes === 0 && at + 1 < attempts.length) {
        at += 1;
        // The clock restarts with the recorder, so `ms` describes the file we
        // actually have rather than including the failed attempt.
        startedAt = Date.now();
        chunks.length = 0;
        if (begin()) return;
      }
      errored = true;
      finished();
    };
    try {
      next.start(TIMESLICE_MS);
    } catch {
      return false;
    }
    rec = next;
    return true;
  };

  while (at < attempts.length) {
    if (begin()) break;
    at += 1;
  }
  if (!rec) return null;

  const cap = window.setTimeout(() => {
    capped = true;
    halted();
  }, MAX_MS);

  const halt = async () => {
    window.clearTimeout(cap);
    halted();
    /* Bounded. The caller stops the track the moment this resolves, and a
       recorder that never fires `stop` must not be able to leave the browser's
       recording indicator lit on a page nobody is dictating into.
       **But which of the two won matters.** If the timeout did, the recorder
       never finished and the chunks in hand are missing their last piece —
       offering them would be handing the reader a partial file described as
       what we captured. So the wait reports its winner and a timed-out flush
       yields nothing. GPT Sol's code review, item 3. */
    const ok = await Promise.race([
      done.then(() => true),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS)),
    ]);
    if (!ok) timedOut = true;
  };

  return {
    async stop() {
      await halt();
      if (cancelled || errored || timedOut) return null;
      const mimeType = rec?.mimeType || attempts[at]?.type || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      // Dropped either way: the Blob owns the data now, and holding the chunks
      // as well would double the memory for as long as the page is open.
      chunks.length = 0;
      const ms = (endedAt ?? Date.now()) - startedAt;
      /* Empty, or too short to contain anything. Neither is evidence, and
         neither may be handed to a reader as if it were. */
      if (blob.size === 0 || ms < MIN_MS) return null;
      return { blob, mimeType, ext: extFor(mimeType), ms, capped };
    },
    cancel() {
      cancelled = true;
      chunks.length = 0;
      void halt();
    },
  };
}
