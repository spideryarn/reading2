/**
 * **`/add-from-extension`: the page the Chrome extension opens with a page it
 * captured.** It asks the extension for the capture, uploads it through the
 * same upload every file goes through, and hands over to `/add/upload/<id>`,
 * the add page as an upload reaches it, with its "why are you reading this"
 * box. docs/plans/261024q-chrome-extension-one-click-add-the-page.md.
 *
 * **Bound to one reader, from mount to send** (GPT Sol, 261024q F1). The
 * extension's answer arrives later, and the account signed in here may have
 * changed by then; reader A's page must never be uploaded as reader B's. So
 * `receive` sends only if, at the moment of sending, this page is still
 * mounted and both the upload engine and the tab still hold the reader it
 * mounted for. After that the engine's own fence holds it, as it does for the
 * shelf's Add. `App` also keys this page on the reader and makes it an add
 * visit (add-visit.ts), so a change of reader replaces it with AddStopped.
 */
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { REPEAT_PASTE_ON_THE_SHELF } from "../messages.js";
import type { LibraryByUrlResponse } from "../types.js";
import {
  type SendMessage,
  type Taken,
  pageSendMessage,
  takeFromExtension,
  trustedExtensionIds,
} from "./extension-handoff.js";
import { Link } from "./Link.js";
import { apiFetch, readJson } from "./lib/api.js";
import { heldReader } from "./lib/session.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { LIBRARY_HREF, addUploadHref, navigate, readHref } from "./router.js";
import { ONE_UPLOAD_AT_A_TIME, type Transfer, uploadEngine } from "./uploadEngine.js";
import { useUpload } from "./useUpload.js";

const ALREADY_SENT =
  "This page has already been sent to Spideryarn from this tab. To add it again, go back to it and press the button.";

/** What the page is showing. */
export type Receiving =
  | { kind: "asking" }
  | { kind: "sent" }
  /** The reader already has an article from the page's address: offered, nothing uploaded. */
  | { kind: "have"; slug: string }
  /** The shelf could not be asked. Nothing uploaded, and the capture is kept for Try again. */
  | { kind: "unchecked" }
  | { kind: "no-extension" }
  | { kind: "nothing" }
  | { kind: "refused"; reason: string | null };

export interface ReceiveDeps {
  take: () => Promise<Taken>;
  /** The slug of the reader's own article from this saved-from address, or
   *  `null` when there is none. Throws when the shelf could not be asked. */
  have: (savedFrom: string) => Promise<string | null>;
  /** Still mounted, and the engine and the tab both still hold this reader. */
  stillFor: () => boolean;
  send: (file: File) => Promise<string | null>;
  go: (href: string) => void;
}

/** The whole page's work, with its edges passed in so a test can decide each. */
export async function receive(deps: ReceiveDeps): Promise<Receiving | null> {
  const taken = await deps.take();
  if (taken.kind !== "page") return taken;
  if (!deps.stillFor()) return null;
  /* **Already on the shelf?** Asked before the upload, so a second press on a
     page the reader has offers that article and spends nothing (plan 261024y).
     A failed ask uploads nothing: treating it as "not there" would be the very
     duplicate this exists to stop (GPT Sol, plan review F3). A page with no
     address has nothing to ask about, and uploads as before. */
  if (taken.savedFrom !== null) {
    let slug: string | null;
    try {
      slug = await deps.have(taken.savedFrom);
    } catch {
      return deps.stillFor() ? { kind: "unchecked" } : null;
    }
    if (!deps.stillFor()) return null;
    if (slug !== null) return { kind: "have", slug };
  }
  let uploadId: string | null;
  try {
    uploadId = await deps.send(taken.file);
  } catch (err) {
    /* `ONE_UPLOAD_AT_A_TIME`: another file is still going in this tab's engine. */
    return { kind: "refused", reason: err instanceof Error ? err.message : null };
  }
  if (uploadId === null) return { kind: "refused", reason: null };
  if (!deps.stillFor()) return null;
  deps.go(addUploadHref(uploadId));
  return { kind: "sent" };
}

/**
 * **One ask per page load and reader**, shared by every mount. The extension
 * hands a capture over once, and React's Strict Mode mounts, unmounts and
 * mounts again in development: without this the first, discarded mount would
 * take the page and the second would be told there is nothing.
 */
let asked: { readerId: string; taken: Promise<Taken>; used: boolean } | null = null;

/** The capture, at most once to the sender: Back to this address in the same
 *  tab must not upload it a second time. */
async function askOnce(readerId: string, sendMessage: SendMessage | undefined): Promise<Taken> {
  if (asked === null || asked.readerId !== readerId) {
    asked = {
      readerId,
      taken: takeFromExtension(trustedExtensionIds(!import.meta.env.PROD), sendMessage),
      used: false,
    };
  }

  return asked.taken;
}

/** Called just before the capture is sent: no later mount may send it again. */
function spendAsk(): boolean {
  if (asked === null || asked.used) return false;
  asked.used = true;
  return true;
}

function releaseAsk(): void {
  if (asked !== null) asked.used = false;
}

/** Taking from the extension is destructive, so wait until the existing file
 *  has stopped owning the tab's one upload engine. */
export function uploadInFlight(transfer: Transfer | null): boolean {
  const phase = transfer?.phase.kind;
  return phase === "hashing" || phase === "granting" || phase === "sending" || phase === "queueing";
}

/**
 * The slug of `readerId`'s article from the address the capture says it was
 * saved from, or `null`; throws when the shelf could not be asked. The lookup
 * is the server's, on that reader's shelf only, and the request is **made for
 * `readerId`**, so a sign-in as somebody else meanwhile cannot send one
 * reader's page address under another's account (`apiFetch`'s `madeFor`;
 * GPT Sol, plan review F2).
 */
export async function alreadyOnShelf(
  savedFrom: string,
  readerId: string,
  fetchFor: typeof apiFetch = apiFetch,
): Promise<string | null> {
  const r = await fetchFor(`/api/library/by-url?url=${encodeURIComponent(savedFrom)}`, {}, readerId);
  return (await readJson<LibraryByUrlResponse>(r)).slug;
}

/** For tests: forget the ask, as a new page load would. */
export function forgetAsk(): void {
  asked = null;
}

export function AddFromExtension({
  readerId,
  sendMessage: given,
}: {
  readerId: string;
  /** For tests: `null` is a browser with no extension API. The page's own
   *  `chrome.runtime.sendMessage` when left out. */
  sendMessage?: SendMessage | null;
}) {
  useDocumentTitle(pageTitle({ kind: "add" }));
  const [sendMessage] = useState(() => (given === undefined ? pageSendMessage() : (given ?? undefined)));
  const [state, setState] = useState<Receiving>({ kind: "asking" });
  /* Bumped by Try again after `unchecked`, to run the effect once more over
     the capture still cached in `asked`. */
  const [attempt, setAttempt] = useState(0);
  const transfer = useUpload();
  const started = useRef(false);
  /* Once this capture has started, its own transfer makes the engine busy. Keep
     `ready` true so that update does not tear down the effect which must route
     to the upload page. */
  const ready = started.current || !uploadInFlight(transfer);

  useEffect(() => {
    if (!ready) return;
    started.current = true;
    let mounted = true;
    void receive({
      take: () => askOnce(readerId, sendMessage),
      have: (savedFrom) => alreadyOnShelf(savedFrom, readerId),
      stillFor: () => mounted && uploadEngine.reader() === readerId && heldReader() === readerId,
      send: async (file) => {
        if (!spendAsk()) throw new Error(ALREADY_SENT);
        try {
          return await uploadEngine.send(file);
        } catch (err) {
          /* Another picker can win while the extension's reply is in flight.
             Keep the File cached in `asked` and try it when that upload ends. */
          if (err instanceof Error && err.message === ONE_UPLOAD_AT_A_TIME) releaseAsk();
          throw err;
        }
      },
      go: (href) => navigate(href, { replace: true }),
    }).then((next) => {
      if (!mounted || next === null) return;
      /* Spent, as a send would be: Back to this address must not upload it. */
      if (next.kind === "have") spendAsk();
      if (next.kind === "refused" && next.reason === ONE_UPLOAD_AT_A_TIME) {
        started.current = false;
        setState({ kind: "asking" });
        return;
      }
      setState(next);
    });
    return () => {
      mounted = false;
    };
    /* Once per mount and Try again: `App` remounts this page for another reader (`key`). */
  }, [readerId, sendMessage, ready, attempt]);

  const failed = transfer?.phase.kind === "failed" ? transfer.phase.reason : null;
  return (
    <main data-add-from-extension className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:py-10 tw:font-sans">
      <header className="tw:mb-6">
        <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">Adding the page</h1>
      </header>
      <p className="tw:m-0 tw:text-foreground" role="status">
        {!ready ? "Waiting for the upload already in progress to finish…" : sentence(state, failed)}
      </p>
      {state.kind === "have" && (
        <div className="tw:mt-4">
          <Button type="button" size="sm" onClick={() => navigate(readHref(state.slug))}>
            Open the article
          </Button>
        </div>
      )}
      {state.kind === "unchecked" && (
        <div className="tw:mt-4">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              started.current = false;
              setState({ kind: "asking" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {state.kind !== "asking" && state.kind !== "sent" && (
        <p className="tw:mt-6 tw:mb-0 tw:text-sm">
          <Link href={LIBRARY_HREF} className="tw:text-muted-foreground tw:hover:text-highlight-text">
            ← Back to the shelf
          </Link>
        </p>
      )}
    </main>
  );
}

function sentence(state: Receiving, failed: string | null): string {
  switch (state.kind) {
    case "asking":
    case "sent":
      return "Getting the page from Spideryarn's Chrome extension…";
    case "have":
      return REPEAT_PASTE_ON_THE_SHELF;
    case "unchecked":
      return "Spideryarn couldn't check whether this page is already on your shelf, so it hasn't been added yet.";
    case "no-extension":
      return "Spideryarn's Chrome extension didn't answer. If it's installed and switched on, go back to the page and press its button again.";
    case "nothing":
      return "There's no page waiting here: it has already been added, or it was captured more than 15 minutes ago. Go back to the page and press the button again.";
    case "refused":
      return state.reason ?? failed ?? "The upload didn't start. Go back to the page and press the button again.";
    default: {
      const never: never = state;
      return never;
    }
  }
}
