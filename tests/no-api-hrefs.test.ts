/**
 * **No plain link to our own API.**
 *
 * A navigation carries no `Authorization` header, so an `<a href="/api/…">`
 * becomes a 401 page the day the gate lands — and it does not look like auth
 * working, it looks like the thing being linked to having gone missing.
 *
 * There were two, both in Masthead.tsx, both opening the reader's PDF. They are
 * SourceLink.tsx now, which fetches with a token and hands the tab a `blob:`.
 * This test is what will notice the third one.
 *
 * **There are no exemptions, and there was one.** SourceLink kept its `href` at
 * first and cancelled the click, so this file skipped it by name — which meant
 * the test passed while the one component it was written about still reached the
 * API without a token on every middle-click and "Open in new tab". An exemption
 * for the only interesting case is not a test. GPT Sol, 2026-08-27.
 *
 * ## What this cannot see, and where that is handled
 *
 * **Article HTML.** The sanitiser deliberately keeps relative links and images
 * — tests/sanitize.test.ts pins that `<img src="/d.png">` survives, because the
 * block splitter needs figures — so an article can contain `/api/…` in an
 * `href` or a `src` and no grep over our source will ever see it. That is a
 * runtime rule rather than a build-time one, and it lives in src/sanitize.ts
 * with its own tests. GPT Sol, 2026-08-26.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../src/web");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * `href="/api/…"` or `href={`/api/…`}`, in JSX.
 *
 * Deliberately does **not** match `apiFetch("/api/…")` or a comment: the point
 * is a *navigation*, and the string appearing in a fetch or a docstring is
 * exactly what we want everywhere else.
 */
const API_HREF = /href=\{?[`"']\/api\//;

describe("no plain links to our own API", () => {
  it("finds none in src/web", () => {
    const offenders = sources(WEB).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => API_HREF.test(line))
        .map(({ n }) => `${path.relative(WEB, file)}:${n}`),
    );
    expect(offenders).toEqual([]);
  });

  /* The test above passes trivially if the regex is wrong, which is the whole
     failure mode of a grep-shaped test. So: prove it can match. */
  it("would catch one", () => {
    expect(API_HREF.test('<a href="/api/library">shelf</a>')).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal characters are the point — this is JSX source being matched, not a template being built.
    expect(API_HREF.test("<a href={`/api/source/${slug}`}>pdf</a>")).toBe(true);
    expect(API_HREF.test('apiFetch("/api/library")')).toBe(false);
  });
});
