/**
 * **The one size guard: read a body, counting as we go, and stop at the cap.**
 *
 * Two callers and one counter, since 2026-10-04: a stranger's server answering
 * a fetch (`readCapped` in src/fetch.ts) and our own Storage handing back an
 * object (`get` in src/store/blobs-supabase.ts). Until then the second read the
 * whole body with `arrayBuffer()` and checked its length afterwards, which is a
 * cap on what we keep and not on what we buffer. Greg, 2026-10-04: "make them
 * consistent (and perhaps reuse the same protection-machinery)" —
 * docs/plans/261004k-one-size-limit-for-an-upload-and-an-address.md.
 *
 * The counting is the point. By the time bytes reach here they are already
 * decompressed (undici does that), so this caps the size that actually matters
 * rather than the size a header advertised. `cancel()` closes the socket rather
 * than politely draining however many gigabytes are still coming.
 *
 * **A refusal, never a truncation.** Over the cap it throws what `tooLarge`
 * builds; it does not hand back a prefix, because a prefix of a PDF is a
 * corrupt PDF that hashes to something plausible.
 *
 * A leaf: no imports, so either side may use it without learning about the
 * other's errors. The caller says what "too large" is in its own vocabulary.
 *
 * @param tooLarge the error to throw, given the count at the moment it went
 *   over — a lower bound on the real size, since nothing after it is read.
 */
export async function readStreamCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLarge: (seenBytes: number) => Error,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge(total);
      chunks.push(value);
    }
  } catch (err) {
    /* Every way out of that loop except a clean finish leaves a socket open —
       going over the cap, and also the read itself failing mid-body, which is
       the one easy to forget. Cancelling twice is harmless; not cancelling
       leaves the server streaming into nothing. */
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    /* Without this the stream stays locked after we are done with it, so
       nothing else can ever read or cancel it. */
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
