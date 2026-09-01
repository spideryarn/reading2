/**
 * Sending a PDF from the browser to the object store, **without it passing
 * through our server**.
 *
 * That is not an optimisation, it is the only thing that works. A Vercel
 * function refuses a request body over 4.5 MB — flat, unraisable, the same on
 * Node, Edge and Fluid — and two of the three PDFs in this project's own eval
 * set are bigger than that. So the shape is:
 *
 *     POST /api/uploads   {filename, bytes, sha256}   ~200 bytes of JSON to us
 *     PUT  <signed url>   the whole file              straight to Storage
 *     POST /api/jobs      {uploadId}                  ~60 bytes of JSON to us
 *
 * The middle step carries **no credentials at all** — no bearer token, no API
 * key. The grant is in the URL, it is bound to one path that our server chose,
 * and it lasts two hours. See docs/plans/260826u-pdf-upload-and-storage.md § What was
 * measured, not read.
 *
 * ## Why `XMLHttpRequest` in 2026
 *
 * Because `fetch` still cannot report **upload** progress. It can stream a
 * response body and not a request one, and a 50 MB file over a domestic
 * connection is tens of seconds of a reader looking at nothing. `xhr.upload.
 * onprogress` is the only way to know, and it has been for a decade. This is
 * the one place in the client that uses it, and this paragraph is why.
 */

import { apiFetch, readJson } from "./lib/api.js";
import { recordLog } from "./log-buffer.js";

/** How far along, in bytes. `total` is the file's size, not the request's. */
export interface UploadProgress {
  sent: number;
  total: number;
}

/** What `POST /api/uploads` hands back. */
interface Grant {
  uploadId: string;
  url: string;
  expiresAt: string;
  /** The slug this will probably get — a preview, the way the URL box previews one. */
  slug: string;
}

/**
 * The SHA-256 of a file, as lower-case hex.
 *
 * **This is a checksum of the transfer, not an identity.** The server hashes
 * what actually arrives and compares; it never takes this as a statement about
 * which document it is holding. That distinction is the difference between a
 * corruption check and a capability — a claimed hash that skipped the upload
 * would let anyone who knows a hash claim somebody else's document, which is
 * the sharpest thing either review of this design found.
 *
 * `crypto.subtle` needs a secure context, which `localhost` and `https` both
 * are and a plain-`http` LAN address is not. Nothing in this app is served over
 * plain http to another machine, and if it ever is, this is where it fails.
 */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * PUT the bytes, reporting progress, and resolve only when Storage has them.
 *
 * Every one of the four handlers below is load-bearing. `onload` fires for a
 * 4xx as well as a 2xx — an XHR that reached the server "succeeded" as far as
 * XHR is concerned — so a version without the status check reports a refused
 * upload as a finished one, which is the [silent success](../../docs/reusable/silent-success.md)
 * this repo keeps writing up. `onerror` is a network failure with no status at
 * all, `onabort` is the reader cancelling, and `ontimeout` cannot happen
 * because no timeout is set — deliberately, since the whole point is that this
 * request may take minutes.
 */
function put(
  url: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    /* **Before anything else.** An `AbortSignal` does not replay: a signal that
       fired between the grant request settling and this line has no event left
       to deliver, so the listener below never runs and 50 MB goes up after the
       reader pressed stop. Asking `aborted` is the only way to see an abort
       that has already happened. */
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    /* **This request is invisible to `lib/api.ts`.** It is an `XMLHttpRequest`
       to the object store, not an `apiFetch`, so nothing in the ring buffer
       would ever mention a 50 MB upload that failed halfway — and "I tried to
       add a PDF and nothing happened" is precisely the report this feature
       exists to receive. The URL is deliberately not recorded: it is a signed
       grant, and a grant in a bug report is a credential in a bug report.
       See src/web/log-buffer.ts. */
    const started = Date.now();
    const note = (
      phase: "start" | "done" | "failed" | "aborted" | "transport-failed",
      status: number | null,
    ): void => {
      recordLog({ kind: "upload", phase, status, bytes: file.size, ms: Date.now() - started });
    };
    note("start", null);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    /* The bucket's allowlist checks this, and it is the *claimed* type — which
       is why the server checks the bytes afterwards. Sending it means a
       mislabelled file is refused at the door rather than after 50 MB. */
    xhr.setRequestHeader("Content-Type", "application/pdf");

    xhr.upload.onprogress = (e) => {
      /* `lengthComputable` is false for a chunked or compressed body, and then
         `e.total` is 0 — a bar driven straight off it would sit at zero for the
         whole upload and then jump. The file's own size is the honest total. */
      onProgress?.({ sent: e.loaded, total: e.lengthComputable ? e.total : file.size });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        note("done", xhr.status);
        resolve();
        return;
      }
      /* `realStatus`, not `xhr.status` — a duplicate arrives as HTTP 400 with
         `{"statusCode":"409"}` in the body, and a log that recorded the response
         line would send whoever reads it looking at permissions. */
      note("failed", realStatus(xhr));
      /* Storage's own words are deliberately not shown to the reader — the same
         rule src/messages.ts states, and the same reason: a provider's error
         text is not ours to publish and is usually meaningless to a person. The
         status is enough to look it up. */
      console.error("upload failed", xhr.status, xhr.responseText.slice(0, 400));
      reject(new Error(uploadFailure(realStatus(xhr))));
    };
    xhr.onerror = () => {
      note("transport-failed", null);
      reject(new Error(NETWORK_FAILED));
    };
    xhr.onabort = () => {
      note("aborted", null);
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * The status Storage actually meant, which is **not** the one on the response
 * line.
 *
 * Measured: a duplicate comes back as HTTP **400** with `{"statusCode":"409"}`
 * in the body, and a missing object as HTTP 400 with `"404"`. So `xhr.status`
 * alone reports a duplicate as a bad request, and this file would have told a
 * reader their permission had run out when their file was already there.
 * src/store/blobs-supabase.ts does exactly this on the server and this did not,
 * which is the shape worth noticing: one half of a pair knowing something the
 * other half does not. GPT Sol, 2026-08-27.
 */
function realStatus(xhr: XMLHttpRequest): number {
  try {
    const stated = Number((JSON.parse(xhr.responseText) as { statusCode?: string }).statusCode);
    if (Number.isFinite(stated) && stated > 0) return stated;
  } catch {
    /* Not JSON at all — a proxy's HTML, a captive portal. The response line is
       then the only thing there is, and it is the honest answer. */
  }
  return xhr.status;
}

/**
 * The sentence for a refusal from Storage rather than from us.
 *
 * Three of these the reader can act on and the rest they cannot, which is the
 * only distinction worth drawing in the copy. The bracketed codes follow
 * docs/project/copy.md so a reader can quote four characters — and they are
 * `st-` rather than `up-` because these come from the object store, not from
 * our API, and that is the first thing anybody debugging one needs to know.
 */
function uploadFailure(status: number): string {
  if (status === 409) {
    return "That file has already been sent. Choose it again to start over. [st-dup]";
  }
  if (status === 413) {
    return "The file store refused that as too large. A smaller PDF will work. [st-big]";
  }
  if (status === 415) {
    return "The file store would not take that as a PDF. Saving it again from a PDF reader usually produces one it will. [st-type]";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "Permission to send that file had run out. Choose it again — it takes a moment and then works. [st-grant]";
  }
  return `The file store would not take that file (${status}). Trying again in a minute usually works. [st-fail]`;
}

const NETWORK_FAILED =
  "The upload stopped before it finished — that is usually the connection rather than the file. Try again. [st-net]";

/**
 * Choose a file, and end up with an upload id the queue can be pointed at.
 *
 * It deliberately does **not** queue anything. The reader is still on the shelf
 * with the file in their browser's memory, and the page that owns an ingest is
 * `/add/upload/<id>` — which has an address, so it can be reloaded and sent.
 * Doing both here would mean the bytes and the job were started from a page
 * with no way back to either.
 */
export async function uploadPdf(
  file: File,
  options: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<Grant> {
  const sha256 = await sha256Hex(file);
  const grant = await readJson<Grant>(
    await apiFetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, bytes: file.size, sha256 }),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  await put(grant.url, file, options.onProgress, options.signal);
  return grant;
}
