/**
 * Server-sent events off a `fetch` body, for whatever in the client is waiting
 * on one.
 *
 * Written for chat and moved here unchanged when explanations started streaming
 * too — see docs/plans/explain-deeper-answers.md § 2. It knows nothing about
 * threads, comments or articles: it turns bytes into named frames, and the
 * meaning of the names belongs to the caller.
 *
 * The server half is `sse` in src/routes.ts; the OpenRouter half, which parses
 * a different SSE dialect, is `sseChunks` in src/openrouter-stream.ts.
 */
export interface ServerEvent {
  name: string;
  data: unknown;
}

/**
 * Server-sent events off a `fetch` body.
 *
 * The mirror of `sseChunks` in src/converse.ts, and it has the same three
 * traps — a frame split across two reads, blank lines between frames, and the
 * fact that a `data:` line is not necessarily JSON. The difference is that
 * frames here are separated by a **blank line** and carry an `event:` name, so
 * the split is on `\n\n` rather than on `\n`.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; anything after the last one is a
      // partial frame and waits for the next read.
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        cut = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseFrame(frame: string): ServerEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  try {
    return { name, data: JSON.parse(data.join("\n")) };
  } catch {
    // A frame we cannot read loses a few words rather than the answer. Same
    // judgement as the server side, and for the same reason.
    return null;
  }
}
