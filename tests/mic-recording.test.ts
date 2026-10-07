// @vitest-environment jsdom
/**
 * **Keeping the audio of a dictation that produced nothing.**
 *
 * Two properties matter here and they pull in opposite directions.
 *
 * *Never offer a file that is not evidence.* A reader handed a download is
 * being told "this is what we heard", so an empty blob, a recorder that errored
 * part way through, or a quarter-second between two presses must all produce
 * nothing at all rather than a button with a lie behind it.
 *
 * *Never hand over a file the reader's machine will not open.* Which is what
 * the container tests are about, and specifically why bare `audio/mp4` is
 * excluded: Chrome reports it supported, records happily, and produces
 * **Opus in MP4**, which macOS cannot play. It is a
 * [silent success](../docs/reusable/silent-success.md) with a file extension.
 *
 * docs/plans/260827k-microphone-device-and-recording.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES,
  MAX_MS,
  PART_BYTES,
  PART_MS,
  chunkVerdict,
  extFor,
  formatDuration,
  pickMimeType,
  recordTrack,
  recordingFilename,
  supportedAttempts,
  takesAacBitrate,
} from "../src/web/mic-recording.js";

/* ------------------------------------------------------------- the fake -- */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  /** `start N` / `stop N` by construction index, so a test can see the order of a rotation. */
  static log: string[] = [];
  static failToConstruct = false;
  /** Make the next N constructions throw, then behave. For the ladder tests. */
  static constructFailures = 0;
  static failToStart = false;
  /** What this browser claims. Empty by default, so most tests get the "ask for nothing" path. */
  static supported = new Set<string>();
  static isTypeSupported(t: string) {
    return FakeRecorder.supported.has(t);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  /** Exactly what was passed in, so a test can assert which options went with which container. */
  opts: { mimeType?: string; audioBitsPerSecond?: number };
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: unknown, opts?: { mimeType?: string; audioBitsPerSecond?: number }) {
    if (FakeRecorder.failToConstruct) throw new Error("nope");
    if (FakeRecorder.constructFailures > 0) {
      FakeRecorder.constructFailures -= 1;
      throw new Error("nope");
    }
    this.opts = opts ?? {};
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }
  /** Error rather than finish when asked to stop — a part that fails while closing. */
  failOnStop = false;
  start() {
    if (FakeRecorder.failToStart) throw new Error("nope");
    this.state = "recording";
    FakeRecorder.log.push(`start ${FakeRecorder.instances.indexOf(this)}`);
  }
  /** Synchronous `onstop`, so `halt()` never has to fall through to its timeout. */
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    FakeRecorder.log.push(`stop ${FakeRecorder.instances.indexOf(this)}`);
    if (this.failOnStop) this.onerror?.();
    else this.onstop?.();
  }
  /* -- test helpers -- */
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  fail() {
    this.onerror?.();
  }
  /**
   * **The failure the specification actually describes**, which is three events
   * and not one: `error`, then a terminal `dataavailable` carrying whatever was
   * collected, then `stop`.
   * https://www.w3.org/TR/mediastream-recording/#error-handling
   *
   * `fail()` above models only the first of them, which is what Chrome happened
   * to do for the AAC bug (its terminal blob was empty) — and a fake that only
   * reproduces the lucky case certifies the wrong event model. GPT Sol's
   * review of the library decision, 2026-08-27, blocker 3.
   */
  failPerSpec(trailingBytes: number) {
    this.onerror?.();
    this.ondataavailable?.({ data: new Blob([new Uint8Array(trailingBytes)]) });
    this.state = "inactive";
    this.onstop?.();
  }
}

function latest(): FakeRecorder {
  const r = FakeRecorder.instances.at(-1);
  if (!r) throw new Error("no recorder was constructed");
  return r;
}

const track = { readyState: "live", stop: () => {} } as unknown as MediaStreamTrack;

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.log = [];
  FakeRecorder.failToConstruct = false;
  FakeRecorder.constructFailures = 0;
  FakeRecorder.failToStart = false;
  FakeRecorder.supported = new Set();
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  /* **Chromium's vendor string, by default, and it has to be said.** jsdom
     reports `navigator.vendor` as `"Apple Computer, Inc."` — Safari's — so
     without this line every test below would silently be the WebKit case and
     get a bitrate hint on AAC. The WebKit tests set it themselves. */
  vi.stubGlobal("navigator", { vendor: "Google Inc." });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T14:32:05"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------- the container --- */

describe("which container it asks for", () => {
  it("prefers AAC-in-MP4, which is the one a Mac opens on a double-click", () => {
    expect(pickMimeType(() => true)).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("falls to opus-in-webm when AAC is not on offer", () => {
    expect(pickMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
  });

  /* The regression test for the trap. Chrome says yes to bare `audio/mp4` and
     then hands back Opus in an MP4 container, which QuickTime will not play —
     so a file that looks openable and is not. Asking for nothing is better: the
     recorder picks its own and we read back what it actually produced. */
  it("never asks for bare `audio/mp4`, even when it is the only thing supported", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBeUndefined();
  });

  it("asks for nothing at all when the browser supports none of them", () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});

describe("the file extension", () => {
  it("maps the containers we ask for", () => {
    expect(extFor("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(extFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extFor("audio/ogg")).toBe("ogg");
    expect(extFor("audio/wav")).toBe("wav");
  });

  it("falls back to the subtype, and to something harmless when there isn't one", () => {
    expect(extFor("audio/flac")).toBe("flac");
    expect(extFor("nonsense")).toBe("bin");
    expect(extFor("")).toBe("bin");
  });
});

describe("the filename", () => {
  it("carries a local timestamp a person can match to when they pressed the button", () => {
    expect(recordingFilename(new Date("2026-08-27T14:32:05"), "m4a")).toBe(
      "spideryarn dictation 2026-08-27 14-32-05.m4a",
    );
  });

  it("numbers a multipart dictation before the extension", () => {
    expect(recordingFilename(new Date("2026-08-27T14:32:05"), "webm", 3)).toBe(
      "spideryarn dictation 2026-08-27 14-32-05 part 3.webm",
    );
  });
});

describe("m:ss", () => {
  it("is a stopwatch, not a clock", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(83_000)).toBe("1:23");
    expect(formatDuration(3_660_000)).toBe("61:00");
  });

  it("never shows a negative, however the clocks disagree", () => {
    expect(formatDuration(-5_000)).toBe("0:00");
  });
});

/* ------------------------------------------- the bitrate, by engine --- */

/**
 * **An iPad records at 192 kbps unless it is told otherwise** — WebKit's
 * `LargeAudioBitRate`, read from its source — which is several times what
 * speech needs and, on a weak connection, most of the wait. A hint goes only
 * where the encoder is known to take it: Chromium's AAC throws on one (the
 * section below), and the ladder's recovery costs the reader's first word.
 * docs/plans/260912b-dictation-slow-on-weak-wifi.md.
 */
describe("the bitrate hint on AAC, and which engine gets it", () => {
  const all = () => true;

  it("gives WebKit's AAC a speech bitrate, because WebKit honours one", () => {
    const [first] = supportedAttempts(all, true);
    expect(first?.type).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(first?.audioBitsPerSecond).toBe(48_000);
  });

  it("gives Chromium's AAC none, because Chromium's encoder throws on one", () => {
    const [first] = supportedAttempts(all, false);
    expect(first?.type).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(first?.audioBitsPerSecond).toBeUndefined();
  });

  it("leaves the webm attempts as they were, on either engine", () => {
    for (const webkit of [true, false]) {
      const webm = supportedAttempts((t) => t.startsWith("audio/webm"), webkit)[0];
      expect(webm?.type).toBe("audio/webm;codecs=opus");
      expect(webm?.audioBitsPerSecond).toBe(32_000);
    }
  });

  /* A positive check, on purpose: the harmless mistake here is *no* hint,
     which is what the app did before — so only a vendor string it recognises
     gets one, and anything unknown gets today's behaviour. */
  it("recognises WebKit by its vendor string, and says no to everything else", () => {
    vi.stubGlobal("navigator", { vendor: "Apple Computer, Inc." });
    expect(takesAacBitrate()).toBe(true);
    vi.stubGlobal("navigator", { vendor: "Google Inc." });
    expect(takesAacBitrate()).toBe(false);
    vi.stubGlobal("navigator", { vendor: "" }); // Firefox
    expect(takesAacBitrate()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(takesAacBitrate()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(takesAacBitrate()).toBe(false);
  });

  it("puts the hint on the recorder it builds when the page is WebKit", () => {
    vi.stubGlobal("navigator", { vendor: "Apple Computer, Inc." });
    FakeRecorder.supported = new Set(["audio/mp4;codecs=mp4a.40.2"]);
    recordTrack(track);
    expect(latest().opts.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(latest().opts.audioBitsPerSecond).toBe(48_000);
  });

  it("and leaves it off when the page is Chromium", () => {
    FakeRecorder.supported = new Set(["audio/mp4;codecs=mp4a.40.2"]);
    recordTrack(track);
    expect(latest().opts.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(latest().opts.audioBitsPerSecond).toBeUndefined();
  });
});

/* ------------------------------------------------------- the lifecycle --- */

/**
 * The bug this section exists for, found in Chrome 151 on 2026-08-27.
 *
 * `isTypeSupported("audio/mp4;codecs=mp4a.40.2")` returns **true**, and a
 * recorder built on it produces a real AAC file — until you add
 * `audioBitsPerSecond: 32000`, at which point it fires `EncodingError` 307ms
 * in, hands over one zero-byte chunk and stops. Three configurations out of
 * three. The app therefore always picked AAC, always sent the hint, always got
 * nothing, and **never once offered a recording** — silently, because a failed
 * recorder is deliberately quiet.
 *
 * `isTypeSupported` is a claim about the codec, not about the options you pass
 * with it. So the recorder has to prove itself.
 */
describe("when the encoder refuses the combination it said it supported", () => {
  const allSupported = () => {
    FakeRecorder.supported = new Set([
      "audio/mp4;codecs=mp4a.40.2",
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  };

  it("sends no bitrate hint with AAC, which is the pairing that fails", () => {
    allSupported();
    const [first] = supportedAttempts((t) => FakeRecorder.supported.has(t));
    expect(first?.type).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(first?.audioBitsPerSecond).toBeUndefined();
  });

  it("still sends one with webm, where it is measured to be fine", () => {
    const webm = supportedAttempts((t) => t.startsWith("audio/webm"))[0];
    expect(webm?.type).toBe("audio/webm;codecs=opus");
    expect(webm?.audioBitsPerSecond).toBe(32_000);
  });

  it("moves to the next container when the first produced nothing at all", async () => {
    allSupported();
    const tape = recordTrack(track);
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(FakeRecorder.instances[0]?.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");

    // Fails before a single byte — exactly what Chrome's AAC encoder does.
    vi.setSystemTime(new Date("2026-08-27T14:32:06"));
    latest().fail();

    expect(FakeRecorder.instances).toHaveLength(2);
    expect(FakeRecorder.instances[1]?.mimeType).toBe("audio/webm;codecs=opus");

    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:16"));
    const out = await tape?.stop();
    expect(out?.parts[0]?.blob.size).toBe(4096);
    expect(out?.parts[0]?.ext).toBe("webm");
    /* The clock restarted with the recorder: ten seconds of the second
       attempt, not eleven counting the first one's failure. A file described
       as longer than it is, is the thing this whole round is about. */
    expect(out?.parts[0]?.ms).toBe(10_000);
  });

  /* A container that got as far as producing bytes and *then* failed is a real
     failure, not a wrong guess about the codec. Retrying would throw away audio
     we successfully captured in favour of starting again mid-sentence. */
  it("does not retry once a container has proved it works", async () => {
    allSupported();
    const tape = recordTrack(track);
    latest().emit(65_536);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    latest().fail();
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(await tape?.stop()).toBeNull();
  });

  /**
   * **A failed attempt's last chunk must not land in its replacement's file.**
   *
   * The specification fires `error` *before* the terminal `dataavailable`, so
   * at the moment we decide to retry, the failed recorder has not yet handed
   * over what it collected. The retry starts, and then the old recorder's
   * final blob arrives — into the shared `chunks` array now belonging to a
   * different container. AAC bytes at the front of a WebM file: a blob that is
   * the right size, has a plausible type, and does not play.
   *
   * It survived a browser only because Chrome's AAC failure hands over an
   * *empty* terminal blob, so the size check swallowed it. An encoder that
   * errors at 307ms with a timeslice of 1000ms can perfectly well have frames
   * in hand. GPT Sol's review, blocker 3.
   */
  it("ignores the failed attempt's terminal chunk, which arrives after the retry", async () => {
    allSupported();
    const tape = recordTrack(track);
    const first = latest();

    vi.setSystemTime(new Date("2026-08-27T14:32:06"));
    first.failPerSpec(2048);

    const second = latest();
    expect(second).not.toBe(first);
    expect(second.mimeType).toBe("audio/webm;codecs=opus");

    second.emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:16"));
    const out = await tape?.stop();
    // 4096, not 6144: the 2048 belonged to a container this file is not in.
    expect(out?.parts[0]?.blob.size).toBe(4096);
    expect(out?.parts[0]?.ext).toBe("webm");
  });

  /* The same late chunk seen from the other side. It also moves `bytes` off
     zero, which is the flag that decides whether a *further* failure is a bad
     guess worth retrying or a real one worth reporting — so one stray blob
     silently converts the next retry into a giving-up. */
  it("still retries after a failure whose terminal chunk was not empty", async () => {
    allSupported();
    const tape = recordTrack(track);

    latest().failPerSpec(2048);
    expect(FakeRecorder.instances).toHaveLength(2);
    latest().failPerSpec(2048);
    expect(FakeRecorder.instances).toHaveLength(3);

    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:16"));
    const out = await tape?.stop();
    expect(out?.parts[0]?.blob.size).toBe(4096);
    expect(out?.parts[0]?.ext).toBe("webm");
  });

  /* The ladder has to keep walking. An attempt that fails to *construct* is
     not the end of the list, but the retry path only ever called `begin()`
     once — so one unbuildable container in the middle stopped the search
     while the one below it would have worked. GPT Sol's review, blocker 3,
     second half. */
  it("walks past a container that will not even construct, on the retry path", async () => {
    allSupported();
    const tape = recordTrack(track);
    expect(FakeRecorder.instances).toHaveLength(1);

    // The next construction throws; the one after it succeeds.
    FakeRecorder.constructFailures = 1;
    latest().fail();

    // Two more constructions were attempted, and the survivor is the third
    // container. A single `begin()` would have stopped at the unbuildable one.
    expect(latest().mimeType).toBe("audio/webm");
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:16"));
    expect((await tape?.stop())?.parts[0]?.ext).toBe("webm");
  });

  it("gives up honestly when every container refuses", async () => {
    allSupported();
    const tape = recordTrack(track);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    latest().fail();
    latest().fail();
    latest().fail();
    expect(FakeRecorder.instances).toHaveLength(3);
    expect(await tape?.stop()).toBeNull();
  });
});

describe("recording a track", () => {
  it("hands back what was recorded, with the type the recorder actually used", async () => {
    const tape = recordTrack(track);
    expect(tape).not.toBeNull();
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:12"));
    const out = await tape?.stop();
    expect(out?.parts[0]?.blob.size).toBe(4096);
    expect(out?.parts[0]?.ext).toBe("webm");
    expect(out?.parts[0]?.ms).toBe(7000);
    expect(out?.parts[0]?.capped).toBe(false);
  });

  /* The order GPT Sol's review (item 1) was about: the caller releases the
     microphone the moment this promise resolves, so the recorder has to be
     inactive by then or the last second of audio is lost. */
  it("has stopped the recorder before it resolves", async () => {
    const tape = recordTrack(track);
    latest().emit(2048);
    vi.setSystemTime(new Date("2026-08-27T14:32:12"));
    let stateWhenResolved: string | null = null;
    await tape?.stop().then(() => {
      stateWhenResolved = latest().state;
    });
    expect(stateWhenResolved).toBe("inactive");
  });

  it("offers nothing when nothing was recorded", async () => {
    const tape = recordTrack(track);
    vi.setSystemTime(new Date("2026-08-27T14:32:12"));
    expect(await tape?.stop()).toBeNull();
  });

  /* A press immediately followed by a second press. No text, so the retention
     rule would keep it — but a fraction of a second of room tone explains
     nothing and must not be dressed up as evidence. */
  it("offers nothing for a recording too short to contain anything", async () => {
    const tape = recordTrack(track);
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:06"));
    expect(await tape?.stop()).toBeNull();
  });

  it("offers nothing when the recorder errored, however much it had collected", async () => {
    const tape = recordTrack(track);
    latest().emit(65_536);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    latest().fail();
    expect(await tape?.stop()).toBeNull();
  });

  it("throws it away on cancel, which is the ordinary case where dictation worked", async () => {
    const tape = recordTrack(track);
    latest().emit(65_536);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    tape?.cancel();
    expect(await tape?.stop()).toBeNull();
    expect(latest().state).toBe("inactive");
  });

  it("stops itself at the time cap, and says the file is only the beginning", async () => {
    const tape = recordTrack(track);
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:37:20"));
    /* Five minutes is where it used to stop, with no warning — Greg, spya-n8cuqq,
       2026-10-06: *"if there is going to be a cap, let's make it at least 15
       minutes."* Plan 261007b. */
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(latest().state, "it still stops at five minutes").toBe("recording");
    await vi.advanceTimersByTimeAsync(MAX_MS - 5 * 60_000);
    expect(latest().state).toBe("inactive");
    const out = await tape?.stop();
    expect(out?.parts[0]?.capped).toBe(true);
  });

  /* `audioBitsPerSecond` is a hint an encoder may exceed, so a bound derived
     from it is arithmetic rather than a guarantee. GPT Sol's plan review, item
     10 — and then his code review, item 4: a bound checked after the chunk is
     stored bounds nothing, because a delayed `dataavailable` can be any size.
     **Since 2026-09-29 the tape rotates at 80% of the bound**, so the only
     chunk that can reach it is one big enough to jump the gap by itself — a
     suspended tab's backlog — and that is a capture failure, said as such,
     never "everything was kept" over a discarded chunk. Plan 260929f, R6. */
  it("treats a chunk that would overflow one part as a capture failure, not a cap", async () => {
    const broke: number[] = [];
    const capped: number[] = [];
    const tape = recordTrack(track, {
      onBroken: () => broke.push(1),
      onCapped: () => capped.push(1),
    });
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    latest().emit(1_000_000);
    latest().emit(MAX_BYTES);
    expect(latest().state).toBe("inactive");
    expect(broke).toHaveLength(1);
    expect(capped).toHaveLength(0);
    // Nothing before the failure was complete, so there is nothing to offer.
    expect(await tape?.stop()).toBeNull();
  });
});

/* -------------------------------------------------------- the rotation --- */

/**
 * **A long dictation is cut into parts, not cut off.** Greg hit `[mic-full]`
 * two and a half minutes into a Feedback message, because one recording could
 * not grow past what one request may carry. Plan 260929f § Part B.
 */
describe("where the tape is cut", () => {
  it("keeps a chunk while the part is short and small", () => {
    expect(chunkVerdict({ ms: 0, bytes: 0 }, 14_000)).toBe("keep");
    expect(chunkVerdict({ ms: PART_MS - 1, bytes: PART_BYTES - 14_001 }, 14_000)).toBe("keep");
  });

  it("rotates at two minutes, whatever the size", () => {
    expect(PART_MS).toBe(120_000);
    expect(chunkVerdict({ ms: PART_MS, bytes: 10 }, 10)).toBe("rotate");
  });

  it("rotates at 80% of the per-part byte bound, whatever the time", () => {
    expect(PART_BYTES).toBe(Math.floor(MAX_BYTES * 0.8));
    expect(chunkVerdict({ ms: 1000, bytes: PART_BYTES - 10 }, 10)).toBe("rotate");
  });

  it("calls a chunk that would take one part past the bound an overflow, even at the rotation point", () => {
    expect(chunkVerdict({ ms: PART_MS, bytes: 0 }, MAX_BYTES + 1)).toBe("overflow");
    expect(chunkVerdict({ ms: 0, bytes: MAX_BYTES - 5 }, 6)).toBe("overflow");
    expect(chunkVerdict({ ms: 0, bytes: MAX_BYTES - 5 }, 5)).toBe("rotate");
  });
});

describe("recording in parts", () => {
  /** Talk for `ms` and hand over one chunk of `bytes` at the end of it. */
  function talk(ms: number, bytes: number) {
    vi.setSystemTime(Date.now() + ms);
    latest().emit(bytes);
  }

  it("starts the next recorder before it stops the last, on the same container, at two minutes", () => {
    FakeRecorder.supported = new Set(["audio/webm;codecs=opus"]);
    const parts: Array<[number, number]> = [];
    recordTrack(track, { onPart: (p, i) => parts.push([i, p.blob.size]) });
    const first = latest();
    talk(60_000, 1000);
    expect(FakeRecorder.instances).toHaveLength(1);
    talk(60_000, 1000);
    expect(FakeRecorder.instances).toHaveLength(2);
    const second = latest();
    // The second was recording before the first was asked to stop.
    expect(FakeRecorder.log).toEqual(["start 0", "start 1", "stop 0"]);
    expect(second.opts).toEqual(first.opts);
    expect(first.state).toBe("inactive");
    expect(second.state).toBe("recording");
    // Part one is handed over whole, at once, while part two carries on.
    expect(parts).toEqual([[0, 2000]]);
  });

  it("rotates on bytes long before two minutes when the encoder runs hot", () => {
    const parts: number[] = [];
    recordTrack(track, { onPart: (_p, i) => parts.push(i) });
    talk(10_000, PART_BYTES);
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(parts).toEqual([0]);
  });

  it("keeps the old recorder when the handoff will not start, then retries on the next chunk", async () => {
    const tape = recordTrack(track);
    const first = latest();
    vi.setSystemTime(Date.now() + PART_MS);
    FakeRecorder.failToStart = true;
    first.emit(1000);
    expect(first.state).toBe("recording");

    FakeRecorder.failToStart = false;
    vi.setSystemTime(Date.now() + 1000);
    first.emit(1000);
    expect(first.state).toBe("inactive");
    latest().emit(500);
    const out = await tape?.stop();
    expect(out?.broken).toBe(false);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([2000, 500]);
  });

  it("hands every part back at stop, in order, each its own file", async () => {
    const tape = recordTrack(track);
    talk(1000, 500);
    talk(PART_MS, 700); // part one closes here: 1200 bytes
    talk(1000, 300);
    talk(PART_MS, 400); // part two closes here: 700 bytes
    talk(5000, 900); // the tail
    const out = await tape?.stop();
    expect(out?.broken).toBe(false);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([1200, 700, 900]);
    expect(FakeRecorder.instances.every((r) => r.state === "inactive")).toBe(true);
  });

  /* `MIN_MS` exists so a double-press is not offered as evidence. Applied per
     part it would throw away a one-second tail after a rotation — the reader's
     last words. */
  it("keeps a tail shorter than the minimum when an earlier part exists", async () => {
    const tape = recordTrack(track);
    talk(PART_MS, 5000);
    talk(500, 800);
    const out = await tape?.stop();
    expect(out?.parts).toHaveLength(2);
    expect(out?.parts[1]?.blob.size).toBe(800);
    expect(out?.parts[1]?.ms).toBe(500);
  });

  it("leaves out a tail with no bytes in it, and the parts before it stand", async () => {
    const tape = recordTrack(track);
    talk(PART_MS, 5000);
    vi.setSystemTime(Date.now() + 300);
    const out = await tape?.stop();
    expect(out?.broken).toBe(false);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([5000]);
  });

  it("a part that fails while closing breaks the tape, and only the parts before it are offered", async () => {
    const broke: number[] = [];
    const tape = recordTrack(track, { onBroken: () => broke.push(1) });
    talk(PART_MS, 5000); // part one closes cleanly
    latest().failOnStop = true;
    talk(PART_MS, 6000); // part two rotates out, and its recorder errors instead of finishing
    expect(broke).toHaveLength(1);
    // Nothing records past a hole: part three was stopped with it.
    expect(FakeRecorder.instances.every((r) => r.state === "inactive")).toBe(true);
    const out = await tape?.stop();
    expect(out?.broken).toBe(true);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([5000]);
  });

  it("a tail that fails at the end offers the earlier parts, marked broken", async () => {
    const tape = recordTrack(track);
    talk(PART_MS, 5000);
    talk(1000, 900);
    latest().onstop = null; // the tail never finishes flushing
    const pending = tape?.stop();
    await vi.advanceTimersByTimeAsync(4000);
    const out = await pending;
    expect(out?.broken).toBe(true);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([5000]);
  });

  it("an oversize chunk after a rotation keeps what came before it, marked broken", async () => {
    const broke: number[] = [];
    const tape = recordTrack(track, { onBroken: () => broke.push(1) });
    talk(PART_MS, 5000);
    talk(60_000, MAX_BYTES + 1);
    expect(broke).toHaveLength(1);
    const out = await tape?.stop();
    expect(out?.broken).toBe(true);
    expect(out?.parts.map((p) => p.blob.size)).toEqual([5000]);
  });

  it("marks the last part capped when the whole dictation reaches its ceiling", async () => {
    const capped: number[] = [];
    const tape = recordTrack(track, { onCapped: () => capped.push(1) });
    talk(PART_MS, 5000);
    talk(PART_MS, 5000);
    talk(59_000, 5000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(capped, "the ceiling is still five minutes").toHaveLength(0);
    await vi.advanceTimersByTimeAsync(MAX_MS - 5 * 60_000);
    expect(capped).toHaveLength(1);
    const out = await tape?.stop();
    expect(out?.parts.map((p) => p.capped)).toEqual([false, false, true]);
  });

  /* The ceiling is a timer, and a timer in a throttled tab or on a laptop that
     slept fires late. The strip's countdown reads the wall clock, so without
     this it sits at 0:00 over a microphone that is still on. Same rule as
     rotation: decided when the recorder hands over a chunk. GPT Sol's plan
     review of 261007b, P5. */
  it("caps on the first chunk past the deadline when the timer is late, and only once", async () => {
    const capped: number[] = [];
    const tape = recordTrack(track, { onCapped: () => capped.push(1) });
    expect(tape?.endsAt).toBe(Date.now() + MAX_MS);
    talk(PART_MS, 5000);
    expect(capped).toHaveLength(0);
    /* The clock passes the deadline with no timer having run. */
    talk(MAX_MS, 5000);
    expect(capped).toHaveLength(1);
    /* The recorders were told to stop; their closing chunks still arrive. */
    talk(1000, 100);
    expect(capped, "a second chunk past the deadline capped it again").toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MAX_MS);
    expect(capped, "the late timer capped it a second time").toHaveLength(1);
    const out = await tape?.stop();
    expect(out?.parts.at(-1)?.capped).toBe(true);
  });

  it("sends nothing onward after a cancel", async () => {
    const parts: number[] = [];
    const tape = recordTrack(track, { onPart: (_p, i) => parts.push(i) });
    talk(60_000, 5000);
    tape?.cancel();
    talk(PART_MS, 5000);
    expect(parts).toEqual([]);
    expect(await tape?.stop()).toBeNull();
  });
});

describe("recording a track, continued", () => {
  /* A recorder that never fires `stop` leaves us holding chunks with the last
     piece missing. The wait has to end so the microphone can be released, but
     what it was holding is not a finished file and must not be offered as one.
     GPT Sol's code review, item 3. */
  it("offers nothing when the recorder never finished flushing", async () => {
    const broke: number[] = [];
    const tape = recordTrack(track, { onBroken: () => broke.push(1) });
    latest().emit(65_536);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    // A recorder that goes inactive and simply never fires `onstop`.
    latest().onstop = null;
    const pending = tape?.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toBeNull();
    expect(broke).toEqual([1]);
  });

  it("never stops the track it was given", async () => {
    let stops = 0;
    const t = { readyState: "live", stop: () => stops++ } as unknown as MediaStreamTrack;
    const tape = recordTrack(t);
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    await tape?.stop();
    expect(stops).toBe(0);
  });
});

describe("when there is no recorder to be had", () => {
  it("returns null rather than throwing, on a browser without MediaRecorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(recordTrack(track)).toBeNull();
  });

  it("returns null when the recorder refuses to be built", () => {
    FakeRecorder.failToConstruct = true;
    expect(recordTrack(track)).toBeNull();
  });

  it("returns null when the recorder refuses to start", () => {
    FakeRecorder.failToStart = true;
    expect(recordTrack(track)).toBeNull();
  });
});
