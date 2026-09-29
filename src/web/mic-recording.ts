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

/**
 * One **part** of a recording: one `MediaRecorder`'s complete, playable file.
 * Never handed over empty or broken.
 *
 * A dictation is one part until it runs long, and then several — see
 * {@link recordTrack} on why the tape rotates, and
 * docs/plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md.
 */
export interface MicRecording {
  blob: Blob;
  /** What the recorder actually produced, which may not be what we asked for. */
  mimeType: string;
  /** The file extension that matches it — `m4a`, `webm`. No leading dot. */
  ext: string;
  /** How long this part ran, in ms. For the label on the button. */
  ms: number;
  /** The dictation hit its ceiling here, so this is the last part and the rest was never recorded. */
  capped: boolean;
}

/**
 * How a tape ended, when it left anything worth offering.
 *
 * `parts` is never empty. **`broken` means the parts are not the whole
 * dictation** — a recorder failed, a flush never finished, or a chunk had to be
 * thrown away — so they are evidence to save and not a source to transcribe:
 * joining the words either side of a hole would be handing the reader a
 * transcript with a sentence missing and nothing saying so. `parts` is then the
 * complete ones *before* the first failure.
 */
export interface TapeEnding {
  parts: MicRecording[];
  broken: boolean;
}

/** What the tape tells its owner while it runs. All optional; none may throw. */
export interface TapeEvents {
  /** The whole dictation reached {@link MAX_MS}. The tape has stopped itself. */
  onCapped?(): void;
  /**
   * A part closed **because the tape rotated**, complete, while the reader is
   * still talking — so it can be sent now rather than at the end. `index`
   * counts from 0 and matches its place in {@link TapeEnding.parts}. Not called
   * for the tail, which `stop()` hands over.
   */
  onPart?(part: MicRecording, index: number): void;
  /**
   * Capture failed part-way — after audio had been collected — so whatever is
   * said from here cannot be joined to what came before. The owner should end
   * the dictation rather than let the reader talk into a tape that is already
   * lost.
   */
  onBroken?(): void;
}

/** A recording in progress. Exactly one of `stop` / `cancel` is called, once. */
export interface MicTape {
  /**
   * Stop, and hand back every part once the recorders have finished with them.
   * Null when there is nothing worth offering.
   *
   * **The caller must await this before stopping the track** — see the header.
   */
  stop(): Promise<TapeEnding | null>;
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
 *
 * ## Narrower than it first looked, and there is nowhere better to go
 *
 * A spike on 2026-08-27 (docs/research/260827b-microphone-library-options.md) pinned
 * the failure to **one channel, 48 kHz, 32 kbps**: the identical control on a
 * *stereo* track produced 38 KB quite happily. Every microphone tested that day
 * was mono, and a `getUserMedia` track normally is, which is why it read as
 * device-independent.
 *
 * The same spike closed the obvious escape route. WebCodecs'
 * `AudioEncoder.isConfigSupported()` — which, unlike `isTypeSupported`, the
 * spec *requires* to consider the bitrate — answers **`supported: true`** for
 * the configuration that then throws. And `mediabunny`, driving that same
 * encoder, fails at the identical config and then **hangs**: its `start()` and
 * `finalize()` both time out and the error escapes uncaught, where the fallback
 * below has already moved to the next container in 382ms. So there is no better
 * probe to ask and no second encoder to fall back to — which is what makes
 * proving it at runtime the design rather than a stopgap.
 */
const AAC = "audio/mp4;codecs=mp4a.40.2";
const ATTEMPTS: Attempt[] = [
  { type: AAC },
  { type: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 },
  { type: "audio/webm", audioBitsPerSecond: 32_000 },
];
/**
 * **The hint AAC gets on WebKit, and only there** — see {@link takesAacBitrate}.
 *
 * WebKit records at **192 kbps** when a page gives no `audioBitsPerSecond`
 * (`LargeAudioBitRate` in its `MediaRecorderPrivate.cpp`, read 2026-09-12), so
 * the "no hint" above — right for Chromium, whose encoder throws on one — made
 * every iPad dictation ~24 KB/s, several times what speech needs. On a weak
 * connection that was most of the wait: 41 seconds of speech at that size took
 * 10.8 s to upload at 1 Mbps, against ~2 s to transcribe
 * (docs/plans/260912b-dictation-slow-on-weak-wifi.md).
 *
 * 48k rather than 32k because **a value Core Audio refuses does not fail** — it
 * falls back to 192k in silence — and 48k is the more ordinary rate for AAC-LC.
 * Whether it was taken is visible only in production: the `dictation
 * transcribed` log line carries `kbps`, from the provider's own measure of the
 * audio's length.
 */
const WEBKIT_AAC_BPS = 48_000;
/** A chunk a second, so a stop mid-second still has the second before it. */
const TIMESLICE_MS = 1000;
/**
 * **The ceiling on a whole dictation**, however many parts it is in.
 *
 * When it is hit, `onCapped` is told and [`useDictation`](./useDictation.ts)
 * ends the dictation — since 2026-08-27, when the recording became *the source
 * of the transcript*: recording stopping while dictation carried on would have
 * transcribed the first few minutes and replaced the whole of what was said
 * with them. GPT Sol's plan review, item 2.
 *
 * **Five minutes, and not higher, although segments would allow it** (plan
 * 260929f, R7). Five minutes of speech is about what the largest box, Feedback's
 * 4,000 characters, holds; twenty would be ~18,000 characters into boxes that
 * take 600 to 4,000. What segments removed is the byte cutoff that used to end a
 * Chrome dictation at two and a half minutes, well before this.
 */
const MAX_MS = 5 * 60_000;
/**
 * **The tape rotates to a new part at two minutes or 80% of {@link MAX_BYTES},
 * whichever comes first** — see {@link chunkVerdict}.
 *
 * Two minutes is ~1.7 MB at Chrome's AAC rate, so the byte bound is the safety
 * rather than the rule; 80% leaves room for the old recorder's terminal chunk,
 * which arrives after the rotation and still belongs to the old part.
 */
export const PART_MS = 120_000;
export const PART_BYTES = 1_680_000;
/**
 * The most any one **part** may hold: a bound on what is actually held, not on
 * a bitrate hint — and the bound that keeps each request inside Vercel's 4.5 MB.
 *
 * **Since 2026-09-29 reaching it does not end anything**, because the tape
 * rotates to a new part at 80% of it ({@link PART_BYTES}) — so in the ordinary
 * course nothing ever gets here. Only a single chunk big enough to jump the gap
 * does (a tab suspended for minutes and then handed its backlog at once), and
 * that chunk cannot be kept without breaking the size bound or dropped without
 * leaving a hole, so it is a capture failure and said as one. Greg hit the old
 * behaviour as `[mic-full]` two and a half minutes into a Feedback message;
 * plan 260929f § Part B.
 *
 * It was 8 MB, sized when nothing was uploaded. Base64 inflates by a third, so
 * 8 MB of audio is 10.7 MB of body and Vercel refuses it **before any of our
 * code runs** — no `readBody`, no auth, no copy, no log line. `MAX_AUDIO_BASE64`
 * in [src/transcribe.ts](../transcribe.ts) is 3 MB of base64, so this is the
 * raw-byte figure that fits inside it with room for the JSON around it.
 *
 * **On an iPad it used to bite at about 87 seconds**, until 2026-09-12, because
 * WebKit recorded at 192 kbps (~24 KB/s) with no hint — which nobody had worked
 * out, because every rate here was measured in Chrome. See
 * {@link WEBKIT_AAC_BPS}.
 */
export const MAX_BYTES = 2_100_000;
/**
 * Shorter than this and there is nothing in it worth calling evidence.
 *
 * A press immediately followed by a second press produces no confirmed text and
 * would otherwise offer the reader a fraction of a second of room tone as
 * though it explained something. GPT Sol's plan review, item 5.
 *
 * **Applied to the whole dictation, never to a part.** Per part, it would throw
 * away a one-second tail after a rotation — the reader's last words.
 */
const MIN_MS = 2000;
/** How long to wait for a recorder to finish before releasing the track anyway. */
const FLUSH_TIMEOUT_MS = 3000;

/** What to do with a chunk that has just arrived for the part being recorded. */
export type ChunkVerdict =
  /** Keep it and carry on. */
  | "keep"
  /** Keep it, and then start the next part. */
  | "rotate"
  /** It cannot be kept inside {@link MAX_BYTES}: a capture failure. */
  | "overflow";

/**
 * **Where the tape is cut**, decided each time the recorder hands over data.
 *
 * On a chunk rather than on a timer, and that is deliberate (plan 260929f,
 * R6): a background tab's timers are throttled, but `dataavailable` still
 * arrives whenever the recorder has data, so this runs exactly when there is
 * something to decide about. Hard lengths only — no hunting for a pause — until
 * a measurement of seam damage asks for more (R8).
 *
 * @param part the part being recorded, *before* this chunk: how long it has
 * run and what it holds.
 */
export function chunkVerdict(part: { ms: number; bytes: number }, chunk: number): ChunkVerdict {
  const after = part.bytes + chunk;
  if (after > MAX_BYTES) return "overflow";
  if (part.ms >= PART_MS || after >= PART_BYTES) return "rotate";
  return "keep";
}

/**
 * The attempts this browser says it can make, best first.
 *
 * Empty means it claims none of them, in which case `recordTrack` asks for
 * nothing at all and reads back whatever the recorder chose for itself.
 */
export function supportedAttempts(
  supported: (type: string) => boolean = isSupported,
  webkit: boolean = takesAacBitrate(),
): Attempt[] {
  return ATTEMPTS.filter((a) => supported(a.type)).map((a) =>
    webkit && a.type === AAC ? { ...a, audioBitsPerSecond: WEBKIT_AAC_BPS } : a,
  );
}

/**
 * **Whether this page's AAC encoder is WebKit's**, which takes a bitrate hint —
 * and Chromium's, which throws on one, is not.
 *
 * `navigator.vendor` is `"Apple Computer, Inc."` in Safari and in every browser
 * on an iPad or iPhone (they are all WebKit underneath), `"Google Inc."` in
 * Chromium, and empty in Firefox — which never reaches the AAC attempt anyway.
 *
 * **A positive check, and deliberately not `useDictation`'s `probeIsSafe`.**
 * That one asks "is this Chromium?" and is built so its mistake is harmless for
 * the probe. Here the mistakes are the other way round: a hint sent to an
 * encoder that throws starts the next recorder ~380 ms late and loses the
 * reader's first word, while no hint is only what the app did before 2026-09-12.
 * So this says yes only to the one string it recognises.
 */
export function takesAacBitrate(): boolean {
  return typeof navigator !== "undefined" && navigator?.vendor === "Apple Computer, Inc.";
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
export function recordingFilename(at: Date, ext: string, part?: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(
    at.getHours(),
  )}-${p(at.getMinutes())}-${p(at.getSeconds())}`;
  /* The part number for a dictation in several, so two saved in the same
     second do not collide and the reader can put them back in order. */
  return `spideryarn dictation ${stamp}${part === undefined ? "" : ` part ${part}`}.${ext}`;
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
 *
 * ## The tape rotates
 *
 * A long dictation is recorded in **parts**, each its own `MediaRecorder` and
 * so its own complete, playable file — MP4 and WebM cannot be joined byte-wise,
 * which is why this is several recorders and not one recorder's chunks sliced
 * up. {@link chunkVerdict} says when to cut; the next recorder is started on
 * the same track *before* the old one is stopped, and reuses the container that
 * already worked rather than walking the ladder again. Each finished part goes
 * to `onPart`, so it is sent while the reader is still talking and the wait
 * after Stop is only the last part's. Plan 260929f § Part B, and § The spike for
 * what a seam measured.
 */
export function recordTrack(track: MediaStreamTrack, events: TapeEvents = {}): MicTape | null {
  if (typeof MediaRecorder === "undefined") return null;
  /* An empty list is a browser that claims none of our containers. Ask for
     nothing and read back what it chose — which is the same fallback the
     header describes, one level up. */
  const attempts: Array<Attempt | undefined> = supportedAttempts();
  if (attempts.length === 0) attempts.push(undefined);

  /**
   * One recorder's worth. `abandoned` is an attempt on the container ladder
   * that failed before holding anything and was replaced; `failed` is a real
   * loss of audio.
   */
  interface Part {
    rec: MediaRecorder;
    chunks: Blob[];
    bytes: number;
    startedAt: number;
    endedAt: number | null;
    state: "recording" | "closing" | "closed" | "failed" | "abandoned";
    done: Promise<void>;
    settle: () => void;
    /** Built once, when the part closes, and the chunks dropped. */
    file: MicRecording | null;
  }

  const parts: Part[] = [];
  let current: Part | null = null;
  let at = 0;
  let cancelled = false;
  let stopping = false;
  let capped = false;
  /** A part has failed, so nothing more may come out of this tape. */
  let dead = false;
  let ceiling = 0;
  const timers: number[] = [];

  const halt = (p: Part) => {
    try {
      if (p.rec.state !== "inactive") p.rec.stop();
    } catch {
      /* Already inactive. */
    }
  };

  const fileOf = (p: Part): MicRecording => {
    if (!p.file) {
      const mimeType = p.rec.mimeType || attempts[at]?.type || "audio/webm";
      p.file = {
        blob: new Blob(p.chunks, { type: mimeType }),
        mimeType,
        ext: extFor(mimeType),
        ms: (p.endedAt ?? Date.now()) - p.startedAt,
        capped: false,
      };
      // The Blob owns the data now; holding the chunks as well would double it.
      p.chunks.length = 0;
    }
    return p.file;
  };

  /**
   * **A part lost audio, so the tape is over.** Whatever is recorded after a
   * hole cannot be joined to what came before it without the reader's words
   * going missing in the middle with nothing saying so — the all-or-nothing
   * rule, plan 260929f R3. Every recorder stops, and the owner is told so it can
   * end the dictation rather than let the reader keep talking into nothing.
   */
  const fail = (p: Part) => {
    if (p.state === "failed" || p.state === "abandoned") return;
    p.state = "failed";
    p.endedAt = Date.now();
    p.settle();
    dead = true;
    window.clearTimeout(ceiling);
    for (const q of parts) halt(q);
    if (!stopping && !cancelled) events.onBroken?.();
  };

  const onData = (p: Part, data: Blob) => {
    /* **Abandoned and failed parts first, and this is the load-bearing line.**
       The specification's failure sequence is `error`, *then* a terminal
       `dataavailable` carrying what was collected, *then* `stop` — so by the
       time a replacement recorder is running, the one it replaced still has a
       blob to hand over. Were it kept, the reader would be offered a file with
       one container's bytes at the front of another's: right size, plausible
       type, does not play. It would also move `bytes` off zero, which silently
       converts the next retry into a giving-up.
       https://www.w3.org/TR/mediastream-recording/#error-handling
       GPT Sol's review of the library decision, 2026-08-27, blocker 3. It hid
       behind Chrome, whose AAC failure hands over an *empty* terminal blob. */
    if (cancelled || data.size === 0 || p.state === "failed" || p.state === "abandoned") return;
    /* **Checked before the chunk is kept, not after.** A delayed
       `dataavailable` can be any size, so a bound checked afterwards bounds
       nothing. GPT Sol's code review, 2026-08-27, item 4. */
    const verdict = chunkVerdict({ ms: Date.now() - p.startedAt, bytes: p.bytes }, data.size);
    if (verdict === "overflow") {
      fail(p);
      return;
    }
    p.chunks.push(data);
    p.bytes += data.size;
    /* Only the part being recorded rotates. A part already closing is handing
       over its terminal chunk, which is its own and moves nothing. */
    if (verdict === "rotate" && p === current && p.state === "recording" && !stopping && !capped) {
      rotate(p);
    }
  };

  const onError = (p: Part) => {
    if (cancelled || p.state === "failed" || p.state === "abandoned") return;
    /* **A recorder that failed before producing anything gets replaced, not
       mourned** — but only the first part, before the tape has held a byte.
       `isTypeSupported` is a claim about the codec and not about the options we
       pass with it, so the only way to find out whether this browser will
       really encode this combination is to watch it try — and on 2026-08-27 the
       first choice failed on every machine we had, silently, which meant the
       feature never once produced a file. Anything already collected means the
       container was fine and something else went wrong later: a real failure. */
    if (p.bytes === 0 && parts.length === 1 && parts[0] === p) {
      p.state = "abandoned";
      p.settle();
      /* **A loop, not one more go.** An attempt that will not even construct
         is not the end of the ladder. GPT Sol's review, blocker 3. */
      while (at + 1 < attempts.length) {
        at += 1;
        const next = open();
        if (next) {
          parts[0] = next;
          return;
        }
      }
      /* Nothing left to try, and nothing was ever held — so there is no hole,
         only no tape. Not `fail`: that is for audio lost part-way. */
      p.state = "failed";
      return;
    }
    fail(p);
  };

  const onStop = (p: Part) => {
    if (p.state === "failed" || p.state === "abandoned" || p.state === "closed") return;
    p.state = "closed";
    p.endedAt = Date.now();
    p.settle();
    /* A part closed by a rotation, whole: send it now, while the reader is
       still talking. The tail is `stop()`'s to hand over. */
    if (p !== current && !cancelled && !dead && p.bytes > 0) {
      events.onPart?.(fileOf(p), parts.indexOf(p));
    }
  };

  /**
   * Build and start one recorder on the container at `at`, making it
   * `current`. Null if it would not construct or start.
   */
  const open = (): Part | null => {
    const opts = attempts[at];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(new MediaStream([track]), opts ? { ...opts, mimeType: opts.type } : {});
    } catch {
      return null;
    }
    let settle = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    // The clock starts with the recorder, so `ms` describes the file we have.
    const p: Part = {
      rec,
      chunks: [],
      bytes: 0,
      startedAt: Date.now(),
      endedAt: null,
      state: "recording",
      done,
      settle,
      file: null,
    };
    rec.ondataavailable = (e) => onData(p, e.data);
    rec.onstop = () => onStop(p);
    rec.onerror = () => onError(p);
    /* Current *before* `start`, so a chunk delivered from inside `start` is
       judged as the live part's, and put back if it will not start. */
    const previous = current;
    current = p;
    try {
      rec.start(TIMESLICE_MS);
    } catch {
      current = previous;
      return null;
    }
    return p;
  };

  /**
   * **New recorder first, then stop the old one**, so the only gap is what the
   * old recorder's last packet drops. If the new one will not start, the old one
   * carries on and the next chunk tries again; {@link MAX_BYTES} is the backstop.
   */
  const rotate = (old: Part) => {
    const next = open();
    if (!next) return;
    parts.push(next);
    old.state = "closing";
    halt(old);
    /* Bounded, like `stop()`'s wait: a part whose recorder never says it has
       finished is not a complete file. */
    timers.push(
      window.setTimeout(() => {
        if (old.state === "closing") fail(old);
      }, FLUSH_TIMEOUT_MS),
    );
  };

  while (at < attempts.length) {
    const first = open();
    if (first) {
      parts.push(first);
      break;
    }
    at += 1;
  }
  if (parts.length === 0) return null;

  ceiling = window.setTimeout(() => {
    capped = true;
    for (const q of parts) halt(q);
    events.onCapped?.();
  }, MAX_MS);

  const stopAll = () => {
    window.clearTimeout(ceiling);
    for (const t of timers) window.clearTimeout(t);
    for (const q of parts) {
      if (q.state === "recording") q.state = "closing";
      halt(q);
    }
  };

  /** What the settled parts amount to. See {@link TapeEnding}. */
  const collect = (): TapeEnding | null => {
    const broken = parts.some((q) => q.state === "failed");
    const kept: MicRecording[] = [];
    for (const q of parts) {
      // The complete parts *before* the first failure, in order.
      if (q.state !== "closed") break;
      /* A tail with nothing in it is absent — not evidence of silence, and the
         parts before it stand. */
      if (q.bytes > 0) kept.push(fileOf(q));
    }
    const tail = kept.at(-1);
    if (!tail) return null;
    /* The whole dictation, first part's start to last part's end — never a part
       on its own, or a one-second tail after a rotation would go. */
    const total = (parts.at(-1)?.endedAt ?? Date.now()) - (parts[0]?.startedAt ?? Date.now());
    if (broken) return { parts: kept, broken };
    if (total < MIN_MS) return null;
    if (capped) kept[kept.length - 1] = { ...tail, capped: true };
    return { parts: kept, broken };
  };

  return {
    async stop() {
      stopping = true;
      stopAll();
      /* Bounded. The caller stops the track the moment this resolves, and a
         recorder that never fires `stop` must not be able to leave the
         browser's recording indicator lit on a page nobody is dictating into.
         **But a part that never finished is not a file**, so it counts as
         failed rather than being offered as what we captured. GPT Sol's code
         review, 2026-08-27, item 3. */
      await Promise.race([
        Promise.all(parts.map((q) => q.done)),
        new Promise<void>((resolve) => window.setTimeout(resolve, FLUSH_TIMEOUT_MS)),
      ]);
      for (const q of parts) if (q.state === "closing" || q.state === "recording") q.state = "failed";
      if (cancelled) return null;
      const ending = collect();
      for (const q of parts) q.chunks.length = 0;
      return ending;
    },
    cancel() {
      cancelled = true;
      stopAll();
      for (const q of parts) q.chunks.length = 0;
    },
  };
}
