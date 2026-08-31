/**
 * What the browser tab says — src/web/page-title.ts. Pure string work, no DOM.
 *
 * The rules worth pinning are the ones a future edit would break without
 * looking broken:
 *
 *  - **The app's name is last, everywhere except the bare shelf.** Put it first
 *    and every tab in the window starts with the same eleven characters, which
 *    is the exact failure this file was written to end. A test is the only
 *    thing that notices, because either order looks fine on one page.
 *  - **The strapline is on one page only.** Sprinkled everywhere it is
 *    boilerplate, and boilerplate is what Google's own guidance says makes
 *    titles indistinguishable.
 *  - **The default mode leaves no trace.** Easy to "fix" by spelling out
 *    `Contents`, which reads like an improvement and is not.
 *  - **No stranded separators.** A title beginning `" · Spideryarn"` is what an
 *    empty segment joined rather than dropped looks like.
 *
 * The hook is not tested here — it is three lines around `document.title` and a
 * live region, and testing it would mean testing jsdom.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODE, MODES } from "../src/web/params.js";
import {
  APP_NAME,
  articleWaitTitle,
  CLAMP,
  SEP,
  serverComposedHead,
  TAGLINE,
  clamp,
  host,
  pageTitle,
} from "../src/web/page-title.js";

describe("the shelf", () => {
  it("is the one page that leads with the app's name, and the one with the strapline", () => {
    expect(pageTitle({ kind: "library" })).toBe(`${APP_NAME}${SEP}${TAGLINE}`);
  });

  it("drops the strapline the moment the reader narrows it", () => {
    const t = pageTitle({ kind: "library", query: "seth" });
    expect(t).not.toContain(TAGLINE);
    expect(t).toBe(`“seth”${SEP}Shelf${SEP}${APP_NAME}`);
  });

  it("front-loads the search, then the filter, then the page", () => {
    expect(pageTitle({ kind: "library", query: "seth", unread: true })).toBe(
      `“seth”${SEP}Unread${SEP}Shelf${SEP}${APP_NAME}`,
    );
  });

  it("says Unread on its own when that is all that is chosen", () => {
    expect(pageTitle({ kind: "library", unread: true })).toBe(`Unread${SEP}Shelf${SEP}${APP_NAME}`);
  });

  it("treats a box with only spaces in it as an empty box", () => {
    expect(pageTitle({ kind: "library", query: "   " })).toBe(`${APP_NAME}${SEP}${TAGLINE}`);
  });
});

describe("an article", () => {
  const title = "The Mythology of Conscious AI";

  it("leads with the article, not the app", () => {
    expect(pageTitle({ kind: "read", title, view: "article", mode: DEFAULT_MODE })).toBe(
      `${title}${SEP}${APP_NAME}`,
    );
  });

  it("says nothing about the default mode — that is the point of it", () => {
    expect(pageTitle({ kind: "read", title, view: "article", mode: "hierarchy" })).toBe(
      `${title}${SEP}${APP_NAME}`,
    );
  });

  /* Every mode, from `MODES` rather than a list retyped here — an eighth mode
     arriving must fail this test rather than quietly get no name. */
  it("names every other mode, by the word the Dock uses", () => {
    const named: Record<string, string> = {
      outline: "Outline",
      summary: "Summary",
      glossary: "Glossary",
      ideas: "Ideas",
      quotes: "Quotes",
      search: "Search",
      diagram: "Diagram",
      chat: "Chat",
      review: "Review",
      timeline: "Timeline",
    };
    for (const mode of MODES) {
      const t = pageTitle({ kind: "read", title, view: "article", mode });
      if (mode === "hierarchy") {
        expect(t).toBe(`${title}${SEP}${APP_NAME}`);
        continue;
      }
      const word = named[mode];
      expect(word, `${mode} has no expected word — was a mode added?`).toBeDefined();
      expect(t).toBe(`${title}${SEP}${word}${SEP}${APP_NAME}`);
    }
  });

  /* This used to pass a mode to the metadata view and assert it was ignored.
     `TitleSpec` no longer lets that state be built — the reading view requires a
     mode and the other two forbid one — so the case it was defending is a
     compile error now, which is the better place for it. What is left is the
     label itself. */
  it("names the other two views", () => {
    expect(pageTitle({ kind: "read", title, view: "metadata" })).toBe(
      `${title}${SEP}Metadata${SEP}${APP_NAME}`,
    );
    expect(pageTitle({ kind: "read", title, view: "tweets" })).toBe(
      `${title}${SEP}Tweets${SEP}${APP_NAME}`,
    );
  });

  it("has something to say about an article with no title at all", () => {
    expect(pageTitle({ kind: "read", title: "  ", view: "article", mode: DEFAULT_MODE })).toBe(
      `Untitled${SEP}${APP_NAME}`,
    );
  });

  it("clamps a very long title so the app's name survives in a history list", () => {
    const long =
      "Attention Is All You Need But Also A Great Many Other Things Besides Which This Title Will Now List At Length";
    const t = pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE });
    expect(t.endsWith(`${SEP}${APP_NAME}`)).toBe(true);
    expect(t).toContain("…");
    expect(t.length).toBeLessThan(long.length);
  });
});

describe("the pages either side of an article", () => {
  it("names the host being added, not the whole address", () => {
    expect(pageTitle({ kind: "add", source: "https://www.nytimes.com/2026/an-essay" })).toBe(
      `Adding nytimes.com${SEP}${APP_NAME}`,
    );
  });

  it("passes a filename through, because an upload has no host", () => {
    expect(pageTitle({ kind: "add", source: "the-paper.pdf" })).toBe(
      `Adding the-paper.pdf${SEP}${APP_NAME}`,
    );
  });

  it("still says what it is doing when it has nothing to name yet", () => {
    expect(pageTitle({ kind: "add" })).toBe(`Adding an article${SEP}${APP_NAME}`);
  });

  it("gives every other route a name of its own", () => {
    expect(pageTitle({ kind: "profile" })).toBe(`Profile${SEP}${APP_NAME}`);
    expect(pageTitle({ kind: "design" })).toBe(`Design reference${SEP}${APP_NAME}`);
    expect(pageTitle({ kind: "login" })).toBe(`Sign in${SEP}${APP_NAME}`);
    expect(pageTitle({ kind: "callback" })).toBe(`Signing you in${SEP}${APP_NAME}`);
    expect(pageTitle({ kind: "loading" })).toBe(`Loading…${SEP}${APP_NAME}`);
    expect(pageTitle({ kind: "error" })).toBe(`Couldn’t open${SEP}${APP_NAME}`);
  });
});

describe("every title, whatever the page", () => {
  const every = [
    { kind: "library" },
    { kind: "library", query: "x", unread: true },
    { kind: "read", title: "T", view: "article", mode: DEFAULT_MODE },
    { kind: "read", title: "T", view: "article", mode: "search" },
    { kind: "read", title: "T", view: "metadata" },
    { kind: "add" },
    { kind: "add", source: "https://example.com" },
    { kind: "profile" },
    { kind: "design" },
    { kind: "landing" },
    { kind: "login" },
    { kind: "callback" },
    { kind: "loading" },
    { kind: "error" },
  ] as const;

  it("never begins or ends with a stranded separator", () => {
    for (const spec of every) {
      const t = pageTitle(spec);
      expect(t.startsWith(SEP.trim())).toBe(false);
      expect(t.endsWith(SEP.trim())).toBe(false);
      expect(t).not.toContain(`${SEP}${SEP}`);
    }
  });

  /* For these fixtures, not as a universal law: an article genuinely titled
     "Spideryarn" would contain it twice and be perfectly correct. What is being
     pinned is that no *page* adds the app's name a second time of its own
     accord. GPT Sol pointed out the first version of this claimed more than it
     could deliver, 2026-08-27. */
  it("adds the app's name once, for titles that do not contain it themselves", () => {
    for (const spec of every) {
      expect(pageTitle(spec).split(APP_NAME).length - 1, JSON.stringify(spec)).toBe(1);
    }
  });

  it("puts the app's name last on every page except the bare shelf", () => {
    for (const spec of every) {
      const t = pageTitle(spec);
      if (t === `${APP_NAME}${SEP}${TAGLINE}`) continue;
      expect(t.endsWith(APP_NAME)).toBe(true);
    }
  });

  /* Two pages, not one, and they are the same page seen from either side of
     the gate: the bare shelf, and the landing page a signed-out reader gets
     instead of it. Anything else picking up the strapline is a bug — see
     page-title.ts § segments. */
  it("carries the strapline on the two homepages and nowhere else", () => {
    const withTagline = every.filter((s) => pageTitle(s).includes(TAGLINE));
    expect(withTagline).toEqual([{ kind: "library" }, { kind: "landing" }]);
  });
});

describe("clamp", () => {
  it("leaves anything short enough alone", () => {
    expect(clamp("short")).toBe("short");
    expect(clamp("x".repeat(CLAMP))).toBe("x".repeat(CLAMP));
  });

  it("cuts at a word boundary and marks the cut", () => {
    const t = clamp("one two three four five six seven eight nine ten", 20);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toBe("one two three four…");
  });

  /* `slice` counts UTF-16 units, so a cut that lands inside an emoji leaves a
     lone surrogate — rendered as `?`, which is the one character a deliberate
     truncation must never produce. GPT Sol, 2026-08-27. */
  it("never cuts an emoji in half", () => {
    const t = clamp(`${"a".repeat(63)}\u{1F389}bbb`);
    expect(t).toContain("\u{1F389}");
    // A high surrogate not followed by a low one is a broken pair.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(t)).toBe(false);
  });

  it("cuts mid-word rather than down to nothing when there is no space to use", () => {
    // A single 40-character word: honouring the last space would leave "".
    const t = clamp(`${"a".repeat(40)} tail`, 20);
    expect(t).toBe(`${"a".repeat(20)}…`);
  });
});

describe("host", () => {
  it("takes the host off a URL and drops the www", () => {
    expect(host("https://www.nytimes.com/a/b?c=d")).toBe("nytimes.com");
    expect(host("http://example.org:8080/x")).toBe("example.org:8080");
  });

  it("hands back anything that is not a URL, which is how filenames pass through", () => {
    expect(host("the-paper.pdf")).toBe("the-paper.pdf");
    expect(host("")).toBe("");
  });
});

/**
 * **The tab a shared link arrives with, and the rule that stops us wrecking it.**
 *
 * Since 2026-08-29 a public `/read/<slug>` is served with the article's real
 * title already in the tab. `ArticlePage` used to replace that with `Loading…`
 * whenever the fetch ran past 600ms — a cold serverless start against Postgres,
 * routinely — and then put it back. A correct title turning into a worse one and
 * back, announced to a screen reader both times.
 *
 * `articleWaitTitle` is the decision. Its two guards are both load-bearing and
 * each has a case below that fails without it.
 */
describe("what the tab says while a shared article loads", () => {
  const HERE = { slug: "a-shared-piece", title: "A shared piece · Spideryarn" };
  const LOADING = `Loading…${SEP}${APP_NAME}`;
  const ERROR = `Couldn’t open${SEP}${APP_NAME}`;

  it("says nothing, leaving the title the server composed", () => {
    /* The assertion this case is named for and the reason the function exists:
       "" is `useDocumentTitle`'s "not mine to set". */
    expect(articleWaitTitle("loading", HERE.slug, HERE.title, HERE)).toBe("");
  });

  it("but says Loading… once the reader is waiting for a different article", () => {
    /* Guard one. The composed head describes one article; after a navigation
       the server's title is about the page the reader has left, and keeping it
       would be a lie rather than a courtesy. Delete `composed.slug === slug`
       and this is the case that goes red. */
    expect(articleWaitTitle("loading", "some-other-piece", HERE.title, HERE)).toBe(LOADING);
  });

  it("and once something else has already changed the tab", () => {
    /* Guard two, and the case that is easy to miss: a reader who goes
       /read/a → /read/b → back to /read/a still has an `og:url` naming a, so
       the slug check alone passes and b's title would be left standing over a's
       loading page. Comparing the string self-expires the moment anything
       writes a different one. */
    expect(articleWaitTitle("loading", HERE.slug, "Another piece · Spideryarn", HERE)).toBe(LOADING);
  });

  it("and on every page the server did not compose a head for", () => {
    /* An ordinary SPA navigation, a private article, a signed-in reader's own
       shelf — the overwhelming majority of loads, and the behaviour this
       function must leave exactly as it was. */
    expect(articleWaitTitle("loading", HERE.slug, "Spideryarn", null)).toBe(LOADING);
  });

  it("replaces it when the fetch failed, which Loading… deliberately does not", () => {
    /* `Loading…` is a claim that the right title is coming. `Couldn’t open` is a
       claim that it is not, and a broken page must not go on advertising the
       article it could not show. */
    expect(articleWaitTitle("error", HERE.slug, HERE.title, HERE)).toBe(ERROR);
  });

  it("and hands over to the view as soon as the article is here", () => {
    expect(articleWaitTitle("ready", HERE.slug, HERE.title, HERE)).toBe("");
  });
});

describe("reading what the server composed out of the document", () => {
  const docWith = (head: string): Document =>
    new JSDOM(`<!doctype html><html><head>${head}<title>A shared piece · Spideryarn</title></head><body></body></html>`).window.document;

  it("takes the slug from og:url, which is the only thing that carries it", () => {
    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a-shared-piece" />');
    expect(serverComposedHead(d)).toEqual({
      slug: "a-shared-piece",
      title: "A shared piece · Spideryarn",
    });
  });

  it("decodes it, because the server percent-encodes what it writes there", () => {
    const d = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%20b" />');
    expect(serverComposedHead(d)?.slug).toBe("a b");
  });

  it("and says there is none for every page the server did not compose", () => {
    /* The bare shell — every route but a shared article. */
    expect(serverComposedHead(docWith(""))).toBeNull();
    /* A malformed percent-escape makes `decodeURIComponent` throw, and a throw
       at module load would take the whole bundle down over a tab title. */
    const bad = docWith('<meta property="og:url" content="https://www.spideryarn.com/read/a%zz" />');
    expect(serverComposedHead(bad)).toBeNull();
  });
});

/**
 * **A page wired to a route but not to a title is the silent failure here** —
 * it simply inherits whatever the last page set, and a stale title on a new
 * page looks entirely plausible. Nothing in the type system catches it, because
 * a `TitleSpec` variant nobody constructs is not an error.
 *
 * So: every variant of the union has to be constructed somewhere under
 * `src/web/`. A new route that forgets its title fails here as soon as its
 * variant is added, which is the first moment anything can know.
 */
describe("every kind of page is actually wired up", () => {
  const WEB = path.resolve(import.meta.dirname, "..", "src", "web");

  /** The `kind` of every variant, read out of the union rather than retyped. */
  function kinds(): string[] {
    const src = readFileSync(path.join(WEB, "page-title.ts"), "utf8");
    const union = src.slice(src.indexOf("export type TitleSpec ="), src.indexOf("export function pageTitle"));
    return [...union.matchAll(/\{\s*kind:\s*"([a-z-]+)"/g)].map((m) => m[1] as string);
  }

  function callers(): string {
    return readdirSync(WEB, { recursive: true, encoding: "utf8" })
      .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith("page-title.ts"))
      .map((f) => readFileSync(path.join(WEB, f), "utf8"))
      .join("\n");
  }

  it("finds a component constructing each one", () => {
    const found = callers();
    const missing = kinds().filter((k) => !found.includes(`kind: "${k}"`));
    expect(missing).toEqual([]);
  });

  /**
   * **`articleWaitTitle` is only worth anything if `ArticlePage` calls it.**
   *
   * Earlier in this same body of work a guard was written, documented, called by
   * a build check and referred to in its file's header as being in force — and
   * never called from the function it was guarding. The rule against a rule that
   * is documented but not enforced was itself documented and not enforced.
   *
   * This is a **static** check and it says so: it proves the call is written, not
   * that it runs. The dynamic half would mean mounting `ArticlePage`, which
   * drags the whole app in; the six cases above cover the decision itself, and
   * this covers the one failure they cannot see.
   */
  it("and ArticlePage actually asks articleWaitTitle what to say", () => {
    const app = readFileSync(path.join(WEB, "App.tsx"), "utf8");
    expect(app).toContain("articleWaitTitle(");
    /* And has stopped composing the answer itself, which is the shape the call
       replaced — leaving both would put the old behaviour back on some path. */
    expect(app).not.toContain('pageTitle({ kind: "loading" })');
  });

  it("can tell — the union really was read, and it is not empty", () => {
    expect(kinds().length).toBeGreaterThanOrEqual(9);
    expect(kinds()).toContain("library");
  });
});
