// @vitest-environment jsdom
/**
 * **What the owner's metadata page puts first, and what it puts away.**
 *
 * Greg, 2026-09-03, after opening it on a real article:
 *
 * > In general, try and make it easier to understand, with the more important
 * > stuff (for a user) more prominent, and the less important stuff less
 * > visible.
 *
 * The page's order is a claim about what matters, and it is the kind of claim
 * that rots quietly: a section added in the obvious place — the bottom of the
 * return, or next to the thing it was copied from — is a section that has
 * ranked itself. So the order is pinned here rather than left to the reading
 * of a 2,000-line render body.
 *
 * The other half is the identifiers. `temporal-context-reinstatement-spya-dhqkf9`
 * and `spideryarn.article_revisions/<uuid>/` were printed in the header, under
 * the title, on every visit:
 *
 * > I don't know what these are.
 *
 * They are now inside a shut "Technical details", so the assertions about them
 * are assertions of *absence* — and absence is the easy thing to test by
 * accident, so each one is paired with a test that opening the section brings
 * it back. A page that had simply stopped rendering them would pass the first
 * half of this file and fail the second.
 *
 * The one thing that must NOT be put away is the metadata error, which lives in
 * that same section: `docs/reusable/silent-success.md`, and the cross-model
 * review of 2026-08-27 that caught the first version hiding it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Meta } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

/* Same two stubs as tests/metadata-origin.test.tsx, for the same reasons: `?at=`
   needs a nuqs adapter this file has no use for, and the dock is a fixed bar
   with fetches of its own. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Metadata } = await import("../src/web/Metadata.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";
const DIR = "spideryarn.article_revisions/e7efb065-b82d-4442-af7a-148d37895171/";

function article(): Article {
  return {
    meta: { slug: SLUG, title: "Temporal context reinstatement" },
    blocks: [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ],
    assets: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: ["spya-aaaaaa", "spya-aaaaaa"],
          title: "Temporal context reinstatement",
          /* The one sentence, so the section that carries it is on the page at
             all — it is conditional on there being something to put in it. */
          gist: "Putting yourself back where you learned it helps you recall it.",
        },
      },
    },
  } as Article;
}

const STAGES = [
  { step: "fetch", label: "Fetching the page", outputs: ["raw/a.html"], done: true, ranAt: null, bytes: null },
  { step: "extract", label: "Reading the text out", outputs: ["output/a.html"], done: false, ranAt: null, bytes: null },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Answer `GET /api/metadata/:slug` with a body, or fail it with a status. */
function answer(body: Record<string, unknown> | number) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      typeof body === "number"
        ? new Response("{}", { status: body, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    ),
  );
}

async function mount(meta: Partial<Meta> = {}) {
  const a = article();
  await act(async () => {
    root.render(
      createElement(Metadata, {
        slug: SLUG,
        article: { ...a, meta: { ...a.meta, ...meta } },
        onRenamed: () => {},
        onVisibility: () => {},
      }),
    );
  });
}

/** The section headings, in the order the page draws them. */
const sections = () =>
  [...host.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section);

/** The contents list in the margin, in its own order. */
const contents = () =>
  [...host.querySelectorAll("nav[aria-label] button")].map((b) => b.textContent);

/**
 * A section's own disclosure button, by heading.
 *
 * Scoped to `main` on purpose: the contents list in the margin carries a button
 * per section with the same words in it, and it comes first in the document. A
 * page-wide `find` therefore returned the nav entry, whose click handler is
 * `scrollIntoView` — so the first version of these tests was clicking the
 * wrong control and failing on a method jsdom does not implement.
 */
const sectionHeading = (label: string) =>
  [...(host.querySelector("main")?.querySelectorAll("h2 button") ?? [])].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

beforeEach(() => {
  answer({
    slug: SLUG,
    dir: DIR,
    stages: STAGES,
    comments: 0,
    profile: null,
    purpose: null,
    archivedAt: null,
  });
});

describe("what the page puts first", () => {
  it("says what the article is before it says how big it is", async () => {
    await mount();
    const order = sections();

    expect(order).toContain("In one sentence");
    expect(order.indexOf("In one sentence")).toBeLessThan(order.indexOf("At a glance"));
  });

  it("offers the sharing switch above the reader's own notes", async () => {
    await mount();
    const order = sections();

    expect(order.indexOf("Access & sharing")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("Access & sharing")).toBeLessThan(order.indexOf("Your reading"));
  });

  it("puts the machinery last, above only the thing that takes the article off the shelf", async () => {
    await mount();
    const order = sections();

    /* **The last two by name, not a pair of index comparisons.** "Technical
       details is somewhere after Your reading and somewhere before Archive" is
       satisfied by a page that has grown two more sections underneath it — and
       "nothing that takes the article away sits above something somebody came
       here to read" is a claim about the *end* of the page. GPT Sol,
       2026-09-03.

       **It said "Delete this article" until 2026-09-04**, over a control that
       has only ever archived — the rename that answers report
       SPIDERYARN-READING2-19. This line is the pin on the section heading;
       tests/shelf-archive-label.test.tsx pins the shelf's own two. */
    expect(order.slice(-2)).toEqual(["Technical details", "Archive this article"]);
    /* And the first, which is the half of Greg's "directly underneath the
       title" that a section list can actually check. */
    expect(order[0]).toBe("In one sentence");
  });
});

describe("the contents list", () => {
  it("names every section on the page, in the page's own order", async () => {
    await mount();

    /* Derived from the DOM rather than from a second list, which is the whole
       design of PageContents — so this is the test that the derivation runs at
       all, and that it re-runs once the metadata request has landed and the
       conditional sections have appeared. */
    expect(contents()).toEqual(sections());
    expect(contents().length).toBeGreaterThan(3);
  });
});

describe("the two identifiers the owner did not recognise", () => {
  it("keeps them out of the header", async () => {
    await mount();

    /* The heading is `<h1>`, and everything above the first section is the
       identity block. Asserting on that region rather than on the whole page,
       because the strings are legitimately present further down. */
    const header = host.querySelector("main")?.firstElementChild?.parentElement;
    const beforeSections = [...(header?.children ?? [])].slice(
      0,
      [...(header?.children ?? [])].findIndex((el) => el.hasAttribute("data-section")),
    );
    const text = beforeSections.map((el) => el.textContent).join(" ");

    expect(text).not.toContain(SLUG);
    expect(text).not.toContain(DIR);
  });

  it("still holds them, under Technical details, with an explanation each", async () => {
    await mount();
    /* Shut by default, so nothing about them is on the page until asked for —
       and this is the half that stops the test above passing on a page that
       had simply dropped them. */
    expect(host.textContent).not.toContain(DIR);

    const heading = sectionHeading("Technical details");
    expect(heading).toBeTruthy();
    await act(async () => heading?.click());

    expect(host.textContent).toContain(SLUG);
    expect(host.textContent).toContain(DIR);
    /* The labels Greg asked for. Without these the section is the same two
       unexplained strings, one scroll further down. */
    expect(host.textContent).toContain("Address");
    expect(host.textContent).toContain("Stored as");

    /* **And an explanation each, which is what he actually asked for** — the
       labels alone would pass while both tooltips had been deleted. Focus is
       what opens a Tooltip for a keyboard, so it is also how a test asks for
       one. GPT Sol, 2026-09-03. */
    for (const [id, phrase] of [
      /* Phrases unique to each tooltip. "web address" was the first choice for
         the slug and is vacuous: `Origin` prints "No web address was recorded
         for this article" a few lines up, so the assertion passed with the
         tooltip deleted. Each is checked absent BEFORE the trigger is focused,
         which is the only thing that makes the second check mean anything. */
      [SLUG, "random letters"],
      [DIR, "reporting a problem"],
    ] as const) {
      expect(document.body.textContent, `"${phrase}" was already on the page`).not.toContain(phrase);
      const trigger = [
        ...host.querySelectorAll<HTMLButtonElement>("#sec-technical-details button"),
      ].find((b) => b.textContent?.includes(id));
      expect(trigger, `no trigger for ${id}`).toBeTruthy();
      await act(async () => trigger?.focus());
      expect(document.body.textContent).toContain(phrase);
    }
  });

  it("keeps the pipeline stages in there too, shut", async () => {
    await mount();
    /* **Asserted on the output path, not the stage label.** The first version
       of this test used "Fetching the page", which is `fetch`'s label — and
       StageRow draws a stage's label only when it has NOT run, so on a stage
       that has, that string is absent whether the section is open or shut. The
       assertion could not have failed. docs/reusable/silent-success.md. */
    expect(host.textContent).not.toContain("raw/a.html");

    const heading = sectionHeading("Technical details");
    expect(heading).toBeTruthy();
    await act(async () => heading?.click());

    expect(host.textContent).toContain("raw/a.html");
    /* And the other branch of the row, so this covers both shapes of stage. */
    expect(host.textContent).toContain("Reading the text out");
  });
});

describe("the one thing a shut section may not swallow", () => {
  it("opens Technical details when the metadata request failed, error and all", async () => {
    answer(500);
    await mount();

    /* The rule found by the cross-model review of 2026-08-27 and inherited from
       "What we did to it": the error lives in this section, so this section
       stops being collapsible while there is one. A shut heading is exactly
       where a failure goes to not be seen. */
    /* **The section has to be there for its absence to mean anything.** The
       first draft of this test asserted only "no disclosure button", which was
       green before the section existed at all — a check that has never been
       able to fail (docs/reusable/silent-success.md). So: present, open, and
       showing its contents without being asked. */
    /* **Scoped to the section, not to the page.** `expect(host.textContent)` on
       a `/couldn't/` regex passes on this fixture for reasons that have nothing
       to do with this section: `AboutYou` renders "We couldn't read your
       profile just now" and the comments row "Couldn't be counted", off the
       same failed request. The assertion has to read the section itself or it
       is testing two other components. GPT Sol, 2026-09-03. */
    const section = host.querySelector("#sec-technical-details");
    expect(section).toBeTruthy();
    const text = section?.textContent ?? "";

    /* Open, not merely present: no disclosure button, because there is nothing
       to disclose — it is already showing, error and identifier rows both. */
    expect(sectionHeading("Technical details")).toBeUndefined();
    expect(text).toContain("Address");
    /* The fetch's own message, which is the thing that must not be sealed in.
       `readJson` throws with the status in it on a non-2xx. */
    expect(text).toMatch(/500|could not|couldn't|failed/i);
  });
});

/**
 * The PDF row Greg named: *"the one for 'Where it came from / Checked' is very
 * confusing"*.
 *
 * Four states, and the two that are not a number are the ones worth pinning —
 * a scan and an old record both have no `recall`, and telling them apart is the
 * whole point of `unverified`. A "0%" for either would be a lie, in opposite
 * directions.
 */
describe("how well we read the PDF", () => {
  it("states the shortfall, and says what the page count means", async () => {
    await mount({ source: "pdf", pages: 17, pagesChecked: 3, recall: 0.83 });

    expect(sections()).toContain("How well we read the PDF");
    /* 100 − 83, and "judging by" rather than a bare "on 3 of 17 pages", which
       reads as fourteen pages having failed. */
    expect(host.textContent).toContain("About 17%");
    expect(host.textContent).toContain("judging by 3 of 17 pages");
    /* The old heading and the old framing are gone, not merely reworded. */
    expect(sections()).not.toContain("Where it came from");
    expect(host.textContent).not.toContain("83% of the words");
  });

  it("rounds once, so the row and its tooltip cannot disagree", async () => {
    /* 0.835 → 84 found, so 16 missed. Rounded separately these were 17 and 84,
       which is 101% of the document. Metadata.tsx § found(). */
    await mount({ source: "pdf", pages: 4, pagesChecked: 4, recall: 0.835 });

    expect(host.textContent).toContain("About 16%");
  });

  it("says a scan could not be checked rather than giving it a number", async () => {
    await mount({ source: "pdf", pages: 17, pagesChecked: 0, unverified: true });

    expect(host.textContent).toContain("Couldn't be checked");
    expect(host.textContent).not.toContain("About 100%");
    expect(host.textContent).not.toContain("None found");
  });

  it("says a score is missing without inventing a reason for it", async () => {
    await mount({ source: "pdf", pages: 17 });

    /* Not "read before we started recording this", which this said until GPT
       Sol pointed out it is one cause among several: a single-page scan lands
       in this same branch, because `isScan` requires more than one page
       (src/pdf.ts), so it is recorded as neither verified nor scored. */
    expect(host.textContent).toContain("No comparison score was recorded");
    expect(host.textContent).not.toContain("before we started recording");
    expect(host.textContent).not.toContain("None found");
  });

  it("does not call a rounded 100% a perfect transcription", async () => {
    /* Live on a real article: `revistes-ub-30977` stores 0.998, which rounds to
       100 and used to print "None found" over a document that did miss words. */
    await mount({ source: "pdf", pages: 8, pagesChecked: 8, recall: 0.998 });

    expect(host.textContent).toContain("Less than 1%");
    expect(host.textContent).not.toContain("None found");
  });

  it("keeps 'None found' for an actual 1.0", async () => {
    await mount({ source: "pdf", pages: 8, pagesChecked: 8, recall: 1 });

    expect(host.textContent).toContain("None found");
  });
});

/**
 * **The button in that last section, pinned to the act it carries out.**
 *
 * The section heading is pinned above by name, and a heading is not a control:
 * the button under it could be relabelled "Delete", given a bin, or rewired to
 * something else entirely, and every case above would still pass. GPT Sol,
 * 2026-09-04, finding 5.
 *
 * So this asks `tests/shelf-archive-label.test.tsx`'s three questions of the
 * metadata page's own control — the word, the icon, and the request — for the
 * reason that file gives: **it said "Delete this article", with a bin, in
 * destructive red, over a handler that has only ever set `archived_at`**, and
 * Greg filed a report asking for the archive feature the app had had for nine
 * days, because the only word on screen said the opposite.
 */
describe("the button that takes the article off the shelf", () => {
  /** Every request the page makes, so the PATCH can be read back off it. */
  let calls: { url: string; init: RequestInit | undefined }[];

  const META = {
    slug: SLUG,
    dir: DIR,
    stages: STAGES,
    comments: 0,
    profile: null,
    purpose: null,
    archivedAt: null,
  };

  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const json = { headers: { "content-type": "application/json" }, status: 200 };
      /* The route answers with the entry it stored, and the button reads the
         date off *that* rather than off the boolean it sent — `ArchiveArticle`
         in Metadata.tsx says why. */
      if (init?.method === "PATCH") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ entry: { slug: SLUG, archivedAt: "2026-09-04T11:00:00.000Z" } }),
            json,
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(META), json));
    });
  });

  const button = () =>
    [...(host.querySelector("main")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => ["Archive", "Put back", "Delete"].includes(b.textContent?.trim() ?? ""),
    );

  it("says Archive, and never Delete", async () => {
    await mount();

    expect(button()?.textContent?.trim()).toBe("Archive");
    /* Absent rather than merely not asked for: a revert of the rename, or a
       second button appearing beside this one, is exactly the drift worth
       catching. */
    expect(host.querySelector("main")?.textContent).not.toContain("Delete this article");
  });

  /**
   * **A bin says "delete" as loudly as the word does**, and the red said it a
   * third time. Checked by class, because lucide renders its own name onto the
   * `<svg>` — the same instrument tests/shelf-archive-label.test.tsx uses.
   */
  it("draws a box rather than a bin, and is not tinted destructive", async () => {
    await mount();

    expect(button()?.querySelector(".lucide-archive"), "the archive box").toBeTruthy();
    expect(button()?.querySelector(".lucide-trash-2"), "no bin").toBeNull();
    expect(button()?.className, "the colour of something irreversible").not.toContain(
      "destructive",
    );
  });

  /**
   * **The act, not the word.** With the case above, this is the whole point of
   * the section: the label and the request are pinned to each other, so neither
   * can move without the other. `{ archived: true }` and not a `DELETE` — there
   * is no article-deletion route on the server at all (src/routes.ts).
   */
  it("archives the article when it is pressed, and then offers to put it back", async () => {
    await mount();
    await act(async () => {
      button()?.click();
    });

    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch, "no PATCH was sent").toBeTruthy();
    expect(patch?.url).toBe(`/api/library/${SLUG}`);
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ archived: true });
    /* And nothing anywhere asked the server to erase it. */
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);

    /* The same element, relabelled — the reversibility the word promises, on
       screen. */
    expect(button()?.textContent?.trim()).toBe("Put back");
  });
});
