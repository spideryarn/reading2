/**
 * **Where the article sends its reader** — Sources › Links' rows: every web
 * address the article's own prose links to, one row per address, in the order
 * a reader first meets it.
 *
 * Asked for through the Feedback button, Greg, 2026-10-10 (spya-s5mzkd):
 * *"Maybe sources should have a submode for external links as well, or perhaps
 * include those in the bibliography somehow."* Plan
 * docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md.
 *
 * **Read off the blocks the prose already draws**: no model, no fetch, nothing
 * stored, so it is the same for an owner and a visitor and is there the moment
 * the article is.
 *
 * **A second parse of the article's links, on purpose.** `articleLinks` in
 * src/chat-tools.ts is the first, and it is also the scope check behind
 * `/api/link-preview` — a defence (docs/project/security-map.md), which this
 * feature does not edit. Its comment warns against a second parse *for an
 * allowlist*; this one only decides what a list draws, so a disagreement costs
 * a row, never a fetch. It keeps the same rules by importing the same pieces:
 * `isWebUrl` and `sameTarget` (src/urls.ts), the inert `<template>` (a `<base>`
 * inside a block reaches nothing), and words-of-its-own for a link to count.
 * tests/outbound-links.test.ts runs fixtures through both and expects the same
 * external addresses.
 *
 * **Two deliberate differences**, both about drawing rather than choosing:
 * an address with a user name or password in it (`hasCredentials`) is left
 * out, as chat's renderer leaves it out (Cited.tsx); and a phrase is clipped
 * at `MAX_PHRASE_CHARS` at a word boundary, while chat uses a hard cut at the
 * same length. One address is one row. Not `carriesCredential`'s wider net: it refuses `?key=` and
 * `?share=` on purpose for a shared cache, and here it would only hide a link
 * the prose beside the list already shows.
 *
 * Imports no React, so a test can call it on fixtures alone.
 */
import type { BlockId, CitationLinkFrom } from "../types.js";
import { hasCredentials, isWebUrl, sameTarget } from "../urls.js";
import { type Citation, describeLink, type ExternalPreview } from "./link-preview.js";

/** A phrase longer than this is clipped at a word for the row; chat's hard-cut `MAX_LINK_TEXT_CHARS` is also 80. */
export const MAX_PHRASE_CHARS = 80;

function clipped(phrase: string): string {
  if (phrase.length <= MAX_PHRASE_CHARS) return phrase;
  const cut = phrase.slice(0, MAX_PHRASE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_PHRASE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The fields of a block this reads — an owner's `Block` and a visitor's both have them. */
export interface LinkedBlock {
  id: BlockId;
  html: string;
}

/** One address the article links to. */
export interface OutboundLink {
  /** The absolute http(s) address, as the article gives it (resolved against its own address when relative). */
  url: string;
  /** The author's own words for it, whitespace collapsed, each phrase once, first-met first. */
  phrases: string[];
  /** Every block that links it, in article order, each once. */
  blockIds: BlockId[];
  /** What the href says about itself (link-preview.ts § `describeLink`). */
  preview: ExternalPreview;
}

/** Add one sighting without making the block walk own grouping's branches too. */
function addLink(
  byUrl: Map<string, OutboundLink>,
  url: string,
  phrase: string,
  blockId: BlockId,
  sourceUrl: string | null,
): void {
  const row = byUrl.get(url);
  if (row) {
    if (!row.phrases.includes(phrase)) row.phrases.push(phrase);
    if (!row.blockIds.includes(blockId)) row.blockIds.push(blockId);
    return;
  }
  const preview = describeLink(url, sourceUrl);
  /* `externalUrl` admitted only a parseable http(s) address with a host, which is
     `describeLink`'s `external`; anything else is a disagreement to skip, not draw. */
  if (preview.kind !== "external") return;
  byUrl.set(url, { url, phrases: [phrase], blockIds: [blockId], preview });
}

/**
 * `null` for a link that does not leave the article, or that this list cannot
 * name: a `#fragment`, the article's own address written the long way round,
 * `mailto:`, `javascript:`, an address carrying a user name or password.
 */
function externalUrl(href: string, sourceUrl: string | null): string | null {
  if (href === "" || href.startsWith("#")) return null;
  let absolute: string | null = null;
  if (isWebUrl(href)) absolute = href;
  else if (sourceUrl) {
    try {
      const resolved = new URL(href, sourceUrl).href;
      absolute = isWebUrl(resolved) ? resolved : null;
    } catch {
      absolute = null;
    }
  }
  if (absolute === null || hasCredentials(absolute)) return null;
  if (sourceUrl && sameTarget(absolute, sourceUrl)) return null;
  return absolute;
}

/**
 * **The rows.** `sourceUrl` is where the article came from (`meta.url`), or
 * `null` for an upload — then a relative href has nothing to resolve against
 * and is left out, and no row says whether it leaves the publication.
 *
 * `doc` is the document whose `<template>` parses each block: the page's own
 * in the browser, a jsdom one in a test.
 */
export function outboundLinks(
  blocks: readonly LinkedBlock[],
  sourceUrl: string | null,
  doc: Document = document,
): OutboundLink[] {
  const template = doc.createElement("template");
  const byUrl = new Map<string, OutboundLink>();
  for (const block of blocks) {
    /* Case-insensitive, as `articleLinks`'s shortcut is: `<A HREF=…>` is valid markup. */
    if (!block.html || !/<a[\s>]/i.test(block.html)) continue;
    template.innerHTML = block.html;
    for (const a of Array.from(template.content.querySelectorAll("a[href]"))) {
      /* An `<a>` around an image has nothing to say about where it goes. */
      const words = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      if (words === "") continue;
      const phrase = clipped(words);
      const url = externalUrl((a.getAttribute("href") ?? "").trim(), sourceUrl);
      if (url === null) continue;
      addLink(byUrl, url, phrase, block.id, sourceUrl);
    }
  }
  return [...byUrl.values()];
}

/** The cited work a link's address belongs to, if Bibliography has one — the *In Bibliography* press. */
export interface LinkableWork {
  id: string;
  /** Absent on a visitor's row whose address the public boundary refused (src/public/dto.ts). */
  url?: string | undefined;
  linkFrom: CitationLinkFrom;
}

/**
 * **The paper an address names, as one comparable string**, or `null`: a DOI
 * lower-cased (DOIs are case-insensitive), an arXiv id without its version.
 * Read by `describeLink`, the same reader the prose's link card uses.
 */
function paperKey(citation: Citation | null): string | null {
  if (citation === null) return null;
  if (citation.label === "DOI") return `doi:${citation.id.toLowerCase()}`;
  if (citation.label === "arXiv") return `arxiv:${citation.id.replace(/v\d+$/, "")}`;
  return null;
}

/**
 * **Bibliography's work at this address**, or `null`. Two ways to match:
 *
 * 1. **The same address**, by `sameTarget`, which ignores the fragment and may
 *    over-match (src/urls.ts) — costing only an *In Bibliography* on an
 *    address that differs by `#…`.
 * 2. **The same paper**, for a work whose link Bibliography made from an
 *    identifier: it rewrites a publisher's DOI page to `doi.org/…` and an arXiv
 *    PDF to `/abs/…` (src/bibliography.ts § `fromAnchor`), so the prose's
 *    `science.org/doi/10.1126/…` and the row's `doi.org/10.1126/…` are one work
 *    at two addresses. GPT Sol's F2 on plan 261011d.
 *
 * A Scholar search is never a match: it is a search for the title, not an
 * address the article gave.
 */
export function workAt(link: Pick<OutboundLink, "url" | "preview">, works: readonly LinkableWork[]): LinkableWork | null {
  const paper = paperKey(link.preview.citation);
  for (const work of works) {
    if (work.linkFrom === "search" || work.url === undefined) continue;
    if (sameTarget(link.url, work.url)) return work;
  }
  if (paper === null) return null;
  for (const work of works) {
    if ((work.linkFrom !== "doi" && work.linkFrom !== "arxiv") || work.url === undefined) continue;
    const theirs = describeLink(work.url, null);
    if (theirs.kind === "external" && paperKey(theirs.citation) === paper) return work;
  }
  return null;
}
