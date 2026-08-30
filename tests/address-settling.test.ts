/**
 * **The one test that would have found all eight, instead of a reviewer finding
 * four of them.**
 *
 * A shared `/read/<slug>` is served by a function that composes the `<title>`
 * from the address (src/public/page-head.ts); the client then settles the
 * address (`settleAddress` in src/web/router.ts) and React sets
 * `document.title`. **Anything the two disagree about is a tab that changes in
 * front of the reader**, a second after the page lands.
 *
 * Eight of those shipped, and they are numbered here to match the section
 * headings in docs/project/page-titles.md, because the number and the list have
 * disagreed twice and GPT Sol caught it both times: (1) whitespace, controls and
 * bidi, (2) the fallback chain, (3) `Loading…`, (4) the mode, (5) the legacy
 * metadata addresses, (6) `?slug=`, (7) `?add=`, (8) the interaction between the
 * hash rewrite and the metadata one.
 *
 * **`not-shared` is not one of the eight**, which is what the miscount kept
 * being: a page that set no title at all is a gap rather than a disagreement
 * between two answers, and it is fixed by a `TitleSpec` variant rather than by
 * anything in this file. Counting it here made a list of nine sit under the word
 * eight for two review rounds.
 *
 * Each fix got a test naming its own case, and
 * that is exactly the shape of testing that let the next one through: **a list
 * of the cases somebody thought of is not a statement about the class.**
 *
 * So this file states the class. It crosses every path shape against every
 * query parameter this app has ever recognised against every hash shape.
 *
 * The eighth is the reason this exists rather than another per-case test. It was
 * an *interaction*: the hash rewrite reserialised the query through
 * `URLSearchParams`, turning `?%61bout=1` into `?about=1`, which made the
 * metadata rewrite two steps later fire on a parameter the server had never
 * seen. No test of either rewrite alone could see it. GPT Sol found it by
 * reading, at the fourth time of asking; a cross-product finds it by arithmetic.
 *
 * ## Two assertions, and the second one took three more rounds
 *
 * The first version asserted only
 *
 *     what the server puts in <title>  ===  what the client ends up setting
 *
 * which is blind, by construction, to both halves being wrong in the same way —
 * and the **tenth** was exactly that: `redirectsToMetadata` read a `?` inside
 * another parameter's value as a parameter boundary, so
 * `?add=https://x.test/a?about=1` went to the metadata page with server and
 * client in cheerful agreement. GPT Sol, 2026-08-30.
 *
 * So every row of the corpus now carries the view it **should** settle on, and
 * that is checked first. An equality test is only as good as its anchor.
 *
 * @see docs/project/page-titles.md § the eight — and the two address bugs
 *      beside them, which is why the count in this file is ten.
 */
import { describe, expect, it } from "vitest";

import type { ServerResponse } from "node:http";

import { DEFAULT_MODE, MODES, type Mode } from "../src/modes.js";
import { servePublicReadPage } from "../src/public/page.js";
import { viewFor, type ArticleView } from "../src/read-address.js";
import type { PublicHead } from "../src/store/public-reader.js";
import { readSlug } from "../src/vercel.js";
import { pageTitle } from "../src/web/page-title.js";
import { parseRoute, settleAddress } from "../src/web/router.js";

const SLUG = "a-shared-piece";
const TITLE = "A shared piece";
const HEAD: PublicHead = { slug: SLUG, title: TITLE, gist: null, canonical: null };

/* A shell with the sentinels, so `composeShell` is exercised rather than a
   stand-in for it — the title asserted below is the one that reaches the
   document. */
const SHELL = [
  "<!doctype html><html><head>",
  "<!-- spideryarn:managed-head:start -->",
  "<title>Spideryarn</title>",
  "<!-- spideryarn:managed-head:end -->",
  "</head><body><div id=root></div></body></html>",
].join("\n");

/**
 * **What the server actually serves for this address** — through
 * `servePublicReadPage`, not through a reassembly of the functions it calls.
 *
 * An earlier version of this helper called `readMode`, `viewFor` and
 * `composeShell` itself. That is a **model of the server**, and a model stays
 * green while production drifts: deleting the `mode` argument at the call site
 * in `src/vercel.ts` would have put the title change straight back with this
 * file none the wiser. GPT Sol, 2026-08-30 — and it is the same fault as
 * everything else in this file, one level up.
 *
 * So the page module now takes the whole address and reads the mode and the view
 * itself, and this drives it. What is left un-covered is one required `url:`
 * argument in `vercel.ts`, which cannot be dropped without the compiler saying
 * so.
 *
 * `null` when the address gets no enhanced head — either not a `/read/<slug>`
 * at all, or the reader is not entitled to one.
 */
async function serverTitle(pathname: string, search: string): Promise<string | null> {
  if (readSlug(pathname) !== SLUG) return null;
  let body = "";
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk?: string) => {
      body += chunk ?? "";
    },
  } as unknown as ServerResponse;

  await servePublicReadPage({
    /* The request as `src/vercel.ts` hands it over: `url` is the *restored*
       address, and it is the only place the address comes from. */
    req: { method: "GET", url: `${pathname}${search}` },
    res,
    slug: SLUG,
    shell: { html: SHELL, sha256: "a".repeat(64) },
    read: async () => HEAD,
  });

  const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? null;
  /* The bare shell title means no head was composed for this address. */
  return title === "Spideryarn" ? null : title;
}

/**
 * **What the client will put in the tab for this address**, once it has stopped
 * moving.
 *
 * `settleAddress` is the *real* pre-mount rewrite sequence — the same function
 * `main.tsx` calls — so this is the client's actual destination rather than a
 * model of it. That is the whole reason the sequence was made a pure function.
 *
 * Returns `null` when the reader ends up somewhere that is not this article's
 * reading view, which the server must then not have titled as the article.
 */
function clientSettles(
  pathname: string,
  search: string,
  hash: string,
): { view: ArticleView; title: string } | null {
  const settled = settleAddress(pathname, search, hash) ?? `${pathname}${search}${hash}`;
  const [beforeHash = ""] = settled.split("#");
  const [path = "", query = ""] = beforeHash.split("?");
  const route = parseRoute(path);
  if (route.kind !== "read" || route.slug !== SLUG) return null;
  const mode = new URLSearchParams(query).get("mode");
  const chosen = (MODES as readonly string[]).includes(mode ?? "")
    ? (mode as Mode)
    : DEFAULT_MODE;
  /* Split by view because `TitleSpec` is: the reading view must carry a mode and
     the other two must not. That is not this test being fussy — it is the type
     that makes App.tsx dropping `mode` a compile error rather than something a
     cross-product has to notice. */
  const title =
    route.view === "article"
      ? pageTitle({ kind: "read", title: TITLE, view: "article", mode: chosen })
      : pageTitle({ kind: "read", title: TITLE, view: route.view });
  return { view: route.view, title };
}

/**
 * **Every query this app recognises, and the page each one should settle on.**
 *
 * The second field is the part that took three review rounds to arrive at.
 * Comparing the server's title with the client's catches every case where the
 * two *disagree* — and says nothing whatever about a case where they agree on
 * the wrong page. GPT Sol found exactly that on 2026-08-30: `redirectsToMetadata`
 * read a `?` inside another parameter's value as a parameter boundary, so
 * `?add=https://x.test/a?about=1` sent the reader to the metadata page, both
 * halves cheerfully concurring. An equality test is only as good as its anchor,
 * and until now this corpus had none.
 *
 * So every row states its own answer, and both halves are checked against it.
 * `%61bout` and `about=%31` are the eighth divergence in its own words — the
 * hash rewrite decoded them on the way past, so the client acted on a parameter
 * the server had not seen — and they redirect, because a percent-encoded
 * unreserved character is the same parameter.
 */
const QUERIES: { search: string; view: ArticleView }[] = [
  { search: "", view: "article" },
  { search: "?mode=glossary", view: "article" },
  { search: "?mode=hierarchy", view: "article" },
  { search: "?mode=toc", view: "article" },
  { search: "?mode=nonsense", view: "article" },
  { search: "?at=spya-k3m9qt", view: "article" },
  { search: "?cols=0,1", view: "article" },
  { search: "?about=1", view: "metadata" },
  { search: "?about=0", view: "article" },
  { search: "?about=2", view: "article" },
  { search: "?panel=about", view: "metadata" },
  { search: "?panel=notes", view: "article" },
  { search: "?%61bout=1", view: "metadata" },
  { search: "?about=%31", view: "metadata" },
  { search: "?panel=%61bout", view: "metadata" },
  { search: "?slug=another-piece", view: "article" },
  { search: "?add=https://example.com/x", view: "article" },
  { search: "?about=1&mode=glossary", view: "metadata" },
  { search: "?mode=glossary&about=1", view: "metadata" },
  { search: "?at=spya-k3m9qt&cols=0,1&mode=summary", view: "article" },
  { search: "?about=1&at=spya-k3m9qt", view: "metadata" },
  /* **A `?` inside a value is not a parameter boundary.** GPT Sol's tenth,
     2026-08-30. Only the first `?` begins the query; after that only `&`
     separates pairs, and every one of these three used to redirect. */
  { search: "?add=https://x.test/a?about=1", view: "article" },
  { search: "?next=https://x.test/?about=1", view: "article" },
  { search: "?x=?panel=about", view: "article" },
  /* Encoded keys, duplicates and order — the classes GPT Sol named as missing,
     2026-08-30. `%61t` is `at` and `%73lug` is `slug` as far as
     `URLSearchParams` is concerned, and a textual filter that does not decode
     the key leaves the old pair sitting in front of the new one. */
  { search: "?%61t=spya-k6fpme", view: "article" },
  { search: "?%73lug=another-piece", view: "article" },
  { search: "?at=spya-k6fpme&at=spya-hqrrtt", view: "article" },
  { search: "?mode=glossary&mode=chat", view: "article" },
  { search: "?mode=chat&mode=glossary", view: "article" },
  { search: "?at=spya-k6fpme&%61t=spya-hqrrtt", view: "article" },
  { search: "?%6dode=glossary", view: "article" },
];

/** Fragments, including the legacy anchor that becomes `?at=` on the way in. */
const HASHES = ["", "#spya-k3m9qt", "#not-an-id", "#%zz"];

describe("the server's title and the client's, over every address either can see", () => {
  it("agree for every combination of query and hash on a shared article", async () => {
    const disagreed: string[] = [];
    let compared = 0;

    for (const { search, view } of QUERIES) {
      for (const hash of HASHES) {
        const server = await serverTitle(`/read/${SLUG}`, search);
        const client = clientSettles(`/read/${SLUG}`, search, hash);

        /* **The client leaving this article is a failure, full stop.**
           An earlier version of this line permitted the server's ordinary
           article title here — which meant restoring the unrestricted `?slug=`
           or `?add=` rewrites produced `client === null`, an ordinary server
           title, and no failure at all. Two of the faults this file claims
           to cover slipped straight through it. GPT Sol checked the predicate
           and reported `caught: false` for both, 2026-08-30.

           Every address in this loop is a `/read/<slug>` that the server gives
           an enhanced head to. If the client walks away from it, the server has
           titled a page the reader will not be looking at, and that is exactly
           the class. (Root legacy entrances are a different case and are not in
           this corpus: there the server composes nothing at all — asserted
           separately below.) */
        if (client === null) {
          disagreed.push(
            `${search}${hash}: the client left this article, but the server titled it ${JSON.stringify(server)}`,
          );
          continue;
        }
        compared++;
        /* **The anchor, checked before the agreement.** Both halves reading the
           same wrong parameter is a bug they agree about, and equality is blind
           to it by construction — the tenth divergence was exactly that. This is
           the row saying what the right answer is, independently of either. */
        if (client.view !== view) {
          disagreed.push(
            `${search}${hash}: settles on the ${client.view} view, and it should be the ${view} view`,
          );
          continue;
        }
        if (server !== client.title) {
          disagreed.push(
            `${search}${hash}\n    server ${JSON.stringify(server)}\n    client ${JSON.stringify(client.title)}`,
          );
        }
      }
    }

    expect(disagreed).toEqual([]);
    /* The control. A cross-product that compared nothing would also report no
       disagreement, and "0 failures out of 0" is the shape of every corpus that
       cannot exercise its arm. */
    expect(compared, "the corpus must actually reach the reading view").toBeGreaterThan(40);
  });

  /**
   * **And the other half of the class: the server composes a head for exactly
   * one shape of address.**
   *
   * The case above varies query and hash over `/read/<slug>`. This varies the
   * path, and asserts the property that makes the case above sufficient — every
   * other path gets no composed title at all, so there is nothing for the client
   * to disagree with. It is what makes `/read/x/metadata` safe, and it is the
   * assertion I should have written instead of reasoning that it was safe: three
   * of the ten were on this axis, and I twice wrote down that it was covered.
   */
  it("composes a head for /read/<slug> and for no other path", async () => {
    for (const pathname of [
      "/",
      "/library",
      "/add/https://example.com/x",
      "/add/upload/spya-k3m9qt",
      `/read/${SLUG}/metadata`,
      `/read/${SLUG}/tweets`,
      "/read/",
      "/profile",
      "/design",
      "/admin",
      "/admin/users",
      "/login",
      "/auth/callback",
      `/read/${SLUG}/nonsense`,
    ]) {
      for (const search of ["", "?mode=glossary", "?about=1", "?slug=other"]) {
        expect(await serverTitle(pathname, search), `${pathname}${search}`).toBeNull();
      }
    }
    /* The control: the one path that *does* compose, or the loop above would
       pass against a server that had stopped composing anything at all. */
    expect(await serverTitle(`/read/${SLUG}`, "")).toBe(`${TITLE} · Spideryarn`);
  });

  /**
   * **The eighth on its own: a rewrite must not change which page you land on.**
   *
   * `%61bout` is `about`. `settleAddress` used to run the query through
   * `URLSearchParams` while lifting the hash into `?at=`, which normalised the
   * escape — so the metadata rewrite two steps later fired on a parameter the
   * server had never seen, and the tab changed. Neither rewrite is wrong alone;
   * it is the sequence, which is why the sequence became one function.
   *
   * **The invariant outlived the rule, and that is the point of writing it this
   * way.** This case first asserted that `%61bout=1` stays on the article, which
   * was true while the predicate matched raw text. On GPT Sol's round-6
   * recommendation the rule changed — percent-encoded unreserved characters are
   * the same parameter, so `%61bout=1`, `about=%31` and `panel=%61bout` all
   * redirect now, and both the decision and the removal decode. Had this case
   * been written as *"stays on the article"* it would now be pinning a decision
   * nobody holds. Written as *"the fragment changes nothing about which page"*
   * it survives the rule change and still reddens on the bug.
   */
  it("does not let the hash rewrite change which page an address settles on", () => {
    for (const search of ["?%61bout=1", "?about=%31", "?panel=%61bout", "?about=1", "?about=0"]) {
      const alone = settleAddress(`/read/${SLUG}`, search, "");
      const withHash = settleAddress(`/read/${SLUG}`, search, "#spya-k3m9qt");
      const page = (href: string | null) =>
        (href ?? `/read/${SLUG}${search}`).split("?")[0];
      expect(page(withHash), `${search} must land on the same page with a fragment on it`).toBe(
        page(alone),
      );
    }

    /* And the two controls, so the loop above is not agreeing that nothing
       redirects. One spelling of each answer, checked absolutely. */
    expect(viewFor("?%61bout=1"), "an encoded key is the same parameter").toBe("metadata");
    expect(viewFor("?about=0"), "a shut panel stays on the article").toBe("article");
  });

  /**
   * **The fragment must beat an `?at=` however that parameter is spelled.**
   *
   * `?%61t=…` is `?at=…` to `URLSearchParams`, which decodes keys. Removing only
   * the literal spelling left both pairs in the query, and `get("at")` returns
   * the first — so the reader landed at the position they had *left* rather than
   * the one the link asked for. GPT Sol found it, 2026-08-30: the ninth address
   * bug, and not a title divergence, which is why the cross-product above cannot
   * see it and this case exists.
   */
  it("lets the fragment beat an ?at= whatever its key is encoded as", () => {
    const HERE = "spya-k3m9qt";
    for (const search of [
      "?at=spya-k6fpme",
      "?%61t=spya-k6fpme",
      "?a%74=spya-k6fpme",
      "?at=spya-k6fpme&%61t=spya-hqrrtt",
    ]) {
      const settled = settleAddress(`/read/${SLUG}`, search, `#${HERE}`) ?? "";
      const at = new URLSearchParams(settled.split("?")[1] ?? "").getAll("at");
      expect(at, search).toEqual([HERE]);
    }
  });

  it("and still keeps every unrelated pair byte for byte while doing it", () => {
    /* The removal decodes the *key* to decide, and then drops or keeps the pair
       whole — so nothing that stays is re-encoded. `?cols=0,1` is the case that
       matters (params.ts spells those commas out on purpose). */
    const settled = settleAddress(`/read/${SLUG}`, "?cols=0,1&%61t=spya-k6fpme&mode=summary", "#spya-k3m9qt") ?? "";
    expect(settled).toContain("cols=0,1");
    expect(settled).toContain("mode=summary");
    expect(settled).not.toContain("spya-k6fpme");
    expect(settled).toContain("at=spya-k3m9qt");
  });

  /**
   * The other rule the eighth taught: the query is edited as **text**, never
   * round-tripped through `URLSearchParams`. This file's `?cols=0,1` case exists
   * because the hash rewrite was re-encoding those commas into `%2C` — still
   * correct, still parsed the same, and no longer readable, which is the thing
   * `params.ts` spells them out to avoid.
   */
  it("carries every other parameter through untouched, exactly as written", () => {
    const settled = settleAddress(`/read/${SLUG}`, "?cols=0,1&mode=summary", "#spya-k3m9qt");
    expect(settled).toContain("cols=0,1");
    expect(settled).not.toContain("cols=0%2C1");
    expect(settled).toContain("mode=summary");
    expect(settled).toContain("at=spya-k3m9qt");
  });
});
