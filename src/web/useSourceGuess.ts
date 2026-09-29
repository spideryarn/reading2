/**
 * **Ask, once, where an uploaded paper lives on the web** — the client half of
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md.
 *
 * The server does the search when it is asked and not before (plan § Decisions
 * 2): an upload nobody opens is never searched. This hook is the asking. It
 * fires `POST /api/source-guess/:slug` when the owner's payload says nobody has
 * looked yet (`sourceGuess` undefined) or that a look is under way
 * (`searching` — the server decides whether that means *wait* or *reclaim* a
 * stale claim), and hands back what the server answered so the page can draw it
 * without a reload.
 *
 * ## Where it is mounted, and why that is the whole of "owner-only"
 *
 * In `OwnedArticle` (src/web/article/ArticlePage.tsx), which exists only for
 * the owner — a visitor's `VisitorArticle` never mounts it, so a signed-out
 * browser issues no POST (tests/public-network-trace.test.tsx). There rather
 * than in `OwnedReader` because `OwnedArticle` holds the payload both views
 * draw from and is not remounted when the reader steps between the reading
 * view and the metadata page: the answer lands once and both see it.
 *
 * ## Once, and the ref is what makes it once
 *
 * `<StrictMode>` runs every effect twice in development (main.tsx), and a
 * re-render with a fresh `article` object runs this effect's dependencies
 * again. The ref records the slug already asked about and survives both, so a
 * mount asks at most once per slug — the same construction as the record-open
 * POST beside it. **No cancel flag in the cleanup**, deliberately: StrictMode's
 * simulated unmount would set it, the second run would return early on the
 * ref, and the one answer that did come back would be thrown away. A late
 * answer for a slug the reader has left is dropped by the slug check in the
 * return instead.
 *
 * ## Failures are silent and are not retried
 *
 * A background nicety, like the record-open POST: a 429, a 502 from the
 * provider or a lost connection leaves the line as it was — *uploaded*, with no
 * guess — and the next open asks again. Nothing is said to the reader, because
 * there is nothing they could do about it and the line they already see is
 * true.
 */
import { useEffect, useRef, useState } from "react";

import type { Article, SourceGuess } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { cameOffADisk, webSource } from "./SourceLink.js";

/** A settled answer — the only kind worth layering over the payload. */
export type SettledGuess = Extract<SourceGuess, { status: "found" | "none" }>;

/**
 * **Should this article ask?** An owner's upload with no web address, whose
 * payload has no settled answer. Exported for the tests.
 */
export function wantsSourceGuess(article: Article): boolean {
  if (!cameOffADisk(article.meta) || webSource(article.meta) !== null) return false;
  const guess = article.sourceGuess;
  return guess === undefined || guess.status === "searching";
}

/**
 * The server's answer, checked for shape before it is drawn — a `found` whose
 * fields are not strings would put `undefined` in an `href`. `searching` is not
 * returned: it changes nothing on screen, and layering it would rebuild the
 * reading view for no visible reason.
 */
function settledOf(body: unknown): SettledGuess | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.status === "none") return { status: "none" };
  if (
    b.status === "found" &&
    typeof b.url === "string" &&
    typeof b.host === "string" &&
    (b.kind === "canonical" || b.kind === "matching") &&
    (b.matchedBy === "doi" || b.matchedBy === "arxiv" || b.matchedBy === "content")
  ) {
    return { status: "found", url: b.url, host: b.host, kind: b.kind, matchedBy: b.matchedBy };
  }
  return null;
}

/**
 * The settled answer this mount received for `slug`, or `null` while there is
 * none — in which case the payload's own `sourceGuess` stands.
 */
export function useSourceGuess(slug: string, article: Article): SettledGuess | null {
  const wanted = wantsSourceGuess(article);
  const [answer, setAnswer] = useState<{ slug: string; guess: SettledGuess } | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!wanted || asked.current === slug) return;
    asked.current = slug;
    void (async () => {
      const res = await apiFetch(`/api/source-guess/${encodeURIComponent(slug)}`, {
        method: "POST",
      });
      const guess = settledOf(await readJson<unknown>(res));
      if (guess) setAnswer({ slug, guess });
    })().catch(() => {
      /* Silent on purpose — see the header. */
    });
  }, [slug, wanted]);

  return answer?.slug === slug ? answer.guess : null;
}
