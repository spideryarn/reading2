/**
 * The clock on a client-side SSE stream — see src/web/lib/sse.ts.
 *
 * The bug these exist for: **a stream can stop without ending.** A TCP
 * connection that has gone away without being closed delivers no bytes and no
 * error, so `reader.read()` neither resolves nor rejects and a `for await` over
 * it waits for ever. There is no event to hang a failure on, which is why the
 * panel spun on "thinking…" until the tab was closed. Found in a browser pass
 * on 2026-08-26; see docs/plans/chat-mode.md.
 *
 * Real timers and tiny numbers throughout, deliberately. The thing under test
 * is a race between a read and a timeout, and fake timers replace exactly the
 * half of it that matters.
 */
import { describe, expect, it } from "vitest";
import { readEvents, StreamStalled } from "../src/web/lib/sse.js";

const enc = new TextEncoder();

/** One frame, and then the same silence. What a dead socket *mid-answer* looks like. */
function spokeThenSilent(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('event: begin\ndata: {"id":"one"}\n\n'));
    },
  });
}

function chunks(pieces: string[], gapMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(c) {
      for (const piece of pieces) {
        await new Promise((r) => setTimeout(r, gapMs));
        c.enqueue(enc.encode(piece));
      }
      c.close();
    },
  });
}

async function drain(
  body: ReadableStream<Uint8Array>,
  stallMs?: number,
): Promise<{ name: string; data: unknown }[]> {
  const seen: { name: string; data: unknown }[] = [];
  for await (const e of readEvents(body, stallMs === undefined ? {} : { stallMs })) seen.push(e);
  return seen;
}

describe("a stream that stops without ending", () => {
  it("throws StreamStalled once the silence passes stallMs", async () => {
    await expect(drain(spokeThenSilent(), 25)).rejects.toBeInstanceOf(StreamStalled);
  });

  it("reports the silence in whole seconds, for the reader-facing message", async () => {
    const err = await drain(spokeThenSilent(), 1_400).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamStalled);
    expect((err as StreamStalled).seconds).toBe(1);
  });

  /* The bug itself, kept as a test rather than as a sentence. Without a clock
     the loop below never settles — so the only thing that can be asserted is
     that it has not, which is precisely the complaint. */
  it("waits for ever when there is no clock", async () => {
    let settled = false;
    void drain(spokeThenSilent()).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(settled).toBe(false);
  });

  /* And the deliberate hole in it, asserted rather than assumed. A stream that
     has not said anything *yet* is not a stream that has stopped: an
     intermediary that ignores `X-Accel-Buffering: no` holds the whole body,
     heartbeats included, and delivers it at the end. Clocking that would kill a
     response that was going to arrive, having learnt nothing except that the
     reader is behind an old proxy. The clock arms on the first byte. */
  it("does not clock a stream that has not started, which is what buffering looks like", async () => {
    /* `pull` counted, and asserted, because "not settled yet" on its own is
       also what an implementation that never reads at all would look like —
       which would pass this test while breaking every other case. */
    let pulls = 0;
    const waiting = new ReadableStream<Uint8Array>({
      pull() {
        pulls++;
      },
    });
    let settled = false;
    void drain(waiting, 25).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(pulls).toBeGreaterThan(0);
    expect(settled).toBe(false);
  });
});

describe("heartbeats", () => {
  /* The point of the whole design: the clock is on *bytes*, not on frames. A
     heartbeat is an SSE comment and `parseFrame` drops it, so a timer in the
     caller's `for await` loop would never see the one thing proving the
     connection is alive. Five beats at 15ms is 75ms of a 40ms clock. */
  it("keep a quiet stream alive without becoming events", async () => {
    const beats = [": ping\n\n", ": ping\n\n", ": ping\n\n", ": ping\n\n", ": ping\n\n"];
    const seen = await drain(
      chunks([...beats, 'event: done\ndata: {"ok":true}\n\n'], 15),
      40,
    );
    expect(seen).toEqual([{ name: "done", data: { ok: true } }]);
  });
});

describe("what the clock does not break", () => {
  it("still reassembles a frame split across two reads", async () => {
    const seen = await drain(chunks(['event: delta\ndata: {"te', 'xt":"hi"}\n\n'], 5), 500);
    expect(seen).toEqual([{ name: "delta", data: { text: "hi" } }]);
  });

  it("still ends cleanly when the server closes the stream", async () => {
    const seen = await drain(chunks(['event: done\ndata: {"n":1}\n\n'], 5), 500);
    expect(seen).toEqual([{ name: "done", data: { n: 1 } }]);
  });

  /* A caller that stops reading early used to release the lock and leave the
     body live — the socket stays open and the browser goes on receiving an
     answer nobody is reading. The generator's `finally` now cancels it. */
  it("cancels the body when the caller breaks out of the loop", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of readEvents(body, { stallMs: 500 })) break;
    expect(cancelled).toBe(true);
  });
});
