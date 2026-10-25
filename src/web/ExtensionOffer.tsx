/**
 * **Where a reader is told about the Chrome extension, and the one link to it.**
 * Greg asked for it to be findable, not pushed (docs/project/chrome-extension.md
 * § Being found; plan docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md):
 *
 * > I don't think we want to push it because it's only worth them using the
 * > extension if they need it
 *
 * So it is offered where a reader needs it: under an import a site turned
 * away (`UploadInstead`), in Help's *Adding an article*, and as a typed-only
 * row in the command bar. Every one takes the link from `EXTENSION_STORE_URL`,
 * so setting `PRODUCTION_EXTENSION_ID` is the whole change when the store item
 * exists. The `url` prop is for tests, which draw both states without
 * changing the constant.
 *
 * The link leaves our site, so it opens a new tab with no opener: on the add
 * page the failed import is what the reader is standing on.
 */
import { useState } from "react";

import { EXTENSION_STORE_URL } from "./extension-handoff.js";
import { media } from "./media.js";

export const EXTENSION_STORE_LABEL = "Get it from the Chrome Web Store";

/** Help's sentence, the same in both states, so search and the Help chatbot's corpus do not move when the id is set. */
export const EXTENSION_HELP_SENTENCE =
  "In Chrome on a computer, the Spideryarn extension adds the page you are looking at in one press, as your browser shows it, with nothing to save or upload.";

/** What Help says after the sentence while there is no store item. */
export const EXTENSION_NOT_YET = "It is not in the Chrome Web Store yet.";

/**
 * **Whether this device is one the extension is for.** A mouse or a trackpad,
 * as `SavePageBookmarklet` asks: a phone or a bare iPad cannot install a Chrome
 * extension. Not narrowed by user agent: Edge and Brave install from the
 * Chrome Web Store too, and the sentence says Chrome.
 */
export function extensionDevice(): boolean {
  return media("(pointer: fine)");
}

function StoreLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {EXTENSION_STORE_LABEL}
    </a>
  );
}

/** Under a failed import (UploadInstead.tsx): nothing while there is no item, or on a phone. */
export function ExtensionOffer({ url = EXTENSION_STORE_URL }: { url?: string | null }) {
  const [device] = useState(extensionDevice);
  if (url === null || !device) return null;
  return (
    <p className="tw:mt-3 tw:text-sm tw:text-muted-foreground">
      In Chrome on a computer, the Spideryarn extension adds a page like this in one press, as your browser
      shows it, with nothing to save or upload. <StoreLink url={url} />
    </p>
  );
}

/** Help's paragraph (`{{chrome-extension}}`, help-markdown.tsx): the sentence, then the link or "not yet". */
export function ExtensionHelp({ url = EXTENSION_STORE_URL }: { url?: string | null }) {
  return (
    <p>
      {EXTENSION_HELP_SENTENCE} {url === null ? EXTENSION_NOT_YET : <StoreLink url={url} />}
    </p>
  );
}
