/**
 * **The addresses the author lookup offers but never applies** — plan
 * docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md
 * § D3, D4 and Revision 1.
 *
 * Greg, #686: *"maybe you could have tried to guess, based on other Ink &
 * Switch people, what the email address might be. And so you could list a few
 * with tooltips for me with a level of confidence for each."*
 *
 * Pure. **Every confidence here is computed, never the model's** (R3): a
 * model's "high" is only its word, and Greg acts on the chip.
 *
 * - written on a page the lookup read (D2): *high* when the address names the
 *   author, *medium* otherwise — the page was only *taken* for theirs (R2);
 * - seen in a search result but not in the author's name (R1): *medium*;
 * - a guess: *medium* only when a colleague's address, seen as a whole token in
 *   the result the model cited, follows a name pattern that turns the author's
 *   name into exactly this guess, at the same domain, and that domain is not a
 *   public mail provider. Every other guess is *low*. No guess is *high*.
 *
 * None of these ever fills the draft. *Use this address* on the page is Greg's
 * own edit, through the ordinary `PATCH`.
 */

import type { AdminLookupCandidate, CandidateConfidence } from "./admin-author-gifts.js";
import { addressNamesAuthor, type PageRead } from "./author-page.js";
import { looksLikeEmail, normaliseEmail } from "./email-address.js";

/** At most this many a lookup (R5). */
export const CANDIDATES_MAX = 8;
/** At most this many guesses the model may offer; more are dropped. */
export const GUESSES_MAX = 3;

/**
 * One offered address — the wire's shape exactly, so the store writes what the
 * page reads. `sourceUrl` is the page it was seen on, or the result a guess's
 * colleague was seen in; null for an unsupported guess.
 */
export type AddressCandidate = AdminLookupCandidate;

/* ------------------------------------------------------------- patterns -- */

/** Lower-case letters only, accents folded. */
function letters(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** First and last name, folded; null when there are not two. */
function firstLast(name: string): { f: string; l: string } | null {
  const words = name
    .split(/[\s,]+/)
    .map(letters)
    .filter((w) => w !== "");
  const f = words[0];
  const l = words[words.length - 1];
  return words.length >= 2 && f && l ? { f, l } : null;
}

/** The address patterns institutions use, by name. */
const PATTERNS: Record<string, (f: string, l: string) => string> = {
  "first.last": (f, l) => `${f}.${l}`,
  firstlast: (f, l) => `${f}${l}`,
  first_last: (f, l) => `${f}_${l}`,
  "first-last": (f, l) => `${f}-${l}`,
  flast: (f, l) => `${f[0]}${l}`,
  "f.last": (f, l) => `${f[0]}.${l}`,
  first: (f) => f,
  last: (_f, l) => l,
  lastf: (f, l) => `${l}${f[0]}`,
  firstl: (f, l) => `${f}${l[0]}`,
};

/** Which patterns turn this person's name into this local part. */
export function patternsFor(name: string, local: string): string[] {
  const n = firstLast(name);
  if (!n) return [];
  const want = local.toLowerCase();
  return Object.entries(PATTERNS)
    .filter(([, make]) => make(n.f, n.l) === want)
    .map(([key]) => key);
}

/** Free mail: the same domain says nothing about an institution's pattern. */
const PUBLIC_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me", "pm.me", "aol.com", "gmx.com",
  "gmx.de", "gmx.net", "fastmail.com", "hey.com", "yandex.com", "yandex.ru", "qq.com", "163.com",
  "mail.com", "zoho.com", "tutanota.com",
]);

export function isPublicMailDomain(domain: string): boolean {
  return PUBLIC_MAIL.has(domain.toLowerCase());
}

/* --------------------------------------------------------------- guesses -- */

/** A guess as the model gave it, after shape checks; the colleague checked against the results. */
export interface CheckedGuess {
  readonly address: string;
  /** The colleague whose address was seen, if the model named one and it checked out. */
  readonly colleague: { readonly name: string; readonly address: string; readonly sourceUrl: string } | null;
}

/**
 * **One guess's confidence and its reason** (R3). `authorName` is the name
 * the lookup is working from; null makes every guess *low*.
 */
export function judgeGuess(guess: CheckedGuess, authorName: string | null): AddressCandidate {
  const [local = "", domain = ""] = guess.address.split("@");
  const c = guess.colleague;
  if (c && authorName) {
    const [cLocal = "", cDomain = ""] = c.address.split("@");
    const shared = patternsFor(c.name, cLocal).filter((p) => patternsFor(authorName, local).includes(p));
    const sameDomain = cDomain === domain;
    if (shared.length > 0 && sameDomain && !isPublicMailDomain(domain)) {
      return {
        address: guess.address,
        kind: "guess",
        confidence: "medium",
        why: `A guess: ${c.name}'s address, ${c.address}, follows the pattern ${shared[0]}, and that pattern gives this one for ${authorName}.`,
        sourceUrl: c.sourceUrl,
        patternSeen: true,
      };
    }
    const reason = !sameDomain
      ? `${c.name}'s address, ${c.address}, is at a different domain`
      : isPublicMailDomain(domain)
        ? `${domain} is a public mail service, so a colleague's address there says nothing about this one`
        : `${c.name}'s address, ${c.address}, does not follow a pattern that gives this one`;
    return { address: guess.address, kind: "guess", confidence: "low", why: `A long shot: ${reason}.`, sourceUrl: c.sourceUrl, patternSeen: false };
  }
  return {
    address: guess.address,
    kind: "guess",
    confidence: "low",
    why: "A long shot: no colleague's address was seen to support it.",
    sourceUrl: null,
    patternSeen: false,
  };
}

/* ------------------------------------------------------------- assembly -- */

const RANK: Record<CandidateConfidence, number> = { high: 0, medium: 1, low: 2 };

export interface CandidateSources {
  /** The name the lookup is working from, for the *names the author* check. */
  readonly authorName: string | null;
  /** An address seen in a search result that did not name the author (R1). */
  readonly seenNotNamed: { readonly address: string; readonly sourceUrl: string } | null;
  /** The pages read (D2). */
  readonly pages: readonly PageRead[];
  readonly guesses: readonly CheckedGuess[];
  /** The model's old not-seen suggestion, offered only when it is address-shaped (R7). */
  readonly suggestedEmail?: string | null;
  /** Addresses never to list: the one that filled the draft. */
  readonly exclude: readonly string[];
}

/** Host and path, for the reason line — the full URL is the source link beside it. */
function placeOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * **Every candidate, best first, each address once, at most
 * `CANDIDATES_MAX`.** Ties keep the order of the kinds: written on a page,
 * seen in a result, guessed.
 */
export function assembleCandidates(s: CandidateSources): AddressCandidate[] {
  const out: AddressCandidate[] = [];
  const seen = new Set(s.exclude.map(normaliseEmail));
  const push = (c: AddressCandidate) => {
    const address = normaliseEmail(c.address);
    if (!looksLikeEmail(address) || seen.has(address)) return;
    seen.add(address);
    out.push({ ...c, address });
  };

  for (const page of s.pages) {
    if (page.kind !== "read") continue;
    for (const a of page.addresses) {
      const named = addressNamesAuthor(a.address, s.authorName);
      const how = a.disguised ? "written in disguise" : "written";
      push({
        address: a.address,
        kind: a.disguised ? "on-page-disguised" : "on-page",
        confidence: named ? "high" : "medium",
        why: `${how[0]?.toUpperCase()}${how.slice(1)} on ${placeOf(page.url)}, the page the lookup took for theirs${named ? ", and in the author's name" : ", but not in the author's name"}.`,
        sourceUrl: page.url,
        patternSeen: null,
      });
    }
  }
  if (s.seenNotNamed) {
    push({
      address: s.seenNotNamed.address,
      kind: "in-result",
      confidence: "medium",
      why: `Seen on ${placeOf(s.seenNotNamed.sourceUrl)}, and named by the lookup as theirs, but not in the author's name — it may be a colleague's or a shared inbox.`,
      sourceUrl: s.seenNotNamed.sourceUrl,
      patternSeen: null,
    });
  }
  for (const g of s.guesses) push(judgeGuess(g, s.authorName));
  if (s.suggestedEmail) {
    push({
      address: s.suggestedEmail,
      kind: "guess",
      confidence: "low",
      why: "The lookup gave this address, but it was not written in any search result it was checked against.",
      sourceUrl: null,
      patternSeen: false,
    });
  }

  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.confidence] - RANK[b.c.confidence] || a.i - b.i)
    .map(({ c }) => c)
    .slice(0, CANDIDATES_MAX);
}
