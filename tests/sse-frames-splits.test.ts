/**
 * `sseFrames`, driven through **every possible chunk split** — tools/overseer/source.ts.
 *
 * ## Why a whole file for one property
 *
 * This parser has now been wrong about packetization twice, in opposite
 * directions: once by checking its size bound against a whole chunk (so four
 * small valid frames in one TCP segment were an overflow), and once by counting
 * a half-arrived terminator against the frame body (so the same bytes passed or
 * failed depending on where the split fell). Both were found by GPT Sol reading
 * it, not by a test — because every test pushed one tidy frame per `push`, and
 * a real socket does no such thing.
 *
 * On 2026-09-10 it was rewritten again, to accept the bare-CR line endings the
 * HTML Standard permits, by normalising line endings on the way in and holding
 * back a trailing `\r` until the next chunk says whether it was a line ending or
 * half a CRLF. That is exactly the kind of change that is right for every input
 * somebody thought of.
 *
 * So the property, rather than more examples: **how a stream is cut into chunks
 * must not change what comes out of it.** For each stream below, the whole thing
 * in one push is the oracle, and every single-cut and every double-cut is
 * checked against it. That is O(n²) pushes of very short strings — a few
 * thousand, milliseconds — and it covers the splits nobody would think to write
 * down, including the ones inside a `\r\n` and inside a `data:` field name.
 */
import { describe, expect, test } from "vitest";

import { sseFrames, type SseFrame } from "../tools/overseer/source.js";

/** Every prefix/suffix cut, and every pair of cuts. */
function splits(text: string): string[][] {
  const out: string[][] = [[text]];
  for (let i = 1; i < text.length; i += 1) {
    out.push([text.slice(0, i), text.slice(i)]);
    for (let j = i + 1; j < text.length; j += 1) {
      out.push([text.slice(0, i), text.slice(i, j), text.slice(j)]);
    }
  }
  return out;
}

function drain(chunks: string[], maxChars: number): { frames: SseFrame[]; threw: string | null } {
  const parser = sseFrames(maxChars);
  const frames: SseFrame[] = [];
  try {
    for (const chunk of chunks) frames.push(...parser.push(chunk));
  } catch (cause) {
    return { frames, threw: cause instanceof Error ? cause.message : String(cause) };
  }
  return { frames, threw: null };
}

const STREAMS: { name: string; text: string }[] = [
  { name: "LF, two frames", text: 'event: snapshot\ndata: {"a":1}\n\nevent: ping\ndata: 2\n\n' },
  { name: "CRLF, two frames", text: 'event: snapshot\r\ndata: {"a":1}\r\n\r\nevent: ping\r\ndata: 2\r\n\r\n' },
  { name: "bare CR, two frames", text: 'event: snapshot\rdata: {"a":1}\r\revent: ping\rdata: 2\r\r' },
  { name: "mixed endings in one frame", text: "event: ping\r\ndata: 1\rdata: 2\ndata: 3\n\n" },
  { name: "a comment line and a field with no colon", text: ": keep-alive\nevent: ping\ndata\ndata: 2\n\n" },
  { name: "an empty data field, then a real one", text: "event: ping\ndata:\n\nevent: ping\ndata: 2\n\n" },
  { name: "a data value that itself contains a colon", text: "event: snapshot\ndata: {\"at\":\"12:30\"}\n\n" },
];

describe("however the stream is cut, the frames are the same", () => {
  for (const { name, text } of STREAMS) {
    test(name, () => {
      const whole = drain([text], 4096);
      // A sanity floor: the oracle itself must have parsed something, or this
      // test would be comparing two empty answers and passing.
      expect(whole.threw).toBeNull();
      expect(whole.frames.length).toBeGreaterThan(0);

      for (const chunks of splits(text)) {
        const got = drain(chunks, 4096);
        expect(got.threw, `split ${JSON.stringify(chunks)}`).toBeNull();
        expect(got.frames, `split ${JSON.stringify(chunks)}`).toEqual(whole.frames);
      }
    });
  }

  test("a frame ending in a bare CR is delivered at once, not held for the next byte", () => {
    /* **THE FIRST IMPLEMENTATION HELD IT, and that was wrong** — found by GPT
       Sol reviewing the code, 2026-09-10, after the same reviewer had asked for
       the CR support in the first place.

       The reasoning that produced the bug is seductive: `\r` and `\r\n` are one
       line ending each, so a chunk ending in `\r` looks unresolved. But the
       ambiguity is only ever about whether a FOLLOWING `\n` is a second line
       ending — never about whether this one ended a line. `data: 1\r\r` is a
       line and then an empty line, which dispatches, and `data: 1\r\r\n`
       dispatches at exactly the same point. Holding it delayed every frame of a
       CR-only stream by one chunk and **lost the last one entirely** if the
       stream then ended, which is the failure this whole plan is about wearing
       a very small hat. */
    expect(sseFrames(64).push("event: ping\rdata: 1\r\r")).toEqual([{ event: "ping", data: "1" }]);

    // And the split that made it tempting, still handled: a CRLF cut in half is
    // one line ending, so this is the same frame and not two.
    const split = sseFrames(64);
    expect(split.push("event: ping\rdata: 1\r")).toEqual([]);
    expect(split.push("\n\r\n")).toEqual([{ event: "ping", data: "1" }]);
  });
});

describe("and the size bound judges the same bytes the same way", () => {
  test("across every split, at a bound the stream sits exactly on", () => {
    /* The second historical bug, as a property. `data: xx` is eight characters,
       so at a bound of eight it is acceptable and one more is not — and that
       verdict must not depend on which side of the terminator a chunk boundary
       falls, in any of the three line-ending styles. */
    for (const ending of ["\n\n", "\r\n\r\n", "\r\r"]) {
      for (const chunks of splits(`data: xx${ending}`)) {
        expect(drain(chunks, 8).threw, `ok, ${JSON.stringify(chunks)}`).toBeNull();
      }
      for (const chunks of splits(`data: xxx${ending}`)) {
        expect(drain(chunks, 8).threw, `refused, ${JSON.stringify(chunks)}`).toMatch(/8 characters/);
      }
    }
  });
});
