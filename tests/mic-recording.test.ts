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
 * docs/plans/microphone-device-and-recording.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extFor,
  formatDuration,
  pickMimeType,
  recordTrack,
  recordingFilename,
} from "../src/web/mic-recording.js";

/* ------------------------------------------------------------- the fake -- */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static failToConstruct = false;
  static failToStart = false;
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    if (FakeRecorder.failToConstruct) throw new Error("nope");
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }
  start() {
    if (FakeRecorder.failToStart) throw new Error("nope");
    this.state = "recording";
  }
  /** Synchronous `onstop`, so `halt()` never has to fall through to its timeout. */
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }
  /* -- test helpers -- */
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  fail() {
    this.onerror?.();
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
  FakeRecorder.failToConstruct = false;
  FakeRecorder.failToStart = false;
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal("MediaRecorder", FakeRecorder);
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

/* ------------------------------------------------------- the lifecycle --- */

describe("recording a track", () => {
  it("hands back what was recorded, with the type the recorder actually used", async () => {
    const tape = recordTrack(track);
    expect(tape).not.toBeNull();
    latest().emit(4096);
    vi.setSystemTime(new Date("2026-08-27T14:32:12"));
    const out = await tape?.stop();
    expect(out?.blob.size).toBe(4096);
    expect(out?.ext).toBe("webm");
    expect(out?.ms).toBe(7000);
    expect(out?.capped).toBe(false);
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
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(latest().state).toBe("inactive");
    const out = await tape?.stop();
    expect(out?.capped).toBe(true);
  });

  /* `audioBitsPerSecond` is a hint an encoder may exceed, so a bound derived
     from it is arithmetic rather than a guarantee. GPT Sol's plan review, item
     10 — and then his code review, item 4: the first version stored the chunk
     and *then* noticed it had gone over, which bounds nothing at all, because a
     delayed `dataavailable` can be any size. The chunk that would overflow is
     refused, so the blob is genuinely never bigger than the cap. */
  it("bounds what it actually holds, refusing the chunk that would overflow", async () => {
    const MAX = 8 * 1024 * 1024;
    const tape = recordTrack(track);
    /* The clock moves first: the cap stops the recorder inside `emit`, and
       `endedAt` is stamped there — so a test that advanced afterwards would be
       measuring a zero-length recording and getting `null` for the right
       reason and the wrong one. */
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    latest().emit(4 * 1024 * 1024);
    latest().emit(5 * 1024 * 1024);
    expect(latest().state).toBe("inactive");
    const out = await tape?.stop();
    expect(out?.capped).toBe(true);
    expect(out?.blob.size).toBe(4 * 1024 * 1024);
    expect(out?.blob.size).toBeLessThanOrEqual(MAX);
  });

  /* A recorder that never fires `stop` leaves us holding chunks with the last
     piece missing. The wait has to end so the microphone can be released, but
     what it was holding is not a finished file and must not be offered as one.
     GPT Sol's code review, item 3. */
  it("offers nothing when the recorder never finished flushing", async () => {
    const tape = recordTrack(track);
    latest().emit(65_536);
    vi.setSystemTime(new Date("2026-08-27T14:32:20"));
    // A recorder that goes inactive and simply never fires `onstop`.
    latest().onstop = null;
    const pending = tape?.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toBeNull();
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
