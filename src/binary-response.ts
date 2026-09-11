/**
 * **Writing a response whose body is bytes** — the mechanics six routes share,
 * and none of their policies. docs/plans/260911e-one-binary-response-writer.md.
 *
 * The six are the original PDF (`sendSource`), an Illustrated plate
 * (`sendPlate`), an article's own picture for its owner (`sendArticleAsset`),
 * the export zip (`sendExport`) and a feedback screenshot, all in
 * src/routes.ts, and the same picture for a stranger (`sendBytes`,
 * src/public/routes.ts). Every one of them wrote the same four things by hand,
 * and those four are what live here:
 *
 *  - **status 200** — the caller has the bytes in hand by the time it calls,
 *    so every refusal has already become its own status upstream;
 *  - **`X-Content-Type-Options: nosniff`** — these are a stranger's file, a
 *    model's picture or a zip of the reader's prose, served from our own
 *    origin, and a wrong content type is the one place that becomes script;
 *  - **`Content-Length` from the bytes being written**, not a stored count and
 *    not a character count: the two agree whenever both exist, and this one is
 *    true when they do not;
 *  - the body, or on a HEAD, none.
 *
 * **What is deliberately not here** is everything that differs between the six
 * and is a decision rather than a mechanism: whether the caller may see the
 * bytes, which storage key they came from, which manifest entry named them,
 * the disposition, the cache policy and every error status. Those stay in each
 * caller, beside the comment that says why — the disposition and the cache
 * policy as the caller's own `setHeader` lines, written just before it calls
 * here. The content type is passed in rather than set by the caller only
 * because every one of the six has one; which one is still the caller's.
 *
 * **Not a `policy` object, which the first version took.** A closed-looking
 * `{ "Cache-Control"?, "Content-Disposition"? }` enumerated into `setHeader` is
 * not closed: TypeScript checks excess keys only on a fresh literal, so a
 * policy built elsewhere could carry `Content-Type` past it, or a key whose
 * value is `undefined` and makes Node throw — and the loop was a branch the
 * stage had promised not to add. GPT Sol, 2026-09-11. Plain `setHeader` at the
 * caller has neither problem.
 *
 * **HEAD is a second function, not a flag**, because answering HEAD is itself
 * a policy. Only the public route answers one; the authenticated dispatcher has
 * no HEAD at all (src/routes.ts § `AuthRouteMethod`). A `head: boolean` on one
 * writer would put the choice at every call site, one mistyped `true` from
 * serving a HEAD the router never meant to; as a separate export, a route that
 * never imports it cannot answer one.
 *
 * A leaf, importing nothing but a type: the public graph may not reach
 * src/routes.ts or the owner's stores (tests/public-imports.test.ts), and this
 * is imported from both sides of that line.
 */

import type { ServerResponse } from "node:http";

/** One binary answer: its bytes and what they are. Nothing else is the writer's. */
export interface BinaryReply {
  bytes: Uint8Array;
  contentType: string;
}

/* Straight-line, and written **after** the caller's own headers, so a caller
   that set one of these by mistake is overwritten rather than obeyed. */
function writeHeaders(res: ServerResponse, reply: BinaryReply): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", reply.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", String(reply.bytes.byteLength));
}

/** Answer a GET with these bytes. The caller's policy headers are already set. */
export function sendBinary(res: ServerResponse, reply: BinaryReply): void {
  writeHeaders(res, reply);
  res.end(Buffer.from(reply.bytes));
}

/**
 * **Answer a HEAD exactly as the GET would be answered, without the body** —
 * `Content-Length` included. Node drops a HEAD's body on a real socket of its
 * own accord, but it drops the length too, and an unfurler that HEADs a URL to
 * decide whether to fetch it learns nothing from a missing length. Relying on
 * Node would also be untestable: the fake response every route test uses has no
 * suppression, so the truth would live somewhere no test reached.
 * src/public/routes.ts § `send` has the measurement.
 *
 * Only for a route whose policy is to answer HEAD. Today that is one.
 */
export function sendBinaryHead(res: ServerResponse, reply: BinaryReply): void {
  writeHeaders(res, reply);
  res.end();
}
