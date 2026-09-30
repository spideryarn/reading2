/**
 * **Which `<mark class="xref">` in the prose is ours, and where it goes** —
 * the one place a cross-reference mark is resolved.
 *
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
 * § 2. A cross-reference is drawn by `xrefMarks` (annotate.ts) as
 * `<mark class="xref" data-xref="<nonce>-<i>">`, where `<i>` indexes the
 * validated artefact the owner's GET returned.
 *
 * ## Why a nonce, and why the target never comes from the DOM
 *
 * An article's own HTML can carry any class and any `data-*` attribute the
 * sanitiser does not forbid, and `data-xref` is not forbidden yet — reserving
 * it at ingress is a defence edit left for Greg (the plan's § Left for Greg).
 * So the DOM cannot be trusted to say either *this is a cross-reference* or
 * *it goes there*. The nonce answers the first: it is random per page load,
 * lives only in this module, and is never stored or sent anywhere, so markup
 * written before this page loaded cannot know it. The artefact answers the
 * second: `to` is read from the links array by index, never from an attribute.
 * A forged mark is therefore an underline that does nothing — no card, no
 * jump — which is the whole of what an article can do with it.
 *
 * **Every handler goes through `xrefTarget`** — TableView's click and Enter,
 * BlockLinkCard's hover and focus. One helper is what keeps the check from
 * being present in three places and missing from the fourth.
 */
import type { BlockId, Crossref } from "../types.js";

/** Twelve hex characters from the platform's CSPRNG. */
function mintNonce(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** This page load's nonce. Module memory only: never stored, never sent. */
export const XREF_NONCE: string = mintNonce();

/** The class and attribute the mark carries. The selector every handler starts from. */
export const XREF_SELECTOR = "mark.xref[data-xref]";

/**
 * The index a mark names **if its nonce is this page's**, else null.
 *
 * Strict on shape — `<nonce>-<digits>` and nothing else — so `x-0`, a nonce
 * with a suffix, or a leading zero all fail rather than being parsed leniently.
 */
export function xrefIndex(el: Element, nonce: string = XREF_NONCE): number | null {
  const value = el.getAttribute("data-xref");
  if (value === null) return null;
  const prefix = `${nonce}-`;
  if (!value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  if (!/^(0|[1-9]\d*)$/.test(rest)) return null;
  return Number(rest);
}

/**
 * **Where the cross-reference under this element goes**, or null when it is not
 * one of ours.
 *
 * `from` is anything inside the prose — an event target, usually. The nearest
 * `mark.xref[data-xref]` is found, its nonce checked, and `to` read from
 * `links` by index. **Never from the DOM.** Null for no mark, a forged or stale
 * nonce, an index past the end, or no links at all (a visitor, a stale
 * artefact, one not generated).
 */
export function xrefTarget(
  from: EventTarget | Element | null,
  links: readonly Crossref[] | null | undefined,
  nonce: string = XREF_NONCE,
): BlockId | null {
  if (!links || links.length === 0) return null;
  const mark = (from as Element | null)?.closest?.(XREF_SELECTOR);
  if (!mark) return null;
  const i = xrefIndex(mark, nonce);
  if (i === null) return null;
  return links[i]?.to ?? null;
}

/** How the card resolves a mark — `xrefTarget` bound to the current links. */
export type XrefResolver = (el: Element) => BlockId | null;
