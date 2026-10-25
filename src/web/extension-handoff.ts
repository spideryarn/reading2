/**
 * **Ask Spideryarn's Chrome extension for the page it captured**, from
 * `/add-from-extension` (AddFromExtension.tsx).
 *
 * The extension cannot push to a page, so this page asks
 * (`chrome.runtime.sendMessage`), and only Chrome lets it: the extension's
 * manifest names our origin in `externally_connectable`, and a page on any
 * other origin has no `sendMessage` to call. The extension then checks that
 * the asker is the top frame of the tab it opened for this capture, here.
 * docs/plans/261024q-chrome-extension-one-click-add-the-page.md.
 *
 * **What comes back is treated as a file the reader chose**: a string made
 * into a `File` and handed to the upload, which is all a reader can do with any
 * file. Nothing in it runs here and nothing in it is shown.
 *
 * **Only the ids named here are asked**, never one from the address: any
 * extension can name our origin in `externally_connectable` without a
 * permission warning, so an id taken from a link would let one the reader
 * installed for something else hand us a page.
 */
import { MAX_UPLOAD_BYTES } from "../uploads.js";
import { savedSource } from "../urls.js";

/**
 * The store's id for the published extension, once Greg has created the item
 * (the store assigns it then; until then there is none, and production asks
 * nobody). docs/user-feedback/questions/ has the steps.
 *
 * **Setting it is the whole change**: every place that points a reader at the
 * extension takes its link from `EXTENSION_STORE_URL` below and draws nothing
 * of it while this is `null` (plan 261025b). The id lives here only;
 * docs/project/chrome-extension.md points at this line rather than copying it.
 */
export const PRODUCTION_EXTENSION_ID: string | null = null;

/** The store's page for an item: Chromium builds it as this prefix plus the id. */
export function extensionStoreUrl(id: string | null): string | null {
  return id === null ? null : `https://chromewebstore.google.com/detail/${id}`;
}

/** Where a reader installs the extension, or `null` while there is no item. */
export const EXTENSION_STORE_URL: string | null = extensionStoreUrl(PRODUCTION_EXTENSION_ID);

/** extension/manifest.ts § `DEV_EXTENSION_ID`, held equal by
 *  tests/extension-handoff.test.ts. Trusted only by a dev build of this app,
 *  because its key is public and anybody can load an extension with it. */
export const DEV_EXTENSION_ID = "mgaelddegjfaooojhjaijcnkambbcaea";

/** extension/src/handoff.ts § `TAKE`, held equal by the same test. */
export const TAKE = "spideryarn.take";

/** The ids this build asks, in order. */
export function trustedExtensionIds(dev: boolean): string[] {
  const ids: string[] = [];
  if (PRODUCTION_EXTENSION_ID !== null) ids.push(PRODUCTION_EXTENSION_ID);
  if (dev) ids.push(DEV_EXTENSION_ID);
  return ids;
}

/** How long one extension has to answer. A 50 MB page took 1.7 s in the spike. */
const ANSWER_MS = 20_000;

export type Taken =
  /** The page, as a file to upload, and the address it says it was saved from
   *  (checked by `savedSource`; `null` when it gave none or one that fails). */
  | { kind: "page"; file: File; savedFrom: string | null }
  /** No extension we trust answered: not installed, disabled, or another browser. */
  | { kind: "no-extension" }
  /** It answered, with nothing for this tab: already taken, expired, or never captured. */
  | { kind: "nothing" };

/** The part of `chrome.runtime` a page on an `externally_connectable` origin gets. */
export type SendMessage = (extensionId: string, message: unknown) => Promise<unknown>;

/** `chrome.runtime.sendMessage`, or `undefined` when this browser offers none to this page. */
export function pageSendMessage(): SendMessage | undefined {
  const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime;
  const send = runtime?.sendMessage;
  if (typeof send !== "function") return undefined;
  return (id, message) => (send as SendMessage).call(runtime, id, message);
}

/** Ask each trusted id in turn; the first that answers decides. */
export async function takeFromExtension(
  ids: readonly string[],
  send: SendMessage | undefined,
): Promise<Taken> {
  if (send === undefined) return { kind: "no-extension" };
  for (const id of ids) {
    let reply: unknown;
    try {
      reply = await withTimeout(send(id, { type: TAKE }), ANSWER_MS);
    } catch {
      /* Not installed under this id ("Could not establish connection"), or too slow. */
      continue;
    }
    return asTaken(reply);
  }
  return { kind: "no-extension" };
}

/**
 * The reply, checked: a page is a string within the upload cap and a short
 * file name ending `.html`; anything else is nothing.
 */
export function asTaken(reply: unknown): Taken {
  if (typeof reply !== "object" || reply === null) return { kind: "nothing" };
  const r = reply as { kind?: unknown; html?: unknown; filename?: unknown; savedFrom?: unknown };
  if (r.kind !== "page" || typeof r.html !== "string" || typeof r.filename !== "string") {
    return { kind: "nothing" };
  }
  const file = new File([r.html], fileName(r.filename), { type: "text/html" });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return { kind: "nothing" };
  /* A claim, like the meta it mirrors: only ever looked up on this reader's
     own shelf, never fetched (plan 261024y). */
  return { kind: "page", file, savedFrom: typeof r.savedFrom === "string" ? savedSource(r.savedFrom) : null };
}

/** The capture names its own file; it is still a claim, so it is tidied. */
function fileName(claimed: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what a filename must not carry.
  const base = claimed.replace(/[\u0000-\u001f\u007f/\\]/g, " ").replace(/\.html$/i, "").trim().slice(0, 120);
  return `${base || "page"}.html`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no answer")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
